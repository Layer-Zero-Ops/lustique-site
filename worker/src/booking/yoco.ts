// worker/src/booking/yoco.ts
/**
 * POST /api/booking/yoco-webhook — Yoco payment webhook handler.
 *
 * Yoco's actual event types (confirmed 2026-06-21 via API):
 *   payment.created  — fires when a card payment succeeds (Yoco never fires on failure)
 *   payment.refunded — fires when a refund is processed
 *
 * Signature: Standard Webhooks (https://www.standardwebhooks.com/)
 *   header: webhook-signature = "v1,<base64>"; signed: "${id}.${ts}.${body}"; 3-min window
 *
 * Flow for payment.created:
 *   1. Verify Standard Webhooks signature + timestamp
 *   2. Idempotency check: findPaymentByYocoId (already processed? return 200)
 *   3. Look up pending payment row by checkout ID
 *   4. Mark payment paid; kind-branch transition (deposit→deposit_paid, balance→settled)
 *   5. Email bride "date secured 🎉" / "fully paid 🎉"
 *
 * payment.failed handler is retained but Yoco never fires it — failed cards produce no
 * payment object. The pendingPaymentSweep() cron covers failures (24h stale-pending → EFT fallback).
 *
 * payment.refunded: audit-only (no booking transition needed yet).
 */
import {
  findPaymentByCheckoutId,
  findPaymentByYocoId,
  markPaymentPaid,
  markPaymentFailed,
  markPaymentFailureNotified,
  findStalePayments,
  transitionBooking,
  getBookingById,
  type DbEnv,
} from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { recordPayment, type WaveEnv } from "../lib/wave";
import { esc, fmtDate, fmtZAR, ep, em, emailShell, emailTable, emailNote, firstN, sendEmail, getEftSettings, type EftSettings } from "../lib/email";

export interface YocoWebhookEnv extends AuditEnv, WaveEnv, DbEnv {
  YOCO_WEBHOOK_SECRET: string;
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
}

// ── Standard Webhooks signature verification ──────────────────────────────────

const enc = new TextEncoder();

/**
 * Decode the webhook secret. Yoco dispatches it with a "whsec_" prefix (Standard Webhooks
 * convention) whose value is base64-encoded key bytes. Strip the prefix then base64-decode;
 * fall back to UTF-8 for un-prefixed plain strings (test environments).
 */
function decodeSecret(secret: string): Uint8Array {
  const b64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return enc.encode(secret);
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Standard Webhooks verification (https://www.standardwebhooks.com/).
 * Signed content = "${webhookId}.${webhookTimestamp}.${rawBody}"
 * Signature header = one or more "v1,<base64>" values separated by spaces.
 * Timestamp must be within 3 minutes of now (replay protection).
 */
async function verifyStandardWebhook(
  rawBody: string,
  webhookId: string,
  webhookTimestamp: string,
  sigHeader: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  // Reject stale timestamps (±3 minutes)
  const ts = parseInt(webhookTimestamp, 10);
  if (isNaN(ts) || Math.abs(nowMs - ts * 1000) > 3 * 60 * 1000) return false;

  const keyBytes = decodeSecret(secret);
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const toSign = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(toSign));
  const computed = btoa(String.fromCharCode(...new Uint8Array(buf)));

  // Header may contain multiple "v1,<base64>" entries (space-separated) — accept any one
  return sigHeader.split(" ").some((part) => {
    if (!part.startsWith("v1,")) return false;
    return timingSafeEqual(computed, part.slice(3));
  });
}

// ── types ─────────────────────────────────────────────────────────────────────

interface YocoPaymentEvent {
  id?: string;
  type?: string;
  createdDate?: string;
  payload?: {
    id?: string;             // Yoco payment ID
    checkoutId?: string;     // our checkout ID (links to payments.yoco_checkout_id)
    amountInCents?: number;
    currency?: string;
    failureReason?: string;
    metadata?: Record<string, string>;
    paymentId?: string;      // for refund.succeeded: the original payment ID
  };
}

// ── email helpers ─────────────────────────────────────────────────────────────

function depositSecuredEmailHtml(brideName: string, weddingDate: string, depositCents: number, balanceCents: number, reference: string): string {
  return emailShell({
    preheader: `Your deposit is in — ${fmtDate(weddingDate)} is officially yours.`,
    heading: `Your date is secured, ${esc(firstN(brideName))}.`,
    body: ep(`Your deposit is in — ${em(fmtDate(weddingDate))} is officially yours. We can&#8217;t wait to be part of your day.`) +
      emailTable([
        { key: "Date", val: fmtDate(weddingDate) },
        { key: "Deposit received", val: fmtZAR(depositCents), bold: true },
        { key: "Balance due", val: fmtZAR(balanceCents), bold: true },
        { key: "Your reference", val: reference, ref: true },
      ]),
    btnZone: emailNote(`We&#8217;ll send you a balance reminder closer to your day.`),
  });
}

function fullyPaidEmailHtml(brideName: string, weddingDate: string, balanceCents: number, reference: string): string {
  return emailShell({
    preheader: `You're all settled — ${fmtDate(weddingDate)} is fully paid and we're ready for your day.`,
    heading: `All settled, ${esc(firstN(brideName))}.`,
    body: ep(`Your balance is in — ${em(fmtDate(weddingDate))} is fully paid and we are ready for your day. There&#8217;s nothing more to do.`) +
      emailTable([
        { key: "Date", val: fmtDate(weddingDate) },
        { key: "Balance received", val: fmtZAR(balanceCents), bold: true },
        { key: "Your reference", val: reference, ref: true },
      ]),
    btnZone: emailNote(`We&#8217;ll be in touch closer to your day with final details.`),
  });
}

function paymentFailedBrideEmailHtml(
  eft: EftSettings,
  brideName: string,
  weddingDate: string,
  amountCents: number,
  reference: string,
): string {
  return emailShell({
    preheader: `Your card payment didn't go through — your date is still held, please complete by EFT.`,
    heading: `Your payment didn&#8217;t go through, ${esc(firstN(brideName))}.`,
    body: ep(`Your card payment wasn&#8217;t processed. No need to worry — your date for ${em(fmtDate(weddingDate))} is still held. Please complete your payment by EFT using the details below.`) +
      emailTable([
        { key: "Amount due", val: fmtZAR(amountCents), bold: true },
        { key: "Bank", val: eft.bank },
        { key: "Account holder", val: eft.accountHolder },
        { key: "Account no.", val: eft.accountNumber },
        { key: "Branch code", val: eft.branchCode },
        { key: "Payment reference", val: reference, ref: true },
      ]),
    btnZone: emailNote(`Please use your payment reference above when making the EFT transfer so we can match the payment.`),
    footerNote: `If you&#8217;d like to retry with a card payment, reply to this email and we&#8217;ll send a new link. Questions? <a href="mailto:info@lustiqueco.co.za" style="color:#5C4332;text-decoration:none;">info@lustiqueco.co.za</a>`,
  });
}

function paymentFailedAdminEmailHtml(brideName: string, weddingDate: string, amountCents: number, reference: string): string {
  return `<p style="font:14px/1.6 system-ui,sans-serif;"><strong>${esc(brideName)}</strong> — ${esc(weddingDate)} — card payment failed. She&#8217;s been emailed EFT instructions.</p>
<p style="font:14px/1.6 system-ui,sans-serif;">Amount: <strong>${fmtZAR(amountCents)}</strong> &middot; Ref: <strong>${esc(reference)}</strong></p>
<p style="font-size:.88rem;color:#8a7d72;">If she pays by EFT, use the &#8220;Mark deposit received&#8221; link from the original approval email to confirm receipt.</p>`;
}

// ── shared failure handler (webhook + sweep) ──────────────────────────────────

async function handlePaymentFailure(
  env: YocoWebhookEnv,
  payment: Record<string, unknown>,
  raw: unknown,
  f: typeof fetch,
): Promise<void> {
  const paymentRowId = String(payment["id"]);
  const alreadyFailed = payment["status"] === "failed";
  const alreadyNotified = !!payment["failure_notified_at"];

  if (!alreadyFailed) {
    await markPaymentFailed(env, paymentRowId, raw, f);
  }

  if (alreadyNotified) return; // EFT fallback email already sent

  const booking = await getBookingById(env, String(payment["booking_id"]), f);
  if (!booking) return;

  try {
    const eft = await getEftSettings(env, f);
    const amountCents = Number(payment["net_cents"]);
    await sendEmail(
      env,
      { email: booking.bride_email, name: booking.bride_name },
      "Your payment didn't go through — Lustique Co.",
      paymentFailedBrideEmailHtml(eft, booking.bride_name, booking.wedding_date, amountCents, booking.reference),
      f,
    );
    await sendEmail(
      env,
      { email: env.NOTIFY_EMAIL, name: "Lustique" },
      `Payment failed · ${booking.bride_name} · ${booking.wedding_date}`,
      paymentFailedAdminEmailHtml(booking.bride_name, booking.wedding_date, amountCents, booking.reference),
      f,
    );
    await markPaymentFailureNotified(env, paymentRowId, f);
  } catch (e) {
    await writeAudit(env, { bookingId: booking.id, eventType: "payment.failure-email-failed", payload: { reference: booking.reference, error: String(e) } }, f).catch(() => {});
  }
}

// ── webhook handler ───────────────────────────────────────────────────────────

export async function handleYocoWebhook(
  env: YocoWebhookEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const rawBody = await req.text();

  const webhookId = req.headers.get("webhook-id") ?? "";
  const webhookTimestamp = req.headers.get("webhook-timestamp") ?? "";
  const sigHeader = req.headers.get("webhook-signature") ?? "";

  if (!await verifyStandardWebhook(rawBody, webhookId, webhookTimestamp, sigHeader, env.YOCO_WEBHOOK_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let event: YocoPaymentEvent;
  try { event = JSON.parse(rawBody) as YocoPaymentEvent; } catch {
    return new Response("Bad request", { status: 400 });
  }

  // ── payment.created ────────────────────────────────────────────────────────
  if (event.type === "payment.created") {
    const yocoPaymentId = event.payload?.id;
    const checkoutId = event.payload?.checkoutId;
    if (!yocoPaymentId || !checkoutId) return new Response("Bad request", { status: 400 });

    // Idempotency: has this Yoco payment already been recorded?
    const existing = await findPaymentByYocoId(env, yocoPaymentId, fetchImpl);
    if (existing) return new Response("OK", { status: 200 }); // already processed

    const payment = await findPaymentByCheckoutId(env, checkoutId, fetchImpl);
    if (!payment) return new Response("OK", { status: 200 }); // unknown checkout — ignore

    try {
      await markPaymentPaid(env, String(payment["id"]), yocoPaymentId, event, fetchImpl);
    } catch (e) {
      await writeAudit(env, { bookingId: String(payment["booking_id"]), eventType: "payment.mark-paid-failed", payload: { checkoutId, error: String(e) } }, fetchImpl).catch(() => {});
      return new Response("Internal error", { status: 500 });
    }

    const bookingId = String(payment["booking_id"]);
    const kind = String(payment["kind"]);

    // Kind-branch: deposit accepts the date; balance settles the booking.
    // Wave A: deposit transitions from "accepted"; legacy: from "confirmed".
    const isBalance = kind === "balance";
    const toStatus = isBalance ? "settled" : "deposit_paid";
    const paidAtField = isBalance ? "settled_at" : "deposit_paid_at";
    const paidPatch = { status: toStatus, [paidAtField]: new Date().toISOString() };

    const updated = isBalance
      ? await transitionBooking(env, bookingId, "deposit_paid", paidPatch, fetchImpl)
      : (await transitionBooking(env, bookingId, "accepted", paidPatch, fetchImpl)
          ?? await transitionBooking(env, bookingId, "confirmed", paidPatch, fetchImpl));

    if (!updated) {
      await writeAudit(env, { bookingId, eventType: "payment.deposit-paid-race", payload: { checkoutId } }, fetchImpl).catch(() => {});
      return new Response("OK", { status: 200 });
    }

    const booking = await getBookingById(env, bookingId, fetchImpl);

    // S8: record in Wave (fire-and-forget)
    if (booking?.wave_invoice_id && (env.WAVE_CLIENT_ID || env.WAVE_API_KEY) && env.WAVE_BUSINESS_ID && env.WAVE_BANK_ACCOUNT_ID) {
      const label = kind === "balance" ? "Yoco balance" : "Yoco deposit";
      const cents = kind === "balance" ? booking.balance_net_cents : booking.deposit_net_cents;
      recordPayment(env, booking.wave_invoice_id, cents, new Date().toISOString().slice(0, 10), `${label} · ${booking.reference}`, fetchImpl)
        .then(() => writeAudit(env, { bookingId, eventType: "wave.payment-recorded", payload: { reference: booking.reference, kind } }, fetchImpl))
        .catch(() => writeAudit(env, { bookingId, eventType: "wave.payment-failed", payload: { reference: booking.reference } }, fetchImpl).catch(() => {}));
    }

    if (booking) {
      try {
        const subject = kind === "balance"
          ? "You're all set — fully paid 🎉 · Lustique Co."
          : "Your date is secured 🎉 · Lustique Co.";
        const html = kind === "balance"
          ? fullyPaidEmailHtml(booking.bride_name, booking.wedding_date, booking.balance_net_cents, booking.reference)
          : depositSecuredEmailHtml(booking.bride_name, booking.wedding_date, booking.deposit_net_cents, booking.balance_net_cents, booking.reference);
        await sendEmail(env, { email: booking.bride_email, name: booking.bride_name }, subject, html, fetchImpl);
        await writeAudit(env, { bookingId, eventType: `payment.${kind}-paid`, payload: { reference: booking.reference, checkoutId, yocoPaymentId } }, fetchImpl);
      } catch {
        await writeAudit(env, { bookingId, eventType: "payment.email-failed", payload: { reference: booking.reference, checkoutId } }, fetchImpl).catch(() => {});
      }
    }

    return new Response("OK", { status: 200 });
  }

  // ── payment.failed ────────────────────────────────────────────────────────
  if (event.type === "payment.failed") {
    const checkoutId = event.payload?.checkoutId;
    if (!checkoutId) return new Response("Bad request", { status: 400 });

    const payment = await findPaymentByCheckoutId(env, checkoutId, fetchImpl);
    if (!payment) return new Response("OK", { status: 200 });

    await handlePaymentFailure(env, payment, event, fetchImpl);
    return new Response("OK", { status: 200 });
  }

  // ── payment.refunded — audit-only ─────────────────────────────────────────
  if (event.type === "payment.refunded") {
    return new Response("OK", { status: 200 });
  }

  // Unknown event type — 200 so Yoco doesn't retry
  return new Response("OK", { status: 200 });
}

// ── pending payment sweep (cron) ──────────────────────────────────────────────

/**
 * Called from the daily scheduled() handler.
 * Finds payment rows that have been pending for more than 24 hours and runs the
 * same failure path as payment.failed — marks them failed and sends the EFT fallback
 * email to the bride (guarded by failure_notified_at so it only fires once).
 */
export async function pendingPaymentSweep(
  env: YocoWebhookEnv,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<void> {
  const cutoff = new Date(now().getTime() - 24 * 60 * 60 * 1000).toISOString();
  const stale = await findStalePayments(env, cutoff, fetchImpl);
  for (const payment of stale) {
    try {
      await handlePaymentFailure(env, payment, { source: "pendingPaymentSweep", cutoff }, fetchImpl);
    } catch {
      await writeAudit(env, { bookingId: String(payment["booking_id"]), eventType: "payment.sweep-failed", payload: { paymentId: String(payment["id"]) } }, fetchImpl).catch(() => {});
    }
  }
}
