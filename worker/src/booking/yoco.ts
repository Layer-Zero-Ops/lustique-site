// worker/src/booking/yoco.ts
/**
 * POST /api/booking/yoco-webhook — Yoco payment webhook handler (Wave 0 rewrite).
 *
 * Fixes two live defects found in the 2026-06-18 re-plan:
 *   C-A: was listening for "checkout.succeeded"; Yoco emits "payment.succeeded" / "payment.failed"
 *   C-B: was using a custom hex-HMAC over the raw body; Yoco uses Standard Webhooks
 *        (header: webhook-signature = "v1,<base64>"; signed: "${id}.${ts}.${body}"; 3-min window)
 *
 * Flow for payment.succeeded:
 *   1. Verify Standard Webhooks signature + timestamp
 *   2. Idempotency check: findPaymentByYocoId (already processed? return 200)
 *   3. Look up pending payment row by checkout ID
 *   4. Mark payment paid; kind-branch transition (deposit→deposit_paid, balance→settled)
 *   5. Email bride "date secured 🎉" / "fully paid 🎉"
 *
 * Flow for payment.failed:
 *   1–3 same; mark payment failed; send EFT-fallback emails (once, guarded by failure_notified_at)
 *
 * refund.succeeded: audit-only in Wave 0 (no booking transition needed yet).
 *
 * pendingPaymentSweep(): cron helper — finds 24h+ stale-pending payments and runs the
 * same failure path as payment.failed so brides always get the EFT fallback.
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

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
const zar = (cents: number) => `R ${(cents / 100).toLocaleString("en-ZA")}`;

interface EftSettings {
  bank: string;
  accountHolder: string;
  accountNumber: string;
  branchCode: string;
}

async function getEftSettings(env: YocoWebhookEnv, f: typeof fetch): Promise<EftSettings> {
  const r = await f(
    `${env.SUPABASE_URL}/rest/v1/business_settings?key=in.(eft_bank_name,eft_account_holder,eft_account_number,eft_branch_code)&select=key,value`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } },
  );
  if (!r.ok) throw new Error(`getEftSettings ${r.status}`);
  const rows = (await r.json()) as Array<{ key: string; value: string }>;
  const m = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    bank: m["eft_bank_name"] ?? "",
    accountHolder: m["eft_account_holder"] ?? "",
    accountNumber: m["eft_account_number"] ?? "",
    branchCode: m["eft_branch_code"] ?? "",
  };
}

async function brevoEmail(
  env: YocoWebhookEnv,
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

function depositSecuredEmailHtml(brideName: string, weddingDate: string, depositCents: number, balanceCents: number, reference: string): string {
  return `<p>Hi ${esc(brideName)},</p>
<p>🎉 Your payment is in — <strong>${esc(weddingDate)}</strong> is officially secured. We can't wait.</p>
<p>We've received your deposit of <strong>${zar(depositCents)}</strong> (ref ${esc(reference)}). The balance of <strong>${zar(balanceCents)}</strong> is payable closer to your day — we'll send a reminder.</p>
<p>We'll be in touch soon to start planning the details.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

function fullyPaidEmailHtml(brideName: string, weddingDate: string, balanceCents: number, reference: string): string {
  return `<p>Hi ${esc(brideName)},</p>
<p>🎉 Your balance is in — <strong>${esc(weddingDate)}</strong> is fully paid and all set. We can't wait to be part of your day.</p>
<p>We've received your balance of <strong>${zar(balanceCents)}</strong> (ref ${esc(reference)}). Nothing further is needed from you.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

function paymentFailedBrideEmailHtml(
  eft: EftSettings,
  brideName: string,
  weddingDate: string,
  amountCents: number,
  reference: string,
): string {
  return `<p>Hi ${esc(brideName)},</p>
<p>It looks like your card payment didn't go through. No worries — you can still secure your date for <strong>${esc(weddingDate)}</strong> by making a manual EFT transfer.</p>
<p><strong>Amount due:</strong> ${zar(amountCents)}</p>
<table style="border-collapse:collapse;font:15px/1.7 system-ui,sans-serif;margin:.6rem 0 1rem;">
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Bank</td><td>${esc(eft.bank)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Account name</td><td>${esc(eft.accountHolder)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Account no.</td><td>${esc(eft.accountNumber)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Branch code</td><td>${esc(eft.branchCode)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Reference</td><td><strong>${esc(reference)}</strong></td></tr>
</table>
<p style="font-size:.92rem;color:#8a7d72;">Please use <strong>${esc(reference)}</strong> as your reference. Once it reflects we'll send your date-secured confirmation.</p>
<p>If you'd like to retry with your card, please reply to this email and we'll send a new payment link.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

function paymentFailedAdminEmailHtml(brideName: string, weddingDate: string, amountCents: number, reference: string): string {
  return `<p><strong>${esc(brideName)}</strong> — ${esc(weddingDate)} — card payment failed. She's been emailed EFT instructions.</p>
<p>Amount: <strong>${zar(amountCents)}</strong> · Ref: <strong>${esc(reference)}</strong></p>
<p style="font-size:.88rem;color:#8a7d72;">If she pays by EFT, use the "Mark deposit received" link from the original approval email to confirm receipt.</p>`;
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
    await brevoEmail(
      env,
      { email: booking.bride_email, name: booking.bride_name },
      "Your payment didn't go through — Lustique Co.",
      paymentFailedBrideEmailHtml(eft, booking.bride_name, booking.wedding_date, amountCents, booking.reference),
      f,
    );
    await brevoEmail(
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

  // ── payment.succeeded ──────────────────────────────────────────────────────
  if (event.type === "payment.succeeded") {
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
    if (booking?.wave_invoice_id && env.WAVE_API_KEY && env.WAVE_BUSINESS_ID && env.WAVE_BANK_ACCOUNT_ID) {
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
        await brevoEmail(env, { email: booking.bride_email, name: booking.bride_name }, subject, html, fetchImpl);
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

  // ── refund.succeeded — audit-only in Wave 0 ───────────────────────────────
  if (event.type === "refund.succeeded") {
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
