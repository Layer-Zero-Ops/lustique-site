// worker/src/booking/yoco.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleYocoWebhook } from "./yoco";

const WEBHOOK_SECRET = "webhook-secret";
const BOOKING_ID = "11111111-2222-3333-4444-555555555555";
const CHECKOUT_ID = "ch_test_123";
const YOCO_PAYMENT_ID = "pay_test_yyy";

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
  ...over,
});

const succeededEvent = {
  id: "evt_xxx",
  type: "checkout.succeeded",
  createdDate: "2026-06-17T12:00:00Z",
  payload: {
    id: CHECKOUT_ID,
    paymentId: YOCO_PAYMENT_ID,
    amountInCents: 441300,
    currency: "ZAR",
    metadata: { bookingId: BOOKING_ID, reference: "LUS-2026-111122" },
  },
};

// Build a real HMAC-SHA256 signature for test payloads
async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

function webhookReq(event: unknown, sig: string): Request {
  const body = JSON.stringify(event);
  return new Request("https://worker/api/booking/yoco-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-yoco-signature": sig },
    body,
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("handleYocoWebhook — signature", () => {
  it("returns 401 for a missing or wrong signature", async () => {
    const body = JSON.stringify(succeededEvent);
    const resp = await handleYocoWebhook(
      env,
      new Request("https://worker/api/booking/yoco-webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-yoco-signature": "sha256=bad" },
        body,
      }),
      vi.fn() as unknown as typeof fetch,
    );
    expect(resp.status).toBe(401);
  });
});

describe("handleYocoWebhook — checkout.succeeded", () => {
  it("marks payment paid, transitions booking to deposit_paid, emails bride, returns 200", async () => {
    const body = JSON.stringify(succeededEvent);
    const sig = await sign(body);
    const f = vi.fn()
      .mockResolvedValueOnce(res([paymentRow()]))        // findPaymentByCheckoutId
      .mockResolvedValueOnce(res({}, 200))               // markPaymentPaid
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]))  // transitionBooking
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]))  // getBookingById
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201));                // Brevo → bride

    const resp = await handleYocoWebhook(env, webhookReq(succeededEvent, sig), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);

    // Verify PATCH goes to bookings with status=eq.confirmed guard
    const patchUrl = f.mock.calls[2]![0] as string;
    expect(patchUrl).toContain("bookings");
    expect(patchUrl).toContain("status=eq.confirmed");
    const patch = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(patch.status).toBe("deposit_paid");
    expect(patch.deposit_paid_at).toBeTruthy();

    // Bride email was sent
    const brideEmail = JSON.parse((f.mock.calls[4]![1] as RequestInit).body as string);
    expect(brideEmail.to[0].email).toBe("anke@example.com");
    expect(brideEmail.htmlContent).toContain("secured");
  });

  it("returns 200 immediately for an unknown event type (no DB calls)", async () => {
    const body = JSON.stringify({ type: "some.other.event" });
    const sig = await sign(body);
    const f = vi.fn();
    const resp = await handleYocoWebhook(env, webhookReq({ type: "some.other.event" }, sig), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 200 without re-processing when payment is already paid (idempotent)", async () => {
    const body = JSON.stringify(succeededEvent);
    const sig = await sign(body);
    const f = vi.fn().mockResolvedValueOnce(res([paymentRow({ status: "paid" })]));
    const resp = await handleYocoWebhook(env, webhookReq(succeededEvent, sig), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1); // only the lookup, no PATCH
  });

  it("returns 200 when checkout ID is not found (e.g. test ping)", async () => {
    const body = JSON.stringify(succeededEvent);
    const sig = await sign(body);
    const f = vi.fn().mockResolvedValueOnce(res([]));
    const resp = await handleYocoWebhook(env, webhookReq(succeededEvent, sig), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("returns 200 and audits the race when booking already moved past confirmed", async () => {
    const body = JSON.stringify(succeededEvent);
    const sig = await sign(body);
    const f = vi.fn()
      .mockResolvedValueOnce(res([paymentRow()]))       // findPaymentByCheckoutId
      .mockResolvedValueOnce(res({}, 200))              // markPaymentPaid
      .mockResolvedValueOnce(res([]))                   // transitionBooking → 0 rows (race)
      .mockResolvedValueOnce(res({}, 201));             // writeAudit deposit-paid-race (audit_log)
    const resp = await handleYocoWebhook(env, webhookReq(succeededEvent, sig), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const auditBody = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(auditBody.event_type).toBe("payment.deposit-paid-race");
  });
});
