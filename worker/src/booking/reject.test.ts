// worker/src/booking/reject.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderRejectPage, handleReject } from "./reject";
import { signActionToken } from "./token";

const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const BOOKING_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SIGNING_SECRET = "test-signing-secret";

const env = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_KEY: "svc",
  BREVO_API_KEY: "brevo-key",
  NOTIFY_EMAIL: "z@lustique.co.za",
  ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  SIGNING_SECRET,
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
  signActionToken(BOOKING_ID, new Date(Date.now() + ttlMs), SIGNING_SECRET, "reject");

const expiredToken = () =>
  signActionToken(BOOKING_ID, new Date(Date.now() - 1000), SIGNING_SECRET, "reject");

const getReq = (token: string) =>
  new Request(`https://worker/api/booking/reject?token=${encodeURIComponent(token)}`);

const postReq = (token: string) =>
  new Request("https://worker/api/booking/reject", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });

// ── GET renderRejectPage ──────────────────────────────────────────────────────

describe("renderRejectPage — GET", () => {
  it("renders the decline confirmation page", async () => {
    const token = await validToken();
    const f = vi.fn().mockResolvedValueOnce(res([quoteSentBooking()]));
    const resp = await renderRejectPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Decline this booking");
    expect(html).toContain("2027-11-14");
    expect(html).toContain("LUS-2026-111122");
    expect(html).toContain('method="POST"');
    expect(f).toHaveBeenCalledOnce();        // GET never mutates
  });

  it("returns 400 with no token, no DB call", async () => {
    const f = vi.fn();
    const resp = await renderRejectPage(env, new Request("https://worker/api/booking/reject"), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 400 for a tampered token without touching the DB", async () => {
    const token = (await validToken()) + "x";
    const f = vi.fn();
    const resp = await renderRejectPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 410 for an expired token without touching the DB", async () => {
    const token = await expiredToken();
    const f = vi.fn();
    const resp = await renderRejectPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(410);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 200 handled page when booking is not quote_sent", async () => {
    const token = await validToken();
    const f = vi.fn().mockResolvedValueOnce(res([quoteSentBooking({ status: "rejected" })]));
    const resp = await renderRejectPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("already been responded to");
  });
});

// ── POST handleReject ─────────────────────────────────────────────────────────

describe("handleReject — POST", () => {
  it("T4 transition, notifies Zandeline, returns thank-you page", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([quoteSentBooking()]))                                // [0] getBookingById
      .mockResolvedValueOnce(res([quoteSentBooking({ status: "rejected" })]))          // [1] transitionBooking
      .mockResolvedValueOnce(res([{}]))                                                // [2] insertRejection
      .mockResolvedValueOnce(res([]))                                                  // [3] insertAudit (bride-declined)
      .mockResolvedValueOnce(res({}, 202));                                            // [4] Brevo → Zandeline

    const resp = await handleReject(env, postReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Thanks for letting us know");
    expect(html).toContain("Anke van der Berg");

    const patchBody = JSON.parse((f.mock.calls[1][1] as RequestInit).body as string);
    expect(patchBody.status).toBe("rejected");

    expect(f.mock.calls[4][0] as string).toContain("brevo.com");
    const brevoBody = JSON.parse((f.mock.calls[4][1] as RequestInit).body as string);
    expect(brevoBody.to[0].email).toBe("z@lustique.co.za");
  });

  it("race — returns handled page if transitionBooking misses", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([quoteSentBooking()]))  // [0] getBookingById
      .mockResolvedValueOnce(res([]));                   // [1] transitionBooking → race

    const resp = await handleReject(env, postReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("already been responded to");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("still returns thank-you page when Brevo throws", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([quoteSentBooking()]))                                // [0] getBookingById
      .mockResolvedValueOnce(res([quoteSentBooking({ status: "rejected" })]))          // [1] transitionBooking
      .mockResolvedValueOnce(res([{}]))                                                // [2] insertRejection
      .mockResolvedValueOnce(res([]))                                                  // [3] insertAudit (bride-declined)
      .mockResolvedValueOnce(new Response("err", { status: 500 }))                    // [4] Brevo → throws
      .mockResolvedValueOnce(res([]));                                                 // [5] insertAudit (notify-failed)

    const resp = await handleReject(env, postReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Thanks for letting us know");
  });

  it("returns 400 with no token", async () => {
    const f = vi.fn();
    const req = new Request("https://worker/api/booking/reject", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({}).toString(),
    });
    const resp = await handleReject(env, req, f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});
