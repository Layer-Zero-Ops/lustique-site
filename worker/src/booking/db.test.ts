import { describe, it, expect, vi } from "vitest";
import { insertBooking, updateBookingStatus, findPaymentByYocoId, keepWarm, countBookingsOnDate, getBookingByTokenHash, transitionRequestedBooking, getBookingById, transitionBooking } from "./db";

const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "svc" };
const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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
  it("returns the count from the PostgREST aggregate", async () => {
    const f = vi.fn().mockResolvedValue(res([{ count: "3" }]));
    const n = await countBookingsOnDate(env, "2026-11-14", f as unknown as typeof fetch);
    expect(n).toBe(3);
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain("wedding_date=eq.2026-11-14");
    expect(url).toContain("status=not.in.(expired,declined,cancelled)");
  });
  it("returns 0 when no active bookings exist on that date", async () => {
    const f = vi.fn().mockResolvedValue(res([{ count: "0" }]));
    expect(await countBookingsOnDate(env, "2026-12-25", f as unknown as typeof fetch)).toBe(0);
  });
  it("returns 0 when PostgREST returns an empty array (defensive guard)", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    expect(await countBookingsOnDate(env, "2026-12-25", f as unknown as typeof fetch)).toBe(0);
  });
});
