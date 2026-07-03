/**
 * GET /api/booking/contract?token=<signed> — bride's Client Agreement, populated per booking.
 *
 * PLACEHOLDER WORDING: Zandeline is providing the studio's actual contract text and
 * comments — swap CONTRACT_VERSION + contractBodyHtml() for her approved copy before
 * flipping business_settings.contract_enabled to 'true'. Until then this route works
 * (so the signing flow can be built/tested end-to-end) but nothing in the live booking
 * flow requires a signature.
 *
 * Signature model: ordinary electronic signature under South Africa's ECT Act (Electronic
 * Communications and Transactions Act 25 of 2002) s13 — typed full name + explicit
 * checkbox consent + timestamp + IP + user-agent + a hash of the exact contract text
 * shown, all captured atomically with the booking's accept/deposit-selection step
 * (see handleInvoicePay in invoice.ts). This is not a suretyship, deed of alienation, or
 * other ECT Act Schedule 2 document, so an "advanced electronic signature" is not required.
 */

import { verifyActionToken } from "./token";
import { getBookingByIdForInvoice } from "./db";

const enc = new TextEncoder();

export const CONTRACT_VERSION = "draft-v1-placeholder";

function esc(s = ""): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

const zar = (cents: number) =>
  "R " + (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDateStr(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}

export interface ContractBooking {
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
}

/** The plain-text body that gets hashed at signing time — must match contractBodyHtml() 1:1 in substance. */
export function contractBodyText(b: ContractBooking): string {
  const venue = [b.venue, b.town, b.province].filter(Boolean).join(", ") || "to be confirmed";
  const feePhrase = b.deposit_pct ? `${b.deposit_pct}%` : "the percentage selected at checkout (25%, 50%, or 100%)";
  return [
    `LUSTIQUE COSMETOLOGY — CLIENT AGREEMENT (${CONTRACT_VERSION})`,
    `Reference: ${b.reference}`,
    `Client: ${b.bride_name} <${b.bride_email}>`,
    `Event date: ${fmtDateStr(b.wedding_date)}`,
    `Venue: ${venue}`,
    `Party size: ${b.party_size} look${b.party_size !== 1 ? "s" : ""}`,
    `Total fee: ${zar(b.total_cents)}`,
    `Booking fee: ${feePhrase} of the total, due to confirm this date. Non-refundable after 30 days from booking.`,
    `Balance due: 14 business days before the event date.`,
    `1. Services. Lustique Cosmetology (\"the Studio\") will provide bridal hair and makeup services on the event date and at the venue above, as detailed in the accompanying invoice.`,
    `2. Fees & payment. The client agrees to pay the total fee shown above. The booking fee secures the date; the balance is due 14 business days before the event. Non-payment by that date may result in automatic cancellation of the booking.`,
    `3. Cancellation. Cancellations made within 30 days of booking qualify for a full refund of the booking fee. After 30 days, the booking fee is forfeited. Cancellations within 14 days of the event date forfeit the full fee.`,
    `4. Travel. Travel is complimentary within 15 km one-way (30 km round trip) of the Studio's La Montagne base. Venues beyond this are charged at R7/km (round trip), payable with the balance.`,
    `5. Force majeure. Neither party is liable for delay or failure to perform due to circumstances beyond reasonable control (illness, accident, extreme weather, or other emergency). The Studio will make reasonable efforts to provide a substitute artist of comparable skill.`,
    `6. Portfolio use. The client grants the Studio a non-exclusive licence to use photographs from the event for portfolio and marketing purposes, unless the client opts out in writing before the event.`,
    `7. Liability. The Studio's liability under this agreement is limited to the total fee paid. The Studio is not liable for allergic reactions to products where the client has not disclosed known sensitivities in advance.`,
    `8. Governing law. This agreement is governed by the laws of the Republic of South Africa.`,
    `9. Entire agreement. This document, together with the invoice referenced above, constitutes the entire agreement between the parties.`,
  ].join("\n");
}

function contractBodyHtml(b: ContractBooking): string {
  const venue = [b.venue, b.town, b.province].filter(Boolean).join(", ") || "to be confirmed";
  const feePhrase = b.deposit_pct ? `${b.deposit_pct}%` : "the percentage selected at checkout (25%, 50%, or 100%)";
  return `
  <div class="section">
    <div class="section-label">Parties &amp; event</div>
    <div class="detail-grid">
      <span class="dk">Client</span><span>${esc(b.bride_name)} (${esc(b.bride_email)})</span>
      <span class="dk">Event date</span><span>${fmtDateStr(b.wedding_date)}</span>
      <span class="dk">Venue</span><span>${esc(venue)}</span>
      <span class="dk">Party size</span><span>${b.party_size} look${b.party_size !== 1 ? "s" : ""}</span>
      <span class="dk">Total fee</span><span>${zar(b.total_cents)}</span>
      <span class="dk">Booking fee</span><span>${esc(feePhrase)} of the total, non-refundable after 30 days from booking</span>
    </div>
  </div>
  <div class="section">
    <div class="section-label">Terms</div>
    <ol class="terms-list">
      <li><strong>Services.</strong> Lustique Cosmetology ("the Studio") will provide bridal hair and makeup services on the event date and at the venue above, as detailed in the accompanying invoice.</li>
      <li><strong>Fees &amp; payment.</strong> The client agrees to pay the total fee shown above. The booking fee secures the date; the balance is due 14 business days before the event. Non-payment by that date may result in automatic cancellation.</li>
      <li><strong>Cancellation.</strong> Cancellations within 30 days of booking qualify for a full refund of the booking fee. After 30 days, the booking fee is forfeited. Cancellations within 14 days of the event forfeit the full fee.</li>
      <li><strong>Travel.</strong> Complimentary within 15 km one-way (30 km round trip) of the Studio's La Montagne base. Beyond this, R7/km (round trip), payable with the balance.</li>
      <li><strong>Force majeure.</strong> Neither party is liable for delay or non-performance due to circumstances beyond reasonable control. The Studio will make reasonable efforts to provide a substitute artist of comparable skill.</li>
      <li><strong>Portfolio use.</strong> The client grants the Studio a non-exclusive licence to use event photographs for portfolio and marketing, unless the client opts out in writing before the event.</li>
      <li><strong>Liability.</strong> The Studio's liability is limited to the total fee paid. The Studio is not liable for allergic reactions where the client has not disclosed known sensitivities in advance.</li>
      <li><strong>Governing law.</strong> Republic of South Africa.</li>
      <li><strong>Entire agreement.</strong> This document, together with the referenced invoice, constitutes the entire agreement between the parties.</li>
    </ol>
  </div>`;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function renderContractPage(b: ContractBooking, invoiceToken: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Client Agreement ${esc(b.reference)} — Lustique Co.</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font:15px/1.6 Georgia,'Times New Roman',serif;color:#3A2E26;background:#FAF6F0;padding:2rem 1rem;}
.page{max-width:740px;margin:0 auto;background:#fff;border-radius:4px;padding:3rem 3.5rem;box-shadow:0 2px 24px rgba(58,46,38,.09);}
.inv-title{font-size:1.6rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7A2E3A;margin-bottom:2rem;}
.section{margin:1.8rem 0 .8rem;}
.section-label{font-size:.68rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#8a7d72;border-bottom:1px solid #f0e8de;padding-bottom:.35rem;margin-bottom:.8rem;}
.detail-grid{display:grid;grid-template-columns:auto 1fr;gap:.35rem .8rem;font-size:.9rem;}
.dk{color:#8a7d72;}
.terms-list{font-size:.9rem;color:#3A2E26;line-height:1.75;padding-left:1.2rem;}
.terms-list li{margin-bottom:.6rem;}
.print-btn{display:block;width:100%;margin-top:2rem;font:inherit;font-size:.88rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border:1.5px solid #E8D5B7;border-radius:4px;padding:.75em;cursor:pointer;background:none;color:#7A2E3A;}
@media print{.print-btn{display:none;}}
</style>
</head>
<body>
<div class="page">
  <div class="inv-title">Client Agreement</div>
  ${contractBodyHtml(b)}
  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
</div>
</body>
</html>`;
}

export interface ContractEnv {
  SIGNING_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

/** GET /api/booking/contract?token=<same invoice token> — read-only, no signing here. */
export async function renderContractPageHandler(
  env: ContractEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return new Response("Missing token", { status: 400, headers: { "content-type": "text/plain" } });

  const v = await verifyActionToken(token, env.SIGNING_SECRET, "invoice");
  if (!v) return new Response("Invalid or expired link", { status: 400, headers: { "content-type": "text/plain" } });

  const booking = await getBookingByIdForInvoice(env, v.bookingId, fetchImpl);
  if (!booking) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

  return new Response(renderContractPage(booking, token), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
  });
}
