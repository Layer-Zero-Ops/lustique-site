// worker/src/booking/contacts.ts
// Contacts tab — unified people view: booking clients + enquiry leads.
// Queries the existing bookings + enquiries tables (no new DB required).
// Deduplicates by email so each person appears once.

import { getAdminSession } from "./auth";
import type { Env } from "../index";
import type { ShellFn } from "./enquiries";

export interface ContactsEnv extends Env {
  SUPABASE_JWT_SECRET: string;
}

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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface BookingClient {
  id: string;
  bride_name: string;
  bride_email: string;
  bride_phone: string | null;
  status: string;
  wedding_date: string;
  created_at: string;
  reference: string;
}

interface EnquiryLead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  occasion: string | null;
  status: string;
  created_at: string;
}

interface Contact {
  key: string;       // email (lowercase) — dedup key
  name: string;
  email: string;
  phone: string | null;
  type: "client" | "lead" | "both";
  lifecycle: string; // e.g. "Booking client", "Enquiry lead", "Converted"
  lastActivity: string;
  bookingId?: string;
  bookingRef?: string;
  bookingStatus?: string;
  weddingDate?: string;
  enquiryId?: string;
  enquiryStatus?: string;
}

const BOOKING_STATUS_LABELS: Record<string, string> = {
  requested:     "Requested",
  quote_sent:    "Quote sent",
  accepted:      "Accepted",
  deposit_paid:  "Deposit paid",
  settled:       "Settled",
  rejected:      "Declined (bride)",
  declined:      "Declined (us)",
  cancelled:     "Cancelled",
  invoice_expired: "Expired",
};

const BOOKING_STATUS_COLORS: Record<string, string> = {
  requested:    "background:#fef9e7;color:#b7791f;",
  quote_sent:   "background:#ebf8ff;color:#2b6cb0;",
  accepted:     "background:#e9d8fd;color:#553c9a;",
  deposit_paid: "background:#f0fff4;color:#276749;",
  settled:      "background:#c6f6d5;color:#22543d;",
  rejected:     "background:#fff5f5;color:#c53030;",
  declined:     "background:#fff5f5;color:#c53030;",
  cancelled:    "background:#f7fafc;color:#718096;",
  invoice_expired: "background:#f7fafc;color:#718096;",
};

function statusBadge(status: string, labels: Record<string, string>, colors: Record<string, string>): string {
  const label = labels[status] ?? status;
  const style = colors[status] ?? "";
  return `<span style="display:inline-block;padding:.15em .6em;border-radius:20px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;${style}">${esc(label)}</span>`;
}

const ENQ_STATUS_LABELS: Record<string, string> = {
  new: "New lead", contacted: "Contacted", converted: "Converted", closed: "Closed",
};
const ENQ_STATUS_COLORS: Record<string, string> = {
  new:       "background:#fef9e7;color:#b7791f;",
  contacted: "background:#ebf8ff;color:#2b6cb0;",
  converted: "background:#f0fff4;color:#276749;",
  closed:    "background:#f7fafc;color:#718096;",
};

// ── Handler ───────────────────────────────────────────────────────────────────

/** GET /api/admin/contacts — unified CRM people view */
export async function handleAdminContacts(
  req: Request,
  env: ContactsEnv,
  shell: ShellFn,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") ?? "all"; // all | clients | leads

  const hdr = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };

  const [bRes, eRes] = await Promise.all([
    f(
      `${env.SUPABASE_URL}/rest/v1/bookings` +
        `?select=id,reference,bride_name,bride_email,bride_phone,status,wedding_date,created_at` +
        `&order=created_at.desc`,
      { headers: hdr },
    ),
    f(
      `${env.SUPABASE_URL}/rest/v1/enquiries` +
        `?select=id,name,email,phone,occasion,status,created_at` +
        `&order=created_at.desc`,
      { headers: hdr },
    ),
  ]);

  const bookings: BookingClient[] = bRes.ok ? ((await bRes.json()) as BookingClient[]) : [];
  const enquiries: EnquiryLead[] = eRes.ok ? ((await eRes.json()) as EnquiryLead[]) : [];

  // Build a deduped map keyed by lowercase email
  const map = new Map<string, Contact>();

  for (const b of bookings) {
    const key = b.bride_email.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      // Prefer the most recent booking
      existing.type = existing.type === "lead" ? "both" : "client";
      if (b.created_at > existing.lastActivity) {
        existing.bookingId = b.id;
        existing.bookingRef = b.reference;
        existing.bookingStatus = b.status;
        existing.weddingDate = b.wedding_date;
        existing.lastActivity = b.created_at;
      }
    } else {
      map.set(key, {
        key,
        name: b.bride_name,
        email: b.bride_email,
        phone: b.bride_phone ?? null,
        type: "client",
        lifecycle: "Booking client",
        lastActivity: b.created_at,
        bookingId: b.id,
        bookingRef: b.reference,
        bookingStatus: b.status,
        weddingDate: b.wedding_date,
      });
    }
  }

  for (const e of enquiries) {
    const key = e.email.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.type = existing.type === "client" ? "both" : "lead";
      if (!existing.enquiryId) {
        existing.enquiryId = e.id;
        existing.enquiryStatus = e.status;
      }
      if (existing.type === "both") existing.lifecycle = "Booking client + enquiry";
    } else {
      map.set(key, {
        key,
        name: e.name,
        email: e.email,
        phone: e.phone ?? null,
        type: "lead",
        lifecycle: ENQ_STATUS_LABELS[e.status] ?? e.status,
        lastActivity: e.created_at,
        enquiryId: e.id,
        enquiryStatus: e.status,
      });
    }
  }

  const all = Array.from(map.values()).sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  const filtered = tab === "clients"
    ? all.filter((c) => c.type === "client" || c.type === "both")
    : tab === "leads"
    ? all.filter((c) => c.type === "lead")
    : all;

  // Stats
  const clientCount = all.filter((c) => c.type === "client" || c.type === "both").length;
  const leadCount   = all.filter((c) => c.type === "lead").length;
  const totalCount  = all.length;

  function tabLink(t: string, label: string, count: number): string {
    const active = tab === t;
    return `<a href="/api/admin/contacts?tab=${t}" style="padding:.4rem .9rem;border-radius:7px;text-decoration:none;font-size:.85rem;font-weight:${active ? "700" : "500"};color:${active ? "#8a3a52" : "#5c3d47"};${active ? "background:#f7e8ec;" : "background:transparent;"}">
      ${esc(label)} <span style="font-size:.75rem;font-weight:600;color:#8a7d72;">(${count})</span>
    </a>`;
  }

  const tabs = `<div style="display:flex;gap:.3rem;margin-bottom:1.4rem;">
    ${tabLink("all", "All People", totalCount)}
    ${tabLink("clients", "Booking Clients", clientCount)}
    ${tabLink("leads", "Enquiry Leads", leadCount)}
  </div>`;

  const rows = filtered.length
    ? filtered.map((c) => {
        const nameCell = c.bookingId
          ? `<a class="row-link" href="/api/admin/booking/${esc(c.bookingId)}">${esc(c.name)}</a>`
          : c.enquiryId
          ? `<a class="row-link" href="/api/admin/enquiries/${esc(c.enquiryId)}">${esc(c.name)}</a>`
          : esc(c.name);

        const typeTag = c.type === "both"
          ? `<span style="display:inline-block;padding:.1em .5em;border-radius:20px;font-size:.7rem;font-weight:700;background:#e9d8fd;color:#553c9a;margin-left:.4rem;">CLIENT+LEAD</span>`
          : c.type === "client"
          ? `<span style="display:inline-block;padding:.1em .5em;border-radius:20px;font-size:.7rem;font-weight:700;background:#edfcf2;color:#276749;margin-left:.4rem;">CLIENT</span>`
          : `<span style="display:inline-block;padding:.1em .5em;border-radius:20px;font-size:.7rem;font-weight:700;background:#fef9e7;color:#b7791f;margin-left:.4rem;">LEAD</span>`;

        const statusCell = c.bookingStatus
          ? statusBadge(c.bookingStatus, BOOKING_STATUS_LABELS, BOOKING_STATUS_COLORS)
          : c.enquiryStatus
          ? statusBadge(c.enquiryStatus, ENQ_STATUS_LABELS, ENQ_STATUS_COLORS)
          : "—";

        const actionsCell = [
          c.bookingId ? `<a class="row-link" href="/api/admin/booking/${esc(c.bookingId)}">${esc(c.bookingRef ?? "Booking")}</a>` : "",
          c.enquiryId ? `<a class="row-link" href="/api/admin/enquiries/${esc(c.enquiryId)}" style="margin-left:.5rem;">Enquiry</a>` : "",
        ].filter(Boolean).join("");

        return `<tr>
          <td>${nameCell}${typeTag}</td>
          <td style="font-size:.85rem;">${esc(c.email)}</td>
          <td style="font-size:.85rem;">${esc(c.phone ?? "—")}</td>
          <td>${c.weddingDate ? fmtDate(c.weddingDate) : "—"}</td>
          <td>${statusCell}</td>
          <td style="font-size:.82rem;">${fmtDate(c.lastActivity)}</td>
          <td>${actionsCell}</td>
        </tr>`;
      }).join("\n")
    : `<tr><td colspan="7" class="empty">no contacts yet ✦</td></tr>`;

  const table = `<table>
    <thead><tr>
      <th>Name</th>
      <th>Email</th>
      <th>Phone</th>
      <th>Wedding date</th>
      <th>Status</th>
      <th>Last activity</th>
      <th>Links</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  return htmlResponse(shell("Contacts", user, tabs + table, new URL(req.url).pathname));
}
