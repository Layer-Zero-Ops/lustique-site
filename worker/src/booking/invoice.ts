/**
 * GET /api/booking/invoice?token=<signed> — bride's printable invoice (S9).
 *
 * Token is signed with action "invoice" and a 2-year TTL — generated once on
 * review approval and included in the deposit email. Stateless: no new DB column.
 *
 * Renders a Lustique-branded HTML invoice the bride can open and print to PDF.
 * Shows live payment status (awaiting deposit / deposit paid / fully paid).
 */

import { getBookingByIdForInvoice } from "./db";
import { verifyActionToken } from "./token";
import type { AuditEnv } from "./audit";

export interface InvoiceEnv extends AuditEnv {
  SIGNING_SECRET: string;
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
  deposit_pct: number;
  deposit_net_cents: number;
  balance_net_cents: number;
  status: string;
  quote_lines: Array<{ label: string; amount: number }>;
}): string {
  const today = new Date();
  const due = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

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

/* ── Print button ── */
.print-btn{display:block;width:100%;margin-top:2rem;font:inherit;font-size:.88rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border:1.5px solid #E8D5B7;border-radius:4px;padding:.75em;cursor:pointer;background:none;color:#7A2E3A;transition:background .15s;}
.print-btn:hover{background:#FAF6F0;}

@media print{
  body{background:#fff;padding:0;}
  .page{box-shadow:none;padding:1.5rem 2rem;}
  .print-btn{display:none;}
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
      <span class="dk">Event date</span><span>${esc(b.wedding_date)}</span>
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
      <li>Travel is complimentary for venues within 30 km of our La Montagne studio. Venues beyond 30 km are charged at <strong>R7/km (round trip)</strong>.</li>
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

  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>

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

  const html = invoicePage(booking).replace(">Loading…</div>", `>${bankHtml}</div>`);
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
