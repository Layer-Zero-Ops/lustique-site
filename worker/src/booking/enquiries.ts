// worker/src/booking/enquiries.ts
// Wave E — Enquiry CRM: admin views for listing, reviewing, and updating enquiry leads.
// All routes are JWT-gated via getAdminSession.

import { getAdminSession, type AdminUser } from "./auth";
import { listEnquiries, getEnquiryById, updateEnquiry, insertBooking, type EnquiryCrmRow } from "./db";
import { signToken, hashToken } from "./token";
import { makeReference } from "./util";
import type { Env } from "../index";

export interface EnquiriesEnv extends Env {
  SUPABASE_JWT_SECRET: string;
  SIGNING_SECRET: string;
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
export type ShellFn = (title: string, user: AdminUser, inner: string, currentPath?: string) => string;

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
    return htmlResponse(shell("Enquiries", user, inner, url.pathname));
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

  return htmlResponse(shell(`Enquiries (${enquiries.length})`, user, inner, url.pathname));
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
  if (!e) return htmlResponse(shell("Enquiry not found", user, `<p>Not found. <a href="/api/admin/enquiries">Back to enquiries</a></p>`, new URL(req.url).pathname), 404);

  const url = new URL(req.url);
  const saved = url.searchParams.get("saved") === "1";

  // Build detail sections from submitted form data.
  // Entries with kind="service" render as a quote line-item table; all others render as key-value.
  let detailRows = "";
  let serviceTable = "";
  if (Array.isArray(e.details)) {
    type DetailEntry = { label?: string; value?: string; kind?: string };
    const all = e.details as DetailEntry[];
    const infoEntries = all.filter((d) => d.kind !== "service" && d.value && String(d.value).trim());
    const serviceEntries = all.filter((d) => d.kind === "service" && d.value && String(d.value).trim());

    if (infoEntries.length > 0) {
      const rows = infoEntries
        .map((d) => `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;white-space:nowrap;">${esc(d.label ?? "")}</td><td>${esc(String(d.value))}</td></tr>`)
        .join("");
      detailRows = `<table style="border-collapse:collapse;font-size:.88rem;margin:.5rem 0 1rem;">${rows}</table>`;
    }

    if (serviceEntries.length > 0) {
      const serviceRows = serviceEntries.map((d) => {
        const isDiscount = String(d.value).startsWith("−");
        const cellStyle = isDiscount
          ? `style="color:#8a3a52;font-style:italic;"`
          : "";
        return `<tr>
          <td ${cellStyle} style="padding:6px 12px 6px 0;">${esc(d.label ?? "")}</td>
          <td ${cellStyle} style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;">${esc(String(d.value))}</td>
        </tr>`;
      }).join("");
      const totalLine = e.estimate
        ? `<tr><td colspan="2" style="border-top:2px solid rgba(60,42,42,.2);padding-top:8px;"></td></tr>
           <tr>
             <td style="padding:4px 12px 4px 0;font-weight:700;">Estimated Total</td>
             <td style="padding:4px 0;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;">${esc(e.estimate)}</td>
           </tr>`
        : "";
      serviceTable = `
        <h2 style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;margin:1.2rem 0 .5rem;">Quote Breakdown</h2>
        <table style="border-collapse:collapse;font-size:.88rem;width:100%;margin:.5rem 0 1rem;">
          <thead><tr>
            <th style="text-align:left;padding:4px 12px 8px 0;font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a7d72;border-bottom:1px solid #ede7e0;">Service</th>
            <th style="text-align:right;padding:4px 0 8px;font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a7d72;border-bottom:1px solid #ede7e0;">Amount</th>
          </tr></thead>
          <tbody>${serviceRows}${totalLine}</tbody>
        </table>`;
    }
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
          ${e.referral_source ? `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Referral source</td><td>${esc(e.referral_source)}</td></tr>` : ""}
          <tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Received</td><td>${esc(e.created_at.slice(0, 16).replace("T", " "))}</td></tr>
        </table>
        ${detailRows ? `<h2 style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;margin:1.2rem 0 .5rem;">Occasion details</h2>${detailRows}` : ""}
        ${serviceTable}
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
        <div style="margin-top:1.5rem;padding-top:1.2rem;border-top:1px solid #f3ede8;">
          <h2 style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;margin:0 0 .7rem;">Invoice</h2>
          ${e.booking_id
            ? `<a href="/api/admin/booking/${esc(e.booking_id)}"
                style="display:inline-block;padding:.5em 1.2em;background:#276749;color:#fff;border-radius:8px;font-size:.88rem;font-weight:700;text-decoration:none;">View Invoice →</a>`
            : `<form method="POST" action="/api/admin/enquiries/${esc(e.id)}/generate-invoice">
                <button type="submit"
                  style="font:inherit;font-size:.88rem;font-weight:700;padding:.5em 1.2em;background:#8a3a52;color:#fff;border:none;border-radius:8px;cursor:pointer;"
                  onclick="return confirm('Generate an invoice for ${esc(e.name.replace(/'/g, "\\'"))}? This creates a booking record you can review and edit before sending.')">
                  Generate Invoice
                </button>
                <p style="font-size:.78rem;color:#8a7d72;margin:.5rem 0 0;">Creates a booking record in Invoices using this enquiry's data. You can edit the total before sending.</p>
              </form>`
          }
        </div>
      </div>
    </div>`;

  return htmlResponse(shell(`${e.name} — Enquiry`, user, inner, url.pathname));
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

// ── Generate Invoice (POST handler) ──────────────────────────────────────────

const OCCASION_KEY: Record<string, string> = {
  "Wedding": "wedding",
  "Matric farewell": "matric",
};

function parseTotalCents(estimate: string | null): number {
  if (!estimate) return 0;
  // "from R 21 229" → strip label + spaces → parse rands → × 100
  const digits = estimate.replace(/from\s+R\s*/i, "").replace(/\s/g, "");
  const rands = parseFloat(digits);
  return isNaN(rands) ? 0 : Math.round(rands * 100);
}

// "R 1 700" or "− R 850" → rands as number (quote_lines.amount convention: rands, not cents)
function parseServiceLines(
  details: unknown,
): Array<{ label: string; amount: number }> {
  if (!Array.isArray(details)) return [];
  return (details as Array<{ label?: string; value?: string; kind?: string }>)
    .filter((d) => d.kind === "service" && d.label && d.value)
    .map((d) => {
      const isNeg = (d.value ?? "").includes("−");
      const rands = parseFloat((d.value ?? "").replace(/[^0-9.]/g, "")) || 0;
      return { label: d.label!, amount: isNeg ? -rands : rands };
    })
    .filter((l) => l.amount !== 0);
}

export async function handleAdminGenerateInvoice(
  req: Request,
  env: EnquiriesEnv,
  shell: ShellFn,
  id: string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const e = await getEnquiryById(env, id, f);
  if (!e) return new Response("Enquiry not found", { status: 404 });

  // Idempotent — already generated, just send them there
  if (e.booking_id) return redirect(`/api/admin/booking/${e.booking_id}`);

  const bookingId = crypto.randomUUID();
  const reference = makeReference(bookingId, new Date().getUTCFullYear());
  const idempotencyKey = `enquiry:${e.id}`;

  const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
  const tokenExpiry = new Date(Date.now() + TOKEN_TTL_MS);
  const token = await signToken(bookingId, tokenExpiry, env.SIGNING_SECRET);
  const tokenHash = await hashToken(token);

  const occasion = OCCASION_KEY[e.occasion ?? ""] ?? "wedding";
  const weddingDate = e.event_date ?? "2099-12-31"; // Zandeline can correct on the booking detail

  const returned = await insertBooking(env, {
    id: bookingId,
    reference,
    idempotency_key: idempotencyKey,
    status: "requested",
    occasion,
    wedding_date: weddingDate,
    bride_name: e.name,
    bride_email: e.email,
    bride_phone: e.phone,
    town: e.town ?? null,
    province: null,
    venue: null,
    party_size: 1,
    estimate_input: {},
    total_cents: parseTotalCents(e.estimate),
    quote_lines: parseServiceLines(e.details),
    deposit_pct: null,
    deposit_net_cents: 0,
    balance_net_cents: 0,
    availability_conflict: false,
    consent_at: e.created_at,
    confirm_token_hash: tokenHash,
    confirm_token_expires_at: tokenExpiry.toISOString(),
    notes: e.message ?? null,
  }, f);

  // Link the booking back to the enquiry and mark it converted
  await updateEnquiry(env, id, { booking_id: returned.id, status: "converted" }, f);

  return redirect(`/api/admin/booking/${returned.id}`);
}
