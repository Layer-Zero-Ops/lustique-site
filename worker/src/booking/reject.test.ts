// worker/src/booking/reject.test.ts
// The reject route is now a 410 stub — bride no longer declines via link.
import { describe, it, expect, vi } from "vitest";
import { renderRejectPage, handleReject } from "./reject";
import { signActionToken } from "./token";

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

const validToken = () =>
  signActionToken(BOOKING_ID, new Date(Date.now() + 7 * 24 * 3600 * 1000), SIGNING_SECRET, "reject");

const getReq = (token: string) =>
  new Request(`https://worker/api/booking/reject?token=${encodeURIComponent(token)}`);

const postReq = (token: string) =>
  new Request("https://worker/api/booking/reject", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });

describe("renderRejectPage — GET (410 stub)", () => {
  it("returns 410 for a still-valid token — no DB call", async () => {
    const token = await validToken();
    const f = vi.fn();
    const resp = await renderRejectPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(410);
    expect(f).not.toHaveBeenCalled();
    const html = await resp.text();
    expect(html).toContain("no longer in use");
  });

  it("returns 410 with no token — no DB call", async () => {
    const f = vi.fn();
    const resp = await renderRejectPage(env, new Request("https://worker/api/booking/reject"), f as unknown as typeof fetch);
    expect(resp.status).toBe(410);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 410 for a tampered token — no DB call", async () => {
    const token = (await validToken()) + "x";
    const f = vi.fn();
    const resp = await renderRejectPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(410);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("handleReject — POST (410 stub)", () => {
  it("returns 410 for a still-valid token — no DB transition, no email", async () => {
    const token = await validToken();
    const f = vi.fn();
    const resp = await handleReject(env, postReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(410);
    expect(f).not.toHaveBeenCalled();
    const html = await resp.text();
    expect(html).toContain("no longer in use");
  });

  it("returns 410 with no token — no DB call", async () => {
    const f = vi.fn();
    const req = new Request("https://worker/api/booking/reject", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({}).toString(),
    });
    const resp = await handleReject(env, req, f as unknown as typeof fetch);
    expect(resp.status).toBe(410);
    expect(f).not.toHaveBeenCalled();
  });
});
