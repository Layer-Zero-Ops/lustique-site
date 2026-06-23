// worker/src/booking/auth.ts
// Phase-1 admin auth: Supabase JWT verification + admin session gating.
// Replaces the shared ADMIN_SECRET for all new dashboard endpoints.

export const AUTH_COOKIE = "__Host-sb_session";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  exp: number;
  iat: number;
}

export interface AdminUser {
  sub: string;
  email: string;
  name: string;
}

export interface AuthEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_JWT_SECRET: string;
}

function base64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const raw = atob(b64 + pad);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Verify a Supabase HS256 JWT. Returns the payload, or null if invalid/expired. */
export async function verifySupabaseJwt(
  token: string,
  secret: string,
): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let payload: JwtPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(parts[1]!)),
    ) as JwtPayload;
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlDecode(parts[2]!),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return null;
  }

  return valid ? payload : null;
}

/** Extract a named cookie from the request's Cookie header. */
export function getCookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Verify the session cookie and confirm the user's profile role is 'admin'.
 * Returns AdminUser on success, null otherwise.
 * Pass a custom `fetchFn` for testing.
 *
 * Validates the token via Supabase's /auth/v1/user endpoint rather than
 * verifying the JWT signature locally — this removes the SUPABASE_JWT_SECRET
 * dependency and delegates token validity to Supabase (which owns the signing key).
 */
export async function getAdminSession(
  req: Request,
  env: AuthEnv,
  fetchFn: typeof fetch = fetch,
): Promise<AdminUser | null> {
  const token = getCookieValue(req, AUTH_COOKIE);
  if (!token) return null;

  const userRes = await fetchFn(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!userRes.ok) return null;
  const authUser = (await userRes.json()) as { id: string; email: string };
  if (!authUser.id) return null;

  const res = await fetchFn(
    `${env.SUPABASE_URL}/rest/v1/profiles?select=role,full_name&id=eq.${authUser.id}&limit=1`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!res.ok) return null;

  const rows = (await res.json()) as Array<{ role: string; full_name: string | null }>;
  if (!rows.length || rows[0]!.role !== "admin") return null;

  return { sub: authUser.id, email: authUser.email, name: rows[0]!.full_name ?? "Admin" };
}

/** Session cookie attributes for Set-Cookie. */
export function sessionCookieHeader(token: string, maxAgeSec = 3600): string {
  return `${AUTH_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}

/** Clear the session cookie (sets Max-Age=0). */
export function clearSessionCookieHeader(): string {
  return `${AUTH_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/** Redirect to the admin login page, optionally with a message. */
export function loginRedirect(msg?: string): Response {
  const loc = msg ? `/api/admin/login?msg=${encodeURIComponent(msg)}` : "/api/admin/login";
  return new Response(null, { status: 302, headers: { Location: loc } });
}
