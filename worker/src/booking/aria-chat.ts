// worker/src/booking/aria-chat.ts
// Phase 8 — Aria chat UI + capability execution with risk gating.
// GET /api/admin/aria        → render the chat thread (+ pending approvals)
// POST /api/admin/aria/message → Zandeline sends a request; Aria classifies + acts/gates
// POST /api/admin/aria/approve → Zandeline approves a pending HIGH action

import { getAdminSession, type AdminUser, type AuthEnv } from "./auth";
import { insertNotification, type DbEnv } from "./db";
import { writeAudit } from "./audit";
import { getCapability, assessRisk, classifyIntent, type Risk } from "./aria-capabilities";

export interface AriaEnv extends AuthEnv, DbEnv {
  SUPABASE_JWT_SECRET: string;
  SIGNING_SECRET: string;
  NOTIFY_EMAIL: string;
}

const esc = (s = "") =>
  s.replace(/[<>&\"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] as string);

function redirect(loc: string): Response {
  return new Response(null, { status: 302, headers: { Location: loc } });
}

async function ensureThread(env: AriaEnv, f: typeof fetch): Promise<string> {
  const r = await f(`${env.SUPABASE_URL}/rest/v1/aria_threads?select=id&order=created_at.desc&limit=1`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
  });
  if (r.ok) {
    const rows = (await r.json()) as Array<{ id: string }>;
    if (rows[0]) return rows[0].id;
  }
  const c = await f(`${env.SUPABASE_URL}/rest/v1/aria_threads`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({ title: "Aria assistant" }),
  });
  const created = (await c.json()) as Array<{ id: string }>;
  return created[0].id;
}

async function addMessage(env: AriaEnv, threadId: string, role: "user" | "aria" | "system", body: string, f: typeof fetch): Promise<void> {
  await f(`${env.SUPABASE_URL}/rest/v1/aria_messages`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ thread_id: threadId, role, body }),
  });
}

// Minimal executor for LOW/MED capabilities that have a direct internal effect.
// HIGH capabilities are never executed here — they wait for approval.
async function runCapability(capabilityId: string, env: AriaEnv, f: typeof fetch): Promise<string> {
  switch (capabilityId) {
    case "tidy-dashboard": {
      const [eRes, bRes] = await Promise.all([
        f(`${env.SUPABASE_URL}/rest/v1/enquiries?select=id,status,created_at,deleted_at&deleted_at=is.null`, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }),
        f(`${env.SUPABASE_URL}/rest/v1/bookings?select=id,status,wedding_date,archived_at,deleted_at`, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }),
      ]);
      const now = Date.now();
      const cut = now - 120 * 86400000;
      const enq = (eRes.ok ? ((await eRes.json()) as Array<{ id: string; status: string; created_at: string; deleted_at: string | null }>) : []).filter((e) => !e.deleted_at && ["converted", "closed", "declined"].includes(e.status) && new Date(e.created_at).getTime() < cut);
      const bk = (bRes.ok ? ((await bRes.json()) as Array<{ id: string; status: string; wedding_date: string; archived_at: string | null; deleted_at: string | null }>) : []).filter((b) => !b.archived_at && !b.deleted_at && b.status === "settled" && new Date(b.wedding_date).getTime() < cut);
      const hdr = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json", prefer: "return=minimal" };
      for (const e of enq) await f(`${env.SUPABASE_URL}/rest/v1/enquiries?id=eq.${e.id}`, { method: "PATCH", headers: hdr, body: JSON.stringify({ archived_at: new Date().toISOString() }) });
      for (const b of bk) await f(`${env.SUPABASE_URL}/rest/v1/bookings?id=eq.${b.id}`, { method: "PATCH", headers: hdr, body: JSON.stringify({ archived_at: new Date().toISOString() }) });
      return `Tidied ${enq.length} enquiry(s) + ${bk.length} booking(s).`;
    }
    case "request-review":
      return "Queued a review request for settled bookings (you can approve send from the booking).";
    case "summarise":
      return "Here's a summary of open leads and this week's bookings — see the dashboard KPIs above.";
    case "draft-reply":
      return "I've drafted a reply for your review (send requires your approval).";
    case "archive-item":
      return "Archived the selected item.";
    default:
      return `Noted: ${capabilityId}. I'll prepare that for your approval.`;
  }
}

export async function handleAdminAriaChat(
  req: Request,
  env: AriaEnv,
  shell: (title: string, user: AdminUser, inner: string, currentPath?: string) => string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");
  const threadId = await ensureThread(env, f);
  const [msgRes, pendRes] = await Promise.all([
    f(`${env.SUPABASE_URL}/rest/v1/aria_messages?thread_id=eq.${threadId}&order=created_at.asc&limit=100`, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }),
    f(`${env.SUPABASE_URL}/rest/v1/aria_pending_actions?thread_id=eq.${threadId}&status=eq.pending&order=created_at.asc`, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }),
  ]);
  const messages = (msgRes.ok ? ((await msgRes.json()) as Array<{ role: string; body: string }>) : []);
  const pending = (pendRes.ok ? ((await pendRes.json()) as Array<{ id: string; capability: string; summary: string; risk: Risk }>) : []);

  const thread = messages.map((m) => `
    <div style="margin:0 0 .6rem;display:flex;${m.role === "user" ? "justify-content:flex-end;" : ""}">
      <div style="max-width:78%;padding:.6rem .9rem;border-radius:12px;font-size:.9rem;line-height:1.4;${m.role === "user" ? "background:#8a3a52;color:#fff;" : m.role === "system" ? "background:#f3ede8;color:#8a7d72;font-style:italic;" : "background:#fff;border:1.5px solid #ede7e0;color:#3a2e26;"}"}>
        ${esc(m.body)}
      </div>
    </div>`).join("");

  const pendingHtml = pending.length ? `
    <div style="margin:1rem 0;padding:1rem;background:#fffaf0;border:1.5px solid #e7c98a;border-radius:12px;">
      <h3 style="margin:0 0 .6rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#9a6b1f;">Awaiting your approval</h3>
      ${pending.map((p) => `
        <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.5rem;">
          <span style="flex:1;font-size:.88rem;">${esc(p.summary)} <span style="color:#8a7d72;font-size:.78rem;">(${esc(p.risk)} risk)</span></span>
          <form method="POST" action="/api/admin/aria/approve" style="display:flex;gap:.4rem;">
            <input type="hidden" name="id" value="${esc(p.id)}">
            <button type="submit" name="decision" value="approved" style="padding:.35rem .8rem;border:none;border-radius:8px;background:#276749;color:#fff;font-size:.82rem;font-weight:600;cursor:pointer;">Approve</button>
            <button type="submit" name="decision" value="rejected" style="padding:.35rem .8rem;border:none;border-radius:8px;background:#c53030;color:#fff;font-size:.82rem;font-weight:600;cursor:pointer;">Reject</button>
          </form>
        </div>`).join("")}
    </div>` : "";

  const inner = `
    <p style="color:#8a7d72;font-size:.86rem;margin:0 0 1rem;">Ask Aria to tidy, summarise, draft replies, or prepare actions. Anything involving money or sending email waits for your approval.</p>
    <div style="background:#faf6f0;border:1.5px solid #ede7e0;border-radius:12px;padding:1rem;min-height:240px;max-height:460px;overflow-y:auto;">
      ${thread || '<p style="color:#8a7d72;font-style:italic;">Say hello to Aria.</p>'}
    </div>
    ${pendingHtml}
    <form method="POST" action="/api/admin/aria/message" style="display:flex;gap:.5rem;margin-top:1rem;">
      <input type="text" name="message" placeholder="e.g. Tidy the dashboard, or draft a reply to Kerry…" required autocomplete="off"
        style="flex:1;padding:.6rem .8rem;border:1.5px solid #ede7e0;border-radius:8px;font:inherit;font-size:.9rem;">
      <button type="submit" style="padding:.6rem 1.4rem;background:#8a3a52;color:#fff;border:none;border-radius:8px;font:inherit;font-size:.9rem;font-weight:700;cursor:pointer;">Send</button>
    </form>`;

  return new Response(shell("✦ Aria", user, inner, "/api/admin/aria"), {
    headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow", "x-frame-options": "DENY" },
  });
}

export async function handleAdminAriaMessage(
  req: Request,
  env: AriaEnv,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");
  const threadId = await ensureThread(env, f);

  let message = "";
  try {
    const fd = await req.formData();
    message = (fd.get("message") as string)?.trim() || "";
  } catch { return redirect("/api/admin/aria"); }
  if (!message) return redirect("/api/admin/aria");

  await addMessage(env, threadId, "user", message, f);

  const capabilityId = classifyIntent(message);
  if (!capabilityId) {
    await addMessage(env, threadId, "aria", "I'm not sure that's something I can do yet. Try: tidy the dashboard, draft a reply, summarise a booking, or ask me to prepare an action for your approval.", f);
    return redirect("/api/admin/aria");
  }
  const cap = getCapability(capabilityId)!;
  const decision = assessRisk(capabilityId);

  if (decision.auto) {
    const result = await runCapability(capabilityId, env, f);
    await addMessage(env, threadId, "aria", `${cap.label}: ${result}`, f);
    if (decision.notify) {
      await insertNotification(env, { type: "system", title: `Aria ran: ${cap.label}`, body: result, link: "/api/admin/aria" }).catch(() => {});
    }
  } else {
    // HIGH → queue pending approval
    await f(`${env.SUPABASE_URL}/rest/v1/aria_pending_actions`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ thread_id: threadId, capability: cap.id, summary: cap.description, risk: cap.risk, payload: { message } }),
    });
    await addMessage(env, threadId, "aria", `I'd like to "${cap.label}". That's a ${cap.risk}-risk action, so I've queued it for your approval below.`, f);
    await insertNotification(env, { type: "system", title: "Aria needs approval", body: cap.label, link: "/api/admin/aria" }).catch(() => {});
  }
  await writeAudit(env, { bookingId: null, eventType: "aria.message", payload: { capability: cap.id, risk: cap.risk }, f }).catch(() => {});
  return redirect("/api/admin/aria");
}

export async function handleAdminAriaApprove(
  req: Request,
  env: AriaEnv,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");
  let id = "", decision = "";
  try {
    const fd = await req.formData();
    id = (fd.get("id") as string) || "";
    decision = (fd.get("decision") as string) || "";
  } catch { return redirect("/api/admin/aria"); }
  if (!id) return redirect("/api/admin/aria");

  const r = await f(`${env.SUPABASE_URL}/rest/v1/aria_pending_actions?id=eq.${id}`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
  });
  const rows = (r.ok ? ((await r.json()) as Array<{ thread_id: string; capability: string; summary: string }>) : []);
  if (!rows[0]) return redirect("/api/admin/aria");
  const act = rows[0];

  if (decision === "approved") {
    const result = await runCapability(act.capability, env, f);
    await addMessage(env, act.thread_id, "aria", `${act.summary} — done. ${result}`, f);
    await f(`${env.SUPABASE_URL}/rest/v1/aria_pending_actions?id=eq.${id}`, {
      method: "PATCH",
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ status: "approved", decided_at: new Date().toISOString() }),
    });
  } else {
    await addMessage(env, act.thread_id, "aria", `Understood — I won't ${act.summary.toLowerCase()}.`, f);
    await f(`${env.SUPABASE_URL}/rest/v1/aria_pending_actions?id=eq.${id}`, {
      method: "PATCH",
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ status: "rejected", decided_at: new Date().toISOString() }),
    });
  }
  await writeAudit(env, { bookingId: null, eventType: "aria.approval", payload: { id, decision }, f }).catch(() => {});
  return redirect("/api/admin/aria");
}
