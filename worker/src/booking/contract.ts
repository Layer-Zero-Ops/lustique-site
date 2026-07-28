/**
 * GET /api/booking/contract?token=<signed> — bride's Client Agreement, populated per booking.
 *
 * Signature model: ordinary electronic signature under South Africa's ECT Act (Electronic
 * Communications and Transactions Act 25 of 2002) s13 — typed full name + explicit
 * checkbox consent + timestamp + IP + user-agent + a hash of the exact contract text
 * shown, all captured atomically with the booking's accept/deposit-selection step
 * (see handleInvoicePay in invoice.ts).
 */

import { verifyActionToken } from "./token";
import { getBookingByIdForInvoice } from "./db";

const enc = new TextEncoder();

export const CONTRACT_VERSION = "lustique-v1-2026-07-28";

function esc(s = ""): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

const zar = (cents: number) =>
  "R " + (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDateStr(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
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

export function contractBodyText(b: ContractBooking): string {
  const venue = [b.venue, b.town, b.province].filter(Boolean).join(", ") || "to be confirmed";
  const feePhrase = b.deposit_pct ? `${b.deposit_pct}%` : "the percentage selected at checkout (25%, 50%, or 100%)";
  return [
    `LUSTIQUE COSMETOLOGY — CLIENT SERVICE AGREEMENT (${CONTRACT_VERSION})`,
    `Reference: ${b.reference}`,
    `Client: ${b.bride_name} <${b.bride_email}>`,
    `Event date: ${fmtDateStr(b.wedding_date)}`,
    `Venue: ${venue}`,
    `Party size: ${b.party_size} look${b.party_size !== 1 ? "s" : ""}`,
    `Total fee: ${zar(b.total_cents)}`,
    `Booking fee: ${feePhrase} of the total, due to confirm this date.`,
    `Balance due: 14 business days before the event date.`,
    `1. Scope of Services. The Service Provider, LUSTIQUE COSMETOLOGY and the full team of hair stylists and makeup artists, offers professional hair and makeup services for events. The specific services provided to the Client are detailed in the customized quotation as provided to the client, detailing the booking terms and conditions and stating the package details as requested and accepted by the client. Additional services encompass travel TO and FROM the venue on the event date, calculated and outlined in the quotation/invoice provided to the client.`,
    `1.4 Time Schedule and Venue. The Service Provider agrees to commence services at agreed upon time as per hair and makeup schedule discussed between service provider and the client, at the specified venue. Wedding day hair and makeup schedules are sent to bride 7-14 working days before the date of the event for approval; or when the wedding/photographer's timeline has been finalised.`,
    `2. Payment Plans. Lustique Cosmetology provides clients with three payment plan options. This agreement is subject to the terms and conditions of Lustique Cosmetology and is governed by the applicable laws of South Africa.`,
    `2.1 Option 1: 100% Payment. Full payment amount of as per quotation/invoice provided on acceptance of this agreement.`,
    `2.2 Option 2: 50% Booking fee as per full quotation/invoice provided, required after acceptance of initial quote ("Payment 1"). 50% Balance required 14 working days before the date of the event ("Payment 2").`,
    `2.3 Option 3 (Only available to Packages 3+): 25% Booking Payment required upon booking confirmation ("Payment 1"). 75% Balance fee payable in installments, as agreed to by both parties or the full balance amount payable 14 working days before the date of the event.`,
    `3. Payment Methods. Lustique Cosmetology is proudly cashless: EFT Payment (send proof to info@lustiqueco.co.za along with the signed service agreement) or Yoco Payment Link.`,
    `3.1 Payment Terms and Conditions. 3.1.1 A confirmed booking secures the agreed-upon event date; all other dates remain the property of Lustique Cosmetology. 3.1.2 40% of the totalled invoice is non-refundable to book and secure the specified event date. 3.1.3 Any payment made constitutes a legally binding agreement. 3.1.4 All remaining balances must be paid in full no later than 14 business days before the wedding date. 3.1.5 Failure to make full payment within the specified timeframe will result in automatic cancellation. 3.1.6 Booking confirmation only once the booking fee has been received and receipted. 3.1.7 Once accepted and paid, no deductions may be made; additional services must be finalized at least 14 working days prior to the event.`,
    `4. Postponement of Event Date. 4.1.1 Single postponement allowance within the current or next calendar year, subject to availability. 4.1.2 Weekend postponement fee R1,000; weekday postponement once without penalty. 4.1.3 Each subsequent postponement incurs R1,000. 4.1.4 Postponements into a new year are subject to updated pricing. 4.1.5 Client remains liable for the total booking amount. 4.1.6 Penalties based on notice period: 3-6 months 20%, 2-3 months 30%, 1-2 months 40%, 30 days or less 50%.`,
    `5. Cancellations. 5.1 Cancellation must be submitted in writing via email. 5.2 Cancellations within 30 days of booking qualify for a full refund. 5.3 After 30 days, 40% of the total invoiced amount is non-refundable. 5.4 Cancellation fees by notice period: 6 months 50%, 3 months 60%, 2 months 75%, 30 days or less 100%. 5.5 No refunds for transferred bookings. 5.6 Exceptional circumstances reviewed case-by-case.`,
    `6. Health & Safety Disclosure Requirements. 6.1 Client must disclose any communicable diseases. 6.2 Lustique reserves the right to refuse service; no refunds for refusal due to health and safety concerns. 6.3 Failure to disclose relevant health conditions makes the client liable for medical expenses and replacement of contaminated products. 6.4 No unauthorised handling of kits; contamination or breakage is the client's financial responsibility.`,
    `7. On-Location Requirements. 7.1 Once set up, no changes to venue/room permitted; location must be well-ventilated and spacious. 7.2 No additional services on the day beyond those booked. 7.3 Minimum requirements: suitable table/workstation, low chair near mirror with plug points, ample natural lighting, well-ventilated room, clean moisturized faces, hair not washed on the day, strict adherence to time slots. 7.4 No cancellations/changes on the event day; absent individuals forfeit their service fee.`,
    `8. Additional Artists. For large groups, additional artists may be assigned. If preparation time is limited, Lustique reserves the right to assign additional artists. Additional artist fee: R850.00 per additional artist, plus travel fee if applicable.`,
    `9. Service, Waiting Time & Overtime Charges. 9.1 Early start may be required for large parties. 9.2 Overtime: waiting fee R250 per 30-minute increment; overtime beyond finishing time R250 per 30 minutes; must be paid in cash before departure. 9.3 Late arrivals may delay start time or reduce allocated styling time. 9.4 Late arrivals will not extend the end time; missed services due to tardiness are non-refundable.`,
    `10. Destination Weddings. 10.1 Subject to confirmation if travel restrictions exist. 10.2 Over 200 km one-way, accommodation must be provided (minimum 3-star, no shared beds), arranged for the night before. 10.3 Accommodation details due no less than 14 days prior. 10.4 Over 200 km one-way, client secures and covers minimum 2 nights' accommodation unless agreed otherwise in writing.`,
    `11. Code of Conduct. 11.1 Lustique will respond promptly and respectfully. 11.2 Client agrees to treat providers with respect; disruptive behaviour may result in termination. 11.3 Mutual respect, integrity, and professionalism. 11.4 Lustique consists of six hairstylists and makeup artists including assistants; additional artists beyond reasonable allocation are charged at R850.00 each.`,
    `12. Photographs & Content. 12.1 Client grants permission to use images/audio/video for publication purposes. 12.2 Client agrees to share photographs/video clips from the photographer/videographer for promotional purposes.`,
    `13. Disclaimer. 13.1 Force majeure: not liable for non-attendance/late arrival due to circumstances beyond control; liability limited to service fee charged. 13.4 Not liable for skin reactions with undisclosed allergies; client must inform Lustique of known allergens.`,
    `14. Acknowledgement. Client acknowledges they have read, understood, and accept all terms and conditions. If the client disagrees, this contract is void immediately.`,
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
      <span class="dk">Booking fee</span><span>${esc(feePhrase)} of the total, due to confirm this date.</span>
    </div>
  </div>
  <div class="section">
    <div class="section-label">Terms</div>
    <ol class="terms-list">
      <li><strong>Scope of Services.</strong> The Service Provider, Lustique Cosmetology and the full team of hair stylists and makeup artists, offers professional hair and makeup services for events, as detailed in the accompanying quotation/invoice. Additional travel to and from the venue is calculated in the quotation.</li>
      <li><strong>Payment Plans.</strong> Three options are available: Option 1 – 100%; Option 2 – 50% booking fee + 50% balance 14 working days before the event; Option 3 – 25% booking fee + balance in instalments or 14 working days before (Packages 3+ only). This agreement is governed by the laws of South Africa.</li>
      <li><strong>Payment Terms.</strong> 40% of the total is non-refundable to secure the date. Booking confirmation only once the fee is received. Balance due 14 business days before the event. Late payment may result in automatic cancellation.</li>
      <li><strong>Postponement.</strong> One postponement allowed within the current or next calendar year, subject to availability. Weekend transfers incur R1,000; additional transfers R1,000 each. New-year transfers are subject to updated pricing. Notice-period penalties apply: 3–6 months 20%, 2–3 months 30%, 1–2 months 40%, 30 days or less 50%.</li>
      <li><strong>Cancellation.</strong> Written notice by email required. Within 30 days: full refund. After 30 days: 40% non-refundable. Cancellation fees by notice period: 6 months 50%, 3 months 60%, 2 months 75%, 30 days or less 100%. Transferred bookings are non-refundable.</li>
      <li><strong>Health &amp; Safety.</strong> Client must disclose communicable diseases. Lustique may refuse service on health grounds with no refund. Client is liable for medical costs and replacement of contaminated products where disclosure was not made. Kits must not be handled without permission.</li>
      <li><strong>On-location requirements.</strong> No venue changes once setup is complete. Table, chair, mirror, plug points, good lighting and ventilation are required. Hair must not be washed on the day. Late arrivals may be moved to the end of the schedule or forfeit their service.</li>
      <li><strong>Additional artists.</strong> Additional artists may be assigned for large groups or limited time. Fee: R850.00 per additional artist, plus travel if applicable.</li>
      <li><strong>Overtime &amp; waiting.</strong> Waiting fee: R250 per 30 minutes. Overtime beyond the agreed finish: R250 per 30 minutes, payable in cash before departure. Late arrivals will not extend the booking end time.</li>
      <li><strong>Destination weddings.</strong> Over 200 km one-way from Pretoria: client must provide accommodation (minimum 3-star, no shared beds) for the night before, and cover at least 2 nights unless agreed otherwise in writing.</li>
      <li><strong>Code of conduct.</strong> Both parties must act respectfully. Disruptive behaviour may result in termination. Artist allocation is at Lustique's discretion.</li>
      <li><strong>Photographs &amp; content.</strong> Client grants Lustique a non-exclusive licence to use event photographs for portfolio and marketing purposes, unless the client opts out in writing before the event.</li>
      <li><strong>Disclaimer.</strong> Lustique is not liable for indirect/consequential damages. Liability limited to the total fee paid. Not liable for allergic reactions where sensitivities were not disclosed. Force majeure events relieve both parties from liability.</li>
      <li><strong>Entire agreement.</strong> This document, together with the invoice referenced above, constitutes the entire agreement between the parties.</li>
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
@media (max-width:600px){
  body{padding:1rem .5rem;}
  .page{padding:1.75rem 1.25rem;}
  .inv-title{font-size:1.2rem;}
}
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
