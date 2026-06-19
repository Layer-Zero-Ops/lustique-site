/**
 * GET /api/admin/quote-pdf?token=ADMIN_SECRET&id=<booking_id>
 *
 * Zandeline's printable quote — one-off admin tool, not sent to brides.
 * Shows the quote_lines breakdown, deposit %, totals, and expiry date for
 * any booking in quote_sent or later state.
 *
 * Auth: timing-safe ADMIN_SECRET comparison (same pattern as other admin pages).
 * No long-lived signed token needed — just open, print, close.
 */

import { getBookingByIdForInvoice } from "./db";
import type { AdminEnv } from "./admin";

const enc = new TextEncoder();

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const [ha, hb] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}

const esc = (s = "") =>
  String(s).replace(/[<>&"']/g, (c) => (
    { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));

const zar = (cents: number) =>
  "R " + (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function quoteExpiry(quoteSentAt: string | null): string {
  if (!quoteSentAt) return "—";
  const d = new Date(quoteSentAt);
  d.setDate(d.getDate() + 7);
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

function statusBadge(status: string): string {
  if (status === "quote_sent") return `<span class="badge pending">Quote sent — awaiting acceptance</span>`;
  if (status === "accepted") return `<span class="badge accepted">Accepted — awaiting deposit</span>`;
  if (status === "deposit_paid") return `<span class="badge partial">Accepted — deposit received</span>`;
  if (status === "settled") return `<span class="badge paid">Fully settled</span>`;
  if (status === "rejected") return `<span class="badge rejected">Declined by client</span>`;
  if (status === "invoice_expired") return `<span class="badge expired">Quote expired</span>`;
  return `<span class="badge pending">${esc(status)}</span>`;
}

function quotePage(b: {
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
  quote_sent_at: string | null;
  quote_lines: Array<{ label: string; amount: number }>;
}): string {
  const venue = [b.venue, b.town, b.province].filter(Boolean).join(", ") || "—";
  const depositPct = b.deposit_pct ?? 50;
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
<meta name="robots" content="noindex">
<title>Quote ${esc(b.reference)} — Lustique Co.</title>
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

/* expiry */
.expiry{margin-top:1.2rem;font-size:.88rem;color:#8a7d72;}
.expiry strong{color:#6b5d52;}

/* status */
.badge{display:inline-block;font-size:.8rem;font-weight:700;letter-spacing:.06em;border-radius:4px;padding:.3em .85em;margin-top:1.4rem;}
.badge.paid{background:#e8f4ec;color:#2a6b3a;}
.badge.accepted{background:#e8f0f8;color:#1a4a7a;}
.badge.partial{background:#f4ede8;color:#7A2E3A;}
.badge.pending{background:#f2f2f2;color:#6b5d52;}
.badge.rejected{background:#fdf0f0;color:#8a3a52;}
.badge.expired{background:#f7f3ef;color:#8a7d72;}

/* admin note */
.admin-note{margin-top:2rem;padding:.9rem 1rem;background:#FAF6F0;border-radius:6px;font-size:.85rem;color:#8a7d72;border:1px solid #E8D5B7;}
.admin-note strong{color:#6b5d52;}

/* print */
.print-btn{display:block;width:100%;margin-top:2rem;font:inherit;font-size:.88rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border:1.5px solid #E8D5B7;border-radius:4px;padding:.7em;cursor:pointer;background:none;color:#7A2E3A;}
.print-btn:hover{background:#FAF6F0;}
@media print{
  body{background:#fff;padding:0;}
  .page{box-shadow:none;padding:1.5rem 2rem;}
  .print-btn{display:none;}
  .admin-note{display:none;}
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
      <div class="inv-label">Quote</div>
      <div class="inv-ref">${esc(b.reference)}</div>
      <div class="inv-date">Valid until: ${esc(quoteExpiry(b.quote_sent_at))}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-label">Prepared for</div>
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
    <div class="total-row deposit"><span>Deposit (${depositPct}%)</span><span>${zar(b.deposit_net_cents)}</span></div>
    <div class="total-row"><span>Balance due on the day</span><span>${zar(b.balance_net_cents)}</span></div>
  </div>

  ${statusBadge(b.status)}

  <div class="admin-note">
    <strong>Admin use only</strong> — this is your internal quote copy. The bride's acceptance link was sent via email.
  </div>

  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>

</div>
</body>
</html>`;
}

export async function handleAdminQuotePdf(
  env: AdminEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const id = url.searchParams.get("id") ?? "";

  if (!token) return new Response("Missing token", { status: 401, headers: { "content-type": "text/plain" } });
  if (!await timingSafeEqual(token, env.ADMIN_SECRET)) {
    return new Response("Invalid token", { status: 401, headers: { "content-type": "text/plain" } });
  }
  if (!id) return new Response("Missing booking id", { status: 400, headers: { "content-type": "text/plain" } });

  const booking = await getBookingByIdForInvoice(env, id, fetchImpl);
  if (!booking) return new Response("Booking not found", { status: 404, headers: { "content-type": "text/plain" } });

  const html = quotePage(booking);
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
