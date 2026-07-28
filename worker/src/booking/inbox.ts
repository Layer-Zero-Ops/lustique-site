// worker/src/booking/inbox.ts
// Phase 1 — Unified inbox: merges enquiries + bookings + rejections into ONE
// timeline so Zandeline can see every submission in one place and clean up
// (bulk archive) without hunting across four screens.

import { getAdminSession, type AdminUser } from "./auth";
import { computeKpis, formatZAR, isZeroTotal, isQuoteExpired, isBalanceOverdue, type KpiBooking, type KpiEnquiry } from "./dashboard-kpi";
import { computeOutcomes, formatMinutes, type AutomationEvent } from "./dashboard-outcomes";
import type { Env } from "../index";

export type ShellFn = (title: string, user: AdminUser, inner: string, currentPath?: string) => string;

const esc = (s = "") =>
  s.replace(/[<>&\"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] as string);

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}
function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}
const fmtDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");

interface UnifiedRow {
  kind: "enquiry" | "booking" | "rejection";
  id: string;
  name: string;
  date: string; // event/wedding date or —
  received: string;
  status: string;
  total_cents: number;
  at_risk: boolean;
  detailHref: string;
}

function riskFlag(b: KpiBooking, now: number): boolean {
  return isZeroTotal(b) || isQuoteExpired(b, now) || isBalanceOverdue(b, now) || (b.balance_net_cents > 0 && b.status !== "settled");
}

// ── GET /api/admin/inbox ──────────────────────────────────────────────────────
export async function handleAdminInbox(
  req: Request,
  env: Env & { SUPABASE_JWT_SECRET: string },
  shell: ShellFn,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const url = new URL(req.url);
  const onlyRisk = url.searchParams.get("risk") === "1";
  const hdr = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
  const now = Date.now();

  const [enqRes, bkRes, rejRes, evtRes] = await Promise.all([
    f(`${env.SUPABASE_URL}/rest/v1/enquiries?select=id,name,created_at,status,booking_id,archived_at,event_date&archived_at=is.null&order=created_at.desc`, { headers: hdr }),
    f(`${env.SUPABASE_URL}/rest/v1/bookings?select=id,reference,bride_name,wedding_date,total_cents,status,created_at,archived_at,quote_sent_at,deposit_net_cents,balance_net_cents,availability_conflict&archived_at=is.null&order=created_at.desc`, { headers: hdr }),
    f(`${env.SUPABASE_URL}/rest/v1/rejections?select=id,created_at,bookings(reference,bride_name)&order=created_at.desc`, { headers: hdr }),
    f(`${env.SUPABASE_URL}/rest/v1/notifications?select=type,created_at&created_at=gte.${new Date(now - 7 * 86400000).toISOString()}&order=created_at.desc&limit=500`, { headers: hdr }),
  ]);

  const enquiries = enqRes.ok ? ((await enqRes.json()) as any[]) : [];
  const bookings = bkRes.ok ? ((await bkRes.json()) as any[]) : [];
  const rejections = rejRes.ok ? ((await rejRes.json()) as any[]) : [];

  const rows: UnifiedRow[] = [
    ...enquiries.map((e) => ({
      kind: "enquiry" as const,
      id: e.id,
      name: e.name ?? "—",
      date: e.event_date ?? "—",
      received: e.created_at,
      status: e.status ?? "new",
      total_cents: 0,
      at_risk: !e.booking_id && daysSince(e.created_at) > 7,
      detailHref: `/api/admin/enquiries/${e.id}`,
    })),
    ...bookings.map((b) => {
      const kb: KpiBooking = {
        status: b.status,
        total_cents: b.total_cents ?? 0,
        deposit_net_cents: b.deposit_net_cents ?? 0,
        balance_net_cents: b.balance_net_cents ?? 0,
        wedding_date: b.wedding_date,
        created_at: b.created_at,
        quote_sent_at: b.quote_sent_at ?? null,
        archived_at: b.archived_at ?? null,
      };
      return {
        kind: "booking" as const,
        id: b.id,
        name: b.bride_name ?? b.reference ?? "—",
        date: b.wedding_date ?? "—",
        received: b.created_at,
        status: b.status,
        total_cents: b.total_cents ?? 0,
        at_risk: riskFlag(kb, now),
        detailHref: `/api/admin/booking/${b.id}`,
      };
    }),
    ...rejections.map((r) => ({
      kind: "rejection" as const,
      id: r.id,
      name: r.bookings?.bride_name ?? r.bookings?.reference ?? "—",
      date: "—",
      received: r.created_at,
      status: "declined",
      total_cents: 0,
      at_risk: false,
      detailHref: `/api/admin/rejections`,
    })),
  ];

  rows.sort((a, b) => (a.received < b.received ? 1 : -1));
  const visible = onlyRisk ? rows.filter((r) => r.at_risk) : rows;

  // KPI header
  const kpi = computeKpis(
    bookings.map((b) => ({
      status: b.status,
      total_cents: b.total_cents ?? 0,
      deposit_net_cents: b.deposit_net_cents ?? 0,
      balance_net_cents: b.balance_net_cents ?? 0,
      wedding_date: b.wedding_date,
      created_at: b.created_at,
      quote_sent_at: b.quote_sent_at ?? null,
      archived_at: b.archived_at ?? null,
    })),
    enquiries.map((e) => ({ id: e.id, status: e.status, created_at: e.created_at, booking_id: e.booking_id, archived_at: e.archived_at })),
    now,
  );

  const events: AutomationEvent[] = evtRes.ok ? ((await evtRes.json()) as AutomationEvent[]) : [];

  // Pillar 6 — outcome-framed hero (reclaimed time + coordination score)
  const outcomes = computeOutcomes({
    pipeline_cents: kpi.pipeline_cents,
    booked_cents: kpi.booked_cents,
    collected_cents: kpi.collected_cents,
    owed_cents: kpi.owed_cents,
    collection_pct: kpi.collection_pct,
    open_enquiries: kpi.open_enquiries,
    at_risk_count: kpi.at_risk_count,
    conversion_pct: kpi.conversion_pct,
    events,
    now,
  });

  const scoreColor = outcomes.coordination_score >= 70 ? "#276749" : outcomes.coordination_score >= 45 ? "#b7791f" : "#c53030";
  const hero = `<div style="background:linear-gradient(135deg,#8a3a52,#5c3d47);border-radius:16px;padding:1.6rem 1.8rem;color:#fff;margin-bottom:1.5rem;">
    <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;opacity:.85;font-weight:700;">This week, the business ran itself</div>
    <div style="font-size:1.35rem;font-weight:800;margin:.4rem 0 .9rem;line-height:1.35;">${esc(outcomes.headline)}</div>
    <div style="display:flex;gap:2.2rem;flex-wrap:wrap;">
      <div><div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;opacity:.8;">Admin reclaimed</div><div style="font-size:1.6rem;font-weight:800;">${esc(formatMinutes(outcomes.reclaimed_minutes_7d))}</div></div>
      <div><div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;opacity:.8;">Coordination</div><div style="font-size:1.6rem;font-weight:800;color:#ffd9e2;">${outcomes.coordination_score}/100</div></div>
      <div><div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;opacity:.8;">Momentum</div><div style="font-size:1.6rem;font-weight:800;">${esc(outcomes.momentum_label)}</div></div>
    </div>
  </div>`;

  const kpiBar = `<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1.2rem;">
    ${kpiCard("Pipeline", formatZAR(kpi.pipeline_cents))}
    ${kpiCard("Booked", formatZAR(kpi.booked_cents))}
    ${kpiCard("Collected", formatZAR(kpi.collected_cents))}
    ${kpiCard("Owed", formatZAR(kpi.owed_cents))}
    ${kpiCard("Collection", kpi.collection_pct + "%")}
    ${kpiCard("Conversion", kpi.conversion_pct + "%")}
    ${kpiCard("Open enquiries", String(kpi.open_enquiries))}
    ${kpiCard("At risk", String(kpi.at_risk_count), kpi.at_risk_count > 0 ? "#c53030" : "#276749")}
  </div>`;

  const filterBar = `<div style="display:flex;gap:.5rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap;">
    <a href="/api/admin/inbox" style="padding:.35rem .9rem;border-radius:20px;font-size:.82rem;font-weight:600;text-decoration:none;${!onlyRisk ? "background:#8a3a52;color:#fff;" : "background:#ede7e0;color:#5c3d47;"}">All</a>
    <a href="/api/admin/inbox?risk=1" style="padding:.35rem .9rem;border-radius:20px;font-size:.82rem;font-weight:600;text-decoration:none;${onlyRisk ? "background:#8a3a52;color:#fff;" : "background:#ede7e0;color:#5c3d47;"}">⚠ Needs attention</a>
    <form method="POST" action="/api/admin/inbox/archive" style="margin-left:auto;display:flex;gap:.5rem;align-items:center;" onsubmit="return confirm('Archive selected items? They will be hidden from the inbox.');">
      <span style="font-size:.82rem;color:#8a7d72;">Select items, then</span>
      <button type="submit" style="padding:.35rem .9rem;border-radius:8px;font-size:.82rem;font-weight:600;color:#fff;background:#8a3a52;border:none;cursor:pointer;">Archive selected</button>
    </form>
  </div>`;

  const body = visible.length
    ? `<form id="inbox-form" method="POST" action="/api/admin/inbox/archive">${filterBar}
      <table><thead><tr><th></th><th>Type</th><th>Name</th><th>Event</th><th>Received</th><th>Status</th><th>Total</th></tr></thead><tbody>
      ${visible.map((r) => `<tr style="${r.at_risk ? "background:#fff5f5;" : ""}">
        <td><input type="checkbox" name="ids" value="${esc(r.kind)}:${esc(r.id)}"></td>
        <td>${typeBadge(r.kind)}</td>
        <td><a class="row-link" href="${esc(r.detailHref)}">${esc(r.name)}</a></td>
        <td>${fmtDate(r.date)}</td>
        <td style="color:#8a7d72;font-size:.82rem;">${fmtDate(r.received)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${r.total_cents ? formatZAR(r.total_cents) : "—"}</td>
      </tr>`).join("")}
      </tbody></table></form>`
    : `<p class="empty">${onlyRisk ? "Nothing needs attention right now ✦" : "Inbox is clear ✦"}</p>`;

  return htmlResponse(shell("Unified Inbox", user, hero + kpiBar + (visible.length ? body.replace(filterBar, "") : filterBar + body), url.pathname));
}

function kpiCard(label: string, value: string, color = "#2b2b2b"): string {
  return `<div style="background:#fff;border:1.5px solid #ede7e0;border-radius:12px;padding:.8rem 1.1rem;min-width:110px;">
    <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;font-weight:700;">${esc(label)}</div>
    <div style="font-size:1.15rem;font-weight:800;color:${color};">${esc(value)}</div>
  </div>`;
}
function typeBadge(kind: string): string {
  const map: Record<string, [string, string]> = {
    enquiry: ["Enquiry", "#b7791f"],
    booking: ["Booking", "#553c9a"],
    rejection: ["Declined", "#c53030"],
  };
  const [label, color] = map[kind] ?? [kind, "#718096"];
  return `<span style="display:inline-block;padding:.15em .6em;border-radius:20px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:#f7f3ef;color:${color};">${esc(label)}</span>`;
}
function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    new: "#b7791f", contacted: "#2b6cb0", converted: "#276749", closed: "#718096",
    requested: "#b7791f", quote_sent: "#2b6cb0", accepted: "#553c9a", deposit_paid: "#276749",
    settled: "#22543d", declined: "#c53030", rejected: "#c53030",
  };
  const color = colors[status] ?? "#718096";
  return `<span style="display:inline-block;padding:.15em .6em;border-radius:20px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:#f7f3ef;color:${color};">${esc(status)}</span>`;
}
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// ── POST /api/admin/inbox/archive ──────────────────────────────────────────────
export async function handleAdminInboxArchive(
  req: Request,
  env: Env & { SUPABASE_JWT_SECRET: string },
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");
  let ids: string[] = [];
  try {
    const fd = await req.formData();
    ids = fd.getAll("ids").map(String);
  } catch {
    return redirect("/api/admin/inbox?error=bad-form");
  }
  const hdr = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "content-type": "application/json",
    prefer: "return=minimal",
  };
  const ts = new Date().toISOString();
  for (const key of ids) {
    const [kind, id] = key.split(":");
    const table = kind === "enquiry" ? "enquiries" : kind === "booking" ? "bookings" : null;
    if (!table || !/^[0-9a-f-]{36}$/.test(id)) continue;
    await f(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: hdr,
      body: JSON.stringify({ archived_at: ts }),
    });
  }
  return redirect("/api/admin/inbox");
}
