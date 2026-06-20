import { describe, it, expect, vi } from "vitest";
import { reviewEmailSweep } from "./review-email";

const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const BOOKING_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const env = {
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "svc",
  BREVO_API_KEY: "brevo-key", NOTIFY_EMAIL: "z@lustique.co.za",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

// cron "today" = 2026-07-05; cutoff = 2026-07-04; wedding_date must be < 2026-07-04
const NOW = () => new Date("2026-07-05T06:00:00Z");

const settledRow = (over: Record<string, unknown> = {}) => ({
  id: BOOKING_ID, reference: "LUS-2026-111122",
  bride_name: "Anke van der Berg", bride_email: "anke@example.com",
  wedding_date: "2026-07-02", // 3 days before NOW → qualifies
  ...over,
});

const googleUrlRow = [{ value: "https://g.co/review/lustique" }];

describe("reviewEmailSweep", () => {
  it("emails the bride, stamps review_email_sent_at, audits — for a qualifying booking", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res([settledRow()]))          // listBookingsDueForReviewEmail
      .mockResolvedValueOnce(res(googleUrlRow))            // getGoogleReviewUrl
      .mockResolvedValueOnce(res({ messageId: "m" }, 201)) // Brevo → bride
      .mockResolvedValueOnce(res([settledRow({ review_email_sent_at: "2026-07-05T06:00:00Z" })], 200)) // transitionBooking stamp
      .mockResolvedValueOnce(res({}, 201));                // audit sent

    await reviewEmailSweep(env, f as unknown as typeof fetch, NOW);

    const bride = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(bride.to[0].email).toBe("anke@example.com");
    expect(bride.htmlContent).toContain("Thank you");
    expect(bride.htmlContent).toContain("https://g.co/review/lustique");
    expect(bride.htmlContent).toContain("Leave us a Google review");

    const patchUrl = f.mock.calls[3]![0] as string;
    expect(patchUrl).toContain("status=eq.settled");
    const patch = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(patch.review_email_sent_at).toBeTruthy();

    const audit = JSON.parse((f.mock.calls[4]![1] as RequestInit).body as string);
    expect(audit.event_type).toBe("review.email.sent");
  });

  it("skips when no settled bookings are past the cutoff", async () => {
    const f = vi.fn().mockResolvedValueOnce(res([])); // empty list
    await reviewEmailSweep(env, f as unknown as typeof fetch, NOW);
    expect(f).toHaveBeenCalledTimes(1); // only the list query, no google URL fetch
  });

  it("does not stamp when email fails — next run retries", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res([settledRow()]))
      .mockResolvedValueOnce(res(googleUrlRow))
      .mockRejectedValueOnce(new Error("Brevo 503")) // email fails
      .mockResolvedValueOnce(res({}, 201));           // failure audit

    await reviewEmailSweep(env, f as unknown as typeof fetch, NOW);

    const calls = f.mock.calls.map((c) => c[0] as string);
    expect(calls.some((u) => u.includes("id=eq.") && u.includes("status=eq.settled"))).toBe(false); // no stamp PATCH
    const audit = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(audit.event_type).toBe("review.email.failed");
  });

  it("one booking's failure does not abort the others", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res([
        settledRow({ id: "aaaaaaaa-0000-0000-0000-000000000001" }),
        settledRow({ id: "bbbbbbbb-0000-0000-0000-000000000002" }),
      ]))
      .mockResolvedValueOnce(res(googleUrlRow))             // getGoogleReviewUrl (once)
      .mockRejectedValueOnce(new Error("Brevo 503"))        // booking 1 email fails
      .mockResolvedValueOnce(res({}, 201))                  // booking 1 failure audit
      .mockResolvedValueOnce(res({ messageId: "m" }, 201)) // booking 2 email
      .mockResolvedValueOnce(res([settledRow()], 200))      // booking 2 stamp
      .mockResolvedValueOnce(res({}, 201));                 // booking 2 audit

    await reviewEmailSweep(env, f as unknown as typeof fetch, NOW);
    expect(f.mock.calls.length).toBe(7);
  });
});
