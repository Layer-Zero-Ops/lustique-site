// worker/src/booking/yoco.ts
/**
 * POST /api/booking/yoco-webhook — Yoco payment webhook handler (S7).
 *
 * Yoco fires checkout.succeeded when a card payment is captured. We:
 *   1. Verify the HMAC-SHA256 signature (X-Yoco-Signature: sha256=<hex>)
 *   2. Look up the pending payment row by checkout ID
 *   3. Mark it paid (idempotent — skips if already paid)
 *   4. Transition booking confirmed → deposit_paid
 *   5. Email the bride "your date is secured"
 *   6. Audit
 *
 * Always return 200 for non-fatal cases (unknown event type, already paid) so
 * Yoco doesn't retry needlessly. Return 401 only on bad signatures.
 */
import { findPaymentByCheckoutId, markPaymentPaid, transitionBooking, getBookingById } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { recordPayment, type WaveEnv } from "../lib/wave";

export interface YocoWebhookEnv extends AuditEnv, WaveEnv {
  YOCO_WEBHOOK_SECRET: string;
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
}

// ── signature verification ───────────────────────────────────────────────────

const enc = new TextEncoder();

async function hmacHex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns true if X-Yoco-Signature matches sha256=HMAC(body, secret). */
async function verifySignature(body: string, header: string, secret: string): Promise<boolean> {
  const expected = "sha256=" + (await hmacHex(body, secret));
  return timingSafeEqual(header, expected);
}

// ── types ────────────────────────────────────────────────────────────────────

interface YocoEvent {
  id?: string;
  type?: string;
  payload?: {
    id?: string;           // checkoutId
    paymentId?: string;    // Yoco internal payment ID
    amountInCents?: number;
    currency?: string;
    metadata?: Record<string, string>;
  };
}

// ── email ────────────────────────────────────────────────────────────────────

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
const zar = (cents: number) => `R ${(cents / 100).toLocaleString("en-ZA")}`;

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

// ── handler ──────────────────────────────────────────────────────────────────

export async function handleYocoWebhook(
  env: YocoWebhookEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const rawBody = await req.text();
  const sig = req.headers.get("x-yoco-signature") ?? "";

  if (!await verifySignature(rawBody, sig, env.YOCO_WEBHOOK_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let event: YocoEvent;
  try { event = JSON.parse(rawBody) as YocoEvent; } catch {
    return new Response("Bad request", { status: 400 });
  }

  if (event.type !== "checkout.succeeded") {
    return new Response("OK", { status: 200 });
  }

  const checkoutId = event.payload?.id;
  const yocoPaymentId = event.payload?.paymentId;
  if (!checkoutId || !yocoPaymentId) {
    return new Response("Bad request", { status: 400 });
  }

  const payment = await findPaymentByCheckoutId(env, checkoutId, fetchImpl);
  if (!payment) return new Response("OK", { status: 200 }); // unknown checkout — ignore

  // Idempotent: already handled this payment
  if (payment["status"] === "paid") return new Response("OK", { status: 200 });

  // Mark payment paid (best-effort — log but don't fail if it errors)
  try {
    await markPaymentPaid(env, String(payment["id"]), yocoPaymentId, event, fetchImpl);
  } catch (e) {
    await writeAudit(env, { bookingId: String(payment["booking_id"]), eventType: "payment.mark-paid-failed", payload: { checkoutId, error: String(e) } }, fetchImpl).catch(() => {});
    return new Response("Internal error", { status: 500 });
  }

  const bookingId = String(payment["booking_id"]);
  const updated = await transitionBooking(env, bookingId, "confirmed", {
    status: "deposit_paid",
    deposit_paid_at: new Date().toISOString(),
  }, fetchImpl);

  if (!updated) {
    // Race: booking already moved on — still record the payment success
    await writeAudit(env, { bookingId, eventType: "payment.deposit-paid-race", payload: { checkoutId } }, fetchImpl).catch(() => {});
    return new Response("OK", { status: 200 });
  }

  const booking = await getBookingById(env, bookingId, fetchImpl);

  // S8: record deposit payment in Wave (fire-and-forget).
  if (booking?.wave_invoice_id && env.WAVE_API_KEY && env.WAVE_BUSINESS_ID && env.WAVE_BANK_ACCOUNT_ID) {
    try {
      await recordPayment(
        env,
        booking.wave_invoice_id,
        booking.deposit_net_cents,
        new Date().toISOString().slice(0, 10),
        `Yoco deposit · ${booking.reference}`,
        fetchImpl,
      );
      await writeAudit(env, { bookingId, eventType: "wave.deposit-recorded", payload: { reference: booking.reference } }, fetchImpl).catch(() => {});
    } catch {
      await writeAudit(env, { bookingId, eventType: "wave.deposit-failed", payload: { reference: booking.reference } }, fetchImpl).catch(() => {});
    }
  }

  if (booking) {
    try {
      await brevoEmail(
        env,
        { email: booking.bride_email, name: booking.bride_name },
        "Your date is secured 🎉 · Lustique Co.",
        `<p>Hi ${esc(booking.bride_name)},</p>
<p>🎉 Your payment is in — <strong>${esc(booking.wedding_date)}</strong> is officially secured. We can't wait.</p>
<p>We've received your deposit of <strong>${zar(booking.deposit_net_cents)}</strong> (ref ${esc(booking.reference)}). The balance of <strong>${zar(booking.balance_net_cents)}</strong> is payable closer to your day — we'll send a reminder.</p>
<p>We'll be in touch soon to start planning the details.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`,
        fetchImpl,
      );
      await writeAudit(env, { bookingId, eventType: "payment.deposit-paid", payload: { reference: booking.reference, checkoutId, yocoPaymentId } }, fetchImpl);
    } catch {
      await writeAudit(env, { bookingId, eventType: "payment.email-failed", payload: { reference: booking.reference, checkoutId } }, fetchImpl).catch(() => {});
    }
  }

  return new Response("OK", { status: 200 });
}
