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
import { getBookingByTokenHash, transitionRequestedBooking, getBookingById, transitionBooking, insertNotification, type ConfirmBookingRow } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { verifyToken, hashToken, signActionToken, verifyActionToken } from "./token";
import { esc, fmtDate, fmtZAR, ep, em, emailShell, emailTable, emailNote, firstN, sendEmail, getEftSettings, type EftSettings } from "../lib/email";

export interface BookingConfirmEnv extends AuditEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
}

const MARK_PAID_TTL_MS = 90 * 24 * 60 * 60 * 1000;

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
<tr><td class="k">Total</td><td><strong>${fmtZAR(b.total_cents)}</strong></td></tr>
<tr><td class="k">Deposit</td><td>${b.deposit_pct}% — <strong>${fmtZAR(b.deposit_net_cents)}</strong> due now</td></tr>
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

function confirmEmailHtml(eft: EftSettings, b: ConfirmBookingRow): string {
  return emailShell({
    heading: `Your date is available, ${esc(firstN(b.bride_name))}.`,
    body: ep(`Wonderful news — ${em(fmtDate(b.wedding_date))} is available! To secure your date, please pay your deposit by EFT using the details below. As soon as it reflects, we&#8217;ll send your booking confirmation.`) +
      emailTable([
        { key: "Date", val: fmtDate(b.wedding_date) },
        { key: "Deposit due", val: `${fmtZAR(b.deposit_net_cents)} (${b.deposit_pct}%)`, bold: true },
        { key: "Bank", val: eft.bank },
        { key: "Account holder", val: eft.accountHolder },
        { key: "Account no.", val: eft.accountNumber },
        { key: "Branch code", val: eft.branchCode },
        { key: "Payment reference", val: b.reference, ref: true },
      ]),
    btnZone: emailNote(`Please use your payment reference above when making the EFT so we can match the payment. The balance of ${fmtZAR(b.balance_net_cents)} is due 14 working days before your event.`),
  });
}

function declineEmailHtml(b: ConfirmBookingRow): string {
  return emailShell({
    heading: `Thank you for thinking of us, ${esc(firstN(b.bride_name))}.`,
    body: ep(`We&#8217;re so grateful you considered Lustique for ${em(fmtDate(b.wedding_date))}. Sadly, we&#8217;re not able to take this booking — most often because the date is already fully committed with our artists.`) +
      ep(`We&#8217;re truly sorry to miss your day.`),
    btnZone: emailNote(`If your plans change or another date opens up, we&#8217;d love to hear from you.`),
    footerNote: `Reach us any time at <a href="mailto:info@lustiqueco.co.za" style="color:#5C4332;text-decoration:none;">info@lustiqueco.co.za</a> — we&#8217;ll do our best to help.`,
  });
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
      await sendEmail(env, { email: b.bride_email, name: b.bride_name },
        "An update on your Lustique booking — Lustique Co.", declineEmailHtml(b), fetchImpl);
    } else {
      const eft = await getEftSettings(env, fetchImpl);
      await sendEmail(env, { email: b.bride_email, name: b.bride_name },
        "Your date is available — secure it with your deposit · Lustique Co.", confirmEmailHtml(eft, b), fetchImpl);
      const markPaidToken = await signActionToken(b.id, new Date(Date.now() + MARK_PAID_TTL_MS), env.SIGNING_SECRET, "deposit");
      const markPaidUrl = `${origin}/api/booking/mark-paid?token=${encodeURIComponent(markPaidToken)}`;
      await sendEmail(env, { email: env.NOTIFY_EMAIL, name: "Lustique" },
        `Confirmed — awaiting EFT · ${b.bride_name} · ${b.wedding_date}`,
        `<p style="font:14px/1.6 system-ui,sans-serif;"><strong>${esc(b.bride_name)}</strong> — ${esc(b.wedding_date)} — confirmed. The bride has her EFT deposit details (${fmtZAR(b.deposit_net_cents)}, ref <strong>${esc(b.reference)}</strong>).</p>
<p style="margin:1.2rem 0;"><a href="${esc(markPaidUrl)}" style="display:inline-block;background:#8a3a52;color:#fff;padding:.7em 1.6em;border-radius:8px;text-decoration:none;font-weight:600;">When the EFT lands — mark deposit received &amp; secure her date</a></p>
<p style="font-size:.88rem;color:#8a7d72;">Only click once the deposit reflects. Link valid 90 days.</p>`,
        fetchImpl);
    }
    await writeAudit(env, { bookingId: b.id, eventType: decline ? "confirm.declined" : "confirm.confirmed", payload: { reference: b.reference } }, fetchImpl);
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "confirm.email-failed", payload: { reference: b.reference, action } }, fetchImpl).catch(() => {});
  }

  return redirect(`${origin}/booking-${decline ? "declined" : "confirmed"}.html?ref=${encodeURIComponent(b.reference)}`);
}

type ConfirmedLoad =
  | { ok: true; booking: ConfirmBookingRow }
  | { ok: false; reason: "invalid" | "expired" | "handled" };

async function loadConfirmedBooking(env: BookingConfirmEnv, token: string, f: typeof fetch): Promise<ConfirmedLoad> {
  const v = await verifyActionToken(token, env.SIGNING_SECRET, "deposit");
  if (!v) return { ok: false, reason: "invalid" };
  if (v.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  const booking = await getBookingById(env, v.bookingId, f);
  if (!booking) return { ok: false, reason: "invalid" };
  // Wave A: bookings reach mark-paid from "accepted" (new flow) or "confirmed" (legacy flow)
  if (booking.status !== "accepted" && booking.status !== "confirmed") return { ok: false, reason: "handled" };
  return { ok: true, booking };
}

function markPaidPageBody(b: ConfirmBookingRow, token: string): string {
  return `<h1>Record deposit received</h1>
<p>Confirm you've received <strong>${esc(b.bride_name)}</strong>'s EFT deposit. This secures her date and emails her the confirmation.</p>
<table>
<tr><td class="k">Bride</td><td><strong>${esc(b.bride_name)}</strong></td></tr>
<tr><td class="k">Date</td><td><strong>${esc(b.wedding_date)}</strong></td></tr>
<tr><td class="k">Deposit</td><td><strong>${fmtZAR(b.deposit_net_cents)}</strong></td></tr>
<tr><td class="k">Reference</td><td>${esc(b.reference)}</td></tr>
</table>
<div class="actions">
<form method="POST" action="/api/booking/mark-paid"><input type="hidden" name="token" value="${esc(token)}"><button class="confirm" type="submit">Deposit received — secure her date</button></form>
</div>
<p class="muted" style="margin-top:1.4rem;">Only do this once the money reflects in the account.</p>`;
}

const depositRecordedHtml = (b: ConfirmBookingRow) =>
  pageShell("Deposit recorded", `<h1>Deposit recorded ✓</h1><p><strong>${esc(b.bride_name)}</strong>'s date <strong>${esc(b.wedding_date)}</strong> is now secured, and she's been emailed her confirmation. You can close this tab.</p>`);

function depositSecuredEmailHtml(b: ConfirmBookingRow): string {
  return emailShell({
    heading: `Your date is secured, ${esc(firstN(b.bride_name))}.`,
    body: ep(`Your deposit is in — ${em(fmtDate(b.wedding_date))} is officially yours. We can&#8217;t wait to be part of your day.`) +
      emailTable([
        { key: "Date", val: fmtDate(b.wedding_date) },
        { key: "Deposit received", val: fmtZAR(b.deposit_net_cents), bold: true },
        { key: "Balance remaining", val: fmtZAR(b.balance_net_cents) },
        { key: "Your reference", val: b.reference, ref: true },
      ]),
    btnZone: emailNote(`We&#8217;ll send a balance reminder closer to your day — there&#8217;s nothing more to do right now.`),
  });
}

/** GET — render-only deposit-received page. */
export async function renderMarkPaidPage(env: BookingConfirmEnv, req: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return htmlResponse(invalidHtml(), 400);
  const loaded = await loadConfirmedBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "expired") return htmlResponse(expiredHtml(), 410);
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(invalidHtml(), 400);
  }
  return htmlResponse(pageShell("Record deposit", markPaidPageBody(loaded.booking, token)));
}

/** POST — guarded confirmed→deposit_paid, email the bride "secured". */
export async function handleMarkPaid(env: BookingConfirmEnv, req: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  if (!token) return htmlResponse(invalidHtml(), 400);

  const loaded = await loadConfirmedBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(loaded.reason === "expired" ? expiredHtml() : invalidHtml(), loaded.reason === "expired" ? 410 : 400);
  }

  const b = loaded.booking;
  // Try Wave A status first ("accepted"), fall back to legacy ("confirmed") for old bookings.
  const now2 = new Date().toISOString();
  const updated =
    await transitionBooking(env, b.id, "accepted", { status: "deposit_paid", deposit_paid_at: now2 }, fetchImpl) ??
    await transitionBooking(env, b.id, "confirmed", { status: "deposit_paid", deposit_paid_at: now2 }, fetchImpl);
  if (!updated) return htmlResponse(handledHtml(), 200);

  insertNotification(env, {
    type: "deposit_paid",
    title: `Booking fee received — ${b.bride_name}`,
    body: `${b.reference} · ${b.wedding_date}`,
    link: `/api/admin/booking/${b.id}`,
    booking_id: b.id,
    payload: { reference: b.reference },
  }, fetchImpl).catch(() => {});

  try {
    await sendEmail(env, { email: b.bride_email, name: b.bride_name },
      "Your date is secured · Lustique Co.", depositSecuredEmailHtml(b), fetchImpl);
    await writeAudit(env, { bookingId: b.id, eventType: "payment.deposit-recorded", payload: { reference: b.reference } }, fetchImpl);
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "payment.email-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }
  return htmlResponse(depositRecordedHtml(b));
}
