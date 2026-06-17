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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${esc(b.reference)} — Lustique Co.</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font:15px/1.6 Georgia,'Times New Roman',serif;color:#3A2E26;background:#FAF6F0;padding:2rem 1rem;}
.page{max-width:720px;margin:0 auto;background:#fff;border-radius:4px;padding:3rem 3.5rem;box-shadow:0 2px 20px rgba(58,46,38,.08);}

/* header */
.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.5px solid #E8D5B7;padding-bottom:2rem;margin-bottom:2rem;}
.brand-name{font-size:1.35rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#3A2E26;}
.brand-sub{font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:#8a7d72;margin-top:.2rem;}
.inv-meta{text-align:right;}
.inv-label{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:#8a7d72;}
.inv-ref{font-size:1.1rem;font-weight:700;color:#7A2E3A;margin-top:.15rem;}
.inv-date{font-size:.88rem;color:#6b5d52;margin-top:.2rem;}

/* bill-to */
.section{margin:1.6rem 0;}
.section-label{font-size:.72rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#8a7d72;margin-bottom:.5rem;}
.bill-name{font-size:1rem;font-weight:700;}
.bill-detail{font-size:.9rem;color:#6b5d52;margin-top:.15rem;}

/* service detail */
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:.3rem .8rem;font-size:.9rem;margin-top:.4rem;}
.dk{color:#8a7d72;}

/* items table */
table{width:100%;border-collapse:collapse;margin:1rem 0;}
thead tr{border-bottom:1.5px solid #E8D5B7;}
th{font-size:.72rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8a7d72;padding:.4rem 0;text-align:left;}
th.amt,td.amt{text-align:right;}
tbody tr{border-bottom:1px solid #f3ede8;}
td{padding:.55rem 0;font-size:.95rem;}
td.desc{color:#3A2E26;}

/* totals */
.totals{margin-top:.6rem;padding-top:.6rem;}
.total-row{display:flex;justify-content:space-between;padding:.3rem 0;font-size:.95rem;color:#6b5d52;}
.total-row.main{border-top:1.5px solid #E8D5B7;margin-top:.3rem;padding-top:.6rem;font-size:1.05rem;font-weight:700;color:#3A2E26;}
.total-row.deposit{color:#7A2E3A;}

/* status */
.badge{display:inline-block;font-size:.8rem;font-weight:700;letter-spacing:.06em;border-radius:4px;padding:.3em .85em;margin-top:1.4rem;}
.badge.paid{background:#e8f4ec;color:#2a6b3a;}
.badge.partial{background:#f4ede8;color:#7A2E3A;}
.badge.pending{background:#f2f2f2;color:#6b5d52;}

/* footer */
.footer{margin-top:2.5rem;padding-top:1.6rem;border-top:1.5px solid #E8D5B7;font-size:.85rem;color:#8a7d72;}
.footer strong{color:#6b5d52;}
.bank-grid{display:grid;grid-template-columns:auto 1fr;gap:.2rem .8rem;margin-top:.6rem;}

/* print */
.print-btn{display:block;width:100%;margin-top:2rem;font:inherit;font-size:.88rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border:1.5px solid #E8D5B7;border-radius:4px;padding:.7em;cursor:pointer;background:none;color:#7A2E3A;}
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

  <div class="hd">
    <div>
      <div class="brand-name">Lustique Co.</div>
      <div class="brand-sub">Cosmetology</div>
    </div>
    <div class="inv-meta">
      <div class="inv-label">Invoice</div>
      <div class="inv-ref">${esc(b.reference)}</div>
      <div class="inv-date">${new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-label">Billed to</div>
    <div class="bill-name">${esc(b.bride_name)}</div>
    <div class="bill-detail">${esc(b.bride_email)}</div>
  </div>

  <div class="section">
    <div class="section-label">Service details</div>
    <div class="detail-grid">
      <span class="dk">Wedding date</span><span>${esc(b.wedding_date)}</span>
      <span class="dk">Venue</span><span>${esc(venue)}</span>
      <span class="dk">Party size</span><span>${b.party_size} look${b.party_size !== 1 ? "s" : ""}</span>
    </div>
  </div>

  <table>
    <thead><tr><th>Service</th><th class="amt">Amount</th></tr></thead>
    <tbody>${lineRows}</tbody>
  </table>

  <div class="totals">
    <div class="total-row main"><span>Total</span><span>${zar(b.total_cents)}</span></div>
    <div class="total-row deposit"><span>Deposit due (${b.deposit_pct}%)</span><span>${zar(b.deposit_net_cents)}</span></div>
    <div class="total-row"><span>Balance due</span><span>${zar(b.balance_net_cents)}</span></div>
  </div>

  ${statusBadge(b.status)}

  <div class="footer">
    <strong>EFT payment details</strong>
    <div class="bank-grid" id="bankGrid">Loading…</div>
    <p style="margin-top:.8rem;">Please use <strong>${esc(b.reference)}</strong> as your payment reference.</p>
    <p style="margin-top:.4rem;">Questions? Email <a href="mailto:info@lustiqueco.co.za" style="color:#7A2E3A;">info@lustiqueco.co.za</a></p>
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

  // Fetch EFT settings to embed in the page (avoids a client-side fetch from HTML)
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
<span style="color:#8a7d72">Bank</span><span>${esc(m["eft_bank_name"] ?? "")}</span>
<span style="color:#8a7d72">Account name</span><span>${esc(m["eft_account_holder"] ?? "")}</span>
<span style="color:#8a7d72">Account no.</span><span><strong>${esc(m["eft_account_number"] ?? "")}</strong></span>
<span style="color:#8a7d72">Branch code</span><span>${esc(m["eft_branch_code"] ?? "")}</span>`;
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
