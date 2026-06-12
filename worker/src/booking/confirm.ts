/**
 * GET + POST /api/booking/confirm — the confirm gate (spec §5, §7, §12).
 *
 * GET  = render-only hosted page (Zandeline sees the booking + Confirm/Decline
 *        buttons). NO mutation — mail scanners pre-fetch GET, so the state change
 *        is POST-only (spec §12 prefetch safety).
 * POST = verify token → guarded `requested → confirmed|declined` → email the
 *        bride → 303 redirect to the static thank-you page.
 *
 * v1 takes deposits by EFT (no Yoco). S4 swaps the EFT block for a Yoco pay-link.
 */
import { getBookingByTokenHash, transitionRequestedBooking, type ConfirmBookingRow } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { verifyToken, hashToken } from "./token";

export interface BookingConfirmEnv extends AuditEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
  EFT_BANK: string;
  EFT_ACCOUNT_NAME: string;
  EFT_ACCOUNT_NO: string;
  EFT_BRANCH_CODE: string;
}

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
const zar = (cents: number) => `R ${(cents / 100).toLocaleString("en-ZA")}`;

type LoadResult =
  | { ok: true; booking: ConfirmBookingRow }
  | { ok: false; reason: "invalid" | "expired" | "handled" };

/** Verify the token, look the booking up by hash, classify its state. */
async function loadBooking(
  env: BookingConfirmEnv,
  token: string,
  f: typeof fetch,
): Promise<LoadResult> {
  const v = await verifyToken(token, env.SIGNING_SECRET);
  if (!v) return { ok: false, reason: "invalid" };
  if (v.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  const booking = await getBookingByTokenHash(env, await hashToken(token), f);
  if (!booking) return { ok: false, reason: "invalid" };
  if (booking.status !== "requested" || booking.confirm_token_used_at) {
    return { ok: false, reason: "handled" };
  }
  return { ok: true, booking };
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function pageShell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — Lustique Co.</title><style>
body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2b;background:#f7f3ef;}
.card{max-width:540px;margin:6vh auto;background:#fff;border-radius:14px;padding:2.4rem 2rem;box-shadow:0 6px 30px rgba(0,0,0,.06);}
h1{font-size:1.5rem;margin:0 0 1rem;color:#8a3a52;}
table{border-collapse:collapse;margin:1rem 0;width:100%;}td{padding:4px 0;vertical-align:top;}
td.k{color:#8a7d72;white-space:nowrap;padding-right:14px;width:1%;}
.actions{display:flex;gap:.8rem;flex-wrap:wrap;margin-top:1.6rem;}
button{font:inherit;font-weight:600;border:0;border-radius:9px;padding:.75em 1.5em;cursor:pointer;}
.confirm{background:#8a3a52;color:#fff;}.decline{background:#efe7e0;color:#6b5d52;}
.muted{color:#8a7d72;font-size:.9rem;}</style></head><body><div class="card">${inner}</div></body></html>`;
}

const invalidHtml = () =>
  pageShell("Link not valid", "<h1>This link isn't valid</h1><p>Please use the most recent confirm link from your email.</p>");
const expiredHtml = () =>
  pageShell("Link expired", "<h1>This link has expired</h1><p>Confirm links are valid for 14 days. Ask the bride to re-submit, or reach out to her directly.</p>");
const handledHtml = () =>
  pageShell("Already handled", "<h1>This booking has already been handled</h1><p>It's no longer pending — there's nothing more to do here.</p>");

function confirmPageBody(b: ConfirmBookingRow, token: string): string {
  const where = [b.venue, b.town, b.province].filter(Boolean).join(", ") || "—";
  return `<h1>Confirm this booking</h1>
<p>Review the request, then confirm to email <strong>${esc(b.bride_name)}</strong> her EFT deposit details, or decline to send a gentle no.</p>
<table>
<tr><td class="k">Bride</td><td><strong>${esc(b.bride_name)}</strong><br><span class="muted">${esc(b.bride_email)}</span></td></tr>
<tr><td class="k">Date</td><td><strong>${esc(b.wedding_date)}</strong></td></tr>
<tr><td class="k">Venue</td><td>${esc(where)}</td></tr>
<tr><td class="k">Party</td><td>${b.party_size} looks</td></tr>
<tr><td class="k">Total</td><td><strong>${zar(b.total_cents)}</strong></td></tr>
<tr><td class="k">Deposit</td><td>${b.deposit_pct}% — <strong>${zar(b.deposit_net_cents)}</strong> due now</td></tr>
<tr><td class="k">Reference</td><td>${esc(b.reference)}</td></tr>
</table>
<div class="actions">
<form method="POST" action="/api/booking/confirm"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="action" value="confirm"><button class="confirm" type="submit">Confirm &amp; email deposit details</button></form>
<form method="POST" action="/api/booking/confirm"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="action" value="decline"><button class="decline" type="submit">Decline</button></form>
</div>
<p class="muted" style="margin-top:1.4rem;">This link is single-use and expires 14 days after the request.</p>`;
}

/** GET — render-only. Never mutates (spec §12 prefetch safety). */
export async function renderConfirmPage(
  env: BookingConfirmEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return htmlResponse(invalidHtml(), 400);
  const loaded = await loadBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "expired") return htmlResponse(expiredHtml(), 410);
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(invalidHtml(), 400);
  }
  return htmlResponse(pageShell("Confirm booking", confirmPageBody(loaded.booking, token)));
}

async function brevoEmail(
  env: BookingConfirmEnv,
  to: { email: string; name?: string },
  subject: string,
  html: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const r = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: env.NOTIFY_EMAIL, name: "Lustique Co." },
      to: [to], subject, htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}

function confirmEmailHtml(env: BookingConfirmEnv, b: ConfirmBookingRow): string {
  return `<p>Hi ${esc(b.bride_name)},</p>
<p>Wonderful news — <strong>${esc(b.wedding_date)}</strong> is available! To book your date, please pay your deposit by EFT. As soon as it reflects, we'll send you your booking confirmation.</p>
<table style="border-collapse:collapse;font:15px/1.7 system-ui,sans-serif;margin:.6rem 0 1rem;">
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Deposit due</td><td><strong>${zar(b.deposit_net_cents)}</strong> (${b.deposit_pct}%)</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Bank</td><td>${esc(env.EFT_BANK)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Account name</td><td>${esc(env.EFT_ACCOUNT_NAME)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Account no.</td><td>${esc(env.EFT_ACCOUNT_NO)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Branch code</td><td>${esc(env.EFT_BRANCH_CODE)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Payment reference</td><td><strong>${esc(b.reference)}</strong></td></tr>
</table>
<p style="font-size:.92rem;color:#8a7d72;">Please use <strong>${esc(b.reference)}</strong> as your payment reference so we can match it to your booking. The balance of ${zar(b.balance_net_cents)} is payable closer to your day.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

function declineEmailHtml(b: ConfirmBookingRow): string {
  return `<p>Hi ${esc(b.bride_name)},</p>
<p>Thank you so much for thinking of Lustique for <strong>${esc(b.wedding_date)}</strong>.</p>
<p>Sadly we're not able to take this booking — most often that's because the date is already fully committed with our artists. We're truly sorry to miss your day.</p>
<p>If your plans shift or you'd like to explore another date, we'd love to hear from you at <a href="mailto:info@lustiqueco.co.za">info@lustiqueco.co.za</a>.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

/** POST — verify, guarded transition, email, redirect. The mutation lives here, never in GET. */
export async function handleBookingConfirm(
  env: BookingConfirmEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const action = String(form?.get("action") ?? "confirm");
  const origin = env.ALLOWED_ORIGIN || "";
  const decline = action === "decline";

  if (!token || (action !== "confirm" && action !== "decline")) {
    return htmlResponse(invalidHtml(), 400);
  }

  const loaded = await loadBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(loaded.reason === "expired" ? expiredHtml() : invalidHtml(), loaded.reason === "expired" ? 410 : 400);
  }

  const b = loaded.booking;
  const now = new Date().toISOString();
  const patch = decline
    ? { status: "declined", declined_at: now, confirm_token_used_at: now }
    : { status: "confirmed", confirmed_at: now, confirm_token_used_at: now };

  const updated = await transitionRequestedBooking(env, b.id, patch, fetchImpl);
  if (!updated) return htmlResponse(handledHtml(), 200);

  try {
    if (decline) {
      await brevoEmail(env, { email: b.bride_email, name: b.bride_name },
        "An update on your Lustique booking", declineEmailHtml(b), fetchImpl);
    } else {
      await brevoEmail(env, { email: b.bride_email, name: b.bride_name },
        "Your date is available — secure it with your deposit · Lustique Co.", confirmEmailHtml(env, b), fetchImpl);
    }
    await writeAudit(env, { bookingId: b.id, eventType: decline ? "confirm.declined" : "confirm.confirmed", payload: { reference: b.reference } }, fetchImpl);
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "confirm.email-failed", payload: { reference: b.reference, action } }, fetchImpl).catch(() => {});
  }

  return redirect(`${origin}/booking-${decline ? "declined" : "confirmed"}.html?ref=${encodeURIComponent(b.reference)}`);
}
