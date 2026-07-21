import { describe, it, expect, vi } from "vitest";
import { insertBooking, updateBookingStatus, findPaymentByYocoId, keepWarm, countBookingsOnDate, getBookingByTokenHash, transitionRequestedBooking, getBookingById, transitionBooking, listBookingsDueForBalanceReminder, getBusinessSetting, setBusinessSetting, persistEnquiry, listSettledBookingEmails } from "./db";

const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "svc" };
const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
// Mock for countBookingsOnDate: returns count via Content-Range header (Prefer: count=exact)
const countRes = (count: number, status = 200) =>
  new Response("[]", { status, headers: { "content-type": "application/json", "content-range": `*/${count}` } });

describe("insertBooking", () => {
  it("returns the inserted row", async () => {
    const f = vi.fn().mockResolvedValue(res([{ id: "u1", reference: "LUS-2026-AAA111" }], 201));
    const out = await insertBooking(env, { idempotency_key: "k1" }, f as unknown as typeof fetch);
    expect(out).toEqual({ id: "u1", reference: "LUS-2026-AAA111" });
    expect(f).toHaveBeenCalledOnce();
  });
  it("on a duplicate (empty insert) re-fetches the existing booking — never a second row", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res([], 201))                                  // conflict → ignored
      .mockResolvedValueOnce(res([{ id: "u9", reference: "LUS-2026-DUP999" }])); // re-fetch
    const out = await insertBooking(env, { idempotency_key: "k1" }, f as unknown as typeof fetch);
    expect(out).toEqual({ id: "u9", reference: "LUS-2026-DUP999" });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("throws on a non-OK insert", async () => {
    const f = vi.fn().mockResolvedValue(res({ message: "boom" }, 500));
    await expect(insertBooking(env, { idempotency_key: "k1" }, f as unknown as typeof fetch)).rejects.toThrow(/500/);
  });
});

describe("persistEnquiry", () => {
  it("stores referral_source when provided", async () => {
    const f = vi.fn().mockResolvedValue(res([{ id: "e1" }], 201));
    await persistEnquiry(env, { name: "Anri", email: "anri@x.com", phone: "0821234567", referral_source: "avianto" }, f as unknown as typeof fetch);
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.referral_source).toBe("avianto");
  });

  it("omits referral_source when not provided (never sends undefined as a literal string)", async () => {
    const f = vi.fn().mockResolvedValue(res([{ id: "e2" }], 201));
    await persistEnquiry(env, { name: "Anri", email: "anri@x.com", phone: "0821234567" }, f as unknown as typeof fetch);
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.referral_source).toBeUndefined();
  });
});

describe("updateBookingStatus", () => {
  it("PATCHes the row by id and returns it", async () => {
    const f = vi.fn().mockResolvedValue(res([{ id: "u1", status: "confirmed" }]));
    const out = await updateBookingStatus(env, "u1", { status: "confirmed" }, f as unknown as typeof fetch);
    expect(out.status).toBe("confirmed");
    const url = (f.mock.calls[0]![0] as string);
    expect(url).toContain("/rest/v1/bookings?id=eq.u1");
  });
});

describe("findPaymentByYocoId", () => {
  it("returns null when no payment matches", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    expect(await findPaymentByYocoId(env, "pay_x", f as unknown as typeof fetch)).toBeNull();
  });
});

describe("keepWarm", () => {
  it("issues a tiny select to reset the free-tier pause clock", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    await keepWarm(env, f as unknown as typeof fetch);
    expect((f.mock.calls[0]![0] as string)).toContain("/rest/v1/bookings?select=id&limit=1");
  });
});

const dbEnv = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "svc" };

describe("getBookingByTokenHash", () => {
  it("returns the row when the hash matches", async () => {
    const row = { id: "b1", reference: "LUS-2026-AAA", status: "requested" };
    const f = vi.fn().mockResolvedValue(res([row]));
    const got = await getBookingByTokenHash(dbEnv, "deadbeef", f as unknown as typeof fetch);
    expect(got).toEqual(row);
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain("confirm_token_hash=eq.deadbeef");
  });

  it("returns null when no row matches", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    expect(await getBookingByTokenHash(dbEnv, "nope", f as unknown as typeof fetch)).toBeNull();
  });
});

describe("transitionRequestedBooking", () => {
  it("PATCHes guarded on status=eq.requested and returns the updated row", async () => {
    const updated = { id: "b1", status: "confirmed" };
    const f = vi.fn().mockResolvedValue(res([updated]));
    const got = await transitionRequestedBooking(
      dbEnv, "b1", { status: "confirmed" }, f as unknown as typeof fetch,
    );
    expect(got).toEqual(updated);
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain("id=eq.b1");
    expect(url).toContain("status=eq.requested");
  });

  it("returns null when the guard matches 0 rows (already handled)", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    const got = await transitionRequestedBooking(
      dbEnv, "b1", { status: "confirmed" }, f as unknown as typeof fetch,
    );
    expect(got).toBeNull();
  });
});

describe("getBookingById", () => {
  it("selects by id and returns the row", async () => {
    const row = { id: "b1", status: "confirmed" };
    const f = vi.fn().mockResolvedValue(res([row]));
    const got = await getBookingById(dbEnv, "b1", f as unknown as typeof fetch);
    expect(got).toEqual(row);
    expect(f.mock.calls[0]![0] as string).toContain("id=eq.b1");
  });
  it("returns null when absent", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    expect(await getBookingById(dbEnv, "x", f as unknown as typeof fetch)).toBeNull();
  });
});

describe("transitionBooking (generalized guard)", () => {
  it("guards on the given fromStatus", async () => {
    const f = vi.fn().mockResolvedValue(res([{ id: "b1", status: "deposit_paid" }]));
    await transitionBooking(dbEnv, "b1", "confirmed", { status: "deposit_paid" }, f as unknown as typeof fetch);
    expect(f.mock.calls[0]![0] as string).toContain("status=eq.confirmed");
  });
  it("returns null on 0-row guard miss", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    expect(await transitionBooking(dbEnv, "b1", "confirmed", { status: "deposit_paid" }, f as unknown as typeof fetch)).toBeNull();
  });
});

describe("countBookingsOnDate", () => {
  it("returns the count from the Content-Range header", async () => {
    const f = vi.fn().mockResolvedValue(countRes(3));
    const n = await countBookingsOnDate(env, "2026-11-14", f as unknown as typeof fetch);
    expect(n).toBe(3);
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain("wedding_date=eq.2026-11-14");
    expect(url).toContain("status=not.in.(expired,declined,cancelled,rejected,invoice_expired)");
  });
  it("returns 0 when count is zero", async () => {
    const f = vi.fn().mockResolvedValue(countRes(0));
    expect(await countBookingsOnDate(env, "2026-12-25", f as unknown as typeof fetch)).toBe(0);
  });
  it("returns 0 when Content-Range header is absent (defensive guard)", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    expect(await countBookingsOnDate(env, "2026-12-25", f as unknown as typeof fetch)).toBe(0);
  });
});

describe("listBookingsDueForBalanceReminder", () => {
  it("queries deposit_paid, unsent, balance>0, within the wedding-date window", async () => {
    const rows = [{ id: "b1", status: "deposit_paid", wedding_date: "2026-07-01", balance_reminder_sent_at: null, balance_net_cents: 441300 }];
    const f = vi.fn().mockResolvedValue(res(rows));
    const got = await listBookingsDueForBalanceReminder(env, "2026-06-13", "2026-07-04", f as unknown as typeof fetch);
    expect(got).toEqual(rows);
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain("status=eq.deposit_paid");
    expect(url).toContain("balance_reminder_sent_at=is.null");
    expect(url).toContain("balance_net_cents=gt.0");
    expect(url).toContain("wedding_date=gte.2026-06-13");
    expect(url).toContain("wedding_date=lte.2026-07-04");
    expect(url).toContain("balance_reminder_sent_at"); // present in the select list
  });
  it("returns [] when nothing is due", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    expect(await listBookingsDueForBalanceReminder(env, "2026-06-13", "2026-07-04", f as unknown as typeof fetch)).toEqual([]);
  });
});

describe("listSettledBookingEmails", () => {
  it("queries settled bookings and returns bride email + name", async () => {
    const rows = [
      { bride_email: "anke@example.com", bride_name: "Anke van der Berg" },
      { bride_email: "zanele@example.com", bride_name: "Zanele Nkosi" },
    ];
    const f = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const result = await listSettledBookingEmails(env, f as unknown as typeof fetch);
    expect(result).toEqual(rows);
    const [url] = f.mock.calls[0]!;
    expect(url).toContain("bookings?status=eq.settled");
    expect(url).toContain("select=bride_email,bride_name");
  });

  it("throws on a non-2xx response", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("error", { status: 500 }));
    await expect(listSettledBookingEmails(env, f as unknown as typeof fetch)).rejects.toThrow(/500/);
  });
});

describe("getBusinessSetting", () => {
  it("returns the value when the key exists", async () => {
    const f = vi.fn().mockResolvedValue(res([{ value: "cheapest-look-free" }]));
    expect(await getBusinessSetting(env, "active_promo_id", f as unknown as typeof fetch)).toBe("cheapest-look-free");
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain("business_settings?key=eq.active_promo_id");
  });
  it("returns null when the key is unset", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    expect(await getBusinessSetting(env, "active_promo_id", f as unknown as typeof fetch)).toBeNull();
  });
  it("returns null on a non-OK response rather than throwing", async () => {
    const f = vi.fn().mockResolvedValue(res({ message: "boom" }, 500));
    expect(await getBusinessSetting(env, "active_promo_id", f as unknown as typeof fetch)).toBeNull();
  });
});

describe("setBusinessSetting", () => {
  it("upserts key/value via on_conflict + merge-duplicates", async () => {
    const f = vi.fn().mockResolvedValue(res([], 201));
    await setBusinessSetting(env, "active_promo_id", "flat-1000-off", f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0]!;
    expect(url as string).toContain("business_settings?on_conflict=key");
    expect((init as RequestInit).headers).toMatchObject({ prefer: "resolution=merge-duplicates" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ key: "active_promo_id", value: "flat-1000-off" });
  });
  it("throws on a non-OK response", async () => {
    const f = vi.fn().mockResolvedValue(res({ message: "boom" }, 500));
    await expect(setBusinessSetting(env, "k", "v", f as unknown as typeof fetch)).rejects.toThrow(/500/);
  });
});
