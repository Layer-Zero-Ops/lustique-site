// worker/src/booking/auth.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  verifySupabaseJwt,
  getCookieValue,
  getAdminSession,
  AUTH_COOKIE,
  type AdminUser,
} from "./auth";

// ── JWT test helper ──────────────────────────────────────────────────────────

const TEST_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

function base64url(buf: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintJwt(
  payload: Record<string, unknown>,
  secret = TEST_SECRET,
): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${base64url(sig)}`;
}

const VALID_PAYLOAD = {
  sub: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  email: "zandeline@lustiqueco.co.za",
  role: "authenticated",
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
};

// ── verifySupabaseJwt ────────────────────────────────────────────────────────

describe("verifySupabaseJwt", () => {
  it("returns null for a malformed token (not 3 parts)", async () => {
    expect(await verifySupabaseJwt("not.a.jwt.with.too.many.parts", TEST_SECRET)).toBeNull();
    expect(await verifySupabaseJwt("twosegments", TEST_SECRET)).toBeNull();
  });

  it("returns null when signature does not match", async () => {
    const valid = await mintJwt(VALID_PAYLOAD);
    const tampered = valid.slice(0, -4) + "XXXX";
    expect(await verifySupabaseJwt(tampered, TEST_SECRET)).toBeNull();
  });

  it("returns null when signed with a different secret", async () => {
    const token = await mintJwt(VALID_PAYLOAD, "other-secret-that-does-not-match!!!");
    expect(await verifySupabaseJwt(token, TEST_SECRET)).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const token = await mintJwt({
      ...VALID_PAYLOAD,
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    expect(await verifySupabaseJwt(token, TEST_SECRET)).toBeNull();
  });

  it("returns null when payload is not valid JSON", async () => {
    const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
    const bad = btoa("not-json").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(TEST_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${bad}`));
    const token = `${header}.${bad}.${base64url(sig)}`;
    expect(await verifySupabaseJwt(token, TEST_SECRET)).toBeNull();
  });

  it("returns the payload for a valid token", async () => {
    const token = await mintJwt(VALID_PAYLOAD);
    const payload = await verifySupabaseJwt(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe(VALID_PAYLOAD.sub);
    expect(payload!.email).toBe(VALID_PAYLOAD.email);
  });
});

// ── getCookieValue ───────────────────────────────────────────────────────────

describe("getCookieValue", () => {
  const req = (cookies: string) =>
    new Request("https://example.com", { headers: { Cookie: cookies } });

  it("returns null when there is no Cookie header", () => {
    expect(getCookieValue(new Request("https://example.com"), AUTH_COOKIE)).toBeNull();
  });

  it("returns null when the cookie is not present", () => {
    expect(getCookieValue(req("other=value"), AUTH_COOKIE)).toBeNull();
  });

  it("returns the value for a single matching cookie", () => {
    expect(getCookieValue(req(`${AUTH_COOKIE}=my-token`), AUTH_COOKIE)).toBe("my-token");
  });

  it("handles multiple cookies and returns the correct one", () => {
    expect(
      getCookieValue(req(`a=1; ${AUTH_COOKIE}=the-token; b=2`), AUTH_COOKIE),
    ).toBe("the-token");
  });

  it("handles cookie value that contains = (e.g. a base64 JWT)", () => {
    const value = "eyJ0.eyJz.abc=def=";
    expect(getCookieValue(req(`${AUTH_COOKIE}=${value}`), AUTH_COOKIE)).toBe(value);
  });
});

// ── getAdminSession ──────────────────────────────────────────────────────────

const baseEnv = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_KEY: "svc-key",
  SUPABASE_JWT_SECRET: TEST_SECRET,
};

const supaRes = (rows: unknown[], status = 200) =>
  new Response(JSON.stringify(rows), {
    status,
    headers: { "content-type": "application/json" },
  });

function reqWithSession(token: string): Request {
  return new Request("https://example.com", {
    headers: { Cookie: `${AUTH_COOKIE}=${token}` },
  });
}

describe("getAdminSession", () => {
  it("returns null when no session cookie is present", async () => {
    const f = vi.fn();
    const result = await getAdminSession(
      new Request("https://example.com"),
      baseEnv,
      f as unknown as typeof fetch,
    );
    expect(result).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns null when the JWT is invalid (bad signature)", async () => {
    const f = vi.fn();
    const result = await getAdminSession(
      reqWithSession("bad.jwt.token"),
      baseEnv,
      f as unknown as typeof fetch,
    );
    expect(result).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns null when the profiles lookup returns an error", async () => {
    const token = await mintJwt(VALID_PAYLOAD);
    const f = vi.fn().mockResolvedValueOnce(supaRes([], 500));
    const result = await getAdminSession(reqWithSession(token), baseEnv, f as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("returns null when the user has no profiles row", async () => {
    const token = await mintJwt(VALID_PAYLOAD);
    const f = vi.fn().mockResolvedValueOnce(supaRes([]));
    const result = await getAdminSession(reqWithSession(token), baseEnv, f as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("returns null when the user's role is 'artist', not 'admin'", async () => {
    const token = await mintJwt(VALID_PAYLOAD);
    const f = vi.fn().mockResolvedValueOnce(supaRes([{ role: "artist", full_name: "Leanie" }]));
    const result = await getAdminSession(reqWithSession(token), baseEnv, f as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("returns the AdminUser when JWT is valid and profile role is admin", async () => {
    const token = await mintJwt(VALID_PAYLOAD);
    const f = vi.fn().mockResolvedValueOnce(
      supaRes([{ role: "admin", full_name: "Zandeline" }]),
    );
    const result = await getAdminSession(reqWithSession(token), baseEnv, f as unknown as typeof fetch);
    expect(result).not.toBeNull();
    const user = result as AdminUser;
    expect(user.sub).toBe(VALID_PAYLOAD.sub);
    expect(user.email).toBe(VALID_PAYLOAD.email);
    expect(user.name).toBe("Zandeline");
    expect(f).toHaveBeenCalledOnce();
    const [url, opts] = (f as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/rest/v1/profiles");
    expect(url).toContain(VALID_PAYLOAD.sub);
    expect((opts as { headers: Record<string, string> }).headers["Authorization"]).toContain("svc-key");
  });

  it("falls back to 'Admin' when full_name is null in the profiles row", async () => {
    const token = await mintJwt(VALID_PAYLOAD);
    const f = vi.fn().mockResolvedValueOnce(supaRes([{ role: "admin", full_name: null }]));
    const result = await getAdminSession(reqWithSession(token), baseEnv, f as unknown as typeof fetch);
    expect((result as AdminUser).name).toBe("Admin");
  });
});
