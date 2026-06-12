import { describe, it, expect, vi } from "vitest";
import { renderConfirmPage } from "./confirm";
import { signToken } from "./token";

const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const BOOKING_ID = "11111111-2222-3333-4444-555555555555";
const SIGNING_SECRET = "signing-secret";

const env = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_KEY: "svc",
  BREVO_API_KEY: "brevo-key",
  NOTIFY_EMAIL: "z@lustique.co.za",
  ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  SIGNING_SECRET,
  EFT_BANK: "FNB",
  EFT_ACCOUNT_NAME: "Lustique Co",
  EFT_ACCOUNT_NO: "62000000000",
  EFT_BRANCH_CODE: "250655",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

const bookingRow = (over: Record<string, unknown> = {}) => ({
  id: BOOKING_ID, reference: "LUS-2026-111122", status: "requested",
  bride_name: "Anke van der Berg", bride_email: "anke@example.com",
  wedding_date: "2027-11-14", venue: "Red Ivory", town: "Hartbeespoort", province: "Gauteng",
  party_size: 7, total_cents: 882600, deposit_pct: 50,
  deposit_net_cents: 441300, balance_net_cents: 441300,
  confirm_token_expires_at: "2027-01-01T00:00:00Z", confirm_token_used_at: null,
  ...over,
});

const validToken = (ttlMs = 14 * 24 * 3600 * 1000) =>
  signToken(BOOKING_ID, new Date(Date.now() + ttlMs), SIGNING_SECRET);
const getReq = (token: string) =>
  new Request(`https://worker/api/booking/confirm?token=${encodeURIComponent(token)}`);

describe("renderConfirmPage (GET) — render-only", () => {
  it("renders the booking summary + confirm and decline forms", async () => {
    const token = await validToken();
    const f = vi.fn().mockResolvedValueOnce(res([bookingRow()]));
    const resp = await renderConfirmPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Anke van der Berg");
    expect(html).toContain('name="action" value="confirm"');
    expect(html).toContain('name="action" value="decline"');
    expect(f).toHaveBeenCalledOnce(); // GET reads, never mutates
  });

  it("shows 'already handled' (no forms) for a non-requested booking", async () => {
    const token = await validToken();
    const f = vi.fn().mockResolvedValueOnce(
      res([bookingRow({ status: "confirmed", confirm_token_used_at: "2026-06-11T10:00:00Z" })]),
    );
    const resp = await renderConfirmPage(env, getReq(token), f as unknown as typeof fetch);
    const html = await resp.text();
    expect(html).toContain("already been handled");
    expect(html).not.toContain('value="confirm"');
  });

  it("rejects a tampered token without touching the DB", async () => {
    const token = (await validToken()) + "x";
    const f = vi.fn();
    const resp = await renderConfirmPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("shows an expired page for a past-exp token, before any DB call", async () => {
    const token = await signToken(BOOKING_ID, new Date(Date.now() - 1000), SIGNING_SECRET);
    const f = vi.fn();
    const resp = await renderConfirmPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(410);
    expect(f).not.toHaveBeenCalled();
  });
});
