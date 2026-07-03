// worker/src/booking/accept.test.ts — legacy /api/booking/accept now just redirects to /api/booking/invoice
import { describe, it, expect } from "vitest";
import { renderAcceptPage, handleAccept } from "./accept";
import { signActionToken, verifyActionToken } from "./token";

const BOOKING_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SIGNING_SECRET = "test-signing-secret";

const env = {
  ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  SIGNING_SECRET,
  AUDIT: { put: () => Promise.resolve(undefined) },
};

const validToken = (ttlMs = 7 * 24 * 3600 * 1000) =>
  signActionToken(BOOKING_ID, new Date(Date.now() + ttlMs), SIGNING_SECRET, "accept");

const getReq = (token: string) =>
  new Request(`https://worker/api/booking/accept?token=${encodeURIComponent(token)}`);

const postReq = (token: string) =>
  new Request("https://worker/api/booking/accept", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, depositPct: "50" }).toString(),
  });

describe("renderAcceptPage — GET", () => {
  it("redirects to the invoice page for a valid accept token", async () => {
    const token = await validToken();
    const resp = await renderAcceptPage(env, getReq(token));
    expect(resp.status).toBe(302);
    const location = resp.headers.get("location") ?? "";
    expect(location).toContain("https://lustiqueco.co.za/api/booking/invoice?token=");

    const invoiceToken = new URL(location).searchParams.get("token") ?? "";
    const v = await verifyActionToken(invoiceToken, SIGNING_SECRET, "invoice");
    expect(v?.bookingId).toBe(BOOKING_ID);
  });

  it("returns 400 with no token", async () => {
    const resp = await renderAcceptPage(env, new Request("https://worker/api/booking/accept"));
    expect(resp.status).toBe(400);
  });

  it("returns 400 for a tampered token", async () => {
    const token = (await validToken()) + "x";
    const resp = await renderAcceptPage(env, getReq(token));
    expect(resp.status).toBe(400);
  });
});

describe("handleAccept — POST", () => {
  it("redirects to the invoice page (no booking mutation)", async () => {
    const token = await validToken();
    const resp = await handleAccept(env, postReq(token));
    expect(resp.status).toBe(302);
    const location = resp.headers.get("location") ?? "";
    expect(location).toContain("https://lustiqueco.co.za/api/booking/invoice?token=");
  });

  it("returns 400 with no token", async () => {
    const req = new Request("https://worker/api/booking/accept", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ depositPct: "50" }).toString(),
    });
    const resp = await handleAccept(env, req);
    expect(resp.status).toBe(400);
  });
});
