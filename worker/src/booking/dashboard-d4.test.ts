// worker/src/booking/dashboard-d4.test.ts
// Wave D4 — TDD: artist allocation handlers + booking-detail widget render.
// Build correction #1: all imports must be at the TOP (ESM forbids import-after-statement).

import { describe, it, expect, vi } from "vitest";
import { handleAssignArtist, handleRemoveArtist, listArtists, listBookingArtists } from "./artists";
import { handleAdminBookingDetail } from "./dashboard";
import { AUTH_COOKIE } from "./auth";

// ── JWT helpers ───────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintJwt(payload: Record<string, unknown>): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(TEST_JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${base64url(sig)}`;
}

async function validAdminJwt(): Promise<string> {
  return mintJwt({
    sub: "aaaaaaaa-0000-0000-0000-000000000001",
    email: "zandeline@lustiqueco.co.za",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  });
}

const mockAudit = { put: vi.fn().mockResolvedValue(undefined) };

const env = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_KEY: "svc-key",
  SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
  AUDIT: mockAudit,
};

const fullEnv = {
  ...env,
  BREVO_API_KEY: "x",
  NOTIFY_EMAIL: "x",
  ALLOWED_ORIGIN: "x",
  ADMIN_SECRET: "x",
  SIGNING_SECRET: "x",
  YOCO_SECRET_KEY: "x",
  YOCO_WEBHOOK_SECRET: "x",
  TURNSTILE_SECRET: "x",
  EFT_BANK: "",
  EFT_ACCOUNT_NAME: "",
  EFT_ACCOUNT_NO: "",
  EFT_BRANCH_CODE: "",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const adminProfile = [{ role: "admin", full_name: "Zandeline" }];

const postReq = (path: string, body: Record<string, string>, cookie?: string) => {
  const headers: HeadersInit = { "content-type": "application/x-www-form-urlencoded" };
  if (cookie) headers["Cookie"] = `${AUTH_COOKIE}=${cookie}`;
  return new Request(`https://worker${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  });
};

const getReq = (path: string, cookie?: string) => {
  const headers: HeadersInit = {};
  if (cookie) headers["Cookie"] = `${AUTH_COOKIE}=${cookie}`;
  return new Request(`https://worker${path}`, { headers });
};

// ── listArtists ───────────────────────────────────────────────────────────────

describe("listArtists", () => {
  it("returns active artists sorted by name", async () => {
    const f = vi.fn().mockResolvedValueOnce(
      json([
        { id: "a1", name: "Zandeline", email: "z@l.co.za", active: true, specialisms: ["bridal-hair"] },
        { id: "a2", name: "Elria",     email: "e@l.co.za", active: true, specialisms: ["bridal-hair"] },
        { id: "a3", name: "Jana",      email: "j@l.co.za", active: true, specialisms: ["bridal-hair"] },
      ]),
    );
    const result = await listArtists(env, f as unknown as typeof fetch);
    expect(result.map((a) => a.name)).toEqual(["Elria", "Jana", "Zandeline"]);
  });
});

// ── listBookingArtists ────────────────────────────────────────────────────────

describe("listBookingArtists", () => {
  it("returns assignments ordered lead-first then by name", async () => {
    const f = vi.fn().mockResolvedValueOnce(
      json([
        { id: "ba1", booking_id: "bk1", artist_id: "a1", lead: false, confirmed_at: null, created_at: "2026-06-01T10:00:00Z", artists: { name: "Zandeline", email: "z@l.co.za" } },
        { id: "ba2", booking_id: "bk1", artist_id: "a2", lead: true,  confirmed_at: null, created_at: "2026-06-01T10:00:00Z", artists: { name: "Elria",     email: "e@l.co.za" } },
        { id: "ba3", booking_id: "bk1", artist_id: "a3", lead: false, confirmed_at: null, created_at: "2026-06-01T10:00:00Z", artists: { name: "Jana",      email: "j@l.co.za" } },
      ]),
    );
    const result = await listBookingArtists(env, "bk1", f as unknown as typeof fetch);
    expect(result[0]!.lead).toBe(true);
    expect(result[0]!.artists.name).toBe("Elria");
    expect(result[1]!.artists.name).toBe("Jana");
    expect(result[2]!.artists.name).toBe("Zandeline");
  });
});

// ── handleAssignArtist ────────────────────────────────────────────────────────

describe("handleAssignArtist", () => {
  it("redirects to login without session", async () => {
    const f = vi.fn();
    const res = await handleAssignArtist(
      postReq("/api/admin/booking/bk1/artists", { artist_id: "a1", lead: "false" }),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("rejects when booking status is 'requested' (guard)", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("/bookings?id=eq.bk1")) return Promise.resolve(json([{ id: "bk1", status: "requested" }]));
      return Promise.resolve(json([]));
    });
    const res = await handleAssignArtist(
      postReq("/api/admin/booking/bk1/artists", { artist_id: "a1000000-0000-0000-0000-000000000001", lead: "false" }, token),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  });

  it("inserts booking_artists row and redirects to booking detail on quote_sent booking", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("/bookings?id=eq.bk1")) return Promise.resolve(json([{ id: "bk1", status: "quote_sent" }]));
      if (url.includes("/booking_artists")) return Promise.resolve(json([], 201));
      if (url.includes("/audit_log")) return Promise.resolve(json({}));
      return Promise.resolve(json([]));
    });
    const res = await handleAssignArtist(
      postReq("/api/admin/booking/bk1/artists", { artist_id: "a1000000-0000-0000-0000-000000000001", lead: "true" }, token),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/booking/bk1?saved=1");
  });

  it("inserts booking_artists row on accepted booking", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("/bookings?id=eq.bk2")) return Promise.resolve(json([{ id: "bk2", status: "accepted" }]));
      if (url.includes("/booking_artists")) return Promise.resolve(json([], 201));
      if (url.includes("/audit_log")) return Promise.resolve(json({}));
      return Promise.resolve(json([]));
    });
    const res = await handleAssignArtist(
      postReq("/api/admin/booking/bk2/artists", { artist_id: "a1000000-0000-0000-0000-000000000002", lead: "false" }, token),
      env,
      "bk2",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/booking/bk2?saved=1");
  });

  it("rejects missing artist_id with error redirect", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      return Promise.resolve(json([]));
    });
    const res = await handleAssignArtist(
      postReq("/api/admin/booking/bk1/artists", { lead: "false" }, token),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  });
});

// ── handleRemoveArtist ────────────────────────────────────────────────────────

describe("handleRemoveArtist", () => {
  it("redirects to login without session", async () => {
    const f = vi.fn();
    const res = await handleRemoveArtist(
      postReq("/api/admin/booking/bk1/artists/remove", { artist_id: "a1" }),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("deletes booking_artists row and redirects to booking detail", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("/bookings?id=eq.bk1")) return Promise.resolve(json([{ id: "bk1", status: "quote_sent" }]));
      if (url.includes("/booking_artists?")) return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes("/audit_log")) return Promise.resolve(json({}));
      return Promise.resolve(json([]));
    });
    const res = await handleRemoveArtist(
      postReq("/api/admin/booking/bk1/artists/remove", { artist_id: "a1000000-0000-0000-0000-000000000001" }, token),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/booking/bk1?saved=1");
  });

  it("rejects missing artist_id with error redirect", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      return Promise.resolve(json([]));
    });
    const res = await handleRemoveArtist(
      postReq("/api/admin/booking/bk1/artists/remove", {}, token),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  });
});

// ── Widget render integration tests ──────────────────────────────────────────

const sampleBooking = {
  id: "bk-detail-01",
  reference: "LUS-2026-999",
  status: "quote_sent",
  bride_name: "Thandi Dlamini",
  bride_email: "thandi@example.com",
  bride_phone: "0821234567",
  wedding_date: "2027-05-10",
  town: "Pretoria",
  province: "Gauteng",
  venue: "The Rosewood",
  party_size: 5,
  total_cents: 500000,
  deposit_pct: 50,
  deposit_net_cents: 250000,
  balance_net_cents: 250000,
  occasion: "wedding",
  quote_lines: [],
  created_at: "2026-06-01T10:00:00Z",
  quote_sent_at: "2026-06-02T10:00:00Z",
  accepted_at: null,
  rejected_at: null,
  invoice_expired_at: null,
  availability_conflict: false,
  notes: null,
};

const sampleArtists = [
  { id: "a1000000-0000-0000-0000-000000000001", name: "Zandeline", email: "zandeline@lustiqueco.co.za", active: true, specialisms: ["bridal-hair"] },
  { id: "a1000000-0000-0000-0000-000000000006", name: "Elria",     email: "elria@lustiqueco.co.za",    active: true, specialisms: ["bridal-hair"] },
];

const sampleAssignments = [
  {
    id: "ba-001",
    booking_id: "bk-detail-01",
    artist_id: "a1000000-0000-0000-0000-000000000001",
    lead: true,
    confirmed_at: null,
    created_at: "2026-06-03T10:00:00Z",
    artists: { name: "Zandeline", email: "zandeline@lustiqueco.co.za" },
  },
];

describe("handleAdminBookingDetail — artist widget", () => {
  it("renders assigned artists section with lead badge", async () => {
    const token = await validAdminJwt();
    const f = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("/bookings?id=eq.bk-detail-01&select=id,reference")) return Promise.resolve(json([sampleBooking]));
      if (url.includes("/payments?")) return Promise.resolve(json([]));
      if (url.includes("/quote_revisions?")) return Promise.resolve(json([]));
      if (url.includes("/rejections?")) return Promise.resolve(json([]));
      if (url.includes("/booking_artists?")) return Promise.resolve(json(sampleAssignments));
      if (url.includes("/artists?")) return Promise.resolve(json(sampleArtists));
      return Promise.resolve(json([]));
    });
    const res = await handleAdminBookingDetail(
      getReq("/api/admin/booking/bk-detail-01", token),
      fullEnv,
      "bk-detail-01",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Artists");
    expect(html).toContain("Zandeline");
    expect(html).toContain("Lead");
  });

  it("renders assign form showing only unassigned artists", async () => {
    const token = await validAdminJwt();
    const f = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("/bookings?id=eq.bk-detail-01&select=id,reference")) return Promise.resolve(json([sampleBooking]));
      if (url.includes("/payments?")) return Promise.resolve(json([]));
      if (url.includes("/quote_revisions?")) return Promise.resolve(json([]));
      if (url.includes("/rejections?")) return Promise.resolve(json([]));
      if (url.includes("/booking_artists?")) return Promise.resolve(json(sampleAssignments));
      if (url.includes("/artists?")) return Promise.resolve(json(sampleArtists));
      return Promise.resolve(json([]));
    });
    const res = await handleAdminBookingDetail(
      getReq("/api/admin/booking/bk-detail-01", token),
      fullEnv,
      "bk-detail-01",
      f as unknown as typeof fetch,
    );
    const html = await res.text();
    // Elria is unassigned — should appear in the assign form dropdown
    expect(html).toContain("Elria");
    // Form action URL should be present
    expect(html).toContain('action="/api/admin/booking/bk-detail-01/artists"');
  });

  it("renders locked widget for deposit_paid booking", async () => {
    const token = await validAdminJwt();
    const depositBooking = { ...sampleBooking, status: "deposit_paid" };
    const f = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("/bookings?id=eq.bk-detail-01&select=id,reference")) return Promise.resolve(json([depositBooking]));
      if (url.includes("/payments?")) return Promise.resolve(json([]));
      if (url.includes("/quote_revisions?")) return Promise.resolve(json([]));
      if (url.includes("/rejections?")) return Promise.resolve(json([]));
      if (url.includes("/booking_artists?")) return Promise.resolve(json([]));
      if (url.includes("/artists?")) return Promise.resolve(json(sampleArtists));
      return Promise.resolve(json([]));
    });
    const res = await handleAdminBookingDetail(
      getReq("/api/admin/booking/bk-detail-01", token),
      fullEnv,
      "bk-detail-01",
      f as unknown as typeof fetch,
    );
    const html = await res.text();
    expect(html).toContain("Artist assignment locked");
  });
});
