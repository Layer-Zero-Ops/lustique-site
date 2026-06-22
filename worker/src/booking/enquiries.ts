// worker/src/booking/enquiries.ts
// Wave E — Enquiry CRM: admin views for listing, reviewing, and updating enquiry leads.
// All routes are JWT-gated via getAdminSession.

import { getAdminSession, type AdminUser } from "./auth";
import { listEnquiries, getEnquiryById, updateEnquiry, type EnquiryCrmRow } from "./db";
import type { Env } from "../index";

export interface EnquiriesEnv extends Env {
  SUPABASE_JWT_SECRET: string;
}

// ── HTML helpers (local copies — dashboard.ts owns the shell; we export handlers only) ──

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

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

// Import the shell from dashboard at runtime — avoids circular imports by using a callback pattern.
// Handlers receive a `shell` function injected from the caller (index.ts wires it up).
export type ShellFn = (title: string, user: AdminUser, inner: string) => string;

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  new:       "New",
  contacted: "Contacted",
  converted: "Converted",
  closed:    "Closed",
};

const STATUS_COLORS: Record<string, string> = {
  new:       "background:#fef9e7;color:#b7791f;",
  contacted: "background:#ebf8ff;color:#2b6cb0;",
  converted: "background:#f0fff4;color:#276749;",
  closed:    "background:#f7fafc;color:#718096;",
};

function statusBadge(status: string): string {
  const style = STATUS_COLORS[status] ?? "";
  return `<span style="display:inline-block;padding:.15em .6em;border-radius:20px;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;${style}">${esc(STATUS_LABELS[status] ?? status)}</span>`;
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

// ── List view ─────────────────────────────────────────────────────────────────

export async function handleAdminEnquiries(
  req: Request,
  env: EnquiriesEnv,
  shell: ShellFn,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status") || null;

  const enquiries = await listEnquiries(env, statusFilter, f);

  const filterLinks = ["", "new", "contacted", "converted", "closed"].map((s) => {
    const active = (statusFilter ?? "") === s;
    const label = s ? (STATUS_LABELS[s] ?? s) : "All";
    const href = s ? `/api/admin/enquiries?status=${s}` : "/api/admin/enquiries";
    return `<a href="${href}" style="padding:.3rem .75rem;border-radius:20px;font-size:.82rem;font-weight:600;text-decoration:none;${active ? "background:#8a3a52;color:#fff;" : "background:#ede7e0;color:#5c3d47;"}">${esc(label)}</a>`;
  }).join(" ");

  if (!enquiries.length) {
    const inner = `
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.4rem;">${filterLinks}</div>
      <p style="color:#8a7d72;font-style:italic;">No enquiries${statusFilter ? ` with status "${statusFilter}"` : ""} yet.</p>`;
    return htmlResponse(shell("Enquiries", user, inner));
  }

  const rows = enquiries.map((e) => `
    <tr>
      <td><a href="/api/admin/enquiries/${esc(e.id)}" style="color:#8a3a52;font-weight:600;text-decoration:none;">${esc(e.name)}</a></td>
      <td>${esc(e.email)}</td>
      <td>${esc(e.phone)}</td>
      <td>${e.occasion ? esc(e.occasion) : '<span style="color:#8a7d72;">—</span>'}</td>
      <td>${e.event_date ? esc(e.event_date) : '<span style="color:#8a7d72;">—</span>'}</td>
      <td>${e.town ? esc(e.town) : '<span style="color:#8a7d72;">—</span>'}</td>
      <td>${e.estimate ? esc(e.estimate) : '<span style="color:#8a7d72;">—</span>'}</td>
      <td>${statusBadge(e.status)}</td>
      <td style="color:#8a7d72;font-size:.82rem;">${fmtDate(e.created_at)}</td>
    </tr>`).join("");

  const inner = `
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.4rem;">${filterLinks}</div>
    <table>
      <thead><tr>
        <th>Name</th><th>Email</th><th>Phone</th><th>Occasion</th>
        <th>Date</th><th>Town</th><th>Estimate</th><th>Status</th><th>Received</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  return htmlResponse(shell(`Enquiries (${enquiries.length})`, user, inner));
}

// ── Detail / edit view ────────────────────────────────────────────────────────

export async function handleAdminEnquiryDetail(
  req: Request,
  env: EnquiriesEnv,
  shell: ShellFn,
  id: string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const e = await getEnquiryById(env, id, f);
  if (!e) return htmlResponse(shell("Enquiry not found", user, `<p>Not found. <a href="/api/admin/enquiries">Back to enquiries</a></p>`), 404);

  const url = new URL(req.url);
  const saved = url.searchParams.get("saved") === "1";

  // Build detail rows from submitted form data
  let detailRows = "";
  if (Array.isArray(e.details)) {
    const rows = (e.details as Array<{ label?: string; value?: string }>)
      .filter((d) => d.value && String(d.value).trim())
      .map((d) => `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;white-space:nowrap;">${esc(d.label ?? "")}</td><td>${esc(String(d.value))}</td></tr>`)
      .join("");
    if (rows) detailRows = `<table style="border-collapse:collapse;font-size:.88rem;margin:.5rem 0 1rem;">${rows}</table>`;
  }

  const statusOptions = Object.entries(STATUS_LABELS)
    .map(([v, l]) => `<option value="${v}"${e.status === v ? " selected" : ""}>${l}</option>`)
    .join("");

  const inner = `
    ${saved ? `<div style="background:#f0fff4;border:1px solid #9ae6b4;border-radius:8px;padding:.6rem 1rem;margin-bottom:1.2rem;font-size:.88rem;color:#276749;">Saved.</div>` : ""}
    <a href="/api/admin/enquiries" style="font-size:.85rem;color:#8a3a52;text-decoration:none;">← All enquiries</a>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-top:1.2rem;">
      <div>
        <h2 style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;margin:0 0 .7rem;">Lead details</h2>
        <table style="border-collapse:collapse;font-size:.9rem;width:100%;">
          <tr><td style="color:#8a7d72;padding:3px 12px 3px 0;white-space:nowrap;">Name</td><td><strong>${esc(e.name)}</strong></td></tr>
          <tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Email</td><td><a href="mailto:${esc(e.email)}" style="color:#8a3a52;">${esc(e.email)}</a></td></tr>
          <tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Phone</td><td>${esc(e.phone)}</td></tr>
          ${e.occasion ? `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Occasion</td><td>${esc(e.occasion)}</td></tr>` : ""}
          ${e.event_date ? `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Date</td><td>${esc(e.event_date)}</td></tr>` : ""}
          ${e.town ? `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Town</td><td>${esc(e.town)}</td></tr>` : ""}
          ${e.estimate ? `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Estimate</td><td>${esc(e.estimate)}</td></tr>` : ""}
          <tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Received</td><td>${esc(e.created_at.slice(0, 16).replace("T", " "))}</td></tr>
        </table>
        ${detailRows ? `<h2 style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;margin:1.2rem 0 .5rem;">Occasion details</h2>${detailRows}` : ""}
        ${e.message ? `<h2 style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;margin:1.2rem 0 .5rem;">Message</h2><p style="font-size:.9rem;white-space:pre-wrap;margin:0;">${esc(e.message)}</p>` : ""}
      </div>
      <div>
        <h2 style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;margin:0 0 .7rem;">CRM</h2>
        <form method="POST" action="/api/admin/enquiries/${esc(e.id)}" style="display:flex;flex-direction:column;gap:1rem;">
          <label style="display:flex;flex-direction:column;gap:.3rem;font-size:.88rem;font-weight:600;">
            Status
            <select name="status" style="padding:.45rem .6rem;border:1.5px solid #ede7e0;border-radius:8px;font:inherit;font-size:.88rem;background:#fff;">
              ${statusOptions}
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:.3rem;font-size:.88rem;font-weight:600;">
            Notes
            <textarea name="notes" rows="6" style="padding:.55rem .7rem;border:1.5px solid #ede7e0;border-radius:8px;font:inherit;font-size:.88rem;resize:vertical;">${esc(e.notes ?? "")}</textarea>
          </label>
          <button type="submit" style="align-self:flex-start;padding:.5rem 1.4rem;background:#8a3a52;color:#fff;border:none;border-radius:8px;font:inherit;font-size:.88rem;font-weight:700;cursor:pointer;">Save</button>
        </form>
        ${e.contacted_at ? `<p style="font-size:.82rem;color:#8a7d72;margin-top:1rem;">First contacted: ${esc(e.contacted_at.slice(0, 10))}</p>` : ""}
      </div>
    </div>`;

  return htmlResponse(shell(`${e.name} — Enquiry`, user, inner));
}

// ── Update (POST handler — PRG pattern) ──────────────────────────────────────

export async function handleAdminUpdateEnquiry(
  req: Request,
  env: EnquiriesEnv,
  id: string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const existing = await getEnquiryById(env, id, f);
  if (!existing) return redirect("/api/admin/enquiries");

  let status: string | undefined;
  let notes: string | undefined;
  try {
    const form = await req.formData();
    status = form.get("status")?.toString();
    notes = form.get("notes")?.toString() ?? "";
  } catch {
    return redirect(`/api/admin/enquiries/${id}`);
  }

  const VALID_STATUSES = ["new", "contacted", "converted", "closed"];
  if (!status || !VALID_STATUSES.includes(status)) {
    return redirect(`/api/admin/enquiries/${id}`);
  }

  const patch: Parameters<typeof updateEnquiry>[2] = { status, notes };

  // Set contacted_at the first time status moves away from 'new'
  if (existing.status === "new" && status !== "new" && !existing.contacted_at) {
    patch.contacted_at = new Date().toISOString();
  }

  await updateEnquiry(env, id, patch, f);
  return redirect(`/api/admin/enquiries/${id}?saved=1`);
}
