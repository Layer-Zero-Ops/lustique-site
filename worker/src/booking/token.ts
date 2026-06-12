// worker/src/booking/token.ts
/**
 * Confirm-link token helpers (spec §12).
 * S2 signs tokens (stored as sha256 hash); S3 verifies them.
 *
 * Token format: base64url(booking_id|exp_iso|HMAC-SHA256(booking_id|exp_iso, SIGNING_SECRET))
 * Storage:      confirm_token_hash = sha256(raw_token)  — raw token only ever lives in the emailed URL
 *
 * Uses the Web Crypto API (available globally in both Workers and Node 19+/Vitest).
 */

const enc = new TextEncoder();

/** Converts an ArrayBuffer to a lowercase hex string. */
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return toHex(buf);
}

/**
 * Encodes a string to base64url (RFC 4648 §5).
 *
 * NOTE: `btoa` only accepts Latin-1 (code points 0–255). Callers must only
 * pass ASCII payloads. The token payload is always `uuid|iso_date|hmac_hex`,
 * all of which are ASCII, so this constraint is always satisfied.
 */
function toBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Sign a confirm token for the given booking.
 * Returns the raw token (base64url-encoded) — put this in the emailed URL, never in the DB.
 */
export async function signToken(
  bookingId: string,
  expiresAt: Date,
  secret: string,
): Promise<string> {
  const exp = expiresAt.toISOString();
  const payload = `${bookingId}|${exp}`;
  const hmac = await hmacHex(payload, secret);
  return toBase64Url(`${payload}|${hmac}`);
}

/** Decode a base64url string (inverse of toBase64Url). */
function fromBase64Url(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

/** Constant-time comparison of two hex strings (avoids leaking via early-exit). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a confirm token's authenticity: decode, split, recompute the HMAC and
 * constant-time compare. Returns { bookingId, expiresAt } if the signature is
 * valid, else null (malformed or tampered).
 *
 * Expiry is NOT enforced here — the caller compares expiresAt to now, so the UI
 * can distinguish "invalid" from "expired".
 */
export async function verifyToken(
  token: string,
  secret: string,
): Promise<{ bookingId: string; expiresAt: Date } | null> {
  let decoded: string;
  try {
    decoded = fromBase64Url(token);
  } catch {
    return null;
  }
  const parts = decoded.split("|");
  if (parts.length !== 3) return null;
  const [bookingId, exp, mac] = parts as [string, string, string];
  const expected = await hmacHex(`${bookingId}|${exp}`, secret);
  if (!timingSafeEqualHex(mac, expected)) return null;
  const expiresAt = new Date(exp);
  if (Number.isNaN(expiresAt.getTime())) return null;
  return { bookingId, expiresAt };
}

/**
 * SHA-256 hash of the raw token — what gets stored in `confirm_token_hash`.
 * S3's verify step: decode the token from the URL, hash it, compare to the stored hash.
 */
export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return toHex(buf);
}
