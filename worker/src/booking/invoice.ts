/**
 * GET  /api/booking/invoice?token=<signed>        — bride's printable invoice (S9).
 * POST /api/booking/invoice/reject?token=<signed> — bride declines the invoice.
 * POST /api/booking/invoice/pay?token=<signed>    — TASK-D: bride selects deposit %, creates Yoco checkout.
 *
 * The invoice token is signed with action "invoice" and a 2-year TTL.
 * Rejection transitions booking quote_sent → rejected, inserts a rejections row,
 * fires the admin bell (invoice_rejected), and sends an admin email.
 * Pay transitions quote_sent → accepted then creates a Yoco checkout (same logic as accept.ts).
 */

import { getBookingByIdForInvoice, transitionBooking, insertNotification, insertPayment } from "./db";
import { writeAudit } from "./audit";
import { verifyActionToken } from "./token";
import { sendEmail, esc as emailEsc } from "../lib/email";
import { splitDeposit } from "@lustique/pricing";
import type { AuditEnv } from "./audit";

export interface InvoiceEnv extends AuditEnv {
  SIGNING_SECRET: string;
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
}

export interface InvoicePayEnv extends InvoiceEnv {
  YOCO_SECRET_KEY: string;
  ALLOWED_ORIGIN: string;
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
}, invoiceToken: string): string {
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

/* ── Pay Deposit CTA ── */
.secure-cta{display:block;text-align:center;margin-top:1.8rem;padding:1.4rem;background:#FDF7F4;border:1px solid #E8D5B7;border-radius:6px;}
.secure-cta p{font-size:.88rem;color:#6b5d52;margin:0 0 1rem;}
.secure-btn{display:inline-block;background:#EFD2C5;color:#5C4332;text-decoration:none;font-size:.82rem;letter-spacing:.2em;text-transform:uppercase;padding:13px 36px;border-radius:24px;border:1px solid #5C4332;font-family:Arial,sans-serif;font-weight:500;cursor:pointer;}

/* ── Deposit selection options ── */
.dep-opts{display:flex;flex-direction:column;gap:.5rem;margin:.8rem 0;}
.dep-opt{display:flex;align-items:flex-start;gap:.8rem;border:1.5px solid #E8D5B7;border-radius:8px;padding:.75rem .9rem;cursor:pointer;}
.dep-opt:has(input:checked){border-color:#7A2E3A;background:#FDF5F7;}
.dep-opt input{margin-top:.2rem;accent-color:#7A2E3A;}
.dep-opt-label{font-weight:600;color:#3A2E26;font-size:.9rem;}
.dep-opt-sub{font-size:.83rem;color:#6b5d52;}

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

${b.status === "quote_sent" ? `
  <div class="secure-cta">
    <p>Ready to lock in your date? Choose your deposit to secure it now.</p>
    <button class="secure-btn" id="payDepositBtn" type="button">Pay Deposit &rarr;</button>
  </div>

  <!-- Deposit selection modal -->
  <div class="modal-overlay" id="depositModal" role="dialog" aria-modal="true" aria-labelledby="depositTitle">
    <div class="modal-box">
      <h2 id="depositTitle">Choose your deposit</h2>
      <p>Select how much you&#8217;d like to pay now &#8212; the balance is due closer to your day.</p>
      <div class="dep-opts">
        <label class="dep-opt">
          <input type="radio" name="depositPct" value="25">
          <div><div class="dep-opt-label">25% &mdash; ${zar(Math.round(b.total_cents * 0.25))}</div><div class="dep-opt-sub">Balance of ${zar(b.total_cents - Math.round(b.total_cents * 0.25))} due later</div></div>
        </label>
        <label class="dep-opt">
          <input type="radio" name="depositPct" value="50">
          <div><div class="dep-opt-label">50% &mdash; ${zar(Math.round(b.total_cents * 0.5))}</div><div class="dep-opt-sub">Balance of ${zar(b.total_cents - Math.round(b.total_cents * 0.5))} due later</div></div>
        </label>
        <label class="dep-opt">
          <input type="radio" name="depositPct" value="100">
          <div><div class="dep-opt-label">Pay in full &mdash; ${zar(b.total_cents)}</div><div class="dep-opt-sub">Nothing more to pay &#10003;</div></div>
        </label>
      </div>
      <p id="depositErr" style="display:none;color:#7A2E3A;font-size:.88rem;margin:.4rem 0 0;"></p>
      <div class="modal-actions">
        <button class="btn-cancel" id="cancelDeposit">Cancel</button>
        <button class="btn-decline" id="submitDeposit">Continue to payment &rarr;</button>
      </div>
    </div>
  </div>

  <!-- EFT fallback modal (shown when Yoco checkout fails) -->
  <div class="modal-overlay" id="eftModal" role="dialog" aria-modal="true" aria-labelledby="eftTitle">
    <div class="modal-box">
      <h2 id="eftTitle">Pay by EFT</h2>
      <p>Card payment is temporarily unavailable. Please pay by EFT &#8212; your date will be secured once we confirm receipt.</p>
      <div class="bank-grid" id="eftGrid" style="margin-top:.8rem;"></div>
      <p class="ref-note" id="eftRefNote" style="margin-top:.8rem;"></p>
      <div class="modal-actions">
        <button class="btn-cancel" id="closeEft">Close</button>
      </div>
    </div>
  </div>

  <script>
  (function(){
    var payBtn=document.getElementById('payDepositBtn');
    var depModal=document.getElementById('depositModal');
    var cancelDep=document.getElementById('cancelDeposit');
    var submitDep=document.getElementById('submitDeposit');
    var depErr=document.getElementById('depositErr');
    var eftModal=document.getElementById('eftModal');
    var eftGrid=document.getElementById('eftGrid');
    var eftRefNote=document.getElementById('eftRefNote');
    var closeEft=document.getElementById('closeEft');

    payBtn.addEventListener('click',function(){depModal.classList.add('open');});
    cancelDep.addEventListener('click',function(){depModal.classList.remove('open');});
    depModal.addEventListener('click',function(e){if(e.target===depModal)depModal.classList.remove('open');});
    closeEft.addEventListener('click',function(){eftModal.classList.remove('open');});
    eftModal.addEventListener('click',function(e){if(e.target===eftModal)eftModal.classList.remove('open');});

    submitDep.addEventListener('click',function(){
      var sel=document.querySelector('input[name="depositPct"]:checked');
      if(!sel){depErr.textContent='Please choose a deposit amount.';depErr.style.display='';return;}
      depErr.style.display='none';
      submitDep.disabled=true;submitDep.textContent='Processing…';
      fetch('/api/booking/invoice/pay?token=${esc(invoiceToken)}',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({depositPct:Number(sel.value)})
      }).then(function(r){return r.json();}).then(function(d){
        if(d.ok&&d.checkoutUrl){
          window.location.href=d.checkoutUrl;
          return;
        }
        if(d.ok&&d.eftOnly){
          depModal.classList.remove('open');
          var e=d.eft||{};
          var rows='';
          if(e.bank)rows+='<span>Bank</span><span>'+e.bank+'</span>';
          if(e.accountHolder)rows+='<span>Account name</span><span>'+e.accountHolder+'</span>';
          if(e.accountNumber)rows+='<span>Account no.</span><span><strong>'+e.accountNumber+'</strong></span>';
          if(e.branchCode)rows+='<span>Branch code</span><span>'+e.branchCode+'</span>';
          if(e.amount)rows+='<span>Amount due</span><span><strong>R '+(e.amount/100).toFixed(2)+'</strong></span>';
          eftGrid.innerHTML=rows;
          if(e.reference)eftRefNote.innerHTML='Please use <strong>'+e.reference+'</strong> as your payment reference. Email proof to <a href="mailto:info@lustiqueco.co.za" style="color:#7A2E3A;">info@lustiqueco.co.za</a>.';
          eftModal.classList.add('open');
          return;
        }
        if(d.already_handled){window.location.reload();return;}
        submitDep.disabled=false;submitDep.textContent='Continue to payment →';
        depErr.textContent='Something went wrong — please try again or email info@lustiqueco.co.za.';
        depErr.style.display='';
      }).catch(function(){
        submitDep.disabled=false;submitDep.textContent='Continue to payment →';
        depErr.textContent='Something went wrong — please try again or email info@lustiqueco.co.za.';
        depErr.style.display='';
      });
    });
  }());
  </script>
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

  const html = invoicePage(booking, token).replace(">Loading…</div>", `>${bankHtml}</div>`);
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

// ── handleInvoicePay ──────────────────────────────────────────────────────────

const jsonResp = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/**
 * POST /api/booking/invoice/pay?token=<signed>
 * Body (JSON): { depositPct: 25 | 50 | 100 }
 *
 * TASK-D: Bride selects her deposit percentage directly from the invoice page modal.
 * Verifies the invoice token → transitions quote_sent → accepted → creates Yoco checkout
 * → inserts payment row → returns { ok: true, checkoutUrl }.
 *
 * On Yoco failure returns { ok: true, eftOnly: true, eft: {...} } so the modal
 * can show EFT details inline without a page reload.
 */
export async function handleInvoicePay(
  env: InvoicePayEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return jsonResp({ ok: false, error: "missing_token" }, 400);

  const v = await verifyActionToken(token, env.SIGNING_SECRET, "invoice");
  if (!v) return jsonResp({ ok: false, error: "invalid_token" }, 400);

  let depositPct: number | null = null;
  try {
    const body = await req.json() as { depositPct?: unknown };
    depositPct = Number(body.depositPct);
  } catch { /* non-JSON body */ }

  if (!([25, 50, 100] as number[]).includes(depositPct ?? 0)) {
    return jsonResp({ ok: false, error: "invalid_deposit_pct" }, 400);
  }
  const pct = depositPct as 25 | 50 | 100;

  const booking = await getBookingByIdForInvoice(env, v.bookingId, fetchImpl);
  if (!booking) return jsonResp({ ok: false, error: "not_found" }, 404);
  if (booking.status !== "quote_sent") {
    return jsonResp({ ok: false, already_handled: true }, 409);
  }

  const { depositNetCents, balanceNetCents } = splitDeposit(booking.total_cents, pct);
  const now = new Date().toISOString();

  const updated = await transitionBooking(env, booking.id, "quote_sent", {
    status: "accepted",
    accepted_at: now,
    deposit_pct: pct,
    deposit_net_cents: depositNetCents,
    balance_net_cents: balanceNetCents,
  }, fetchImpl);

  if (!updated) return jsonResp({ ok: false, already_handled: true }, 409);

  await writeAudit(env, {
    bookingId: booking.id,
    eventType: "invoice-pay.accepted",
    payload: { reference: booking.reference, pct, depositNetCents },
  }, fetchImpl).catch(() => {});

  const origin = env.ALLOWED_ORIGIN || "";

  // Create Yoco checkout; on failure return EFT fallback.
  try {
    const r = await fetchImpl("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.YOCO_SECRET_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `${booking.id}-deposit`,
      },
      body: JSON.stringify({
        amount: depositNetCents,
        currency: "ZAR",
        successUrl: `${origin}/booking-deposit-paid.html?ref=${encodeURIComponent(booking.reference)}`,
        cancelUrl: `${origin}/api/booking/invoice?token=${encodeURIComponent(token)}`,
        metadata: { bookingId: booking.id, reference: booking.reference },
      }),
    });
    if (!r.ok) throw new Error(`Yoco ${r.status}: ${await r.text()}`);
    const checkout = (await r.json()) as { id: string; redirectUrl: string };
    await insertPayment(env, {
      booking_id: booking.id,
      kind: "deposit",
      net_cents: depositNetCents,
      payable_cents: depositNetCents,
      yoco_checkout_id: checkout.id,
      pay_url: checkout.redirectUrl,
      status: "pending",
    }, fetchImpl);
    return jsonResp({ ok: true, checkoutUrl: checkout.redirectUrl }, 200);
  } catch (e) {
    await writeAudit(env, {
      bookingId: booking.id,
      eventType: "invoice-pay.checkout-failed",
      payload: { reference: booking.reference, error: String(e) },
    }, fetchImpl).catch(() => {});
  }

  // Yoco failed — return EFT details so the modal can show them inline.
  try {
    const settingsUrl = `${env.SUPABASE_URL}/rest/v1/business_settings?key=in.(eft_bank_name,eft_account_holder,eft_account_number,eft_branch_code)&select=key,value`;
    const sr = await fetchImpl(settingsUrl, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
    });
    if (sr.ok) {
      const rows = (await sr.json()) as Array<{ key: string; value: string }>;
      const m = Object.fromEntries(rows.map(({ key, value }) => [key, value]));
      return jsonResp({ ok: true, eftOnly: true, eft: {
        bank: m["eft_bank_name"] ?? "",
        accountHolder: m["eft_account_holder"] ?? "",
        accountNumber: m["eft_account_number"] ?? "",
        branchCode: m["eft_branch_code"] ?? "",
        reference: booking.reference,
        amount: depositNetCents,
      }}, 200);
    }
  } catch { /* non-fatal */ }

  return jsonResp({ ok: true, eftOnly: true, eft: { reference: booking.reference, amount: depositNetCents } }, 200);
}
