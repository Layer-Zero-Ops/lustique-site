// worker/src/booking/accept.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderAcceptPage, handleAccept } from "./accept";
import { signActionToken } from "./token";

const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const BOOKING_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SIGNING_SECRET = "test-signing-secret";
const YOCO_REDIRECT = "https://checkout.yoco.com/pay/chk-test-123";

const env = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_KEY: "svc",
  BREVO_API_KEY: "brevo-key",
  NOTIFY_EMAIL: "z@lustique.co.za",
  ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  SIGNING_SECRET,
  YOCO_SECRET_KEY: "yoco-test-secret",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

const quoteSentBooking = (over: Record<string, unknown> = {}) => ({
  id: BOOKING_ID, reference: "LUS-2026-111122", status: "quote_sent",
  bride_name: "Anke van der Berg", bride_email: "anke@example.com",
  wedding_date: "2027-11-14", venue: "Red Ivory", town: "Hartbeespoort", province: "Gauteng",
  party_size: 7, total_cents: 500000,
  deposit_pct: null, deposit_net_cents: null, balance_net_cents: null,
  ...over,
});

const validToken = (ttlMs = 7 * 24 * 3600 * 1000) =>
  signActionToken(BOOKING_ID, new Date(Date.now() + ttlMs), SIGNING_SECRET, "accept");

const expiredToken = () =>
  signActionToken(BOOKING_ID, new Date(Date.now() - 1000), SIGNING_SECRET, "accept");

const getReq = (token: string) =>
  new Request(`https://worker/api/booking/accept?token=${encodeURIComponent(token)}`);

const postReq = (token: string, depositPct: string | number) =>
  new Request("https://worker/api/booking/accept", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, depositPct: String(depositPct) }).toString(),
  });

const yocoRes = () => res({ id: "chk-test-123", redirectUrl: YOCO_REDIRECT });
const eftRows = () => res([
  { key: "eft_bank_name", value: "FNB" },
  { key: "eft_account_holder", value: "Lustique Co." },
  { key: "eft_account_number", value: "12345678" },
  { key: "eft_branch_code", value: "250655" },
]);

// ── GET renderAcceptPage ──────────────────────────────────────────────────────

describe("renderAcceptPage — GET", () => {
  it("renders deposit options for a valid quote_sent booking", async () => {
    const token = await validToken();
    const f = vi.fn().mockResolvedValueOnce(res([quoteSentBooking()]));
    const resp = await renderAcceptPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("2027-11-14");
    expect(html).toContain("R 5");           // R5,000 total
    expect(html).toContain('value="25"');
    expect(html).toContain('value="50"');
    expect(html).toContain('value="100"');
    expect(html).toContain('name="depositPct"');
    expect(f).toHaveBeenCalledOnce();        // GET never mutates
  });

  it("returns 400 with no token, no DB call", async () => {
    const f = vi.fn();
    const resp = await renderAcceptPage(env, new Request("https://worker/api/booking/accept"), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 400 for a tampered token without touching the DB", async () => {
    const token = (await validToken()) + "x";
    const f = vi.fn();
    const resp = await renderAcceptPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 410 for an expired token without touching the DB", async () => {
    const token = await expiredToken();
    const f = vi.fn();
    const resp = await renderAcceptPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(410);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 200 handled page when booking is not quote_sent", async () => {
    const token = await validToken();
    const f = vi.fn().mockResolvedValueOnce(res([quoteSentBooking({ status: "accepted" })]));
    const resp = await renderAcceptPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("already been accepted");
  });
});

// ── POST handleAccept ─────────────────────────────────────────────────────────

describe("handleAccept — POST", () => {
  it("T3 transition → Yoco checkout → 303 redirect (50% deposit)", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([quoteSentBooking()]))                                                          // [0] getBookingById
      .mockResolvedValueOnce(res([quoteSentBooking({ status: "accepted", deposit_pct: 50, deposit_net_cents: 250000, balance_net_cents: 250000 })]))  // [1] transitionBooking
      .mockResolvedValueOnce(res([]))                                                                            // [2] insertAudit (accept.accepted)
      .mockResolvedValueOnce(yocoRes())                                                                          // [3] Yoco checkout
      .mockResolvedValueOnce(res([{}]))                                                                          // [4] insertPayment
      .mockResolvedValueOnce(res({}, 202));                                                                      // [5] Brevo → Zandeline

    const resp = await handleAccept(env, postReq(token, 50), f as unknown as typeof fetch);
    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toBe(YOCO_REDIRECT);

    const patchBody = JSON.parse((f.mock.calls[1][1] as RequestInit).body as string);
    expect(patchBody.status).toBe("accepted");
    expect(patchBody.deposit_pct).toBe(50);
    expect(patchBody.deposit_net_cents).toBe(250000);
    expect(patchBody.balance_net_cents).toBe(250000);

    const yocoBody = JSON.parse((f.mock.calls[3][1] as RequestInit).body as string);
    expect(yocoBody.amount).toBe(250000);
    expect(yocoBody.currency).toBe("ZAR");

    expect(f.mock.calls[5][0] as string).toContain("brevo.com");
  });

  it("correct deposit split for 25%", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([quoteSentBooking()]))
      .mockResolvedValueOnce(res([quoteSentBooking({ status: "accepted", deposit_pct: 25, deposit_net_cents: 125000, balance_net_cents: 375000 })]))
      .mockResolvedValueOnce(res([]))
      .mockResolvedValueOnce(yocoRes())
      .mockResolvedValueOnce(res([{}]))
      .mockResolvedValueOnce(res({}, 202));

    const resp = await handleAccept(env, postReq(token, 25), f as unknown as typeof fetch);
    expect(resp.status).toBe(303);
    const patchBody = JSON.parse((f.mock.calls[1][1] as RequestInit).body as string);
    expect(patchBody.deposit_net_cents).toBe(125000);
    expect(patchBody.balance_net_cents).toBe(375000);
    const yocoBody = JSON.parse((f.mock.calls[3][1] as RequestInit).body as string);
    expect(yocoBody.amount).toBe(125000);
  });

  it("full payment (100%) sets balance to 0", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([quoteSentBooking()]))
      .mockResolvedValueOnce(res([quoteSentBooking({ status: "accepted", deposit_pct: 100, deposit_net_cents: 500000, balance_net_cents: 0 })]))
      .mockResolvedValueOnce(res([]))
      .mockResolvedValueOnce(yocoRes())
      .mockResolvedValueOnce(res([{}]))
      .mockResolvedValueOnce(res({}, 202));

    const resp = await handleAccept(env, postReq(token, 100), f as unknown as typeof fetch);
    expect(resp.status).toBe(303);
    const patchBody = JSON.parse((f.mock.calls[1][1] as RequestInit).body as string);
    expect(patchBody.balance_net_cents).toBe(0);
  });

  it("returns 400 for invalid depositPct without touching the DB", async () => {
    const token = await validToken();
    const f = vi.fn();
    const resp = await handleAccept(env, postReq(token, 30), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 400 with no token", async () => {
    const f = vi.fn();
    const req = new Request("https://worker/api/booking/accept", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ depositPct: "50" }).toString(),
    });
    const resp = await handleAccept(env, req, f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("race — returns handled page if transitionBooking misses", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([quoteSentBooking()]))  // [0] getBookingById
      .mockResolvedValueOnce(res([]));                   // [1] transitionBooking → race

    const resp = await handleAccept(env, postReq(token, 50), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("already been accepted");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("EFT fallback — shows bank details when Yoco checkout fails", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([quoteSentBooking()]))                                  // [0] getBookingById
      .mockResolvedValueOnce(res([quoteSentBooking({ status: "accepted" })]))            // [1] transitionBooking
      .mockResolvedValueOnce(res([]))                                                    // [2] insertAudit (accept.accepted)
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))                     // [3] Yoco → throws
      .mockResolvedValueOnce(res([]))                                                    // [4] insertAudit (checkout-failed)
      .mockResolvedValueOnce(res({}, 202))                                               // [5] Brevo → Zandeline
      .mockResolvedValueOnce(eftRows());                                                 // [6] getEftSettings

    const resp = await handleAccept(env, postReq(token, 50), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Pay by EFT");
    expect(html).toContain("FNB");
    expect(html).toContain("12345678");
    expect(html).toContain("LUS-2026-111122");
  });
});
