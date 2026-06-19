// worker/src/booking/review.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderReviewPage, handleReview, invoiceExpirySweep } from "./review";
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
  YOCO_SECRET_KEY: "yoco-test-secret",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};


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
  it("transitions to quote_sent, emails bride accept/reject buttons, emails Zandeline quote-sent, returns 200 HTML", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([reviewBooking()]))                            // [0] getBookingByTokenHashForReview
      .mockResolvedValueOnce(res([reviewBooking({ status: "quote_sent" })]))   // [1] transitionRequestedBooking
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))                    // [2] Brevo → bride
      .mockResolvedValueOnce(res({ messageId: "m2" }, 201))                    // [3] Brevo → Zandeline
      .mockResolvedValueOnce(res({}, 201));                                     // [4] writeAudit → insertAudit

    const resp = await handleReview(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Quote sent");

    // PATCH uses requested→quote_sent guard
    const patchUrl = f.mock.calls[1]![0] as string;
    expect(patchUrl).toContain("status=eq.requested");
    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.status).toBe("quote_sent");
    expect(patch.quote_sent_at).toBeTruthy();
    // Deposit amounts are NOT set at review time — bride picks pct at accept
    expect(patch.deposit_net_cents).toBeUndefined();
    expect(patch.total_cents).toBeUndefined();

    // Bride email has accept and reject action links
    const brideEmail = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(brideEmail.htmlContent).toContain("/api/booking/accept?token=");
    expect(brideEmail.htmlContent).toContain("/api/booking/reject?token=");
    expect(brideEmail.htmlContent).toContain("2027-11-14"); // wedding date appears in bride email body

    // Zandeline email has invoice link; mark-paid link is sent at accept time, not here
    const zandelineEmail = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(zandelineEmail.to[0].email).toBe(env.NOTIFY_EMAIL);
    expect(zandelineEmail.htmlContent).toContain("/api/booking/invoice?token=");
    expect(zandelineEmail.htmlContent).not.toContain("/api/booking/mark-paid");
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

  it("still returns 200 HTML and logs email-failed when Brevo throws post-transition", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([reviewBooking()]))
      .mockResolvedValueOnce(res([reviewBooking({ status: "quote_sent" })]))
      .mockRejectedValueOnce(new Error("Brevo 503"))  // bride email fails
      .mockResolvedValueOnce(res({}, 201));            // writeAudit → insertAudit (review.email-failed)
    const resp = await handleReview(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Quote sent");
    expect(f).toHaveBeenCalledTimes(4);
  });
});

describe("handleReview — approve (with override total)", () => {
  it("includes total_cents but NOT deposit amounts in the PATCH when total is overridden", async () => {
    const token = await validToken();
    // Override total to R10,000 (1_000_000 cents). Original was R8,826 (882_600 cents).
    // Deposit amounts are set by the bride at accept time, not here.
    const f = vi.fn()
      .mockResolvedValueOnce(res([reviewBooking()]))
      .mockResolvedValueOnce(res([reviewBooking({ status: "quote_sent", total_cents: 1_000_000 })]))
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))
      .mockResolvedValueOnce(res({ messageId: "m2" }, 201))
      .mockResolvedValueOnce(res({}, 201));

    const resp = await handleReview(
      env,
      postReq(token, "confirm", { overrideTotal: "10000" }),
      f as unknown as typeof fetch,
    );
    expect(resp.status).toBe(200);

    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.total_cents).toBe(1_000_000);
    // Deposit splits are NOT calculated here — bride picks pct at accept
    expect(patch.deposit_net_cents).toBeUndefined();
    expect(patch.balance_net_cents).toBeUndefined();

    // Bride email reflects the overridden total in the quote
    const brideEmail = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(brideEmail.htmlContent).toContain("10 000"); // R10,000 formatted
    expect(brideEmail.htmlContent).toContain("/api/booking/accept?token=");
  });

  it("uses original amounts when override equals the existing total", async () => {
    const token = await validToken();
    // Send the same total (8826) — should NOT include amount fields in PATCH
    const f = vi.fn()
      .mockResolvedValueOnce(res([reviewBooking()]))
      .mockResolvedValueOnce(res([reviewBooking({ status: "quote_sent" })]))
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))
      .mockResolvedValueOnce(res({ messageId: "m2" }, 201))
      .mockResolvedValueOnce(res({}, 201));

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

// ── invoiceExpirySweep ────────────────────────────────────────────────────────

const expiredBooking = (id = BOOKING_ID) => ({
  id,
  reference: "LUS-2026-AABBCC",
  status: "quote_sent",
  bride_name: "Anke van der Berg",
  bride_email: "anke@example.com",
  wedding_date: "2027-11-14",
  venue: "Red Ivory",
  town: "Hartbeespoort",
  province: "Gauteng",
  party_size: 7,
  total_cents: 882600,
  deposit_pct: 50,
  deposit_net_cents: 441300,
  balance_net_cents: 441300,
  confirm_token_expires_at: "2027-01-01T00:00:00Z",
  confirm_token_used_at: null,
  quote_lines: [],
  quote_sent_at: "2026-06-01T00:00:00Z", // older than 7 days
});

describe("invoiceExpirySweep", () => {
  const now = () => new Date("2026-06-19T00:00:00Z");

  it("transitions expired bookings to invoice_expired and audits each", async () => {
    const b1 = expiredBooking("aaaa-1111-1111-1111-111111111111");
    const b2 = expiredBooking("bbbb-2222-2222-2222-222222222222");
    const f = vi.fn()
      .mockResolvedValueOnce(res([b1, b2]))           // [0] listExpiredQuotes GET
      .mockResolvedValueOnce(res([{ ...b1, status: "invoice_expired" }])) // [1] PATCH b1
      .mockResolvedValueOnce(res({}, 201))             // [2] insertAudit b1
      .mockResolvedValueOnce(res([{ ...b2, status: "invoice_expired" }])) // [3] PATCH b2
      .mockResolvedValueOnce(res({}, 201));             // [4] insertAudit b2

    await invoiceExpirySweep(env, f as unknown as typeof fetch, now);

    // listExpiredQuotes uses cutoff = now - 7d
    const listUrl = f.mock.calls[0]![0] as string;
    expect(listUrl).toContain("status=eq.quote_sent");
    expect(listUrl).toContain("quote_sent_at=lt.");

    // PATCH uses status=eq.quote_sent guard
    const patch1Url = f.mock.calls[1]![0] as string;
    expect(patch1Url).toContain("status=eq.quote_sent");
    const patch1Body = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch1Body.status).toBe("invoice_expired");
    expect(patch1Body.invoice_expired_at).toBeTruthy();

    expect(f).toHaveBeenCalledTimes(5);
    expect(env.AUDIT.put).toHaveBeenCalled();
  });

  it("does nothing when there are no expired quotes", async () => {
    const f = vi.fn().mockResolvedValueOnce(res([])); // [0] empty list
    await invoiceExpirySweep(env, f as unknown as typeof fetch, now);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("skips audit on race (PATCH returns 0 rows)", async () => {
    const b = expiredBooking();
    const f = vi.fn()
      .mockResolvedValueOnce(res([b]))   // [0] listExpiredQuotes
      .mockResolvedValueOnce(res([]));    // [1] PATCH → race, 0 rows updated

    await invoiceExpirySweep(env, f as unknown as typeof fetch, now);

    // only 2 fetch calls: list + failed PATCH; no audit POST
    expect(f).toHaveBeenCalledTimes(2);
  });
});
