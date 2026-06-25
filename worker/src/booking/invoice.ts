/**
 * GET  /api/booking/invoice?token=<signed>        — bride's printable invoice (S9).
 * POST /api/booking/invoice/reject?token=<signed> — bride declines the invoice.
 *
 * The invoice token is signed with action "invoice" and a 2-year TTL.
 * Rejection transitions booking quote_sent → rejected, inserts a rejections row,
 * fires the admin bell (invoice_rejected), and sends an admin email.
 */

import { getBookingByIdForInvoice, transitionBooking, insertNotification } from "./db";
import { writeAudit } from "./audit";
import { verifyActionToken, signActionToken } from "./token";
import { sendEmail, esc as emailEsc } from "../lib/email";
import type { AuditEnv } from "./audit";

export interface InvoiceEnv extends AuditEnv {
  SIGNING_SECRET: string;
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
}

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => (
    { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));

const zar = (cents: number) =>
  "R " + (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function statusBadge(status: string): string {
  if (status === "settled") return `<span class="badge paid">Fully paid</span>`;
  if (status === "deposit_paid") return `<span class="badge partial">Deposit received — balance outstanding</span>`;
  return `<span class="badge pending">Awaiting deposit</span>`;
}

/** Format an ISO date string ("2026-09-24") as "24 September 2026" without timezone drift. */
function fmtDateStr(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${d} ${months[m - 1]} ${y}`;
}

function invoicePage(b: {
  reference: string;
  bride_name: string;
  bride_email: string;
  wedding_date: string;
  venue: string | null;
  town: string | null;
  province: string | null;
  party_size: number;
  total_cents: number;
  deposit_pct: number | null;
  deposit_net_cents: number;
  balance_net_cents: number;
  status: string;
  quote_lines: Array<{ label: string; amount: number }> | null;
  quote_sent_at: string | null;
}, invoiceToken: string, acceptUrl?: string): string {
  const today = new Date();
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  // Due date anchored to quote_sent_at + 14 days, not today + 7.
  const dueDateMs = b.quote_sent_at
    ? new Date(b.quote_sent_at).getTime() + 14 * 24 * 60 * 60 * 1000
    : today.getTime() + 14 * 24 * 60 * 60 * 1000;
  const due = new Date(dueDateMs);

  const venue = [b.venue, b.town, b.province].filter(Boolean).join(", ") || "—";

  const lineRows = (b.quote_lines ?? []).length
    ? b.quote_lines
        .map(
          (l) => `<tr>
        <td class="desc">${esc(l.label)}</td>
        <td class="amt">${zar(Math.round(Number(l.amount) * 100))}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td class="desc">Wedding hair &amp; makeup services</td><td class="amt">${zar(b.total_cents)}</td></tr>`;

  const depositLabel = b.deposit_pct ? `Deposit (${b.deposit_pct}%)` : "Deposit";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${esc(b.reference)} — Lustique Co.</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font:15px/1.6 Georgia,'Times New Roman',serif;color:#3A2E26;background:#FAF6F0;padding:2rem 1rem;}
.page{max-width:740px;margin:0 auto;background:#fff;border-radius:4px;padding:3rem 3.5rem;box-shadow:0 2px 24px rgba(58,46,38,.09);}

/* ── Header: logo + INVOICE ── */
.hd{display:flex;justify-content:space-between;align-items:center;padding-bottom:2rem;border-bottom:2px solid #E8D5B7;margin-bottom:2rem;}
.logo{width:52px;height:52px;object-fit:contain;}
.inv-title{font-size:2rem;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#7A2E3A;}

/* ── From / Meta bar ── */
.info-bar{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2rem;gap:2rem;}
.from-block{font-size:.9rem;line-height:1.8;}
.from-name{font-size:1rem;font-weight:700;letter-spacing:.04em;color:#3A2E26;}
.from-detail{color:#6b5d52;}
.meta-table{text-align:right;font-size:.9rem;line-height:2;}
.meta-label{color:#8a7d72;padding-right:.8rem;}
.meta-val{font-weight:700;color:#3A2E26;}
.meta-ref{color:#7A2E3A;}

/* ── Section chrome ── */
.section{margin:1.8rem 0 .8rem;}
.section-label{font-size:.68rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#8a7d72;border-bottom:1px solid #f0e8de;padding-bottom:.35rem;margin-bottom:.8rem;}

/* ── Billed to ── */
.bill-name{font-size:1rem;font-weight:700;}
.bill-detail{font-size:.9rem;color:#6b5d52;margin-top:.15rem;}

/* ── Event details grid ── */
.detail-grid{display:grid;grid-template-columns:auto 1fr;gap:.25rem .8rem;font-size:.9rem;}
.dk{color:#8a7d72;}

/* ── Line items table ── */
table{width:100%;border-collapse:collapse;margin:.4rem 0 0;}
thead tr{border-bottom:2px solid #E8D5B7;}
th{font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8a7d72;padding:.5rem 0;text-align:left;}
th.amt,td.amt{text-align:right;}
tbody tr{border-bottom:1px solid #f5ede6;}
tbody tr:last-child{border-bottom:none;}
td{padding:.6rem 0;font-size:.95rem;color:#3A2E26;}

/* ── Totals ── */
.totals{margin-top:.8rem;padding-top:.6rem;border-top:2px solid #E8D5B7;}
.total-row{display:flex;justify-content:flex-end;gap:3rem;padding:.3rem 0;font-size:.95rem;color:#6b5d52;}
.total-row .tl{min-width:140px;text-align:right;color:#6b5d52;}
.total-row .tv{min-width:90px;text-align:right;}
.total-row.grand .tl,.total-row.grand .tv{font-size:1.05rem;font-weight:700;color:#3A2E26;}
.total-row.deposit-row .tl,.total-row.deposit-row .tv{color:#7A2E3A;}
.total-row.grand{border-top:1px solid #E8D5B7;margin-top:.25rem;padding-top:.55rem;}

/* ── Status badge ── */
.badge{display:inline-block;font-size:.8rem;font-weight:700;letter-spacing:.06em;border-radius:4px;padding:.3em .9em;margin-top:1.6rem;}
.badge.paid{background:#e8f4ec;color:#2a6b3a;}
.badge.partial{background:#f9f0eb;color:#7A2E3A;}
.badge.pending{background:#f5f5f5;color:#6b5d52;}

/* ── Terms ── */
.terms-list{font-size:.87rem;color:#6b5d52;line-height:1.75;padding-left:1.1rem;}
.terms-list li{margin-bottom:.25rem;}

/* ── Banking ── */
.bank-grid{display:grid;grid-template-columns:auto 1fr;gap:.25rem .9rem;font-size:.9rem;margin-top:.6rem;}
.bank-grid span:first-child{color:#8a7d72;}
.ref-note{font-size:.88rem;color:#6b5d52;margin-top:.8rem;}
.ref-note strong{color:#3A2E26;}

/* ── Footer ── */
.footer{margin-top:2.4rem;padding-top:1.4rem;border-top:1.5px solid #E8D5B7;font-size:.87rem;color:#8a7d72;text-align:center;line-height:1.9;}
.footer a{color:#7A2E3A;text-decoration:none;}

/* ── Secure your date CTA ── */
.secure-cta{display:block;text-align:center;margin-top:1.8rem;padding:1.4rem;background:#FDF7F4;border:1px solid #E8D5B7;border-radius:6px;}
.secure-cta p{font-size:.88rem;color:#6b5d52;margin:0 0 1rem;}
.secure-btn{display:inline-block;background:#EFD2C5;color:#5C4332;text-decoration:none;font-size:.82rem;letter-spacing:.2em;text-transform:uppercase;padding:13px 36px;border-radius:24px;border:1px solid #5C4332;font-family:Arial,sans-serif;font-weight:500;}

/* ── Print button ── */
.print-btn{display:block;width:100%;margin-top:2rem;font:inherit;font-size:.88rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border:1.5px solid #E8D5B7;border-radius:4px;padding:.75em;cursor:pointer;background:none;color:#7A2E3A;transition:background .15s;}
.print-btn:hover{background:#FAF6F0;}

/* ── Decline link ── */
.decline-link{display:block;text-align:center;margin-top:1rem;font-size:.82rem;color:#b08a8a;cursor:pointer;background:none;border:none;text-decoration:underline;font:inherit;}
.decline-link:hover{color:#7A2E3A;}

/* ── Decline modal ── */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:center;justify-content:center;}
.modal-overlay.open{display:flex;}
.modal-box{background:#fff;border-radius:10px;padding:2rem;max-width:440px;width:calc(100% - 2rem);box-shadow:0 8px 40px rgba(0,0,0,.18);}
.modal-box h2{font-size:1.1rem;color:#3A2E26;margin:0 0 .6rem;}
.modal-box p{font-size:.9rem;color:#6b5d52;margin:0 0 1rem;line-height:1.6;}
.modal-box textarea{width:100%;border:1.5px solid #E8D5B7;border-radius:6px;padding:.6rem .75rem;font:inherit;font-size:.9rem;resize:vertical;min-height:80px;color:#3A2E26;}
.modal-box textarea:focus{outline:none;border-color:#7A2E3A;}
.modal-actions{display:flex;gap:.7rem;margin-top:1.2rem;justify-content:flex-end;}
.btn-cancel{font:inherit;font-size:.88rem;padding:.6em 1.2em;border:1.5px solid #E8D5B7;border-radius:6px;background:none;color:#6b5d52;cursor:pointer;}
.btn-cancel:hover{background:#FAF6F0;}
.btn-decline{font:inherit;font-size:.88rem;font-weight:600;padding:.6em 1.4em;border:none;border-radius:6px;background:#7A2E3A;color:#fff;cursor:pointer;}
.btn-decline:hover{background:#5c2230;}
.btn-decline:disabled{opacity:.5;cursor:not-allowed;}

@media print{
  body{background:#fff;padding:0;}
  .page{box-shadow:none;padding:1.5rem 2rem;}
  .print-btn{display:none;}
  .decline-link{display:none;}
}
</style>
</head>
<body>
<div class="page">

  <!-- Header: logo + INVOICE -->
  <div class="hd">
    <img class="logo" src="https://lustiqueco.co.za/favicon.svg" alt="Lustique Co. logo">
    <div class="inv-title">Invoice</div>
  </div>

  <!-- From block + invoice meta -->
  <div class="info-bar">
    <div class="from-block">
      <div class="from-name">Lustique Cosmetology</div>
      <div class="from-detail">242 Frangipani Street, La Montagne</div>
      <div class="from-detail">Pretoria</div>
      <div class="from-detail"><a href="mailto:info@lustiqueco.co.za" style="color:#6b5d52;text-decoration:none;">info@lustiqueco.co.za</a></div>
    </div>
    <div class="meta-table">
      <div><span class="meta-label">Invoice</span><span class="meta-val meta-ref">${esc(b.reference)}</span></div>
      <div><span class="meta-label">Date</span><span class="meta-val">${fmtDate(today)}</span></div>
      <div><span class="meta-label">Due date</span><span class="meta-val">${fmtDate(due)}</span></div>
    </div>
  </div>

  <!-- Billed to -->
  <div class="section">
    <div class="section-label">Billed to</div>
    <div class="bill-name">${esc(b.bride_name)}</div>
    <div class="bill-detail">${esc(b.bride_email)}</div>
  </div>

  <!-- Event details -->
  <div class="section">
    <div class="section-label">Event details</div>
    <div class="detail-grid">
      <span class="dk">Event date</span><span>${fmtDateStr(b.wedding_date)}</span>
      <span class="dk">Venue</span><span>${esc(venue)}</span>
      <span class="dk">Party size</span><span>${b.party_size} look${b.party_size !== 1 ? "s" : ""}</span>
    </div>
  </div>

  <!-- Line items -->
  <div class="section">
    <div class="section-label">Services</div>
    <table>
      <thead><tr><th>Description</th><th class="amt">Amount</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
  </div>

  <!-- Totals -->
  <div class="totals">
    <div class="total-row grand"><span class="tl">Total</span><span class="tv">${zar(b.total_cents)}</span></div>
    <div class="total-row deposit-row"><span class="tl">${esc(depositLabel)}</span><span class="tv">${zar(b.deposit_net_cents)}</span></div>
    <div class="total-row"><span class="tl">Balance due</span><span class="tv">${zar(b.balance_net_cents)}</span></div>
  </div>

  ${statusBadge(b.status)}

  <!-- Terms & Conditions -->
  <div class="section">
    <div class="section-label">Terms &amp; Conditions</div>
    <ul class="terms-list">
      <li>A deposit of 30% of the total invoice amount is required to confirm and secure your booking date. The deposit is <strong>non-refundable</strong> after 30 days from the booking date.</li>
      <li>The remaining balance is due <strong>14 business days before your event date</strong>. Non-payment by this date may result in automatic cancellation.</li>
      <li>Travel is complimentary for venues within 15 km one-way (30 km round trip) from our La Montagne studio. Venues beyond this are charged at <strong>R7/km (round trip)</strong>.</li>
      <li>Cancellations made within 30 days of booking qualify for a full refund. After 30 days, the booking deposit is forfeited.</li>
      <li>All services are provided on-location unless otherwise agreed in writing.</li>
    </ul>
  </div>

  <!-- Banking details (EFT) -->
  <div class="section">
    <div class="section-label">Banking details (EFT)</div>
    <div class="bank-grid" id="bankGrid">Loading…</div>
    <p class="ref-note">Please use <strong>${esc(b.reference)}</strong> as your payment reference.</p>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div>Thank you for your business. We look forward to being part of your special day.</div>
    <div>Questions? <a href="mailto:info@lustiqueco.co.za">info@lustiqueco.co.za</a></div>
  </div>

${b.status === "quote_sent" && acceptUrl ? `
  <div class="secure-cta">
    <p>Ready to lock in your date? Choose your booking fee to confirm.</p>
    <a class="secure-btn" href="${esc(acceptUrl)}">Secure your date →</a>
  </div>
` : ""}

  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>

${b.status === "quote_sent" ? `
  <button class="decline-link" id="declineBtn">I want to decline this invoice</button>

  <div class="modal-overlay" id="declineModal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-box">
      <h2 id="modalTitle">Decline this invoice</h2>
      <p>We're sorry it didn't work out. If you'd like to let us know why, please share any feedback below — it helps us improve.</p>
      <textarea id="declineReason" placeholder="Optional — any feedback is welcome" rows="4"></textarea>
      <div class="modal-actions">
        <button class="btn-cancel" id="cancelDecline">Cancel</button>
        <button class="btn-decline" id="submitDecline">Decline invoice</button>
      </div>
    </div>
  </div>

  <script>
  (function(){
    var btn=document.getElementById('declineBtn');
    var modal=document.getElementById('declineModal');
    var cancel=document.getElementById('cancelDecline');
    var submit=document.getElementById('submitDecline');
    var reason=document.getElementById('declineReason');
    btn.addEventListener('click',function(){modal.classList.add('open');reason.focus();});
    cancel.addEventListener('click',function(){modal.classList.remove('open');});
    modal.addEventListener('click',function(e){if(e.target===modal)modal.classList.remove('open');});
    submit.addEventListener('click',function(){
      submit.disabled=true;submit.textContent='Declining…';
      var body=new URLSearchParams();
      body.set('reason',reason.value.trim());
      fetch('/api/booking/invoice/reject?token=${esc(invoiceToken)}',{
        method:'POST',
        headers:{'content-type':'application/x-www-form-urlencoded'},
        body:body.toString()
      }).then(function(r){
        if(r.ok){
          modal.classList.remove('open');
          document.querySelector('.page').innerHTML='<div style="text-align:center;padding:3rem 1rem;"><p style="font-size:1.1rem;color:#3A2E26;margin-bottom:.8rem;">Thank you for letting us know.</p><p style="color:#6b5d52;font-size:.95rem;">We appreciate you taking the time to get back to us. If circumstances change, please don\'t hesitate to reach out at <a href="mailto:info@lustiqueco.co.za" style="color:#7A2E3A;">info@lustiqueco.co.za</a>.</p></div>';
        } else {
          submit.disabled=false;submit.textContent='Decline invoice';
          alert('Something went wrong — please try again or email us at info@lustiqueco.co.za');
        }
      }).catch(function(){
        submit.disabled=false;submit.textContent='Decline invoice';
        alert('Something went wrong — please try again or email us at info@lustiqueco.co.za');
      });
    });
  }());
  </script>
` : ""}

</div>
</body>
</html>`;
}

export async function renderInvoicePage(
  env: InvoiceEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return new Response("Missing token", { status: 400, headers: { "content-type": "text/plain" } });

  const v = await verifyActionToken(token, env.SIGNING_SECRET, "invoice");
  if (!v) return new Response("Invalid or expired invoice link", { status: 400, headers: { "content-type": "text/plain" } });

  const booking = await getBookingByIdForInvoice(env, v.bookingId, fetchImpl);
  if (!booking) return new Response("Invoice not found", { status: 404, headers: { "content-type": "text/plain" } });

  // Fetch EFT settings server-side so banking details are embedded in the HTML (no client XHR).
  let bankHtml = "Contact info@lustiqueco.co.za for bank details.";
  try {
    const url = `${env.SUPABASE_URL}/rest/v1/business_settings?key=in.(eft_bank_name,eft_account_holder,eft_account_number,eft_branch_code)&select=key,value`;
    const r = await fetchImpl(url, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
    });
    if (r.ok) {
      const rows = (await r.json()) as Array<{ key: string; value: string }>;
      const m = Object.fromEntries(rows.map(({ key, value }) => [key, value]));
      bankHtml = `
<span>Bank</span><span>${esc(m["eft_bank_name"] ?? "")}</span>
<span>Account name</span><span>${esc(m["eft_account_holder"] ?? "")}</span>
<span>Account no.</span><span><strong>${esc(m["eft_account_number"] ?? "")}</strong></span>
<span>Branch code</span><span>${esc(m["eft_branch_code"] ?? "")}</span>`;
    }
  } catch { /* non-fatal — page still renders without bank details */ }

  // For quote_sent bookings, generate a fresh accept token so the invoice page has a "Secure your date" CTA.
  let acceptUrl: string | undefined;
  if (booking.status === "quote_sent") {
    const origin = new URL(req.url).origin;
    const acceptToken = await signActionToken(
      booking.id,
      new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      env.SIGNING_SECRET,
      "accept",
    );
    acceptUrl = `${origin}/api/booking/accept?token=${encodeURIComponent(acceptToken)}`;
  }

  const html = invoicePage(booking, token, acceptUrl).replace(">Loading…</div>", `>${bankHtml}</div>`);
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

// ── handleInvoiceReject ───────────────────────────────────────────────────────

/**
 * POST /api/booking/invoice/reject?token=<signed>
 * Body (form-urlencoded): reason=<text>
 *
 * Verifies the invoice token, guards that the booking is still quote_sent,
 * transitions to rejected, writes a rejections row, rings the admin bell,
 * and sends Zandeline an email with the reason.
 */
export async function handleInvoiceReject(
  env: InvoiceEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return new Response("Missing token", { status: 400, headers: { "content-type": "text/plain" } });

  const v = await verifyActionToken(token, env.SIGNING_SECRET, "invoice");
  if (!v) return new Response("Invalid or expired link", { status: 400, headers: { "content-type": "text/plain" } });

  const booking = await getBookingByIdForInvoice(env, v.bookingId, fetchImpl);
  if (!booking) return new Response("Booking not found", { status: 404, headers: { "content-type": "text/plain" } });

  // Only allow rejection from quote_sent (awaiting deposit).
  // If already handled (rejected/settled/paid), return 200 so the UI shows the thank-you page.
  if (booking.status !== "quote_sent") {
    return new Response(JSON.stringify({ ok: true, already: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  let reason = "";
  try {
    const form = await req.formData();
    reason = String(form.get("reason") ?? "").slice(0, 1000).trim();
  } catch { /* no body — reason stays empty */ }

  const now = new Date().toISOString();

  // Guard-update: quote_sent → rejected.
  const updated = await transitionBooking(
    env,
    booking.id,
    "quote_sent",
    { status: "rejected", rejected_at: now },
    fetchImpl,
  );

  // If another request already moved it, still return ok.
  if (updated) {
    // Store rejection record.
    await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rejections`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({
        booking_id: booking.id,
        rejected_by: "bride",
        reason_text: reason || null,
      }),
    }).catch(() => {});

    // Ring the admin bell.
    insertNotification(env, {
      type: "invoice_rejected",
      title: `Invoice declined — ${booking.bride_name}`,
      body: reason ? reason.slice(0, 80) : `${booking.reference} · ${booking.wedding_date}`,
      link: `/api/admin/booking/${booking.id}`,
      booking_id: booking.id,
      payload: { reference: booking.reference, reason },
    }, fetchImpl).catch(() => {});

    // Email Zandeline.
    const reasonHtml = reason
      ? `<p style="margin:1rem 0 0;"><strong>Reason given:</strong><br/>${emailEsc(reason)}</p>`
      : `<p style="margin:1rem 0 0;color:#8a7d72;">No reason was provided.</p>`;
    sendEmail(
      env,
      { email: env.NOTIFY_EMAIL, name: "Lustique" },
      `Invoice declined — ${booking.bride_name} · ${booking.reference}`,
      `<p style="font:14px/1.6 system-ui,sans-serif;">
        <strong>${emailEsc(booking.bride_name)}</strong> has declined invoice
        <strong>${emailEsc(booking.reference)}</strong>
        (wedding date: ${emailEsc(booking.wedding_date)}).
       </p>
       ${reasonHtml}
       <p style="margin-top:1.2rem;font-size:.9rem;color:#8a7d72;">
         The booking has been marked as Declined in the dashboard.
       </p>`,
      fetchImpl,
    ).catch(() => {});

    await writeAudit(
      env,
      { bookingId: booking.id, eventType: "bride.invoice-rejected", payload: { reference: booking.reference, reason } },
      fetchImpl,
    ).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
