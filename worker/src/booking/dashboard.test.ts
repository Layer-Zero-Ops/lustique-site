// worker/src/booking/dashboard.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  handleAdminLogin,
  handleAdminAuthCallback,
  handleAdminAuthLogout,
  handleAdminDashboard,
} from "./dashboard";
import { AUTH_COOKIE } from "./auth";

// ── JWT test helper (same pattern as auth.test.ts) ───────────────────────────

const TEST_JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintJwt(
  payload: Record<string, unknown>,
  secret = TEST_JWT_SECRET,
): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
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

const postReq = (path: string, body: Record<string, string>, cookie?: string) => {
  const headers: HeadersInit = { "content-type": "application/x-www-form-urlencoded" };
  if (cookie) headers["Cookie"] = `${AUTH_COOKIE}=${cookie}`;
  return new Request(`https://worker${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  });
};

// ── handleAdminLogin ─────────────────────────────────────────────────────────

describe("handleAdminLogin — GET", () => {
  it("renders the login form with an email input", async () => {
    const res = await handleAdminLogin(getReq("/api/admin/login"), env, vi.fn() as unknown as typeof fetch);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<form');
    expect(html).toContain('type="email"');
    expect(html).toContain('name="email"');
    expect(html).toContain("Lustique");
  });

  it("shows an info message from the ?msg= query param", async () => {
    const res = await handleAdminLogin(
      getReq("/api/admin/login?msg=check+your+email"),
      env,
      vi.fn() as unknown as typeof fetch,
    );
    const html = await res.text();
    expect(html).toContain("check your email");
  });

  it("noindex header is set", async () => {
    const res = await handleAdminLogin(getReq("/api/admin/login"), env, vi.fn() as unknown as typeof fetch);
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });
});

describe("handleAdminLogin — POST", () => {
  it("calls Supabase OTP and returns a success page", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }));
    const res = await handleAdminLogin(
      postReq("/api/admin/login", { email: "zandeline@lustiqueco.co.za" }),
      env,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("inbox");
    expect(f).toHaveBeenCalledOnce();
    const [url, opts] = (f as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/auth/v1/otp");
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.email).toBe("zandeline@lustiqueco.co.za");
    expect(body.create_user).toBe(false);
  });

  it("returns 400 for a missing or invalid email", async () => {
    const f = vi.fn();
    const res = await handleAdminLogin(
      postReq("/api/admin/login", { email: "" }),
      env,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns an error page when Supabase OTP fails", async () => {
    const f = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "User not found" }), { status: 422 }),
    );
    const res = await handleAdminLogin(
      postReq("/api/admin/login", { email: "notregistered@example.com" }),
      env,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("inbox");
    // We show the same "check email" message regardless (don't leak user-enumeration info)
  });
});

// ── handleAdminAuthCallback ──────────────────────────────────────────────────

describe("handleAdminAuthCallback", () => {
  it("redirects to login with error when token_hash is missing", async () => {
    const f = vi.fn();
    const res = await handleAdminAuthCallback(
      getReq("/api/admin/auth/callback"),
      env,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
    expect(f).not.toHaveBeenCalled();
  });

  it("redirects to dashboard and sets session cookie on valid token_hash", async () => {
    const fakeToken = await validAdminJwt();
    const f = vi.fn().mockResolvedValueOnce(
      json({ access_token: fakeToken, refresh_token: "ref-123", token_type: "bearer", expires_in: 3600 }),
    );
    const res = await handleAdminAuthCallback(
      getReq("/api/admin/auth/callback?token_hash=abc123&type=email"),
      env,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/dashboard");
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain(AUTH_COOKIE);
    expect(setCookie).toContain(fakeToken);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(f).toHaveBeenCalledOnce();
    const [url, opts] = (f as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/auth/v1/verify");
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.token_hash).toBe("abc123");
    expect(body.type).toBe("email");
  });

  it("redirects to login with error when Supabase verify fails", async () => {
    const f = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Invalid token" }), { status: 400 }),
    );
    const res = await handleAdminAuthCallback(
      getReq("/api/admin/auth/callback?token_hash=bad&type=email"),
      env,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });
});

// ── handleAdminAuthLogout ────────────────────────────────────────────────────

describe("handleAdminAuthLogout", () => {
  it("clears the session cookie and redirects to login", async () => {
    const res = await handleAdminAuthLogout(
      postReq("/api/admin/auth/logout", {}),
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/login");
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain(AUTH_COOKIE);
    expect(setCookie).toContain("Max-Age=0");
  });
});

// ── handleAdminDashboard ─────────────────────────────────────────────────────

describe("handleAdminDashboard", () => {
  it("redirects to login when no session cookie", async () => {
    const f = vi.fn();
    const res = await handleAdminDashboard(
      getReq("/api/admin/dashboard"),
      env,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
    expect(f).not.toHaveBeenCalled();
  });

  it("redirects to login when JWT is invalid", async () => {
    const f = vi.fn();
    const res = await handleAdminDashboard(
      getReq("/api/admin/dashboard", "not.a.valid.jwt"),
      env,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
    expect(f).not.toHaveBeenCalled();
  });

  it("renders the inbox with bookings when session is valid", async () => {
    const token = await validAdminJwt();
    const f = vi
      .fn()
      // 1st call: profiles check from getAdminSession
      .mockResolvedValueOnce(json([{ role: "admin", full_name: "Zandeline" }]))
      // 2nd call: bookings query
      .mockResolvedValueOnce(json([
        {
          id: "bb-1111", reference: "LUS-2026-111111",
          status: "requested", bride_name: "Anke van der Berg",
          wedding_date: "2027-11-14", town: "Hartbeespoort",
          party_size: 6, total_cents: 480000, created_at: "2026-06-10T09:00:00Z",
          availability_conflict: false,
        },
      ]));
    const res = await handleAdminDashboard(getReq("/api/admin/dashboard", token), env, f as unknown as typeof fetch);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Zandeline");
    expect(html).toContain("Anke van der Berg");
    expect(html).toContain("LUS-2026-111111");
    expect(html).toContain("Hartbeespoort");
    expect(html).toContain("requested");
  });

  it("shows 'no pending requests' when bookings list is empty", async () => {
    const token = await validAdminJwt();
    const f = vi
      .fn()
      .mockResolvedValueOnce(json([{ role: "admin", full_name: "Zandeline" }]))
      .mockResolvedValueOnce(json([]));
    const res = await handleAdminDashboard(getReq("/api/admin/dashboard", token), env, f as unknown as typeof fetch);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("no");
  });

  it("shows the nav links for all 7 dashboard views", async () => {
    const token = await validAdminJwt();
    const f = vi
      .fn()
      .mockResolvedValueOnce(json([{ role: "admin", full_name: "Zandeline" }]))
      .mockResolvedValueOnce(json([]));
    const res = await handleAdminDashboard(getReq("/api/admin/dashboard", token), env, f as unknown as typeof fetch);
    const html = await res.text();
    expect(html).toContain("/api/admin/dashboard");           // Inbox
    expect(html).toContain("/api/admin/quotes");             // Sent quotes
    expect(html).toContain("/api/admin/payments");           // Payments
    expect(html).toContain("/api/admin/rejections");         // Rejections
    expect(html).toContain("/api/admin/calendar");           // Calendar
    expect(html).toContain("/api/admin/templates");          // Templates
    expect(html).toContain("/api/admin/auth/logout");        // Logout
  });
});
