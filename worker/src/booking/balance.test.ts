import { describe, it, expect, vi } from "vitest";
import { renderMarkBalancePaidPage, handleMarkBalancePaid, balanceSweep } from "./balance";
import { signActionToken } from "./token";

const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const BOOKING_ID = "11111111-2222-3333-4444-555555555555";
const SIGNING_SECRET = "signing-secret";
const env = {
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "svc",
  BREVO_API_KEY: "brevo-key", NOTIFY_EMAIL: "z@lustique.co.za",
  ALLOWED_ORIGIN: "https://lustiqueco.co.za", SIGNING_SECRET,
  EFT_BANK: "FNB", EFT_ACCOUNT_NAME: "Lustique Co", EFT_ACCOUNT_NO: "62000000000", EFT_BRANCH_CODE: "250655",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};
const bookingRow = (over: Record<string, unknown> = {}) => ({
  id: BOOKING_ID, reference: "LUS-2026-111122", status: "deposit_paid",
  bride_name: "Anke van der Berg", bride_email: "anke@example.com", wedding_date: "2027-11-14",
  venue: "Red Ivory", town: "Hartbeespoort", province: "Gauteng", party_size: 7,
  total_cents: 882600, deposit_pct: 50, deposit_net_cents: 441300, balance_net_cents: 441300,
  confirm_token_expires_at: "2027-01-01T00:00:00Z", confirm_token_used_at: null,
  balance_reminder_sent_at: null, ...over,
});
const balanceToken = (ttlMs = 90 * 24 * 3600 * 1000) =>
  signActionToken(BOOKING_ID, new Date(Date.now() + ttlMs), SIGNING_SECRET, "balance");
const getReq = (t: string) => new Request(`https://worker/api/booking/mark-balance-paid?token=${encodeURIComponent(t)}`);

describe("renderMarkBalancePaidPage (GET render-only)", () => {
  it("renders the balance-received page for a deposit_paid booking", async () => {
    const t = await balanceToken();
    const f = vi.fn().mockResolvedValueOnce(res([bookingRow()])); // getBookingById
    const resp = await renderMarkBalancePaidPage(env, getReq(t), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("balance");
    expect(html).toContain('action="/api/booking/mark-balance-paid"');
    expect(f).toHaveBeenCalledOnce();
  });
  it("shows 'already handled' when the booking isn't deposit_paid", async () => {
    const t = await balanceToken();
    const f = vi.fn().mockResolvedValueOnce(res([bookingRow({ status: "settled" })]));
    const html = await (await renderMarkBalancePaidPage(env, getReq(t), f as unknown as typeof fetch)).text();
    expect(html).toContain("already");
  });
  it("rejects a deposit-purpose token replayed here (wrong purpose), no DB call", async () => {
    const deposit = await signActionToken(BOOKING_ID, new Date(Date.now() + 1e6), SIGNING_SECRET, "deposit");
    const f = vi.fn();
    const resp = await renderMarkBalancePaidPage(env, getReq(deposit), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});

const postReq = (t: string) => new Request("https://worker/api/booking/mark-balance-paid", {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ token: t }).toString(),
});

describe("handleMarkBalancePaid (POST)", () => {
  it("transitions deposit_paid→settled, emails 'fully paid', audits, 200s", async () => {
    const t = await balanceToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]))  // getBookingById
      .mockResolvedValueOnce(res([bookingRow({ status: "settled" })]))        // transitionBooking
      .mockResolvedValueOnce(res({ messageId: "m" }, 201))                    // Brevo → bride
      .mockResolvedValueOnce(res({}, 201));                                   // audit
    const resp = await handleMarkBalancePaid(env, postReq(t), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const patchUrl = f.mock.calls[1]![0] as string;
    expect(patchUrl).toContain("status=eq.deposit_paid");
    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.status).toBe("settled");
    expect(patch.settled_at).toBeTruthy();
    const bride = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(bride.htmlContent).toMatch(/fully paid|all paid|settled|see you/i);
    const audit = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(audit.event_type).toBe("payment.balance-recorded");
  });
  it("does not re-email when the booking already moved on (0-row guard)", async () => {
    const t = await balanceToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]))
      .mockResolvedValueOnce(res([])); // lost the race
    const resp = await handleMarkBalancePaid(env, postReq(t), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("still 200s and logs payment.email-failed when Brevo throws post-transition", async () => {
    const t = await balanceToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]))
      .mockResolvedValueOnce(res([bookingRow({ status: "settled" })]))
      .mockRejectedValueOnce(new Error("Brevo 503"))
      .mockResolvedValueOnce(res({}, 201)); // payment.email-failed audit
    const resp = await handleMarkBalancePaid(env, postReq(t), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const audit = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(audit.event_type).toBe("payment.email-failed");
  });
});

// wedding 14 working days after 2026-06-15 (Mon) = 2026-07-03 (Fri); cron "today" = 2026-06-15.
const NOW = () => new Date("2026-06-15T06:00:00Z");
const dueRow = (over: Record<string, unknown> = {}) => bookingRow({ status: "deposit_paid", wedding_date: "2026-07-03", balance_reminder_sent_at: null, ...over });

describe("balanceSweep", () => {
  it("emails bride + Zandeline, stamps balance_reminder_sent_at, audits — for a due booking", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res([dueRow()]))               // listBookingsDueForBalanceReminder
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201)) // Brevo → bride
      .mockResolvedValueOnce(res({ messageId: "m2" }, 201)) // Brevo → Zandeline
      .mockResolvedValueOnce(res([dueRow({ balance_reminder_sent_at: "2026-06-15T06:00:00Z" })], 200)) // transition stamp
      .mockResolvedValueOnce(res({}, 201));                 // audit sent
    await balanceSweep(env, f as unknown as typeof fetch, NOW);
    const bride = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(bride.to[0].email).toBe("anke@example.com");
    expect(bride.htmlContent).toContain("62000000000");        // EFT account no
    expect(bride.htmlContent).toContain("LUS-2026-111122");    // reference
    const zan = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(zan.to[0].email).toBe(env.NOTIFY_EMAIL);
    expect(zan.htmlContent).toContain("/api/booking/mark-balance-paid?token=");
    const patchUrl = f.mock.calls[3]![0] as string;
    expect(patchUrl).toContain("status=eq.deposit_paid");
    const patch = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(patch.balance_reminder_sent_at).toBeTruthy();
    const audit = JSON.parse((f.mock.calls[4]![1] as RequestInit).body as string);
    expect(audit.event_type).toBe("payment.balance-reminder.sent");
  });
  it("skips a booking still more than 14 working days out (no emails)", async () => {
    const far = dueRow({ wedding_date: "2026-12-31" });
    const f = vi.fn().mockResolvedValueOnce(res([far])); // query only; nothing sent
    await balanceSweep(env, f as unknown as typeof fetch, NOW);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("does not stamp when the bride email fails — next run retries", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res([dueRow()]))
      .mockRejectedValueOnce(new Error("Brevo 503")) // bride email fails
      .mockResolvedValueOnce(res({}, 201));           // failure audit
    await balanceSweep(env, f as unknown as typeof fetch, NOW);
    const calls = f.mock.calls.map((c) => c[0] as string);
    expect(calls.some((u) => u.includes("status=eq.deposit_paid") && u.includes("bookings?id="))).toBe(false); // no stamp PATCH
    const audit = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(audit.event_type).toBe("payment.balance-reminder.failed");
  });
  it("one booking's failure does not abort the others", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res([dueRow({ id: "aaaaaaaa-0000-0000-0000-000000000001" }), dueRow({ id: "bbbbbbbb-0000-0000-0000-000000000002" })]))
      .mockRejectedValueOnce(new Error("Brevo 503")) // booking 1 bride email fails
      .mockResolvedValueOnce(res({}, 201))            // booking 1 failure audit
      .mockResolvedValueOnce(res({ messageId: "m" }, 201)) // booking 2 bride
      .mockResolvedValueOnce(res({ messageId: "m" }, 201)) // booking 2 Zandeline
      .mockResolvedValueOnce(res([dueRow()], 200))         // booking 2 stamp
      .mockResolvedValueOnce(res({}, 201));                // booking 2 audit sent
    await balanceSweep(env, f as unknown as typeof fetch, NOW);
    expect(f.mock.calls.length).toBe(7);
  });
});
