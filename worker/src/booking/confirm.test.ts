import { describe, it, expect, vi } from "vitest";
import { renderConfirmPage, handleBookingConfirm } from "./confirm";
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

const postReq = (token: string, action: string) =>
  new Request("https://worker/api/booking/confirm", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, action }).toString(),
  });

describe("handleBookingConfirm (POST) — confirm", () => {
  it("transitions to confirmed, emails EFT details, audits, 303-redirects", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow()]))                        // 1 getBookingByTokenHash
      .mockResolvedValueOnce(res([bookingRow({ status: "confirmed" })])) // 2 transitionRequestedBooking
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))              // 3 Brevo → bride
      .mockResolvedValueOnce(res({}, 201));                              // 4 insertAudit (via writeAudit)
    const resp = await handleBookingConfirm(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toContain("/booking-confirmed.html?ref=LUS-2026-111122");

    const patchUrl = f.mock.calls[1]![0] as string;
    expect(patchUrl).toContain("status=eq.requested");
    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.status).toBe("confirmed");
    expect(patch.confirmed_at).toBeTruthy();
    expect(patch.confirm_token_used_at).toBeTruthy();

    const email = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(email.htmlContent).toContain("62000000000");       // EFT account no.
    expect(email.htmlContent).toContain("LUS-2026-111122");   // payment reference
  });

  it("does not re-email when the guarded transition matches 0 rows", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow()]))  // looked requested at read time
      .mockResolvedValueOnce(res([]));             // ...but lost the race on PATCH
    const resp = await handleBookingConfirm(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);                 // "already handled" page, not a redirect
    expect(f).toHaveBeenCalledTimes(2);            // no Brevo, no audit
  });

  it("still redirects and logs confirm.email-failed when Brevo throws post-transition", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow()]))
      .mockResolvedValueOnce(res([bookingRow({ status: "confirmed" })]))
      .mockRejectedValueOnce(new Error("Brevo 503"))  // bride email fails
      .mockResolvedValueOnce(res({}, 201));           // confirm.email-failed audit
    const resp = await handleBookingConfirm(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(303);
    const audit = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(audit.event_type).toBe("confirm.email-failed");
  });
});

describe("handleBookingConfirm (POST) — decline", () => {
  it("transitions to declined, emails a gentle decline, 303 to declined page", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow()]))
      .mockResolvedValueOnce(res([bookingRow({ status: "declined" })]))
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))
      .mockResolvedValueOnce(res({}, 201));
    const resp = await handleBookingConfirm(env, postReq(token, "decline"), f as unknown as typeof fetch);
    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toContain("/booking-declined.html");
    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.status).toBe("declined");
    expect(patch.declined_at).toBeTruthy();
  });

  it("rejects a tampered token with no DB mutation", async () => {
    const f = vi.fn();
    const resp = await handleBookingConfirm(env, postReq("garbage.token", "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});
