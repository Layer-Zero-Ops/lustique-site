// worker/src/booking/request.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleBookingRequest } from "./request";
import type { EstimateResult } from "@lustique/pricing";

// ── helpers ─────────────────────────────────────────────────────────────────
const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const BOOKING_ID = "11111111-2222-3333-4444-555555555555";

const env = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_KEY: "svc",
  BREVO_API_KEY: "brevo-key",
  NOTIFY_EMAIL: "z@lustique.co.za",
  ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  SIGNING_SECRET: "signing-secret",
  TURNSTILE_SECRET: "ts-secret",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

const mockResult: EstimateResult = {
  total: 8826, heads: 7, destination: false, occasion: "wedding",
  lines: [{ label: "Bride", amount: 3090 }],
};
const mockCompute = vi.fn().mockReturnValue(mockResult);

const validBody = {
  brideName: "Anke van der Berg",
  brideEmail: "anke@example.com",
  bridePhone: "0671234567",
  weddingDate: "2027-11-14",
  town: "Hartbeespoort",
  province: "Gauteng",
  venue: "Red Ivory",
  depositPct: 50,
  idempotencyKey: "client-key-001",
  consentAt: "2026-06-11T10:00:00Z",
  hp_company: "",
  cfTurnstileToken: "valid-ts-token",
  occasion: "wedding",
  brideHairLen: "long",
  partyHair: { short: 0, medium: 2, long: 1, xlong: 0 },
  bmMakeup: 3, bmHair: 3,
  momMakeup: 1, momHair: 1,
  fgAge: "under", fgMakeup: 0, fgHair: 0, fgHairLen: "short",
  guestMakeup: 0, guestHair: 0,
  requestedArtists: 1,
  promo: { kind: "cheapestLookFree", minPeople: 4 },
  travel: { band: "mid" },
};

/** Build a happy-path fetch chain: Turnstile → count → insert → audit_log → Brevo ×2 */
function happyChain() {
  return vi.fn()
    .mockResolvedValueOnce(res({ success: true }))                                       // 1. Turnstile
    .mockResolvedValueOnce(res([{ count: "0" }]))                                        // 2. countBookingsOnDate
    .mockResolvedValueOnce(res([{ id: BOOKING_ID, reference: "LUS-2026-111122" }], 201)) // 3. insertBooking
    .mockResolvedValueOnce(res({}, 201))                                                 // 4. audit_log
    .mockResolvedValueOnce(res({ messageId: "m1" }, 201))                               // 5. Brevo → Zandeline
    .mockResolvedValueOnce(res({ messageId: "m2" }, 201));                              // 6. Brevo → bride
}

function makeReq(body: unknown) {
  return new Request("https://worker/api/booking/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── tests ────────────────────────────────────────────────────────────────────
describe("handleBookingRequest — happy path", () => {
  it("returns 200 with the booking reference", async () => {
    const f = happyChain();
    const resp = await handleBookingRequest(env, makeReq(validBody), f, mockCompute, () => BOOKING_ID);
    expect(resp.status).toBe(200);
    const data = await resp.json() as { ok: boolean; reference: string };
    expect(data.ok).toBe(true);
    expect(data.reference).toMatch(/^LUS-/);
  });

  it("sends two Brevo emails (Zandeline + bride)", async () => {
    const f = happyChain();
    await handleBookingRequest(env, makeReq(validBody), f, mockCompute, () => BOOKING_ID);
    expect(f).toHaveBeenCalledTimes(6);
    const brevoCall1 = f.mock.calls[4]![0] as string;
    const brevoCall2 = f.mock.calls[5]![0] as string;
    expect(brevoCall1).toBe("https://api.brevo.com/v3/smtp/email");
    expect(brevoCall2).toBe("https://api.brevo.com/v3/smtp/email");
  });

  it("includes the confirm URL in Zandeline's email body", async () => {
    const f = happyChain();
    await handleBookingRequest(env, makeReq(validBody), f, mockCompute, () => BOOKING_ID);
    const zandelineBody = JSON.parse((f.mock.calls[4]![1] as RequestInit).body as string);
    expect(zandelineBody.htmlContent).toContain("/api/booking/confirm?token=");
  });

  it("includes the same-date warning when another booking holds the date", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res({ success: true }))
      .mockResolvedValueOnce(res([{ count: "2" }]))
      .mockResolvedValueOnce(res([{ id: BOOKING_ID, reference: "LUS-2026-111122" }], 201))
      .mockResolvedValueOnce(res({}, 201))
      .mockResolvedValueOnce(res({ messageId: "1" }, 201))
      .mockResolvedValueOnce(res({ messageId: "2" }, 201));
    await handleBookingRequest(env, makeReq(validBody), f, mockCompute, () => BOOKING_ID);
    const zandelineBody = JSON.parse((f.mock.calls[4]![1] as RequestInit).body as string);
    expect(zandelineBody.htmlContent).toContain("2 other booking");
  });

  it("flags bookings over R200,000 in notes but still returns 200", async () => {
    const bigCompute = vi.fn().mockReturnValue({ ...mockResult, total: 250_001 });
    const f = happyChain();
    const resp = await handleBookingRequest(env, makeReq(validBody), f, bigCompute, () => BOOKING_ID);
    expect(resp.status).toBe(200);
    const insertedBody = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(JSON.stringify(insertedBody)).toContain("manual review");
  });
});

describe("handleBookingRequest — honeypot + validation", () => {
  it("silently drops a honeypot hit (hp_company filled)", async () => {
    const f = vi.fn();
    const resp = await handleBookingRequest(
      env, makeReq({ ...validBody, hp_company: "spam-bot" }), f, mockCompute, () => BOOKING_ID,
    );
    expect(resp.status).toBe(200);
    expect((await resp.json() as { ok: boolean }).ok).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects when Turnstile fails", async () => {
    const f = vi.fn().mockResolvedValueOnce(res({ success: false }));
    const resp = await handleBookingRequest(env, makeReq(validBody), f, mockCompute, () => BOOKING_ID);
    expect(resp.status).toBe(422);
    expect((await resp.json() as { error: string }).error).toMatch(/[Bb]ot/);
  });

  it("rejects a wedding date in the past", async () => {
    const f = vi.fn().mockResolvedValueOnce(res({ success: true }));
    const resp = await handleBookingRequest(
      env, makeReq({ ...validBody, weddingDate: "2020-01-01" }), f, mockCompute, () => BOOKING_ID,
    );
    expect(resp.status).toBe(422);
    expect((await resp.json() as { error: string }).error).toMatch(/future/i);
  });

  it("rejects when consent is missing", async () => {
    const f = vi.fn().mockResolvedValueOnce(res({ success: true }));
    const resp = await handleBookingRequest(
      env, makeReq({ ...validBody, consentAt: "" }), f, mockCompute, () => BOOKING_ID,
    );
    expect(resp.status).toBe(422);
    expect((await resp.json() as { error: string }).error).toMatch(/consent/i);
  });

  it("rejects an invalid depositPct", async () => {
    const f = vi.fn().mockResolvedValueOnce(res({ success: true }));
    const resp = await handleBookingRequest(
      env, makeReq({ ...validBody, depositPct: 33 }), f, mockCompute, () => BOOKING_ID,
    );
    expect(resp.status).toBe(422);
    expect((await resp.json() as { error: string }).error).toMatch(/deposit/i);
  });
});

describe("handleBookingRequest — dedupe", () => {
  it("returns 200 without re-emailing when the idempotency_key already exists", async () => {
    const EXISTING_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const f = vi.fn()
      .mockResolvedValueOnce(res({ success: true }))
      .mockResolvedValueOnce(res([{ count: "0" }]))
      .mockResolvedValueOnce(res([{ id: EXISTING_ID, reference: "LUS-2026-EXIST" }], 201));
    const resp = await handleBookingRequest(env, makeReq(validBody), f, mockCompute, () => BOOKING_ID);
    expect(resp.status).toBe(200);
    expect((await resp.json() as { reference: string }).reference).toBe("LUS-2026-EXIST");
    expect(f).toHaveBeenCalledTimes(3);
  });
});
