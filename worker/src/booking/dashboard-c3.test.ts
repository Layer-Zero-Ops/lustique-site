// worker/src/booking/dashboard-c3.test.ts
// Wave C.3 — notifications bell: GET /api/admin/notifications + POST /api/admin/notifications/read
import { describe, it, expect, vi } from "vitest";
import { handleAdminNotifications, handleAdminNotificationsRead } from "./dashboard";
import { AUTH_COOKIE } from "./auth";

// ── Shared JWT helpers ────────────────────────────────────────────────────────

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

const env = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_KEY: "svc-key",
  SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
  BREVO_API_KEY: "brevo-key",
  NOTIFY_EMAIL: "info@lustiqueco.co.za",
  ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  ADMIN_SECRET: "secret",
  SIGNING_SECRET: "signing",
  YOCO_SECRET_KEY: "yoco",
  YOCO_WEBHOOK_SECRET: "yoco-hook",
  TURNSTILE_SECRET: "ts",
  EFT_BANK: "", EFT_ACCOUNT_NAME: "", EFT_ACCOUNT_NO: "", EFT_BRANCH_CODE: "",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const getReq = (path: string, cookie?: string) => {
  const headers: HeadersInit = {};
  if (cookie) headers["Cookie"] = `${AUTH_COOKIE}=${cookie}`;
  return new Request(`https://worker${path}`, { headers });
};

const postJsonReq = (path: string, body: unknown, cookie?: string) => {
  const headers: HeadersInit = { "content-type": "application/json" };
  if (cookie) headers["Cookie"] = `${AUTH_COOKIE}=${cookie}`;
  return new Request(`https://worker${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

// Sample notification rows
const NOTIF_A = {
  id: "11111111-0000-0000-0000-000000000001",
  type: "booking_requested",
  title: "New booking request",
  body: "Alice Smith — 2026-12-15",
  link: "/api/admin/booking/aaa",
  booking_id: "aaa",
  created_at: "2026-06-19T10:00:00Z",
};
const NOTIF_B = {
  id: "22222222-0000-0000-0000-000000000002",
  type: "deposit_paid",
  title: "Deposit received",
  body: null,
  link: "/api/admin/booking/bbb",
  booking_id: "bbb",
  created_at: "2026-06-19T09:00:00Z",
};

// ── handleAdminNotifications (GET) ────────────────────────────────────────────

describe("handleAdminNotifications", () => {
  it("redirects to login when no cookie", async () => {
    const req = getReq("/api/admin/notifications");
    const res = await handleAdminNotifications(req, env, () => Promise.resolve(json({})));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns count:0 and empty items when no unread notifications", async () => {
    const token = await validAdminJwt();
    const req = getReq("/api/admin/notifications", token);

    let callCount = 0;
    const fetchFn = async (url: string) => {
      callCount++;
      if (callCount === 1) {
        // getAdminSession → /auth/v1/user
        return json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" });
      }
      if (callCount === 2) {
        // getAdminSession → profiles lookup
        return json([{ role: "admin", full_name: "Zandeline" }]);
      }
      // notifications query
      expect(url).toContain("notifications");
      expect(url).toContain("recipient=eq.admin");
      expect(url).toContain("read_at=is.null");
      return json([]);
    };

    const res = await handleAdminNotifications(req, env, fetchFn as typeof fetch);
    expect(res.status).toBe(200);
    const body = await res.json() as { count: number; items: unknown[] };
    expect(body.count).toBe(0);
    expect(body.items).toEqual([]);
  });

  it("returns count and items for unread notifications", async () => {
    const token = await validAdminJwt();
    const req = getReq("/api/admin/notifications", token);

    let callCount = 0;
    const fetchFn = async () => {
      callCount++;
      if (callCount === 1) {
        // getAdminSession → /auth/v1/user
        return json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" });
      }
      if (callCount === 2) {
        // getAdminSession → profiles lookup
        return json([{ role: "admin", full_name: "Zandeline" }]);
      }
      return json([NOTIF_A, NOTIF_B]);
    };

    const res = await handleAdminNotifications(req, env, fetchFn as typeof fetch);
    expect(res.status).toBe(200);
    const body = await res.json() as { count: number; items: typeof NOTIF_A[] };
    expect(body.count).toBe(2);
    expect(body.items[0]!.id).toBe(NOTIF_A.id);
    expect(body.items[1]!.id).toBe(NOTIF_B.id);
  });

  it("returns count:0 gracefully when Supabase fetch fails", async () => {
    const token = await validAdminJwt();
    const req = getReq("/api/admin/notifications", token);

    let callCount = 0;
    const fetchFn = async () => {
      callCount++;
      if (callCount === 1) {
        // getAdminSession → /auth/v1/user
        return json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" });
      }
      if (callCount === 2) {
        // getAdminSession → profiles lookup
        return json([{ role: "admin", full_name: "Zandeline" }]);
      }
      return new Response("Internal Server Error", { status: 500 });
    };

    const res = await handleAdminNotifications(req, env, fetchFn as typeof fetch);
    expect(res.status).toBe(200);
    const body = await res.json() as { count: number; items: unknown[] };
    expect(body.count).toBe(0);
    expect(body.items).toEqual([]);
  });
});

// ── handleAdminNotificationsRead (POST) ───────────────────────────────────────

describe("handleAdminNotificationsRead", () => {
  it("returns 405 for non-POST requests", async () => {
    const req = getReq("/api/admin/notifications/read");
    const res = await handleAdminNotificationsRead(req, env, () => Promise.resolve(json({})));
    expect(res.status).toBe(405);
  });

  it("returns 401 when not authenticated", async () => {
    const req = postJsonReq("/api/admin/notifications/read", {});
    const res = await handleAdminNotificationsRead(req, env, () => Promise.resolve(json({})));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("marks all unread as read when body has no id", async () => {
    const token = await validAdminJwt();
    const req = postJsonReq("/api/admin/notifications/read", {}, token);

    const patchedUrls: string[] = [];
    let callCount = 0;
    const fetchFn = async (url: string, opts?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        // getAdminSession → /auth/v1/user
        return json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" });
      }
      if (callCount === 2) {
        // getAdminSession → profiles lookup
        return json([{ role: "admin", full_name: "Zandeline" }]);
      }
      if (opts?.method === "PATCH") patchedUrls.push(url as string);
      return new Response(null, { status: 204 });
    };

    const res = await handleAdminNotificationsRead(req, env, fetchFn as typeof fetch);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(patchedUrls[0]).toContain("recipient=eq.admin");
    expect(patchedUrls[0]).toContain("read_at=is.null");
  });

  it("marks a single notification as read when valid UUID provided", async () => {
    const token = await validAdminJwt();
    const targetId = "11111111-0000-0000-0000-000000000001";
    const req = postJsonReq("/api/admin/notifications/read", { id: targetId }, token);

    const patchedUrls: string[] = [];
    let callCount = 0;
    const fetchFn = async (url: string, opts?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        // getAdminSession → /auth/v1/user
        return json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" });
      }
      if (callCount === 2) {
        // getAdminSession → profiles lookup
        return json([{ role: "admin", full_name: "Zandeline" }]);
      }
      if (opts?.method === "PATCH") patchedUrls.push(url as string);
      return new Response(null, { status: 204 });
    };

    const res = await handleAdminNotificationsRead(req, env, fetchFn as typeof fetch);
    expect(res.status).toBe(200);
    expect(patchedUrls[0]).toContain(`id=eq.${targetId}`);
  });

  it("marks all when a non-UUID id is provided (injection guard falls through to mark-all)", async () => {
    const token = await validAdminJwt();
    // Malformed / injection attempt — not a valid UUID
    const req = postJsonReq("/api/admin/notifications/read", { id: "'; DROP TABLE notifications;--" }, token);

    const patchedUrls: string[] = [];
    let callCount = 0;
    const fetchFn = async (url: string, opts?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        // getAdminSession → /auth/v1/user
        return json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" });
      }
      if (callCount === 2) {
        // getAdminSession → profiles lookup
        return json([{ role: "admin", full_name: "Zandeline" }]);
      }
      if (opts?.method === "PATCH") patchedUrls.push(url as string);
      return new Response(null, { status: 204 });
    };

    const res = await handleAdminNotificationsRead(req, env, fetchFn as typeof fetch);
    expect(res.status).toBe(200);
    // Falls through to mark-all (non-UUID rejected by guard)
    expect(patchedUrls[0]).toContain("recipient=eq.admin");
  });

  it("handles empty/invalid JSON body gracefully — marks all", async () => {
    const token = await validAdminJwt();
    const headers: HeadersInit = {
      "content-type": "application/json",
      "Cookie": `${AUTH_COOKIE}=${token}`,
    };
    const req = new Request("https://worker/api/admin/notifications/read", {
      method: "POST",
      headers,
      body: "not-json",
    });

    const patchedUrls: string[] = [];
    let callCount = 0;
    const fetchFn = async (url: string, opts?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        // getAdminSession → /auth/v1/user
        return json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" });
      }
      if (callCount === 2) {
        // getAdminSession → profiles lookup
        return json([{ role: "admin", full_name: "Zandeline" }]);
      }
      if (opts?.method === "PATCH") patchedUrls.push(url as string);
      return new Response(null, { status: 204 });
    };

    const res = await handleAdminNotificationsRead(req, env, fetchFn as typeof fetch);
    expect(res.status).toBe(200);
    expect(patchedUrls[0]).toContain("recipient=eq.admin");
  });
});
