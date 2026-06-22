// worker/src/lib/rateLimit.ts
//
// Thin wrapper around the CF Workers Rate Limiting binding.
// All rate-limit policies are defined here as named constants — tune in one place.
//
// PERIOD CONSTRAINT (confirmed via CF docs 2026-06):
//   The [[ratelimits]] binding supports ONLY period=10 or period=60 (seconds).
//   Targets like "5/15min" or "3/hour" cannot be expressed natively as a single binding.
//   The 60s binding acts as a burst guard only.
//   True 15-min / 1-hour sliding windows require a Workers KV counter layer (Phase 2 — Task 5).
//
// Binding → limit (must match [[ratelimits]] stanzas in wrangler.toml):
//   RL_LOGIN        5 req / 60 s  POST /api/admin/login (IP key)
//   RL_LOGIN_EMAIL  5 req / 60 s  POST /api/admin/login (email key)
//   RL_BOOKING      3 req / 60 s  POST /api/booking/request (IP key)
//   RL_ENQUIRY     10 req / 60 s  POST /api/enquiry (IP key)
//   RL_ADMIN       60 req / 60 s  GET /api/admin/* + legacy ADMIN_SECRET routes (IP key)

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal shape of the CF Workers RateLimit binding (matches workerd's RateLimit). */
export interface RateLimitBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitPolicy {
  /**
   * The [[ratelimits]] `period` value in seconds (10 or 60).
   * Used to calculate the Retry-After response header.
   */
  periodSeconds: number;
}

export interface RateLimitResult {
  /** true = request is within the limit and may proceed */
  success: boolean;
  /** Suggested Retry-After value in seconds. 0 when success is true. */
  retryAfter: number;
}

// ── Named policy constants ────────────────────────────────────────────────────

export const RATE_LIMITS = {
  /** POST /api/admin/login — IP-keyed burst guard. */
  LOGIN_IP: { periodSeconds: 60 } satisfies RateLimitPolicy,

  /** POST /api/admin/login — email-keyed burst guard (distributed-OTP defence). */
  LOGIN_EMAIL: { periodSeconds: 60 } satisfies RateLimitPolicy,

  /** POST /api/booking/request — IP-keyed burst guard. */
  BOOKING: { periodSeconds: 60 } satisfies RateLimitPolicy,

  /** POST /api/enquiry — IP-keyed burst guard (belt-and-suspenders with Turnstile). */
  ENQUIRY: { periodSeconds: 60 } satisfies RateLimitPolicy,

  /** GET /api/admin/* and legacy ADMIN_SECRET routes — IP-keyed. 60/min is exact. */
  ADMIN: { periodSeconds: 60 } satisfies RateLimitPolicy,
} as const;

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Call the CF Workers Rate Limiting binding and return a normalised result.
 *
 * @param binding  The RateLimit binding from env (e.g. env.RL_LOGIN).
 * @param key      The rate-limit key (IP address, email, or composite).
 * @param policy   The matching entry from RATE_LIMITS (determines Retry-After).
 */
export async function checkRateLimit(
  binding: RateLimitBinding,
  key: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  const { success } = await binding.limit({ key });
  return {
    success,
    retryAfter: success ? 0 : policy.periodSeconds,
  };
}
