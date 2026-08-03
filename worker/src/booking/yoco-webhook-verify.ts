// worker/src/booking/yoco-webhook-verify.ts
/**
 * Standard Webhooks signature verification for Yoco payment webhooks.
 *
 * Spec: https://www.standardwebhooks.com/
 *   Signed content = "${webhookId}.${webhookTimestamp}.${rawBody}"
 *   Signature header = one or more "v1,<base64>" values separated by spaces.
 *   Timestamp must be within 3 minutes of now (replay protection).
 *
 * If the spec evolves or a maintained library becomes Workers-safe,
 * replace the internals of this module; the exported contract stays the same.
 */

const enc = new TextEncoder();

/**
 * Decode the webhook secret. Yoco dispatches it with a "whsec_" prefix
 * whose value is base64-encoded key bytes. Strip the prefix then
 * base64-decode; fall back to UTF-8 for un-prefixed plain strings.
 */
export function decodeSecret(secret: string): Uint8Array {
  const b64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return enc.encode(secret);
  }
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface VerifyOptions {
  /** Epoch seconds window for replay protection. Default: 180s. */
  toleranceSeconds?: number;
  /** Clock source for tests. Defaults to Date.now. */
  nowMs?: () => number;
}

/**
 * Verify a Standard Webhooks signature.
 *
 * @param rawBody        Raw request body string.
 * @param webhookId      webhook-id header value.
 * @param webhookTimestamp webhook-timestamp header value (epoch seconds).
 * @param sigHeader      webhook-signature header value.
 * @param secret         webhook secret from env.
 * @param options        optional overrides for tolerance / clock.
 * @returns true if valid; false otherwise.
 */
export async function verifyStandardWebhook(
  rawBody: string,
  webhookId: string,
  webhookTimestamp: string,
  sigHeader: string,
  secret: string,
  options: VerifyOptions = {},
): Promise<boolean> {
  const tolerance = options.toleranceSeconds ?? 3 * 60;
  const now = options.nowMs ? options.nowMs() : Date.now();

  // Reject stale timestamps (±tolerance)
  const ts = parseInt(webhookTimestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts * 1000) > tolerance * 1000) return false;

  const keyBytes = decodeSecret(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const toSign = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(toSign));
  const computed = btoa(String.fromCharCode(...new Uint8Array(buf)));

  // Header may contain multiple "v1,<base64>" entries — accept any one
  return sigHeader.split(" ").some((part) => {
    if (!part.startsWith("v1,")) return false;
    return timingSafeEqual(computed, part.slice(3));
  });
}
