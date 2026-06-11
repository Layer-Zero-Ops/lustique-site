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

/**
 * SHA-256 hash of the raw token — what gets stored in `confirm_token_hash`.
 * S3's verify step: decode the token from the URL, hash it, compare to the stored hash.
 */
export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return toHex(buf);
}
