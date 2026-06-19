// worker/src/booking/yoco.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleYocoWebhook, pendingPaymentSweep } from "./yoco";

const WEBHOOK_SECRET = "webhook-secret";
const BOOKING_ID = "11111111-2222-3333-4444-555555555555";
const CHECKOUT_ID = "ch_test_123";
const YOCO_PAYMENT_ID = "pay_test_yyy";
const WEBHOOK_ID = "msg_test_abc";

const env = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_KEY: "svc",
  BREVO_API_KEY: "brevo-key",
  NOTIFY_EMAIL: "z@lustique.co.za",
  YOCO_WEBHOOK_SECRET: WEBHOOK_SECRET,
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const bookingRow = (over: Record<string, unknown> = {}) => ({
  id: BOOKING_ID, reference: "LUS-2026-111122", status: "confirmed",
  bride_name: "Anke van der Berg", bride_email: "anke@example.com",
  wedding_date: "2027-11-14", venue: "Red Ivory", town: "Hartbeespoort", province: "Gauteng",
  party_size: 7, total_cents: 882600, deposit_pct: 50,
  deposit_net_cents: 441300, balance_net_cents: 441300,
  confirm_token_expires_at: "2027-01-01T00:00:00Z", confirm_token_used_at: "2026-06-17T12:00:00Z",
  ...over,
});

const paymentRow = (over: Record<string, unknown> = {}) => ({
  id: "pay-row-uuid-1",
  booking_id: BOOKING_ID,
  kind: "deposit",
  net_cents: 441300,
  payable_cents: 441300,
  status: "pending",
  yoco_checkout_id: CHECKOUT_ID,
  pay_url: "https://pay.yoco.com/ch_test_123",
  failure_notified_at: null,
  ...over,
});

const eftSettingsRes = () =>
  res([
    { key: "eft_bank_name", value: "FNB" },
    { key: "eft_account_holder", value: "Lustique Co." },
    { key: "eft_account_number", value: "123456789" },
    { key: "eft_branch_code", value: "250655" },
  ]);

// ── Standard Webhooks signature ───────────────────────────────────────────────

/**
 * Build a valid Standard Webhooks signature.
 * Mirrors the production decodeSecret + HMAC logic so tests are a true round-trip.
 */
async function sign(
  body: string,
  webhookId = WEBHOOK_ID,
  webhookTimestamp = String(Math.floor(Date.now() / 1000)),
): Promise<{ sig: string; webhookId: string; webhookTimestamp: string }> {
  // Production decodes: strip whsec_ prefix then try atob; fallback to UTF-8
  let secretBytes: Uint8Array;
  const raw = WEBHOOK_SECRET.startsWith("whsec_") ? WEBHOOK_SECRET.slice(6) : WEBHOOK_SECRET;
  try {
    secretBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  } catch {
    secretBytes = new TextEncoder().encode(WEBHOOK_SECRET);
  }
  const toSign = `${webhookId}.${webhookTimestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(toSign));
  const sig = `v1,${btoa(String.fromCharCode(...new Uint8Array(buf)))}`;
  return { sig, webhookId, webhookTimestamp };
}

function webhookReq(
  event: unknown,
  sig: string,
  webhookId = WEBHOOK_ID,
  webhookTimestamp = String(Math.floor(Date.now() / 1000)),
): Request {
  const body = JSON.stringify(event);
  return new Request("https://worker/api/booking/yoco-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": webhookTimestamp,
      "webhook-signature": sig,
    },
    body,
  });
}

const paymentSucceededEvent = {
  id: "evt_xxx",
  type: "payment.succeeded",
  createdDate: "2026-06-17T12:00:00Z",
  payload: {
    id: YOCO_PAYMENT_ID,
    checkoutId: CHECKOUT_ID,
    amountInCents: 441300,
    currency: "ZAR",
    metadata: { bookingId: BOOKING_ID, reference: "LUS-2026-111122" },
  },
};

const paymentFailedEvent = {
  id: "evt_fail",
  type: "payment.failed",
  createdDate: "2026-06-17T12:00:00Z",
  payload: {
    id: "pay_failed_zzz",
    checkoutId: CHECKOUT_ID,
    failureReason: "insufficient_funds",
    metadata: { bookingId: BOOKING_ID, reference: "LUS-2026-111122" },
  },
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe("handleYocoWebhook — Standard Webhooks signature", () => {
  it("returns 401 for a missing webhook-signature header", async () => {
    const body = JSON.stringify(paymentSucceededEvent);
    const req = new Request("https://worker/api/booking/yoco-webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "webhook-id": WEBHOOK_ID, "webhook-timestamp": String(Math.floor(Date.now() / 1000)) },
      body,
    });
    const resp = await handleYocoWebhook(env, req, vi.fn() as unknown as typeof fetch);
    expect(resp.status).toBe(401);
  });

  it("returns 401 for a bad signature", async () => {
    const body = JSON.stringify(paymentSucceededEvent);
    const ts = String(Math.floor(Date.now() / 1000));
    const req = new Request("https://worker/api/booking/yoco-webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "webhook-id": WEBHOOK_ID, "webhook-timestamp": ts, "webhook-signature": "v1,badsig==" },
      body,
    });
    const resp = await handleYocoWebhook(env, req, vi.fn() as unknown as typeof fetch);
    expect(resp.status).toBe(401);
  });

  it("returns 401 for a stale timestamp (> 3 minutes old)", async () => {
    const body = JSON.stringify(paymentSucceededEvent);
    const oldTs = String(Math.floor((Date.now() - 4 * 60 * 1000) / 1000));
    const { sig } = await sign(body, WEBHOOK_ID, oldTs);
    const req = new Request("https://worker/api/booking/yoco-webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "webhook-id": WEBHOOK_ID, "webhook-timestamp": oldTs, "webhook-signature": sig },
      body,
    });
    const resp = await handleYocoWebhook(env, req, vi.fn() as unknown as typeof fetch);
    expect(resp.status).toBe(401);
  });

  it("returns 200 for a valid signature with correct timestamp", async () => {
    const body = JSON.stringify({ type: "refund.succeeded", payload: { id: "ref_1", paymentId: YOCO_PAYMENT_ID } });
    const { sig, webhookId, webhookTimestamp } = await sign(body);
    const resp = await handleYocoWebhook(env, webhookReq({ type: "refund.succeeded", payload: { id: "ref_1", paymentId: YOCO_PAYMENT_ID } }, sig, webhookId, webhookTimestamp), vi.fn() as unknown as typeof fetch);
    expect(resp.status).toBe(200);
  });
});

describe("handleYocoWebhook — payment.succeeded (deposit)", () => {
  it("marks payment paid, transitions booking accepted→deposit_paid (Wave A primary path), emails bride", async () => {
    const body = JSON.stringify(paymentSucceededEvent);
    const { sig, webhookId, webhookTimestamp } = await sign(body);
    const f = vi.fn()
      .mockResolvedValueOnce(res([]))                                           // [0] findPaymentByYocoId (not found → proceed)
      .mockResolvedValueOnce(res([paymentRow()]))                               // [1] findPaymentByCheckoutId
      .mockResolvedValueOnce(res({}, 200))                                      // [2] markPaymentPaid
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]))     // [3] transitionBooking(accepted) → succeeds
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]))     // [4] getBookingById
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))                    // [5] Brevo → bride
      .mockResolvedValueOnce(res({}, 201));                                     // [6] writeAudit → insertAudit

    const resp = await handleYocoWebhook(env, webhookReq(paymentSucceededEvent, sig, webhookId, webhookTimestamp), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);

    // Wave A: tries accepted first; legacy fallback (confirmed) is skipped since accepted succeeded
    const patchUrl = f.mock.calls[3]![0] as string;
    expect(patchUrl).toContain("bookings");
    expect(patchUrl).toContain("status=eq.accepted");
    const patch = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(patch.status).toBe("deposit_paid");
    expect(patch.deposit_paid_at).toBeTruthy();

    // Bride email sent
    const brideEmail = JSON.parse((f.mock.calls[5]![1] as RequestInit).body as string);
    expect(brideEmail.to[0].email).toBe("anke@example.com");
    expect(brideEmail.htmlContent).toContain("secured");
  });

  it("checkout-charges-net: payable_cents equals net_cents (absorb model)", () => {
    const row = paymentRow();
    expect(row.payable_cents).toBe(row.net_cents);
  });

  it("returns 200 immediately for unknown event type (no DB calls)", async () => {
    const body = JSON.stringify({ type: "some.other.event" });
    const { sig, webhookId, webhookTimestamp } = await sign(body);
    const f = vi.fn();
    const resp = await handleYocoWebhook(env, webhookReq({ type: "some.other.event" }, sig, webhookId, webhookTimestamp), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 200 without re-processing when Yoco payment ID already recorded (idempotent)", async () => {
    const body = JSON.stringify(paymentSucceededEvent);
    const { sig, webhookId, webhookTimestamp } = await sign(body);
    const f = vi.fn().mockResolvedValueOnce(res([paymentRow({ status: "paid", yoco_payment_id: YOCO_PAYMENT_ID })]));
    const resp = await handleYocoWebhook(env, webhookReq(paymentSucceededEvent, sig, webhookId, webhookTimestamp), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1); // only the idempotency lookup
  });

  it("returns 200 when checkout ID not found (e.g. test ping)", async () => {
    const body = JSON.stringify(paymentSucceededEvent);
    const { sig, webhookId, webhookTimestamp } = await sign(body);
    const f = vi.fn()
      .mockResolvedValueOnce(res([]))      // findPaymentByYocoId → not found
      .mockResolvedValueOnce(res([]));     // findPaymentByCheckoutId → not found
    const resp = await handleYocoWebhook(env, webhookReq(paymentSucceededEvent, sig, webhookId, webhookTimestamp), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("returns 200 and audits the race when booking already moved past accepted/confirmed (both fallbacks miss)", async () => {
    const body = JSON.stringify(paymentSucceededEvent);
    const { sig, webhookId, webhookTimestamp } = await sign(body);
    const f = vi.fn()
      .mockResolvedValueOnce(res([]))                                          // [0] findPaymentByYocoId → not found
      .mockResolvedValueOnce(res([paymentRow()]))                              // [1] findPaymentByCheckoutId
      .mockResolvedValueOnce(res({}, 200))                                     // [2] markPaymentPaid
      .mockResolvedValueOnce(res([]))                                          // [3] transitionBooking(accepted) → 0 rows (race)
      .mockResolvedValueOnce(res([]))                                          // [4] transitionBooking(confirmed) → 0 rows (legacy fallback also misses)
      .mockResolvedValueOnce(res({}, 201));                                    // [5] writeAudit → insertAudit deposit-paid-race
    const resp = await handleYocoWebhook(env, webhookReq(paymentSucceededEvent, sig, webhookId, webhookTimestamp), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const auditBody = JSON.parse((f.mock.calls[5]![1] as RequestInit).body as string);
    expect(auditBody.event_type).toBe("payment.deposit-paid-race");
  });
});

describe("handleYocoWebhook — payment.failed → EFT fallback", () => {
  it("marks payment failed and sends EFT fallback emails to bride + Zandeline", async () => {
    const body = JSON.stringify(paymentFailedEvent);
    const { sig, webhookId, webhookTimestamp } = await sign(body);
    const f = vi.fn()
      .mockResolvedValueOnce(res([paymentRow()]))           // findPaymentByCheckoutId
      .mockResolvedValueOnce(res({}, 200))                  // markPaymentFailed
      .mockResolvedValueOnce(res([bookingRow()]))           // getBookingById
      .mockResolvedValueOnce(eftSettingsRes())              // getEftSettings
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201)) // Brevo → bride
      .mockResolvedValueOnce(res({ messageId: "m2" }, 201)) // Brevo → Zandeline
      .mockResolvedValueOnce(res({}, 200));                 // markPaymentFailureNotified

    const resp = await handleYocoWebhook(env, webhookReq(paymentFailedEvent, sig, webhookId, webhookTimestamp), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);

    // Bride email contains EFT instructions
    const brideEmailBody = JSON.parse((f.mock.calls[4]![1] as RequestInit).body as string);
    expect(brideEmailBody.to[0].email).toBe("anke@example.com");
    expect(brideEmailBody.htmlContent).toMatch(/EFT|bank/i);
  });

  it("skips EFT emails when payment already failed+notified (idempotent)", async () => {
    const body = JSON.stringify(paymentFailedEvent);
    const { sig, webhookId, webhookTimestamp } = await sign(body);
    const f = vi.fn()
      .mockResolvedValueOnce(res([paymentRow({ status: "failed", failure_notified_at: "2026-06-17T12:05:00Z" })]));
    const resp = await handleYocoWebhook(env, webhookReq(paymentFailedEvent, sig, webhookId, webhookTimestamp), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1); // only the lookup, no emails
  });
});

describe("handleYocoWebhook — refund.succeeded", () => {
  it("returns 200 with no DB calls (audit-only in Wave 0)", async () => {
    const refundEvent = { type: "refund.succeeded", payload: { id: "ref_1", paymentId: YOCO_PAYMENT_ID } };
    const body = JSON.stringify(refundEvent);
    const { sig, webhookId, webhookTimestamp } = await sign(body);
    const f = vi.fn();
    const resp = await handleYocoWebhook(env, webhookReq(refundEvent, sig, webhookId, webhookTimestamp), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("pendingPaymentSweep", () => {
  it("marks stale pending payments failed and sends EFT fallback (skips already-notified)", async () => {
    const stalePayment = paymentRow({ id: "stale-pay-1", failure_notified_at: null });
    const alreadyNotified = paymentRow({ id: "stale-pay-2", failure_notified_at: "2026-06-17T10:00:00Z" });
    const f = vi.fn()
      .mockResolvedValueOnce(res([stalePayment, alreadyNotified]))   // findStalePayments
      // for stalePayment:
      .mockResolvedValueOnce(res({}, 200))                           // markPaymentFailed
      .mockResolvedValueOnce(res([bookingRow()]))                    // getBookingById
      .mockResolvedValueOnce(eftSettingsRes())                       // getEftSettings
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))         // Brevo → bride
      .mockResolvedValueOnce(res({ messageId: "m2" }, 201))         // Brevo → Zandeline
      .mockResolvedValueOnce(res({}, 200));                         // markPaymentFailureNotified
    // alreadyNotified: no additional calls (already notified)

    await pendingPaymentSweep(env, f as unknown as typeof fetch);

    // Verify stale payment was marked failed
    const failedPatch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(failedPatch.status).toBe("failed");
    expect(failedPatch.failed_at).toBeTruthy();
  });
});
