// worker/src/booking/contacts.ts
// Contacts tab — unified people view: booking clients + enquiry leads.
// Queries the existing bookings + enquiries tables (no new DB required).
// Deduplicates by email so each person appears once.

import { getAdminSession } from "./auth";
import { insertNotification } from "./db";
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

  const addForm = `
<details style="margin-top:2rem;" id="add-contact-details">
  <summary style="cursor:pointer;font-size:.88rem;font-weight:700;color:#8a3a52;user-select:none;list-style:none;display:inline-flex;align-items:center;gap:.4rem;">
    <span id="add-toggle-icon">▸</span> Add contact
  </summary>
  <div style="background:#fff;border:1.5px solid #ede7e0;border-radius:12px;padding:1.4rem 1.6rem;margin-top:.7rem;max-width:820px;">

    <h2 style="margin:0 0 1rem;">Add individual</h2>
    <form method="POST" action="/api/admin/contacts" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.7rem;align-items:end;">
      <input type="hidden" name="action" value="add_single">
      <label style="display:flex;flex-direction:column;gap:.25rem;font-size:.8rem;font-weight:600;color:#6b5d52;">
        Name *
        <input name="name" required placeholder="Anri van Wyk"
          style="font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .7em;">
      </label>
      <label style="display:flex;flex-direction:column;gap:.25rem;font-size:.8rem;font-weight:600;color:#6b5d52;">
        Email *
        <input name="email" type="email" required placeholder="anri@example.com"
          style="font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .7em;">
      </label>
      <label style="display:flex;flex-direction:column;gap:.25rem;font-size:.8rem;font-weight:600;color:#6b5d52;">
        Phone
        <input name="phone" type="tel" placeholder="+27 82 000 0000"
          style="font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .7em;">
      </label>
      <div style="grid-column:1/-1;">
        <button type="submit"
          style="font:inherit;font-size:.86rem;font-weight:700;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.45em 1.3em;cursor:pointer;">
          Add contact
        </button>
      </div>
    </form>

    <hr style="border:none;border-top:1px solid #ede7e0;margin:1.4rem 0;">

    <h2 style="margin:0 0 .5rem;">Bulk import <span style="font-weight:400;font-size:.82rem;color:#8a7d72;">(one per line: Name, Email, Phone)</span></h2>
    <p style="font-size:.82rem;color:#8a7d72;margin:0 0 .7rem;">Example: <code style="background:#f7f3ef;padding:.1em .4em;border-radius:4px;">Thandi Nkosi, thandi@gmail.com, 082 111 2222</code></p>
    <form method="POST" action="/api/admin/contacts" style="display:flex;flex-direction:column;gap:.6rem;max-width:500px;">
      <input type="hidden" name="action" value="add_bulk">
      <textarea name="csv" rows="6" required placeholder="Jane Smith, jane@example.com, 082 000 1111&#10;Liza Botha, liza@example.com, 071 222 3333"
        style="font:inherit;font-size:.85rem;border:1.5px solid #c9bfb8;border-radius:8px;padding:.5em .75em;resize:vertical;"></textarea>
      <div>
        <button type="submit"
          style="font:inherit;font-size:.86rem;font-weight:700;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.45em 1.3em;cursor:pointer;">
          Import contacts
        </button>
      </div>
    </form>
  </div>
</details>
<script>
(function(){
  var d=document.getElementById('add-contact-details');
  var i=document.getElementById('add-toggle-icon');
  if(d&&i){d.addEventListener('toggle',function(){i.textContent=d.open?'▾':'▸';});
  if(window.location.search.includes('added=')){d.open=true;}}
})();
</script>`;

  const added = url.searchParams.get("added");
  const addedMsg = added
    ? `<div style="background:#f0fff4;border:1px solid #b7dfc8;color:#276749;border-radius:8px;padding:.65em 1em;margin-bottom:1rem;font-size:.88rem;">✓ ${esc(added === "bulk" ? "Contacts imported." : "Contact added.")}</div>`
    : "";

  return htmlResponse(shell("Contacts", user, addedMsg + tabs + table + addForm, new URL(req.url).pathname));
}

// ── POST handler ──────────────────────────────────────────────────────────────

/** POST /api/admin/contacts — add single contact or bulk-import from CSV */
export async function handleAdminAddContact(
  req: Request,
  env: ContactsEnv,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const form = await req.formData().catch(() => null);
  if (!form) return redirect("/api/admin/contacts?error=bad-form");

  const action = String(form.get("action") ?? "add_single");
  const hdr = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "content-type": "application/json",
    prefer: "return=minimal",
  };

  if (action === "add_single") {
    const name  = String(form.get("name")  ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const phone = String(form.get("phone") ?? "").trim();
    if (!name || !email) return redirect("/api/admin/contacts?error=missing-fields");

    const res = await f(`${env.SUPABASE_URL}/rest/v1/enquiries`, {
      method: "POST",
      headers: { ...hdr, prefer: "return=representation" },
      body: JSON.stringify({ name, email, phone: phone || "", message: "" }),
    });
    if (res.ok) {
      const rows = (await res.json()) as Array<{ id: string }>;
      const id = rows[0]?.id;
      insertNotification(env, {
        type: "contact_added",
        title: `New contact — ${name}`,
        body: email,
        link: id ? `/api/admin/enquiries/${id}` : "/api/admin/contacts",
        payload: { email },
      }, f).catch(() => {});
    }
    return redirect("/api/admin/contacts?added=1");
  }

  if (action === "add_bulk") {
    const csv = String(form.get("csv") ?? "");
    const rows: Array<{ name: string; email: string; phone: string; message: string }> = [];
    for (const line of csv.split("\n")) {
      const parts = line.split(",").map((p) => p.trim());
      const name  = parts[0] ?? "";
      const email = (parts[1] ?? "").toLowerCase();
      const phone = parts[2] ?? "";
      if (name && email && email.includes("@")) {
        rows.push({ name, email, phone, message: "" });
      }
    }
    if (rows.length === 0) return redirect("/api/admin/contacts?error=no-valid-rows");
    await f(`${env.SUPABASE_URL}/rest/v1/enquiries`, {
      method: "POST",
      headers: hdr,
      body: JSON.stringify(rows),
    });
    return redirect("/api/admin/contacts?added=bulk");
  }

  return redirect("/api/admin/contacts");
}
