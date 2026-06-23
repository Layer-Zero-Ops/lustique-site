// worker/src/booking/forms.ts
// Admin Forms tab — unified inbox of all submitted forms (enquiries + booking requests).
// "Send Quote" compose flow lets Zandeline email a custom quote to any enquiry lead.

import { getAdminSession } from "./auth";
import { listEnquiries, getEnquiryById, updateEnquiry, type EnquiryCrmRow } from "./db";
import type { Env } from "../index";
import type { ShellFn } from "./enquiries";
import { sendEmail, emailShell } from "../lib/email";

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

// Convert plain text (newline-separated paragraphs) to brand-styled HTML.
// Escapes user content first, then converts structure — never unsafe.
function textToHtml(text: string): string {
  const safe = text.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
  return safe
    .split(/\n\n+/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:14px;line-height:1.85;color:#3A2E26;font-family:Arial,sans-serif;">${p.replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

const STATUS_COLORS: Record<string, string> = {
  new:       "background:#fef9e7;color:#b7791f;",
  contacted: "background:#ebf8ff;color:#2b6cb0;",
  converted: "background:#f0fff4;color:#276749;",
  closed:    "background:#f7fafc;color:#718096;",
};

function statusBadge(status: string): string {
  const label: Record<string, string> = { new: "New", contacted: "Contacted", converted: "Converted", closed: "Closed" };
  const style = STATUS_COLORS[status] ?? "";
  return `<span style="display:inline-block;padding:.15em .6em;border-radius:20px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;${style}">${esc(label[status] ?? status)}</span>`;
}

interface BookingRow {
  id: string;
  reference: string;
  bride_name: string;
  bride_email: string;
  bride_phone: string;
  wedding_date: string;
  town: string | null;
  total_cents: number;
  created_at: string;
}

type FormItem =
  | { kind: "enquiry"; data: EnquiryCrmRow }
  | { kind: "booking"; data: BookingRow };

// ── Forms list ─────────────────────────────────────────────────────────────────

export async function handleAdminForms(
  req: Request,
  env: Env & { SUPABASE_JWT_SECRET: string },
  shell: ShellFn,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const url = new URL(req.url);
  const saved  = url.searchParams.get("saved")  === "1";
  const errMsg = url.searchParams.get("error") ?? "";

  const [enquiries, bookingsRes] = await Promise.all([
    listEnquiries(env, null, f),
    f(
      `${env.SUPABASE_URL}/rest/v1/bookings?status=eq.requested&select=id,reference,bride_name,bride_email,bride_phone,wedding_date,town,total_cents,created_at&order=created_at.desc&limit=50`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } },
    ),
  ]);

  const bookings: BookingRow[] = bookingsRes.ok ? (await bookingsRes.json()) as BookingRow[] : [];

  const items: FormItem[] = [
    ...enquiries.map((e): FormItem => ({ kind: "enquiry", data: e })),
    ...bookings.map((b): FormItem => ({ kind: "booking", data: b })),
  ].sort((a, b) => b.data.created_at.localeCompare(a.data.created_at));

  const rows = items.map((item) => {
    if (item.kind === "enquiry") {
      const e = item.data;
      return `<tr>
        <td><span style="display:inline-block;padding:.1em .5em;border-radius:4px;background:#fdf2f8;color:#8a3a52;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Enquiry</span></td>
        <td><strong>${esc(e.name)}</strong></td>
        <td>${esc(e.email)}</td>
        <td>${e.occasion ? esc(e.occasion) : '<span style="color:#8a7d72;">—</span>'}</td>
        <td>${e.event_date ? esc(e.event_date) : '<span style="color:#8a7d72;">—</span>'}</td>
        <td>${e.estimate ? esc(e.estimate) : '<span style="color:#8a7d72;">—</span>'}</td>
        <td>${statusBadge(e.status)}</td>
        <td style="color:#8a7d72;font-size:.82rem;">${e.created_at.slice(0, 10)}</td>
        <td style="white-space:nowrap;">
          <a href="/api/admin/forms/${esc(e.id)}/send-quote"
            style="display:inline-block;font-size:.78rem;font-weight:700;padding:.3em .8em;background:#8a3a52;color:#fff;border-radius:6px;text-decoration:none;">Send Quote</a>
          <a href="/api/admin/enquiries/${esc(e.id)}"
            style="display:inline-block;margin-left:.4rem;font-size:.78rem;font-weight:600;padding:.3em .8em;background:#f7e8ec;color:#8a3a52;border-radius:6px;text-decoration:none;">View →</a>
        </td>
      </tr>`;
    } else {
      const b = item.data;
      const totalR = `R ${Math.round(b.total_cents / 100).toLocaleString("en-ZA")}`;
      return `<tr>
        <td><span style="display:inline-block;padding:.1em .5em;border-radius:4px;background:#ebf8ff;color:#2b6cb0;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Booking</span></td>
        <td><strong>${esc(b.bride_name)}</strong></td>
        <td>${esc(b.bride_email)}</td>
        <td>Wedding</td>
        <td>${esc(b.wedding_date)}</td>
        <td>${totalR}</td>
        <td><span style="display:inline-block;padding:.15em .6em;border-radius:20px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:#fef9e7;color:#b7791f;">Requested</span></td>
        <td style="color:#8a7d72;font-size:.82rem;">${b.created_at.slice(0, 10)}</td>
        <td style="white-space:nowrap;">
          <a href="/api/admin/booking/${esc(b.id)}"
            style="display:inline-block;font-size:.78rem;font-weight:700;padding:.3em .8em;background:#2b6cb0;color:#fff;border-radius:6px;text-decoration:none;">Review →</a>
        </td>
      </tr>`;
    }
  }).join("");

  const inner = `
    ${saved  ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;border:1px solid #b7dfc8;color:#276749;font-size:.88rem;">✓ Quote sent successfully.</div>` : ""}
    ${errMsg ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#fff5f5;border:1px solid #f5c6c6;color:#c53030;font-size:.88rem;">⚠ ${esc(decodeURIComponent(errMsg))}</div>` : ""}
    ${!items.length
      ? `<p style="color:#8a7d72;font-style:italic;">No form submissions yet.</p>`
      : `<table>
          <thead><tr>
            <th>Type</th><th>Name</th><th>Email</th><th>Occasion</th>
            <th>Date</th><th>Estimate</th><th>Status</th><th>Received</th><th>Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`
    }`;

  return htmlResponse(shell(`Forms (${items.length})`, user, inner, url.pathname));
}

// ── Send Quote compose + send ─────────────────────────────────────────────────

export async function handleAdminFormsSendQuote(
  req: Request,
  env: Env & { SUPABASE_JWT_SECRET: string },
  shell: ShellFn,
  id: string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const e = await getEnquiryById(env, id, f);
  if (!e) return redirect("/api/admin/forms");

  if (req.method === "GET") {
    const defaultSubject = [
      "Your Lustique Co. Quote",
      e.occasion ? `— ${e.occasion}` : null,
      e.event_date ? `on ${e.event_date}` : null,
    ].filter(Boolean).join(" ");

    const defaultBody = [
      `Dear ${e.name},`,
      `Thank you for reaching out to Lustique Co.!`,
      `Based on your enquiry${e.occasion ? ` for your ${e.occasion}` : ""}${e.event_date ? ` on ${e.event_date}` : ""}, here is your personalised quote:`,
      `[Add your pricing and service details here]`,
      `Should you have any questions, feel free to reply to this email or call us directly.`,
      `Warm regards,\nZandeline\nLustique Co.`,
    ].join("\n\n");

    const inner = `
      <a href="/api/admin/forms" style="font-size:.85rem;color:#8a3a52;text-decoration:none;">← Back to Forms</a>
      <div style="margin-top:1.2rem;display:grid;grid-template-columns:300px 1fr;gap:2rem;">
        <div>
          <h2 style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;margin:0 0 .7rem;">Lead details</h2>
          <table style="border-collapse:collapse;font-size:.88rem;width:100%;">
            <tr><td style="color:#8a7d72;padding:3px 12px 3px 0;white-space:nowrap;">Name</td><td><strong>${esc(e.name)}</strong></td></tr>
            <tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Email</td><td>${esc(e.email)}</td></tr>
            <tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Phone</td><td>${esc(e.phone)}</td></tr>
            ${e.occasion   ? `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Occasion</td><td>${esc(e.occasion)}</td></tr>` : ""}
            ${e.event_date ? `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Date</td><td>${esc(e.event_date)}</td></tr>` : ""}
            ${e.town       ? `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Town</td><td>${esc(e.town)}</td></tr>` : ""}
            ${e.estimate   ? `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Estimate</td><td>${esc(e.estimate)}</td></tr>` : ""}
          </table>
          ${e.message ? `<h2 style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;margin:1.2rem 0 .4rem;">Message</h2>
          <p style="font-size:.85rem;white-space:pre-wrap;margin:0;color:#3d2b38;">${esc(e.message)}</p>` : ""}
        </div>
        <div>
          <h2 style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;margin:0 0 .7rem;">Compose quote email</h2>
          <form method="POST" style="display:flex;flex-direction:column;gap:1rem;">
            <label style="display:flex;flex-direction:column;gap:.3rem;font-size:.88rem;font-weight:600;">
              To
              <input type="text" value="${esc(e.email)}" disabled
                style="padding:.45rem .6rem;border:1.5px solid #ede7e0;border-radius:8px;font:inherit;font-size:.88rem;background:#f7f3ef;color:#8a7d72;">
            </label>
            <label style="display:flex;flex-direction:column;gap:.3rem;font-size:.88rem;font-weight:600;">
              Subject
              <input type="text" name="subject" value="${esc(defaultSubject)}" required maxlength="200"
                style="padding:.45rem .6rem;border:1.5px solid #ede7e0;border-radius:8px;font:inherit;font-size:.88rem;">
            </label>
            <label style="display:flex;flex-direction:column;gap:.3rem;font-size:.88rem;font-weight:600;">
              Message <span style="font-weight:400;color:#8a7d72;">(plain text — blank line = new paragraph)</span>
              <textarea name="body" rows="16" required
                style="padding:.55rem .7rem;border:1.5px solid #ede7e0;border-radius:8px;font:inherit;font-size:.88rem;resize:vertical;">${esc(defaultBody)}</textarea>
            </label>
            <div style="display:flex;gap:.8rem;align-items:center;">
              <button type="submit"
                style="padding:.52em 1.6em;background:#8a3a52;color:#fff;border:none;border-radius:8px;font:inherit;font-size:.9rem;font-weight:700;cursor:pointer;">
                Send Quote
              </button>
              <a href="/api/admin/forms" style="font-size:.85rem;color:#8a7d72;text-decoration:none;">Cancel</a>
            </div>
          </form>
        </div>
      </div>`;

    return htmlResponse(shell(`Send Quote — ${e.name}`, user, inner, new URL(req.url).pathname));
  }

  // POST — send the email
  let subject = "";
  let body    = "";
  try {
    const fd = await req.formData();
    subject  = ((fd.get("subject") as string | null) ?? "").trim();
    body     = ((fd.get("body")    as string | null) ?? "").trim();
  } catch {
    return redirect(`/api/admin/forms/${encodeURIComponent(id)}/send-quote`);
  }

  if (!subject || !body) {
    return redirect(`/api/admin/forms/${encodeURIComponent(id)}/send-quote`);
  }

  try {
    await sendEmail(
      env,
      { email: e.email, name: e.name },
      subject,
      emailShell({
        heading: subject,
        body: textToHtml(body),
        btnZone: `<p style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:#8A7060;">Reply to this email with any questions.</p>`,
      }),
      f,
    );
  } catch (err) {
    const msg = encodeURIComponent(
      `Failed to send email: ${err instanceof Error ? err.message : String(err)}`,
    );
    return redirect(`/api/admin/forms?error=${msg}`);
  }

  // Advance enquiry status from 'new' → 'contacted' automatically
  if (e.status === "new") {
    await updateEnquiry(
      env,
      id,
      { status: "contacted", contacted_at: new Date().toISOString() },
      f,
    ).catch(() => {});
  }

  return redirect("/api/admin/forms?saved=1");
}
