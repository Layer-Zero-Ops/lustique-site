/**
 * GET + POST /api/booking/reject — bride declines the quote (T4 transition, Wave A).
 *
 * GET  — render confirmation page ("Are you sure?"). Prefetch-safe: no mutations.
 * POST — verify reject token → T4 (quote_sent → rejected) → insert rejection row
 *         → notify Zandeline → show thank-you page.
 *
 * Token is HMAC-signed (purpose="reject"); booking status enforces idempotency.
 */
import { getBookingById, transitionBooking, insertRejection, type ConfirmBookingRow } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { verifyActionToken } from "./token";

export interface BookingRejectEnv extends AuditEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
}

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));

type RejectLoad =
  | { ok: true; booking: ConfirmBookingRow }
  | { ok: false; reason: "invalid" | "expired" | "handled" };

async function loadQuoteSentBooking(env: BookingRejectEnv, token: string, f: typeof fetch): Promise<RejectLoad> {
  const v = await verifyActionToken(token, env.SIGNING_SECRET, "reject");
  if (!v) return { ok: false, reason: "invalid" };
  if (v.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  const booking = await getBookingById(env, v.bookingId, f);
  if (!booking) return { ok: false, reason: "invalid" };
  if (booking.status !== "quote_sent") return { ok: false, reason: "handled" };
  return { ok: true, booking };
}

async function brevoEmail(
  env: BookingRejectEnv,
  to: { email: string; name?: string },
  subject: string,
  html: string,
  f: typeof fetch,
): Promise<void> {
  const r = await f("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: env.NOTIFY_EMAIL, name: "Lustique Co." }, to: [to], subject, htmlContent: html }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function pageShell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — Lustique Co.</title><style>
body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2b;background:#f7f3ef;}
.card{max-width:520px;margin:6vh auto;background:#fff;border-radius:14px;padding:2.4rem 2rem;box-shadow:0 6px 30px rgba(0,0,0,.06);}
h1{font-size:1.4rem;margin:0 0 .8rem;color:#8a3a52;}
.btn-confirm{font:inherit;font-weight:600;border:0;border-radius:9px;padding:.8em 1.8em;cursor:pointer;background:#6b5d52;color:#fff;margin-top:1rem;}
.btn-confirm:hover{background:#5a4d44;}
.muted{color:#8a7d72;font-size:.88rem;margin-top:1rem;}
</style></head><body><div class="card">${inner}</div></body></html>`;
}

const invalidHtml = () =>
  pageShell("Link not valid", "<h1>This link isn't valid</h1><p>Please use the link from your quote email, or contact info@lustiqueco.co.za.</p>");
const expiredHtml = () =>
  pageShell("Quote expired", "<h1>This quote has expired</h1><p>Please contact info@lustiqueco.co.za if you'd still like to book.</p>");
const handledHtml = () =>
  pageShell("Already handled", "<h1>This quote has already been responded to</h1><p>If you need to change anything, please email info@lustiqueco.co.za.</p>");

function confirmPageBody(b: ConfirmBookingRow, token: string): string {
  return `<h1>Decline this booking?</h1>
<p>We're sorry it didn't work out. If your plans change, you're always welcome to send a new enquiry.</p>
<p style="color:#8a7d72;font-size:.92rem;"><strong>Date:</strong> ${esc(b.wedding_date)} · <strong>Ref:</strong> ${esc(b.reference)}</p>
<form method="POST" action="/api/booking/reject">
<input type="hidden" name="token" value="${esc(token)}">
<button class="btn-confirm" type="submit">Yes, decline this booking</button>
</form>
<p class="muted">Changed your mind? <a href="/api/booking/accept?token=${esc(/* accept token not available here — just go back */ "")}" style="color:#8a3a52;">Go back</a> or email <a href="mailto:info@lustiqueco.co.za" style="color:#8a3a52;">info@lustiqueco.co.za</a>.</p>`;
}

const thankYouHtml = (brideName: string) =>
  pageShell("Thanks for letting us know", `<h1>Thanks for letting us know</h1><p>Hi ${esc(brideName)} — we're sorry this didn't work out. If your plans ever change, we'd love to be part of your day. Feel free to reach out at <a href="mailto:info@lustiqueco.co.za" style="color:#8a3a52;">info@lustiqueco.co.za</a>.</p><p>Blessings,<br/>The Lustique Cosmetology Team</p>`);

/** GET — render confirmation page. Prefetch-safe: no mutations. */
export async function renderRejectPage(
  env: BookingRejectEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return htmlResponse(invalidHtml(), 400);
  const loaded = await loadQuoteSentBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "expired") return htmlResponse(expiredHtml(), 410);
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(invalidHtml(), 400);
  }
  return htmlResponse(pageShell("Decline booking", confirmPageBody(loaded.booking, token)));
}

/** POST — T4: quote_sent → rejected → notify Zandeline. */
export async function handleReject(
  env: BookingRejectEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  if (!token) return htmlResponse(invalidHtml(), 400);

  const loaded = await loadQuoteSentBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(loaded.reason === "expired" ? expiredHtml() : invalidHtml(), loaded.reason === "expired" ? 410 : 400);
  }

  const b = loaded.booking;
  const now = new Date().toISOString();

  // T4: quote_sent → rejected (atomic; no-op if already moved on)
  const updated = await transitionBooking(env, b.id, "quote_sent", {
    status: "rejected",
    rejected_at: now,
  }, fetchImpl);
  if (!updated) return htmlResponse(handledHtml(), 200);

  await insertRejection(env, { booking_id: b.id, rejected_by: "bride" }, fetchImpl).catch(() => {});
  await writeAudit(env, { bookingId: b.id, eventType: "reject.bride-declined", payload: { reference: b.reference } }, fetchImpl).catch(() => {});

  // Notify Zandeline
  try {
    await brevoEmail(
      env,
      { email: env.NOTIFY_EMAIL, name: "Lustique" },
      `Bride declined quote · ${b.bride_name} · ${b.wedding_date}`,
      `<p><strong>${esc(b.bride_name)}</strong> declined the quote for <strong>${esc(b.wedding_date)}</strong> (ref ${esc(b.reference)}).</p>
<p style="font-size:.88rem;color:#8a7d72;">The date is now free. No action needed.</p>`,
      fetchImpl,
    );
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "reject.notify-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }

  return htmlResponse(pageShell("Thanks for letting us know", thankYouHtml(b.bride_name)));
}
