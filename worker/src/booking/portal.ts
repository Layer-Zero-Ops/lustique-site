// worker/src/booking/portal.ts
/**
 * GET /api/booking/portal?token=<action_token>
 *
 * Read-only portal for bride + assigned artists.
 * Shows booking details, payment status, assigned artists,
 * venue/timing, and a link to the signed contract.
 *
 * Token is a generic action token with kind "portal" — short-lived
 * enough for shared viewing, long enough for event-day access.
 */

import { verifyActionToken } from "./token";
import { getBookingById, getBusinessSetting, type DbEnv } from "./db";
import { listBookingArtists } from "./artists";

export interface PortalEnv extends DbEnv {
  SIGNING_SECRET: string;
}

function esc(s = ""): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function fmtZAR(cents: number): string {
  return "R " + (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${d} ${months[m - 1]} ${y}`;
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    requested: "#b7791f",
    quote_sent: "#2b6cb0",
    accepted: "#2f855a",
    deposit_paid: "#2f855a",
    settled: "#276749",
    declined: "#c53030",
    cancelled: "#c53030",
  };
  const bg = colors[status] ?? "#718096";
  return `<span style="display:inline-block;padding:.2em .7em;border-radius:20px;font-size:.78rem;font-weight:700;color:#fff;background:${bg};">${esc(status)}</span>`;
}

export async function renderPortalPage(env: PortalEnv, req: Request, f: typeof fetch = fetch): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return new Response("Missing token", { status: 400, headers: { "content-type": "text/plain" } });

  const v = await verifyActionToken(token, env.SIGNING_SECRET, "portal");
  if (!v) return new Response("Invalid or expired link", { status: 400, headers: { "content-type": "text/plain" } });

  const booking = await getBookingById(env, v.bookingId, f);
  if (!booking) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

  const artists = await listBookingArtists(env as any, v.bookingId, f);
  const where = [booking.venue, booking.town, booking.province].filter(Boolean).join(", ") || "—";

  const contractEnabled = await getBusinessSetting(env, "contract_enabled", f) === "true";
  const contractHtmlUrl = `${new URL(req.url).origin}/api/booking/contract?token=${encodeURIComponent(token)}`;

  const depositPct = booking.deposit_pct ?? 0;
  const depositCents = booking.deposit_net_cents ?? 0;
  const balanceCents = booking.balance_net_cents ?? 0;
  const paymentStatus = booking.status === "settled"
    ? "Fully paid"
    : booking.status === "deposit_paid"
      ? `Deposit paid (${depositPct}%) — balance outstanding`
      : booking.status === "accepted"
        ? "Awaiting payment"
        : statusBadge(booking.status);

  const artistRows = artists.length
    ? artists.map(a => `<tr><td>${esc(a.artists.name)}</td><td>${a.lead ? "Lead" : "Supporting"}</td><td>${a.confirmed_at ? "Confirmed" : "Pending"}</td></tr>`).join("")
    : `<tr><td colspan="3" style="color:#8a7d72;">No artists assigned yet</td></tr>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Booking ${esc(booking.reference)} — Lustique Co.</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font:15px/1.6 Georgia,'Times New Roman',serif;color:#3A2E26;background:#FAF6F0;padding:2rem 1rem;}
.page{max-width:720px;margin:0 auto;background:#fff;border-radius:4px;padding:3rem 3.5rem;box-shadow:0 2px 24px rgba(58,46,38,.09);}
.inv-title{font-size:1.6rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7A2E3A;margin-bottom:2rem;}
.section{margin:1.8rem 0 .8rem;}
.section-label{font-size:.68rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#8a7d72;border-bottom:1px solid #f0e8de;padding-bottom:.35rem;margin-bottom:.8rem;}
.detail-grid{display:grid;grid-template-columns:auto 1fr;gap:.35rem .8rem;font-size:.9rem;}
.dk{color:#8a7d72;}
table.data{width:100%;border-collapse:collapse;font-size:.88rem;margin-top:.5rem;}
table.data th{text-align:left;color:#8a7d72;font-weight:600;padding:.35rem .6rem .35rem 0;border-bottom:1px solid #f0e8de;}
table.data td{padding:.45rem .6rem .45rem 0;border-bottom:1px solid #f7f2ec;}
a.btn{display:inline-block;background:#8a3a52;color:#fff;padding:.65em 1.4em;border-radius:8px;text-decoration:none;font-weight:600;font-size:.88rem;margin-top:.8rem;}
.footer{margin-top:2rem;font-size:.82rem;color:#8a7d72;}
@media (max-width:600px){
  body{padding:1rem .5rem;}
  .page{padding:1.75rem 1.25rem;}
  .inv-title{font-size:1.2rem;}
}
</style>
</head>
<body>
<div class="page">
  <div class="inv-title">Booking ${esc(booking.reference)}</div>

  <div class="section">
    <div class="section-label">Overview</div>
    <div class="detail-grid">
      <span class="dk">Status</span><span>${paymentStatus}</span>
      <span class="dk">Date</span><span>${fmtDate(booking.wedding_date)}</span>
      <span class="dk">Venue</span><span>${esc(where)}</span>
      <span class="dk">Party</span><span>${booking.party_size} look${booking.party_size !== 1 ? "s" : ""}</span>
      <span class="dk">Total</span><span>${fmtZAR(booking.total_cents)}</span>
      ${depositPct ? `<span class="dk">Deposit</span><span>${depositPct}% = ${fmtZAR(depositCents)} paid; ${fmtZAR(balanceCents)} remaining</span>` : ""}
      <span class="dk">Reference</span><span>${esc(booking.reference)}</span>
    </div>
  </div>

  <div class="section">
    <div class="section-label">Assigned Artists</div>
    <table class="data">
      <tr><th>Name</th><th>Role</th><th>Status</th></tr>
      ${artistRows}
    </table>
  </div>

  ${contractEnabled ? `<div class="section"><div class="section-label">Documents</div><a class="btn" href="${esc(contractHtmlUrl)}" target="_blank" rel="noopener">View signed contract</a></div>` : ""}

  <p class="footer">Share this link with your assigned artists so they can see the event details. This link is private — please do not share it publicly.</p>
</div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
  });
}
