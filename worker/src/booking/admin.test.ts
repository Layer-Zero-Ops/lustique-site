// worker/src/booking/admin.test.ts — S8 blocked-dates admin handler tests
import { describe, it, expect, vi } from "vitest";
import { handleAdminBlockedDates } from "./admin";
import type { AdminEnv } from "./admin";

const SECRET = "correct-horse-battery";

function makeEnv(overrides: Partial<AdminEnv> = {}): AdminEnv {
  return {
    SUPABASE_URL: "https://fake.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    ADMIN_SECRET: SECRET,
    AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
}

const DATES = [
  { date: "2026-09-15", reason: "Artist unavailable" },
  { date: "2026-12-25", reason: null },
];

function makeDbFetch(
  listResult: typeof DATES = DATES,
): typeof fetch {
  return vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
    const method = opts?.method?.toUpperCase() ?? "GET";
    // POST (add) and DELETE (remove) → return empty 204
    if (method === "POST" || method === "DELETE" || method === "PATCH") {
      return { ok: true, status: 204, text: async () => "", json: async () => [] };
    }
    // GET → return the dates list
    return { ok: true, status: 200, text: async () => JSON.stringify(listResult), json: async () => listResult };
  }) as unknown as typeof fetch;
}

function get(path: string, secret = SECRET): Request {
  return new Request(`https://worker.dev${path}?token=${encodeURIComponent(secret)}`, { method: "GET" });
}

async function post(data: Record<string, string>, secret = SECRET): Promise<Request> {
  const body = new URLSearchParams({ ...data, token: secret });
  return new Request("https://worker.dev/api/admin/blocked-dates", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

// ── GET ───────────────────────────────────────────────────────────────────────

describe("GET /api/admin/blocked-dates", () => {
  it("returns 200 with dates listed for correct token", async () => {
    const r = await handleAdminBlockedDates(makeEnv(), get("/api/admin/blocked-dates"), makeDbFetch());
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("2026-09-15");
    expect(html).toContain("Artist unavailable");
    expect(html).toContain("2026-12-25");
  });

  it("returns 401 for missing token", async () => {
    const req = new Request("https://worker.dev/api/admin/blocked-dates", { method: "GET" });
    const r = await handleAdminBlockedDates(makeEnv(), req, makeDbFetch());
    expect(r.status).toBe(401);
  });

  it("returns 401 for wrong token", async () => {
    const r = await handleAdminBlockedDates(makeEnv(), get("/api/admin/blocked-dates", "wrong-secret"), makeDbFetch());
    expect(r.status).toBe(401);
  });

  it("shows 'No blocked dates' when list is empty", async () => {
    const r = await handleAdminBlockedDates(makeEnv(), get("/api/admin/blocked-dates"), makeDbFetch([]));
    const html = await r.text();
    expect(html).toContain("No blocked dates");
  });

  it("renders the add form with correct token in hidden input", async () => {
    const r = await handleAdminBlockedDates(makeEnv(), get("/api/admin/blocked-dates"), makeDbFetch());
    const html = await r.text();
    expect(html).toContain(`value="${SECRET}"`);
    expect(html).toContain('name="action" value="add"');
  });
});

// ── POST add ─────────────────────────────────────────────────────────────────

describe("POST add a blocked date", () => {
  it("calls addBlockedDate and re-renders the list", async () => {
    const f = makeDbFetch();
    const req = await post({ action: "add", date: "2027-01-01", reason: "New Year" });
    const r = await handleAdminBlockedDates(makeEnv(), req, f);
    expect(r.status).toBe(200);
    // POST to Supabase was called (add)
    const calls = (f as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>;
    const postCall = calls.find(([, o]) => (o?.method ?? "GET").toUpperCase() === "POST");
    expect(postCall).toBeDefined();
    expect(JSON.parse(postCall![1].body as string)).toMatchObject({ date: "2027-01-01", reason: "New Year" });
  });

  it("returns 401 for wrong token on POST", async () => {
    const req = await post({ action: "add", date: "2027-01-01" }, "hacker");
    const r = await handleAdminBlockedDates(makeEnv(), req, makeDbFetch());
    expect(r.status).toBe(401);
  });

  it("returns 400 for invalid date format", async () => {
    const req = await post({ action: "add", date: "not-a-date" });
    const r = await handleAdminBlockedDates(makeEnv(), req, makeDbFetch());
    expect(r.status).toBe(400);
  });

  it("stores null reason when reason is empty string", async () => {
    const f = makeDbFetch();
    const req = await post({ action: "add", date: "2027-03-15", reason: "" });
    await handleAdminBlockedDates(makeEnv(), req, f);
    const calls = (f as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>;
    const postCall = calls.find(([, o]) => (o?.method ?? "GET").toUpperCase() === "POST");
    expect(JSON.parse(postCall![1].body as string)).toMatchObject({ date: "2027-03-15", reason: null });
  });
});

// ── POST remove ───────────────────────────────────────────────────────────────

describe("POST remove a blocked date", () => {
  it("calls removeBlockedDate and re-renders the list", async () => {
    const f = makeDbFetch();
    const req = await post({ action: "remove", date: "2026-09-15" });
    const r = await handleAdminBlockedDates(makeEnv(), req, f);
    expect(r.status).toBe(200);
    const calls = (f as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>;
    const deleteCall = calls.find(([, o]) => (o?.method ?? "GET").toUpperCase() === "DELETE");
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0]).toContain("2026-09-15");
  });

  it("returns 400 for unknown action", async () => {
    const req = await post({ action: "nuke", date: "2027-01-01" });
    const r = await handleAdminBlockedDates(makeEnv(), req, makeDbFetch());
    expect(r.status).toBe(400);
  });
});
