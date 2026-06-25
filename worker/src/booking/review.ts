// worker/src/booking/review.ts
/**
 * GET + POST /api/booking/review — Zandeline's booking review & approval page (S6b).
 *
 * Replaces the bare confirm/decline gate: Zandeline sees the full quote breakdown,
 * can adjust the final total, then clicks "Approve & Send" to email the bride her
 * EFT deposit invoice in one step. Decline path mirrors the confirm gate.
 *
 * Uses the same 14-day confirm token (signToken / hashToken) already in the email.
 * The old /api/booking/confirm route remains for backwards-compat but new emails link here.
 *
 * GET  = render-only (prefetch-safe — no mutations, spec §12)
 * POST = verify → optional amount override → guarded transition → emails → redirect
 */
import { getBookingByTokenHashForReview, transitionRequestedBooking, updateBookingWaveIds, listExpiredQuotes, transitionBooking, type ReviewBookingRow } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { verifyToken, hashToken, signActionToken } from "./token";
import { createCustomer, createInvoice, type WaveEnv } from "../lib/wave";
import { esc, fmtDate, fmtZAR, ep, em, emailShell, emailTable, emailBtn, emailBtnLink, emailNote, firstN, sendEmail } from "../lib/email";

export interface BookingReviewEnv extends AuditEnv, WaveEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
}

type LoadResult =
  | { ok: true; booking: ReviewBookingRow }
  | { ok: false; reason: "invalid" | "expired" | "handled" };

async function loadBooking(env: BookingReviewEnv, token: string, f: typeof fetch): Promise<LoadResult> {
  const v = await verifyToken(token, env.SIGNING_SECRET);
  if (!v) return { ok: false, reason: "invalid" };
  if (v.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  const booking = await getBookingByTokenHashForReview(env, await hashToken(token), f);
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
.card{max-width:600px;margin:5vh auto 3rem;background:#fff;border-radius:14px;padding:2.4rem 2rem;box-shadow:0 6px 30px rgba(0,0,0,.06);}
h1{font-size:1.5rem;margin:0 0 .5rem;color:#8a3a52;}h2{font-size:.95rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#8a7d72;margin:1.4rem 0 .4rem;}
table{border-collapse:collapse;margin:.3rem 0;width:100%;}td{padding:3px 0;vertical-align:top;}
td.k{color:#8a7d72;white-space:nowrap;padding-right:14px;width:1%;}
.invoice{background:#f7f3ef;border-radius:10px;padding:1rem 1.2rem;margin:1.4rem 0 .6rem;}
.invoice label{display:block;font-weight:600;margin-bottom:.4rem;font-size:.95rem;color:#6b5d52;}
.invoice input[type=number]{font:inherit;font-size:1.2rem;font-weight:600;width:100%;box-sizing:border-box;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .7em;margin-top:.25rem;background:#fff;color:#2b2b2b;}
.invoice input[type=number]:focus{outline:2px solid #8a3a52;border-color:#8a3a52;}
.preview{margin:.6rem 0 0;color:#6b5d52;font-size:.94rem;}
.btn-approve{display:block;width:100%;font:inherit;font-size:1rem;font-weight:600;border:0;border-radius:9px;padding:.85em;cursor:pointer;background:#8a3a52;color:#fff;margin-top:1rem;}
.btn-approve:hover{background:#7a3048;}
.decline-wrap{text-align:center;margin-top:.8rem;}
.btn-decline{font:inherit;font-size:.9rem;font-weight:600;border:1.5px solid #c9bfb8;border-radius:9px;padding:.5em 1.4em;cursor:pointer;background:none;color:#6b5d52;}
.muted{color:#8a7d72;font-size:.88rem;}
</style></head><body><div class="card">${inner}</div></body></html>`;
}

const invalidHtml = () =>
  pageShell("Link not valid", "<h1>This link isn't valid</h1><p>Please use the most recent link from the booking request email.</p>");
const expiredHtml = () =>
  pageShell("Link expired", "<h1>This link has expired</h1><p>Confirm links are valid for 14 days. Ask the bride to re-submit.</p>");
const handledHtml = () =>
  pageShell("Already handled", "<h1>This booking has already been handled</h1><p>Nothing more to do here.</p>");

function reviewPageBody(b: ReviewBookingRow, token: string): string {
  const where = [b.venue, b.town, b.province].filter(Boolean).join(", ") || "—";
  const totalRand = Math.round(b.total_cents / 100);
  const lineRows = (b.quote_lines ?? [])
    .map((l) => `<tr><td class="k">${esc(l.label)}</td><td>R ${Number(l.amount).toLocaleString("en-ZA")}</td></tr>`)
    .join("");

  return `<h1>Review booking request</h1>
<p class="muted">Check the details below and adjust the total if needed, then approve to send ${esc(b.bride_name)} her quote. She picks her deposit % when she accepts.</p>
<h2>Booking details</h2>
<table>
<tr><td class="k">Bride</td><td><strong>${esc(b.bride_name)}</strong><br><span class="muted">${esc(b.bride_email)}</span></td></tr>
<tr><td class="k">Date</td><td><strong>${esc(b.wedding_date)}</strong></td></tr>
<tr><td class="k">Venue</td><td>${esc(where)}</td></tr>
<tr><td class="k">Party</td><td>${b.party_size} looks</td></tr>
<tr><td class="k">Reference</td><td>${esc(b.reference)}</td></tr>
</table>
${lineRows ? `<h2>Quote breakdown</h2><table>${lineRows}</table>` : ""}
<form method="POST" action="/api/booking/review">
<input type="hidden" name="token" value="${esc(token)}">
<input type="hidden" name="action" value="confirm">
<div class="invoice">
  <label>Final total (R)<input id="totalInput" type="number" name="overrideTotal" value="${totalRand}" min="1" step="1" required></label>
  <p class="preview">Total: <strong id="totalPreview">R ${totalRand.toLocaleString("en-ZA")}</strong> · Bride picks deposit % on acceptance</p>
</div>
<button class="btn-approve" type="submit">Approve &amp; send quote to bride</button>
</form>
<div class="decline-wrap">
<form method="POST" action="/api/booking/review">
<input type="hidden" name="token" value="${esc(token)}">
<input type="hidden" name="action" value="decline">
<button class="btn-decline" type="submit">Decline booking</button>
</form>
</div>
<p class="muted" style="margin-top:1.6rem;">This link is single-use and expires 14 days after the request.</p>
<script>(function(){
var t=document.getElementById('totalInput'),p=document.getElementById('totalPreview');
function u(){var tot=Math.max(0,parseInt(t.value,10)||0);p.textContent='R\\u00a0'+tot.toLocaleString('en-ZA');}
t&&t.addEventListener('input',u);
}());</script>`;
}

function declineEmailHtml(b: ReviewBookingRow): string {
  return emailShell({
    heading: `Thank you for thinking of us, ${esc(firstN(b.bride_name))}.`,
    body: ep(`We&#8217;re so grateful you considered Lustique for ${em(fmtDate(b.wedding_date))}. Sadly, we&#8217;re not able to take this booking — most often because the date is already fully committed with our artists.`) +
      ep(`We&#8217;re truly sorry to miss your day.`),
    btnZone: emailNote(`If your plans change or another date opens up, we&#8217;d love to hear from you.`),
    footerNote: `Reach us any time at <a href="mailto:info@lustiqueco.co.za" style="color:#5C4332;text-decoration:none;">info@lustiqueco.co.za</a> — we&#8217;ll do our best to help.`,
  });
}

/** GET — render-only. Never mutates (spec §12 prefetch safety). */
export async function renderReviewPage(
  env: BookingReviewEnv,
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
  return htmlResponse(pageShell("Review booking", reviewPageBody(loaded.booking, token)));
}

/** POST — verify, optionally patch amounts, guarded transition, emails, redirect. */
export async function handleReview(
  env: BookingReviewEnv,
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

  if (decline) {
    const updated = await transitionRequestedBooking(
      env, b.id,
      { status: "declined", declined_at: now, confirm_token_used_at: now },
      fetchImpl,
    );
    if (!updated) return htmlResponse(handledHtml(), 200);
    try {
      await sendEmail(env, { email: b.bride_email, name: b.bride_name },
        "An update on your Lustique booking — Lustique Co.", declineEmailHtml(b), fetchImpl);
      await writeAudit(env, { bookingId: b.id, eventType: "confirm.declined", payload: { reference: b.reference } }, fetchImpl);
    } catch {
      await writeAudit(env, { bookingId: b.id, eventType: "confirm.email-failed", payload: { reference: b.reference, action: "decline" } }, fetchImpl).catch(() => {});
    }
    return new Response(null, { status: 303, headers: { location: `${origin}/booking-declined.html?ref=${encodeURIComponent(b.reference)}` } });
  }

  // Approve: honour Zandeline's total override; deposit % is chosen by the bride at accept.
  const overrideTotalRaw = String(form?.get("overrideTotal") ?? "");
  const overrideTotalRand = parseInt(overrideTotalRaw, 10);
  const useOverride =
    !Number.isNaN(overrideTotalRand) &&
    overrideTotalRand > 0 &&
    overrideTotalRand * 100 !== b.total_cents;

  const finalTotalCents = useOverride ? overrideTotalRand * 100 : b.total_cents;

  const patch: Record<string, unknown> = {
    status: "quote_sent",
    quote_sent_at: now,
    confirm_token_used_at: now,
    ...(useOverride ? { total_cents: finalTotalCents } : {}),
  };

  const updated = await transitionRequestedBooking(env, b.id, patch, fetchImpl);
  if (!updated) return htmlResponse(handledHtml(), 200);

  // Wave invoice (fire-and-forget — locked total, for accounting).
  if ((env.WAVE_CLIENT_ID || env.WAVE_API_KEY) && env.WAVE_BUSINESS_ID) {
    try {
      const waveCustomerId = await createCustomer(env, b.bride_name, b.bride_email, fetchImpl);
      const waveInvoiceId = await createInvoice(env, waveCustomerId, b.reference, finalTotalCents, b.wedding_date, fetchImpl);
      await updateBookingWaveIds(env, b.id, waveCustomerId, waveInvoiceId, fetchImpl);
      await writeAudit(env, { bookingId: b.id, eventType: "wave.invoice-created", payload: { waveCustomerId, waveInvoiceId } }, fetchImpl);
    } catch (e) {
      await writeAudit(env, { bookingId: b.id, eventType: "wave.invoice-failed", payload: { reference: b.reference, error: String(e) } }, fetchImpl).catch(() => {});
    }
  }

  // Accept/reject tokens — HMAC-signed, no DB column needed; status guards idempotency.
  const QUOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const acceptToken = await signActionToken(b.id, new Date(Date.now() + QUOTE_TTL_MS), env.SIGNING_SECRET, "accept");
  const rejectToken = await signActionToken(b.id, new Date(Date.now() + QUOTE_TTL_MS), env.SIGNING_SECRET, "reject");
  const acceptUrl = `${origin}/api/booking/accept?token=${encodeURIComponent(acceptToken)}`;
  const rejectUrl = `${origin}/api/booking/reject?token=${encodeURIComponent(rejectToken)}`;

  // Invoice link (2-year TTL, stateless)
  const INVOICE_TTL_MS = 2 * 365 * 24 * 60 * 60 * 1000;
  const invoiceToken = await signActionToken(b.id, new Date(Date.now() + INVOICE_TTL_MS), env.SIGNING_SECRET, "invoice");
  const invoiceUrl = `${origin}/api/booking/invoice?token=${encodeURIComponent(invoiceToken)}`;

  try {
    // Email 2 — bride: quote ready, accept or decline
    await sendEmail(
      env,
      { email: b.bride_email, name: b.bride_name },
      `Your Lustique quote is ready — ${fmtDate(b.wedding_date)}`,
      emailShell({
        heading: `Your quote is ready, ${esc(firstN(b.bride_name))}.`,
        body: ep(`Good news — we&#8217;ve reviewed your request and we&#8217;re delighted to hold ${em(fmtDate(b.wedding_date))} for you.`) +
          emailTable([
            { key: "Date", val: fmtDate(b.wedding_date) },
            { key: "Bridal party", val: `${b.party_size} looks` },
            { key: "Quote total", val: fmtZAR(finalTotalCents), bold: true },
            { key: "Your reference", val: b.reference, ref: true },
          ]),
        btnZone: emailBtn(acceptUrl, "Accept quote") +
          emailBtnLink(invoiceUrl, "View & print your quote") +
          emailBtnLink(rejectUrl, "I’d like to decline this booking"),
        footerNote: `This quote is valid for 7 days. Questions? Write to us at <a href="mailto:info@lustiqueco.co.za" style="color:#5C4332;text-decoration:none;">info@lustiqueco.co.za</a>.`,
      }),
      fetchImpl,
    );
    // Team notification — quote sent
    await sendEmail(
      env,
      { email: env.NOTIFY_EMAIL, name: "Lustique" },
      `Quote sent — ${b.bride_name} · ${b.wedding_date}`,
      `<p style="font:14px/1.6 system-ui,sans-serif;margin:0 0 .5rem;"><strong>${esc(b.bride_name)}</strong> — ${esc(b.wedding_date)} — quote sent (${fmtZAR(finalTotalCents)}, ref <strong>${esc(b.reference)}</strong>).</p>
<p style="font-size:.88rem;color:#8a7d72;">She has 7 days to accept or decline. You’ll be notified when she responds.</p>
<p><a href="${esc(invoiceUrl)}" style="color:#8a3a52;">View quote →</a></p>`,
      fetchImpl,
    );
    await writeAudit(
      env,
      { bookingId: b.id, eventType: "review.quote-sent", payload: { reference: b.reference, totalCents: finalTotalCents, override: useOverride } },
      fetchImpl,
    );
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "review.email-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }

  return htmlResponse(pageShell("Quote sent", `<h1>Quote sent ✓</h1><p><strong>${esc(b.bride_name)}</strong> has been emailed her quote for ${esc(b.wedding_date)}. She has 7 days to accept or decline. You can close this tab.</p>`));
}

/** Daily cron sweep: transition quote_sent bookings older than 7 days to invoice_expired. */
export async function invoiceExpirySweep(
  env: BookingReviewEnv,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<void> {
  const cutoff = new Date(now().getTime() - 7 * 24 * 60 * 60 * 1000);
  const expired = await listExpiredQuotes(env, cutoff.toISOString(), fetchImpl);
  for (const b of expired) {
    try {
      const updated = await transitionBooking(env, b.id, "quote_sent", {
        status: "invoice_expired",
        invoice_expired_at: now().toISOString(),
      }, fetchImpl);
      if (updated) {
        await writeAudit(env, { bookingId: b.id, eventType: "quote.expired", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
      }
    } catch {
      await writeAudit(env, { bookingId: b.id, eventType: "quote.expire-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
    }
  }
}
