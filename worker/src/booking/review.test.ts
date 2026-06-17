// worker/src/booking/review.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderReviewPage, handleReview } from "./review";
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
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

const eftRows = [
  { key: "eft_bank_name", value: "FNB" },
  { key: "eft_account_holder", value: "Lustique Co" },
  { key: "eft_account_number", value: "62000000000" },
  { key: "eft_branch_code", value: "250655" },
];
const eftRes = () => new Response(JSON.stringify(eftRows), { status: 200, headers: { "content-type": "application/json" } });

const reviewBooking = (over: Record<string, unknown> = {}) => ({
  id: BOOKING_ID, reference: "LUS-2026-111122", status: "requested",
  bride_name: "Anke van der Berg", bride_email: "anke@example.com",
  wedding_date: "2027-11-14", venue: "Red Ivory", town: "Hartbeespoort", province: "Gauteng",
  party_size: 7, total_cents: 882600, deposit_pct: 50,
  deposit_net_cents: 441300, balance_net_cents: 441300,
  confirm_token_expires_at: "2027-01-01T00:00:00Z", confirm_token_used_at: null,
  quote_lines: [{ label: "Bride", amount: 3090 }, { label: "Bridesmaids ×3", amount: 5736 }],
  ...over,
});

const validToken = (ttlMs = 14 * 24 * 3600 * 1000) =>
  signToken(BOOKING_ID, new Date(Date.now() + ttlMs), SIGNING_SECRET);

const getReq = (token: string) =>
  new Request(`https://worker/api/booking/review?token=${encodeURIComponent(token)}`);

const postReq = (token: string, action: string, extra: Record<string, string> = {}) =>
  new Request("https://worker/api/booking/review", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, action, ...extra }).toString(),
  });

// ── GET render ────────────────────────────────────────────────────────────────

describe("renderReviewPage — GET", () => {
  it("renders the review page with booking details and quote lines", async () => {
    const token = await validToken();
    const f = vi.fn().mockResolvedValueOnce(res([reviewBooking()]));
    const resp = await renderReviewPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Anke van der Berg");
    expect(html).toContain("2027-11-14");
    expect(html).toContain("Bride");          // quote line label
    expect(html).toContain("Bridesmaids");    // second quote line label
    expect(html).toContain('name="action" value="confirm"');
    expect(html).toContain('name="action" value="decline"');
    expect(html).toContain('name="overrideTotal"');
    expect(f).toHaveBeenCalledOnce();         // GET never mutates
  });

  it("shows 'already handled' for a non-requested booking", async () => {
    const token = await validToken();
    const f = vi.fn().mockResolvedValueOnce(
      res([reviewBooking({ status: "confirmed", confirm_token_used_at: "2026-06-11T10:00:00Z" })]),
    );
    const resp = await renderReviewPage(env, getReq(token), f as unknown as typeof fetch);
    const html = await resp.text();
    expect(html).toContain("already been handled");
    expect(html).not.toContain('value="confirm"');
  });

  it("rejects a tampered token without touching the DB", async () => {
    const token = (await validToken()) + "x";
    const f = vi.fn();
    const resp = await renderReviewPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("shows an expired page for a past-exp token, before any DB call", async () => {
    const token = await signToken(BOOKING_ID, new Date(Date.now() - 1000), SIGNING_SECRET);
    const f = vi.fn();
    const resp = await renderReviewPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(410);
    expect(f).not.toHaveBeenCalled();
  });
});

// ── POST approve ──────────────────────────────────────────────────────────────

describe("handleReview — approve (no override)", () => {
  it("transitions to confirmed, emails bride EFT details + Zandeline mark-paid link, redirects", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([reviewBooking()]))                          // [0] getBookingByTokenHashForReview
      .mockResolvedValueOnce(res([reviewBooking({ status: "confirmed" })]))   // [1] transitionRequestedBooking
      .mockResolvedValueOnce(eftRes())                                        // [2] getEftSettings
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))                  // [3] Brevo → bride
      .mockResolvedValueOnce(res({ messageId: "m2" }, 201));                 // [4] Brevo → Zandeline

    const resp = await handleReview(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toContain("/booking-confirmed.html?ref=LUS-2026-111122");

    // PATCH used the requested→confirmed guard
    const patchUrl = f.mock.calls[1]![0] as string;
    expect(patchUrl).toContain("status=eq.requested");
    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.status).toBe("confirmed");
    expect(patch.confirmed_at).toBeTruthy();
    // No amount override in patch
    expect(patch.total_cents).toBeUndefined();

    // Bride email has EFT account number
    const brideEmail = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(brideEmail.htmlContent).toContain("62000000000");
    expect(brideEmail.htmlContent).toContain("LUS-2026-111122");

    // Zandeline email has mark-paid link
    const zandelineEmail = JSON.parse((f.mock.calls[4]![1] as RequestInit).body as string);
    expect(zandelineEmail.to[0].email).toBe(env.NOTIFY_EMAIL);
    expect(zandelineEmail.htmlContent).toContain("/api/booking/mark-paid?token=");
  });

  it("does not re-email when the guarded transition matches 0 rows", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([reviewBooking()]))
      .mockResolvedValueOnce(res([])); // lost the race
    const resp = await handleReview(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(200); // handledHtml
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("still redirects to confirmed and logs email-failed when Brevo throws post-transition", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([reviewBooking()]))
      .mockResolvedValueOnce(res([reviewBooking({ status: "confirmed" })]))
      .mockResolvedValueOnce(eftRes())
      .mockRejectedValueOnce(new Error("Brevo 503"))   // bride email fails
      .mockResolvedValueOnce(res({}, 201));             // email-failed audit_log
    const resp = await handleReview(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toContain("/booking-confirmed.html");
    const auditBody = JSON.parse((f.mock.calls[4]![1] as RequestInit).body as string);
    expect(auditBody.event_type).toBe("confirm.email-failed");
  });
});

describe("handleReview — approve (with override total)", () => {
  it("recalculates deposit+balance and includes them in the PATCH when total is overridden", async () => {
    const token = await validToken();
    // Override total to R10,000 (1_000_000 cents). Original was R8,826 (882_600 cents).
    // deposit_pct=50 → deposit=R5,000, balance=R5,000
    const f = vi.fn()
      .mockResolvedValueOnce(res([reviewBooking()]))
      .mockResolvedValueOnce(res([reviewBooking({ status: "confirmed", total_cents: 1_000_000 })]))
      .mockResolvedValueOnce(eftRes())
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))
      .mockResolvedValueOnce(res({ messageId: "m2" }, 201));

    const resp = await handleReview(
      env,
      postReq(token, "confirm", { overrideTotal: "10000" }),
      f as unknown as typeof fetch,
    );
    expect(resp.status).toBe(303);

    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.total_cents).toBe(1_000_000);
    expect(patch.deposit_net_cents).toBe(500_000);
    expect(patch.balance_net_cents).toBe(500_000);

    // Bride email is the EFT deposit email (PATCH body already verified the overridden amounts above)
    const brideEmail = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(brideEmail.htmlContent).toContain("Deposit due");
    expect(brideEmail.htmlContent).toContain("62000000000"); // EFT account from settings
  });

  it("uses original amounts when override equals the existing total", async () => {
    const token = await validToken();
    // Send the same total (8826) — should NOT include amount fields in PATCH
    const f = vi.fn()
      .mockResolvedValueOnce(res([reviewBooking()]))
      .mockResolvedValueOnce(res([reviewBooking({ status: "confirmed" })]))
      .mockResolvedValueOnce(eftRes())
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))
      .mockResolvedValueOnce(res({ messageId: "m2" }, 201));

    await handleReview(
      env,
      postReq(token, "confirm", { overrideTotal: "8826" }),
      f as unknown as typeof fetch,
    );

    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.total_cents).toBeUndefined();
  });
});

// ── POST decline ──────────────────────────────────────────────────────────────

describe("handleReview — decline", () => {
  it("transitions to declined, emails a gentle no to the bride, redirects to declined page", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([reviewBooking()]))
      .mockResolvedValueOnce(res([reviewBooking({ status: "declined" })]))
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))
      .mockResolvedValueOnce(res({}, 201));
    const resp = await handleReview(env, postReq(token, "decline"), f as unknown as typeof fetch);
    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toContain("/booking-declined.html");

    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.status).toBe("declined");
    expect(patch.declined_at).toBeTruthy();

    const brideEmail = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(brideEmail.htmlContent).toMatch(/thank you/i);
  });

  it("rejects a tampered token with no DB mutation", async () => {
    const f = vi.fn();
    const resp = await handleReview(env, postReq("garbage.token", "decline"), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});
