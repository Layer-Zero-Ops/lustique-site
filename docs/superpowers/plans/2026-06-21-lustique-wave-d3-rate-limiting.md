# Wave D3 — Worker Rate Limiting Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (- [ ]) syntax.

**Goal:** Add Cloudflare Workers Rate Limiting bindings to protect all live `/api/*` endpoints against abuse, satisfying the Wave D3 security requirement before D1 (Sanity CMS), D4 (artist allocation), and D2 (Google Calendar) are built.

> ## ⚠️ Build corrections (adversarial review — apply these; they OVERRIDE any conflicting inline text below)
> 1. **No `tsc --noEmit` without a config** — `worker/` has no `tsconfig.json` (and there is no root one). `typescript ^5.6.0` *is* a worker devDep, so either add a minimal `worker/tsconfig.json` — `{ "compilerOptions": { "target": "ES2022", "module": "ES2022", "moduleResolution": "Bundler", "strict": true, "noEmit": true, "lib": ["ES2022"], "types": [] }, "include": ["src"] }` — so `npx tsc --noEmit` resolves only `worker/src`, OR replace every `npx tsc --noEmit` step with `npx wrangler deploy --dry-run`.
> 2. **One `RL_ADMIN` check, not two** — steps 3g + 3h both fire for the four legacy `ADMIN_SECRET` routes when `SUPABASE_JWT_SECRET` is set, consuming two `RL_ADMIN` tokens per request (halves the admin budget to ~30/min). Move a SINGLE `RL_ADMIN` check to immediately **before** the `if (env.SUPABASE_JWT_SECRET)` block so it covers all `/api/admin/*` once, and delete the step-3h duplicate.
> 3. **`worker.fetch` arity** — `index.ts` exports `fetch(req, env)` (2 params) but `index.test.ts` calls it with 3 (`..., {} as ExecutionContext`). Widen the signature to `fetch(req, env, ctx?: ExecutionContext)` (preferred — matches the CF interface) or drop the 3rd arg in the test.
> 4. **`[[ratelimits]]` syntax = verify at build** — confirm the exact field name (`name` vs `binding`) and whether `namespace_id` is a quoted string or a bare integer against the installed wrangler via `npx wrangler deploy --dry-run` BEFORE locking the stanza; CF has accepted both historically. The namespace_id-collision Pieter action already covers the deploy-time check.
> 5. **Cosmetic:** fix the `it()`-count comment in step 3j ("(9)" but 11 tests exist); the step-3i "zero earlier insertions" parenthetical is stale (3f–3h already shifted lines — the unique text anchor still works).

**Architecture:** Four named `[[ratelimits]]` bindings are declared in `worker/wrangler.toml`; a new helper `worker/src/lib/rateLimit.ts` wraps each binding's `.limit()` call and emits a consistent `{ success, retryAfter }` shape; `worker/src/index.ts` calls the helper immediately before dispatching to each protected handler, and `handleAdminLogin` in `worker/src/booking/dashboard.ts` receives the login-email binding so it can additionally key by submitted email. All 429 responses flow through the existing `json()` helper so they carry the project's CORS + security headers.

**Tech Stack:**
- Cloudflare Workers Runtime (rate limiting binding, free tier)
- `wrangler` CLI — `wrangler types` regenerates `worker/worker-configuration.d.ts` after binding changes
- Vitest — unit tests co-located with source; `npm run test` in `worker/`
- TypeScript — strict, no `any`

---

## Global Constraints

These rules apply to every task in this plan unchanged.

1. **Test runner:** Vitest (`vitest run`). Test files co-located with source (e.g. `worker/src/lib/rateLimit.test.ts`). Run via `cd worker && npm run test` (or `npx vitest run <path>`). Smoke-test variant: `npm run smoke`.
2. **Security headers:** every Worker JSON response goes through the existing `json(data, status, origin)` helper in `index.ts` (which calls `secHeaderMap({ html: false })`). The 429 must use this helper — no ad-hoc `new Response(...)` for error paths.
3. **Money rule:** `shared/pricing` (`@lustique/pricing`) is **not touched**. No pricing logic changes.
4. **Migration numbering:** no Supabase migration required for this wave. The highest existing migration is `0012_review_email.sql`. If a future task in this wave unexpectedly needs a migration it must be numbered `0013_*.sql`.
5. **Naming / voice:** binding names are `SCREAMING_SNAKE_CASE` to match `AUDIT`. The 429 error message uses plain English consistent with existing error strings (e.g. `"Too many requests. Please try again later."`).
6. **No `npm install`** in the sandbox — Pieter runs installs. If a new package were needed (it is not for this wave), flag it as a Pieter action.
7. **`wrangler types` must be re-run by Pieter** after every `wrangler.toml` binding change to regenerate `worker-configuration.d.ts`. Until it is re-run, TypeScript will not know about the new `RateLimit` binding types. The plan accounts for this: tests mock the binding objects, so the build compiles before `wrangler types` is re-run.

---

## Architecture Decisions

Each decision answers one of the required "Opus must answer" questions plus the adversarial-review corrections.

### AD-1 — wrangler.toml `[[ratelimits]]` stanza syntax

**Confirmed via context7 CF Workers docs (https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit).**

The correct field name for the binding is **`name`**. This is the field that CF Workers uses to inject the object into the `Env` interface. The canonical wrangler.toml shape is:

```toml
[[ratelimits]]
name         = "RL_LOGIN"
namespace_id = "1001"

  [ratelimits.simple]
    limit  = 5
    period = 60
```

There is no `binding =` field in `[[ratelimits]]` — the `name` field serves the same purpose that `binding` serves in `[[r2_buckets]]`. Do not mix the two shapes.

**`namespace_id` semantics:** The `namespace_id` is an arbitrary positive integer string you choose at configuration time. Cloudflare creates (or reuses) the corresponding namespace in your account on the **first `wrangler deploy`**. It does not need to be pre-created in the CF dashboard, and you cannot query existing namespace IDs before deploying. The integers must be unique per binding within your CF account across all Workers. **Pieter action (P-2):** after first `wrangler deploy`, verify in the CF dashboard (Workers → `lustique-form-handler` → Settings → Bindings) that all five `RL_*` bindings appear. If a `namespace_id` collides with another Worker's namespace in the account, increment all five by 100 (`1101`–`1105`) and redeploy.

### AD-2 — Period constraint and window approximation

**Confirmed via context7:** The CF Workers Rate Limiting binding supports **only `period = 10` (10 seconds) or `period = 60` (60 seconds)**. There is no native 15-minute or 1-hour window.

Policy targets and their implementation:

| Endpoint | Target policy | Binding limit | Effective granularity |
|---|---|---|---|
| POST /api/admin/login | 5 / 15 min | 5 req / 60 s (RL_LOGIN + RL_LOGIN_EMAIL) | 60 s burst guard; true 15-min window via KV — Phase 2 |
| POST /api/booking/request | 3 / hour | 3 req / 60 s (RL_BOOKING) | 60 s burst guard; true 1-hour window via KV — Phase 2 |
| POST /api/enquiry | 10 / hour | 10 req / 60 s (RL_ENQUIRY) | 60 s burst guard; true 1-hour window via KV — Phase 2 |
| GET /api/admin/* | 60 / min | 60 req / 60 s (RL_ADMIN) | Exact — 60 s is the target period |
| POST /api/booking/yoco-webhook | exempt | No binding checked | — |

> **No KV binding exists today** (`worker-configuration.d.ts` shows only `AUDIT: R2Bucket`). The true 15-min / 1-hour windows via KV are documented but **deferred to Task 5 (Phase 2)**. Tasks 1–4 implement the `[[ratelimits]]` bindings, which alone satisfy the Wave D3 security requirement.

### AD-3 — Middleware location

A single helper `worker/src/lib/rateLimit.ts` exports `checkRateLimit(binding, key, policy)`. The `RateLimit` CF built-in type is available after `wrangler types`. In tests, the binding is mocked as `{ limit: vi.fn().mockResolvedValue({ success: true }) }`. The helper is called in `index.ts` at the router level **before** handler dispatch — the body is not consumed before the rate-limit check, avoiding the double-consume risk.

### AD-4 — 429 response shape

```json
{ "ok": false, "error": "Too many requests. Please try again later." }
```

Delivered via the existing `json(data, status, origin)` helper so it carries CORS + security headers. A `Retry-After: <seconds>` header is added on top via `rate429()`. This matches the existing Worker error shape (`{ ok: false, error: string }`). The `handleAdminLogin` 429 is HTML (browser-facing; see Task 4) with the same `Retry-After` header.

### AD-5 — Keying strategy

- All protected routes: keyed by `CF-Connecting-IP` header (falls back to `"unknown"` in local dev/tests where the header is absent).
- POST /api/admin/login **additionally** keyed by submitted email on `RL_LOGIN_EMAIL`, to blunt distributed OTP abuse from many IPs. The email key is extracted **after** the body is parsed but **before** the Supabase OTP call.
- The IP key is checked first (in `index.ts`); if it fails, the handler never runs. The email key is checked second (inside `handleAdminLogin`); if it fails, the OTP call is skipped.

### AD-6 — Production vs staging

Single environment — `wrangler.toml` has no `[env.staging]` block. All limits apply identically to `lustiqueco.co.za/api/*`. To differ limits later: add `[[env.staging.ratelimits]]` sections and deploy with `--env staging`. No action required now.

### AD-7 — Legacy ADMIN_SECRET routes coverage

The four legacy ADMIN_SECRET routes in `index.ts` lines 330–347 (in the **original** unmodified file) sit **outside** the `if (env.SUPABASE_JWT_SECRET)` JWT block (lines 264–326):

```
line 330: /api/admin/blocked-dates
line 335: /api/admin/accounting
line 340: /api/admin/invoices
line 345: /api/admin/quote-pdf
```

These are **not** covered by rate-limiting the JWT block alone. Task 3 (sub-step 3i) adds an `RL_ADMIN` check immediately before the first legacy route, covering all four with one guard.

### AD-8 — `handleAdminLogin` body-consumption safety

`handleAdminLogin` parses the request body itself (`req.formData()` then `req.text()` fallback). The IP-keyed rate-limit check for login is applied at the **router level in `index.ts`** (before the handler is called), using only the `CF-Connecting-IP` header — the body is untouched. The email-keyed second check is applied **inside** `handleAdminLogin` **after** the body is parsed (email is in hand). This is the only safe ordering and avoids consuming the body twice.

---

## File Structure

| Status | Path | Responsibility |
|---|---|---|
| **Create** | `worker/src/lib/rateLimit.ts` | `checkRateLimit(binding, key, policy)` helper + `RATE_LIMITS` constants; no external deps |
| **Create** | `worker/src/lib/rateLimit.test.ts` | Unit tests for the helper (pass, block, retryAfter, period values) |
| **Modify** | `worker/wrangler.toml` | Add five `[[ratelimits]]` stanzas (RL_LOGIN, RL_LOGIN_EMAIL, RL_BOOKING, RL_ENQUIRY, RL_ADMIN) |
| **Modify** | `worker/src/index.ts` | Import rateLimit helpers; add `RL_*` fields to `Env`; add `rate429()` helper; call `checkRateLimit` before each protected route |
| **Create** | `worker/src/index.test.ts` | 429 behaviour tests for all rate-limited route groups |
| **Modify** | `worker/src/booking/dashboard.ts` | Import rateLimit helpers; add `RL_LOGIN_EMAIL?` to `DashboardEnv`; add email-key check inside `handleAdminLogin` POST path |
| **Create** | `worker/src/booking/dashboard.rateLimit.test.ts` | Tests for email-keyed rate limit inside `handleAdminLogin` |
| **Regenerated** | `worker/worker-configuration.d.ts` | Regenerated by `wrangler types` (Pieter action — not hand-edited) |

---

## Task 1 — Create `worker/src/lib/rateLimit.ts` and its unit tests

**Files:**
- Create: `worker/src/lib/rateLimit.ts`
- Create: `worker/src/lib/rateLimit.test.ts`

**Interfaces:**

Consumes:
```ts
// CF built-in type (available after `wrangler types`; mocked in tests)
interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}
```

Produces:
```ts
export interface RateLimitBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}
export interface RateLimitPolicy {
  periodSeconds: number;
}
export interface RateLimitResult {
  success: boolean;
  retryAfter: number;
}
export async function checkRateLimit(
  binding: RateLimitBinding,
  key: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult>
export const RATE_LIMITS: {
  LOGIN_IP:    RateLimitPolicy;
  LOGIN_EMAIL: RateLimitPolicy;
  BOOKING:     RateLimitPolicy;
  ENQUIRY:     RateLimitPolicy;
  ADMIN:       RateLimitPolicy;
}
```

---

- [ ] **Step 1 — Write the failing test**

Create `worker/src/lib/rateLimit.test.ts` with the following complete content:

```ts
// worker/src/lib/rateLimit.test.ts
import { describe, it, expect, vi } from "vitest";
import { checkRateLimit, RATE_LIMITS } from "./rateLimit";

function makeBinding(success: boolean) {
  return { limit: vi.fn().mockResolvedValue({ success }) };
}

describe("checkRateLimit", () => {
  it("returns success:true when binding allows the request", async () => {
    const binding = makeBinding(true);
    const result = await checkRateLimit(binding, "1.2.3.4", RATE_LIMITS.LOGIN_IP);
    expect(result.success).toBe(true);
    expect(binding.limit).toHaveBeenCalledOnce();
    expect(binding.limit).toHaveBeenCalledWith({ key: "1.2.3.4" });
  });

  it("returns success:false when binding blocks the request", async () => {
    const binding = makeBinding(false);
    const result = await checkRateLimit(binding, "1.2.3.4", RATE_LIMITS.LOGIN_IP);
    expect(result.success).toBe(false);
  });

  it("returns retryAfter equal to policy.periodSeconds when blocked", async () => {
    const binding = makeBinding(false);
    const result = await checkRateLimit(binding, "x", RATE_LIMITS.LOGIN_IP);
    expect(result.retryAfter).toBe(RATE_LIMITS.LOGIN_IP.periodSeconds);
  });

  it("returns retryAfter 0 when not blocked", async () => {
    const binding = makeBinding(true);
    const result = await checkRateLimit(binding, "x", RATE_LIMITS.ADMIN);
    expect(result.retryAfter).toBe(0);
  });

  it("BOOKING period is 60s", () => {
    expect(RATE_LIMITS.BOOKING.periodSeconds).toBe(60);
  });

  it("ENQUIRY period is 60s", () => {
    expect(RATE_LIMITS.ENQUIRY.periodSeconds).toBe(60);
  });

  it("ADMIN period is 60s", () => {
    expect(RATE_LIMITS.ADMIN.periodSeconds).toBe(60);
  });

  it("LOGIN_IP period is 60s", () => {
    expect(RATE_LIMITS.LOGIN_IP.periodSeconds).toBe(60);
  });

  it("LOGIN_EMAIL period is 60s", () => {
    expect(RATE_LIMITS.LOGIN_EMAIL.periodSeconds).toBe(60);
  });
});
```

- [ ] **Step 2 — Run the test (expect FAIL — module not found)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker" && npx vitest run src/lib/rateLimit.test.ts
```

Expected output: `Error: Cannot find module './rateLimit'`. The suite fails because the implementation file does not exist yet.

- [ ] **Step 3 — Implement `worker/src/lib/rateLimit.ts`**

Create `worker/src/lib/rateLimit.ts` with the following complete content:

```ts
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
```

- [ ] **Step 4 — Run tests (expect PASS)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker" && npx vitest run src/lib/rateLimit.test.ts
```

Expected output:
```
✓ src/lib/rateLimit.test.ts (9)
Test Files  1 passed (1)
```

- [ ] **Step 5 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique" && git add worker/src/lib/rateLimit.ts worker/src/lib/rateLimit.test.ts && git commit -m "feat(worker): add checkRateLimit helper + RATE_LIMITS constants (D3)"
```

---

## Task 2 — Add `[[ratelimits]]` stanzas to `worker/wrangler.toml`

**Files:**
- Modify: `worker/wrangler.toml` (add five `[[ratelimits]]` stanzas between the `[[r2_buckets]]` block and the `[triggers]` block)

**Interfaces:**

Consumes: the current `worker/wrangler.toml` ending with:

```toml
[[r2_buckets]]
binding = "AUDIT"
bucket_name = "lustique-audit"

[triggers]
crons = ["0 6 * * *"]   # 06:00 UTC ≈ 08:00 SAST — keep-warm now; balance sweep in S5
```

Produces: five additional bindings (`RL_LOGIN`, `RL_LOGIN_EMAIL`, `RL_BOOKING`, `RL_ENQUIRY`, `RL_ADMIN`) available in `env` at runtime.

---

> **Sub-step ordering note:** apply sub-steps in document order — Step 2a (TOML edit) first, then Step 2b (`wrangler types` re-run). Do not skip 2b.

- [ ] **Step 1 — No failing unit test (configuration-only step)**

This task modifies a configuration file. The verification is that `wrangler types` regenerates the `Env` interface correctly (checked in Step 2b) and `tsc --noEmit` passes (Step 3).

- [ ] **Step 2a — Edit `worker/wrangler.toml`**

The file currently ends with these lines (exact text — use this as the insertion anchor):

```toml
# Booking core (S1):
[[r2_buckets]]
binding = "AUDIT"
bucket_name = "lustique-audit"

[triggers]
crons = ["0 6 * * *"]   # 06:00 UTC ≈ 08:00 SAST — keep-warm now; balance sweep in S5
```

Replace that entire block with the following (the `[[r2_buckets]]` stanza is reproduced here only for context — do not duplicate it; replace it in place):

```toml
# Booking core (S1):
[[r2_buckets]]
binding = "AUDIT"
bucket_name = "lustique-audit"

# Wave D3 — Rate Limiting bindings (CF Workers free tier).
#
# SYNTAX NOTE: [[ratelimits]] uses `name =` (not `binding =`).
# The `name` value becomes the property name on the Env interface, just as
# `binding` does for [[r2_buckets]]. These two stanza types use different field names.
#
# PERIOD CONSTRAINT: only period=10 or period=60 (seconds) is supported.
# Targets like "5/15min" or "3/hour" use the 60s binding as a burst guard only.
# True sliding-window limits require a KV counter layer (Phase 2 — see Task 5).
#
# namespace_id: arbitrary positive integers unique within this CF account.
# CF creates the namespace on first `wrangler deploy`.
# After deploy, confirm all five RL_* bindings appear in:
#   CF dashboard → Workers → lustique-form-handler → Settings → Bindings
# If a namespace_id collides with another Worker in this account, increment all by 100 and redeploy.
#
# Limits (must match RATE_LIMITS constants in worker/src/lib/rateLimit.ts):
#   RL_LOGIN        5 req / 60 s  — POST /api/admin/login (IP key)
#   RL_LOGIN_EMAIL  5 req / 60 s  — POST /api/admin/login (email key)
#   RL_BOOKING      3 req / 60 s  — POST /api/booking/request (IP key)
#   RL_ENQUIRY     10 req / 60 s  — POST /api/enquiry (IP key)
#   RL_ADMIN       60 req / 60 s  — GET /api/admin/* + legacy ADMIN_SECRET routes (IP key)

[[ratelimits]]
name         = "RL_LOGIN"
namespace_id = "1001"

  [ratelimits.simple]
    limit  = 5
    period = 60

[[ratelimits]]
name         = "RL_LOGIN_EMAIL"
namespace_id = "1002"

  [ratelimits.simple]
    limit  = 5
    period = 60

[[ratelimits]]
name         = "RL_BOOKING"
namespace_id = "1003"

  [ratelimits.simple]
    limit  = 3
    period = 60

[[ratelimits]]
name         = "RL_ENQUIRY"
namespace_id = "1004"

  [ratelimits.simple]
    limit  = 10
    period = 60

[[ratelimits]]
name         = "RL_ADMIN"
namespace_id = "1005"

  [ratelimits.simple]
    limit  = 60
    period = 60

[triggers]
crons = ["0 6 * * *"]   # 06:00 UTC ≈ 08:00 SAST — keep-warm now; balance sweep in S5
```

- [ ] **Step 2b — Run `wrangler types` (Pieter action — required before TypeScript compilation)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker" && npx wrangler types
```

Expected: `worker-configuration.d.ts` is regenerated. The `__BaseEnv_Env` interface gains five new `RateLimit` fields:

```ts
RL_LOGIN:       RateLimit;
RL_LOGIN_EMAIL: RateLimit;
RL_BOOKING:     RateLimit;
RL_ENQUIRY:     RateLimit;
RL_ADMIN:       RateLimit;
```

If `wrangler types` errors (e.g. network unavailable), add these five fields manually to the `Env` interface in `worker/src/index.ts` (as shown in Task 3 Step 3d) and proceed. The TypeScript compiler uses `index.ts`'s `Env` interface for all handler type-checking; `worker-configuration.d.ts` is supplemental.

- [ ] **Step 3 — Verify TypeScript compiles (build check)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker" && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique" && git add worker/wrangler.toml worker/worker-configuration.d.ts && git commit -m "feat(worker): declare RL_* rate-limiting bindings in wrangler.toml (D3)"
```

---

## Task 3 — Wire rate-limit checks into `worker/src/index.ts`

Sub-steps are applied in document order (3a through 3m). Each insertion anchor quotes the surrounding lines exactly as they appear in the **unmodified current source** to prevent ambiguity.

**Files:**
- Modify: `worker/src/index.ts` (import, Env extension, rate429 helper, six route-level insertions)
- Create: `worker/src/index.test.ts` (new test file for 429 behaviour)

**Interfaces:**

Consumes:
- `checkRateLimit`, `RATE_LIMITS`, `RateLimitBinding` from `./lib/rateLimit`

Produces:
- 429 `{ ok: false, error: "Too many requests. Please try again later." }` with `Retry-After` header for each rate-limited route

---

- [ ] **Step 3a — Write the failing 429 test**

Create `worker/src/index.test.ts` with the following complete content:

```ts
// worker/src/index.test.ts
// Tests for rate-limiting behaviour wired in index.ts.

import { describe, it, expect, vi } from "vitest";
import worker from "./index";

// ── Env factory ──────────────────────────────────────────────────────────────

function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    BREVO_API_KEY: "brevo",
    NOTIFY_EMAIL: "z@lustiqueco.co.za",
    ALLOWED_ORIGIN: "https://lustiqueco.co.za",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_KEY: "svc",
    SUPABASE_JWT_SECRET: "jwt-secret",
    YOCO_SECRET_KEY: "yoco",
    YOCO_WEBHOOK_SECRET: "whsec",
    SIGNING_SECRET: "signing",
    TURNSTILE_SECRET: "ts",
    EFT_BANK: "FNB",
    EFT_ACCOUNT_NAME: "Lustique",
    EFT_ACCOUNT_NO: "12345",
    EFT_BRANCH_CODE: "250655",
    ADMIN_SECRET: "admin-secret",
    AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
    // All RL bindings PASS by default
    RL_LOGIN:       { limit: vi.fn().mockResolvedValue({ success: true }) },
    RL_LOGIN_EMAIL: { limit: vi.fn().mockResolvedValue({ success: true }) },
    RL_BOOKING:     { limit: vi.fn().mockResolvedValue({ success: true }) },
    RL_ENQUIRY:     { limit: vi.fn().mockResolvedValue({ success: true }) },
    RL_ADMIN:       { limit: vi.fn().mockResolvedValue({ success: true }) },
    ...overrides,
  };
}

function makeReq(method: string, pathname: string, body?: unknown, ip = "1.2.3.4") {
  return new Request(`https://worker${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Rate limiting — POST /api/booking/request", () => {
  it("returns 429 with correct JSON when RL_BOOKING blocks", async () => {
    const env = baseEnv({ RL_BOOKING: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("POST", "/api/booking/request", { brideName: "Test" });
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(429);
    const data = await resp.json() as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Too many requests. Please try again later.");
  });

  it("includes Retry-After header when RL_BOOKING blocks", async () => {
    const env = baseEnv({ RL_BOOKING: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("POST", "/api/booking/request", {});
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.headers.get("retry-after")).toBe("60");
  });
});

describe("Rate limiting — POST /api/enquiry", () => {
  it("returns 429 with correct JSON when RL_ENQUIRY blocks", async () => {
    const env = baseEnv({ RL_ENQUIRY: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("POST", "/api/enquiry", { name: "Test", email: "t@t.com", hp_company: "" });
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(429);
    const data = await resp.json() as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Too many requests. Please try again later.");
  });

  it("includes Retry-After header when RL_ENQUIRY blocks", async () => {
    const env = baseEnv({ RL_ENQUIRY: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("POST", "/api/enquiry", {});
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.headers.get("retry-after")).toBe("60");
  });
});

describe("Rate limiting — POST /api/admin/login", () => {
  it("returns 429 JSON when RL_LOGIN blocks (IP check fires before handler)", async () => {
    const env = baseEnv({ RL_LOGIN: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("POST", "/api/admin/login", null);
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(429);
    const data = await resp.json() as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Too many requests. Please try again later.");
  });

  it("includes Retry-After header when RL_LOGIN blocks", async () => {
    const env = baseEnv({ RL_LOGIN: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("POST", "/api/admin/login", null);
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.headers.get("retry-after")).toBe("60");
  });
});

describe("Rate limiting — GET /api/admin/* (JWT block)", () => {
  it("returns 429 JSON when RL_ADMIN blocks on GET /api/admin/dashboard", async () => {
    const env = baseEnv({ RL_ADMIN: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("GET", "/api/admin/dashboard");
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(429);
    const data = await resp.json() as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Too many requests. Please try again later.");
  });
});

describe("Rate limiting — legacy ADMIN_SECRET routes", () => {
  it("returns 429 JSON when RL_ADMIN blocks on GET /api/admin/blocked-dates", async () => {
    const env = baseEnv({ RL_ADMIN: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("GET", "/api/admin/blocked-dates");
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(429);
    const data = await resp.json() as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Too many requests. Please try again later.");
  });

  it("returns 429 JSON when RL_ADMIN blocks on GET /api/admin/accounting", async () => {
    const env = baseEnv({ RL_ADMIN: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("GET", "/api/admin/accounting");
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(429);
  });
});

describe("Rate limiting — Yoco webhook is exempt", () => {
  it("does NOT apply RL_BOOKING to POST /api/booking/yoco-webhook", async () => {
    const rlBooking = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const env = baseEnv({ RL_BOOKING: rlBooking });
    // Webhook will fail validation (no sig header) but must not return 429
    const req = makeReq("POST", "/api/booking/yoco-webhook", {});
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).not.toBe(429);
    expect(rlBooking.limit).not.toHaveBeenCalled();
  });
});

describe("Rate limiting — passes through when binding allows", () => {
  it("does not 429 /api/booking/request when RL_BOOKING passes (handler may 422 on bad body)", async () => {
    const env = baseEnv();
    const req = makeReq("POST", "/api/booking/request", { brideName: "x" });
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).not.toBe(429);
  });
});
```

- [ ] **Step 3b — Run the failing test**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker" && npx vitest run src/index.test.ts
```

Expected: all tests fail — either TypeScript errors (`RL_BOOKING` not in `Env`) or the rate-limit checks have not been wired yet.

- [ ] **Step 3c — Add import to `worker/src/index.ts`**

Anchor: lines 29–31 of the unmodified file read exactly:

```ts
} from "./booking/dashboard";

/* ============================================================
```

Replace those three lines with:

```ts
} from "./booking/dashboard";
import { checkRateLimit, RATE_LIMITS, type RateLimitBinding } from "./lib/rateLimit";

/* ============================================================
```

- [ ] **Step 3d — Add `RL_*` fields to the `Env` interface in `worker/src/index.ts`**

Anchor: the last two lines of the `Env` interface (lines 75–76 of the unmodified file) read exactly:

```ts
  AUDIT: { put(key: string, value: string): Promise<unknown> };
}
```

Replace those two lines with:

```ts
  AUDIT: { put(key: string, value: string): Promise<unknown> };
  // Wave D3 — rate-limiting bindings (declared in wrangler.toml [[ratelimits]])
  // Optional so existing tests that don't supply them compile without changes.
  RL_LOGIN?: RateLimitBinding;
  RL_LOGIN_EMAIL?: RateLimitBinding;
  RL_BOOKING?: RateLimitBinding;
  RL_ENQUIRY?: RateLimitBinding;
  RL_ADMIN?: RateLimitBinding;
}
```

- [ ] **Step 3e — Add `rate429()` helper to `worker/src/index.ts`**

Anchor: lines 133–137 of the unmodified file read exactly:

```ts
const json = (data: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin), ...secHeaderMap({ html: false }) },
  });
```

Insert the following **immediately after** those five lines (before the blank line that precedes `async function verifyTurnstile`):

```ts
/** Emit a 429 through the standard json() helper and add a Retry-After header. */
function rate429(origin: string, retryAfter: number): Response {
  const base = json({ ok: false, error: "Too many requests. Please try again later." }, 429, origin);
  const headers = new Headers(base.headers);
  headers.set("retry-after", String(retryAfter));
  return new Response(base.body, { status: 429, headers });
}
```

- [ ] **Step 3f — Wire `RL_BOOKING` for `POST /api/booking/request`**

Anchor: lines 212–215 of the unmodified file read exactly:

```ts
    // POST /api/booking/request — request-to-book endpoint (S2)
    if (req.method === "POST" && url.pathname === "/api/booking/request") {
      return handleBookingRequest(env, req);
    }
```

Replace with:

```ts
    // POST /api/booking/request — request-to-book endpoint (S2)
    if (req.method === "POST" && url.pathname === "/api/booking/request") {
      if (env.RL_BOOKING) {
        const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
        const rl = await checkRateLimit(env.RL_BOOKING, ip, RATE_LIMITS.BOOKING);
        if (!rl.success) return rate429(origin, rl.retryAfter);
      }
      return handleBookingRequest(env, req);
    }
```

- [ ] **Step 3g — Wire `RL_ADMIN` + `RL_LOGIN` for the JWT-gated admin block**

Anchor: lines 263–270 of the unmodified file read exactly:

```ts
    // ── Wave C Phase 1: JWT-gated admin dashboard routes ─────────────────────
    if (env.SUPABASE_JWT_SECRET) {
      const dashEnv = { ...env, SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET };

      // GET/POST /api/admin/login — magic-link login form
      if (url.pathname === "/api/admin/login") {
        return await handleAdminLogin(req, dashEnv);
      }
```

Replace with:

```ts
    // ── Wave C Phase 1: JWT-gated admin dashboard routes ─────────────────────
    if (env.SUPABASE_JWT_SECRET) {
      // Wave D3: rate-limit all /api/admin/* (defence-in-depth before any handler runs).
      if (url.pathname.startsWith("/api/admin/") && env.RL_ADMIN) {
        const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
        const rl = await checkRateLimit(env.RL_ADMIN, ip, RATE_LIMITS.ADMIN);
        if (!rl.success) return rate429(origin, rl.retryAfter);
      }

      const dashEnv = { ...env, SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET };

      // GET/POST /api/admin/login — magic-link login form
      // POST-only IP rate limit applied here; email rate limit applied inside handleAdminLogin.
      if (url.pathname === "/api/admin/login") {
        if (req.method === "POST" && env.RL_LOGIN) {
          const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
          const rl = await checkRateLimit(env.RL_LOGIN, ip, RATE_LIMITS.LOGIN_IP);
          if (!rl.success) return rate429(origin, rl.retryAfter);
        }
        return await handleAdminLogin(req, dashEnv);
      }
```

- [ ] **Step 3h — Wire `RL_ADMIN` for legacy ADMIN_SECRET routes**

Anchor: lines 328–331 of the unmodified file read exactly (immediately after the `}` that closes the JWT block on line 326, with a blank line then the comment):

```ts
    // ── Legacy ADMIN_SECRET routes (retained until Phase-1 auth fully proven) ─
    // GET/POST /api/admin/blocked-dates — Zandeline's blocked-dates admin (S8; token-protected)
    if (url.pathname === "/api/admin/blocked-dates" && env.ADMIN_SECRET) {
```

Insert the following immediately **before** the `// ── Legacy ADMIN_SECRET routes` comment line:

```ts
    // Wave D3: rate-limit legacy ADMIN_SECRET routes (same RL_ADMIN budget as JWT routes).
    // Covers /api/admin/blocked-dates, /api/admin/accounting, /api/admin/invoices, /api/admin/quote-pdf.
    if (url.pathname.startsWith("/api/admin/") && env.RL_ADMIN) {
      const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
      const rl = await checkRateLimit(env.RL_ADMIN, ip, RATE_LIMITS.ADMIN);
      if (!rl.success) return rate429(origin, rl.retryAfter);
    }

    // ── Legacy ADMIN_SECRET routes (retained until Phase-1 auth fully proven) ─
    // GET/POST /api/admin/blocked-dates — Zandeline's blocked-dates admin (S8; token-protected)
    if (url.pathname === "/api/admin/blocked-dates" && env.ADMIN_SECRET) {
```

- [ ] **Step 3i — Wire `RL_ENQUIRY` for `POST /api/enquiry`**

Anchor: lines 367–370 of the unmodified file (accounting for zero earlier insertions in this task — in the now-modified file, this block follows the `mark-balance-paid` route and precedes the `let body: Enquiry` declaration):

```ts
    if (req.method !== "POST" || url.pathname !== "/api/enquiry") {
      return json({ ok: false, error: "Not found" }, 404, origin);
    }

    let body: Enquiry;
```

Replace with:

```ts
    if (req.method !== "POST" || url.pathname !== "/api/enquiry") {
      return json({ ok: false, error: "Not found" }, 404, origin);
    }

    // Wave D3: rate-limit POST /api/enquiry (belt-and-suspenders with Turnstile).
    if (env.RL_ENQUIRY) {
      const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
      const rl = await checkRateLimit(env.RL_ENQUIRY, ip, RATE_LIMITS.ENQUIRY);
      if (!rl.success) return rate429(origin, rl.retryAfter);
    }

    let body: Enquiry;
```

- [ ] **Step 3j — Run the tests (expect PASS)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker" && npx vitest run src/index.test.ts
```

Expected:
```
✓ src/index.test.ts (9)
Test Files  1 passed (1)
```

- [ ] **Step 3k — Run the full test suite (no regressions)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker" && npm run test
```

Expected: all pre-existing tests pass; the two new suites (`index.test.ts`, `rateLimit.test.ts`) are added to the count.

- [ ] **Step 3l — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique" && git add worker/src/index.ts worker/src/index.test.ts && git commit -m "feat(worker): wire RL_* rate-limit checks into router for all protected routes (D3)"
```

---

## Task 4 — Add email-keyed rate limit inside `handleAdminLogin`

This task adds the second rate-limit check for `POST /api/admin/login`: keyed by the submitted email address, to blunt distributed OTP abuse from many source IPs. The IP-keyed check (Task 3g) fires first at the router; the email-keyed check fires second inside the handler after the body is parsed.

**Files:**
- Modify: `worker/src/booking/dashboard.ts`
- Create: `worker/src/booking/dashboard.rateLimit.test.ts`

**Interfaces:**

Consumes:
- `checkRateLimit`, `RATE_LIMITS` from `../lib/rateLimit`
- `DashboardEnv` extended with optional `RL_LOGIN_EMAIL?`

Produces:
- 429 HTML response from inside `handleAdminLogin` when the email key is rate-limited
- Supabase OTP call is skipped when rate-limited

---

- [ ] **Step 1 — Write the failing test**

Create `worker/src/booking/dashboard.rateLimit.test.ts` with the following complete content:

```ts
// worker/src/booking/dashboard.rateLimit.test.ts
// Tests the email-keyed rate-limit guard inside handleAdminLogin.
// The IP-keyed guard lives in index.ts and is tested in index.test.ts.

import { describe, it, expect, vi } from "vitest";
import { handleAdminLogin } from "./dashboard";
import type { DashboardEnv } from "./dashboard";

// ── env factory ───────────────────────────────────────────────────────────────

function makeEnv(rlEmailSuccess: boolean, includeBinding = true): DashboardEnv {
  return {
    BREVO_API_KEY: "brevo",
    NOTIFY_EMAIL: "z@lustiqueco.co.za",
    ALLOWED_ORIGIN: "https://lustiqueco.co.za",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_KEY: "svc",
    SUPABASE_JWT_SECRET: "jwt-secret",
    YOCO_SECRET_KEY: "yoco",
    YOCO_WEBHOOK_SECRET: "whsec",
    SIGNING_SECRET: "signing",
    TURNSTILE_SECRET: "ts",
    EFT_BANK: "FNB",
    EFT_ACCOUNT_NAME: "Lustique",
    EFT_ACCOUNT_NO: "12345",
    EFT_BRANCH_CODE: "250655",
    AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
    ...(includeBinding
      ? { RL_LOGIN_EMAIL: { limit: vi.fn().mockResolvedValue({ success: rlEmailSuccess }) } }
      : {}),
  } as unknown as DashboardEnv;
}

// noFetch: asserts that Supabase OTP is never called when rate-limited
const noFetch = vi.fn().mockRejectedValue(new Error("fetch must not be called when rate-limited"));

// ── Request builders ──────────────────────────────────────────────────────────

/** URL-encoded body — the standard browser form-submit format */
function makeUrlEncodedPost(email: string): Request {
  return new Request("https://worker/api/admin/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "5.6.7.8",
    },
    body: `email=${encodeURIComponent(email)}`,
  });
}

/** Multipart/form-data body — what browsers send for <form enctype="multipart/form-data"> */
function makeMultipartPost(email: string): Request {
  const fd = new FormData();
  fd.append("email", email);
  return new Request("https://worker/api/admin/login", {
    method: "POST",
    headers: { "cf-connecting-ip": "5.6.7.8" },
    body: fd,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleAdminLogin — email-keyed rate limit (RL_LOGIN_EMAIL)", () => {
  it("returns 429 when RL_LOGIN_EMAIL blocks (URL-encoded body)", async () => {
    const env = makeEnv(false);
    const resp = await handleAdminLogin(makeUrlEncodedPost("info@lustiqueco.co.za"), env, noFetch);
    expect(resp.status).toBe(429);
    const text = await resp.text();
    expect(text).toContain("Too many requests");
  });

  it("does NOT call Supabase OTP when rate-limited (URL-encoded body)", async () => {
    const env = makeEnv(false);
    const fetchSpy = vi.fn().mockRejectedValue(new Error("must not be called"));
    await handleAdminLogin(makeUrlEncodedPost("info@lustiqueco.co.za"), env, fetchSpy);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 429 when RL_LOGIN_EMAIL blocks (multipart body)", async () => {
    const env = makeEnv(false);
    const resp = await handleAdminLogin(makeMultipartPost("info@lustiqueco.co.za"), env, noFetch);
    expect(resp.status).toBe(429);
    const text = await resp.text();
    expect(text).toContain("Too many requests");
  });

  it("does NOT call Supabase OTP when rate-limited (multipart body)", async () => {
    const env = makeEnv(false);
    const fetchSpy = vi.fn().mockRejectedValue(new Error("must not be called"));
    await handleAdminLogin(makeMultipartPost("info@lustiqueco.co.za"), env, fetchSpy);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("includes Retry-After: 60 header when RL_LOGIN_EMAIL blocks", async () => {
    const env = makeEnv(false);
    const resp = await handleAdminLogin(makeUrlEncodedPost("info@lustiqueco.co.za"), env, noFetch);
    expect(resp.headers.get("retry-after")).toBe("60");
  });

  it("keys the binding by the submitted email address (not the IP)", async () => {
    const env = makeEnv(true); // passes — we just want to inspect the call
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await handleAdminLogin(makeUrlEncodedPost("info@lustiqueco.co.za"), env, fetchMock);
    const rl = (env.RL_LOGIN_EMAIL as { limit: ReturnType<typeof vi.fn> }).limit;
    expect(rl).toHaveBeenCalledWith({ key: "info@lustiqueco.co.za" });
  });

  it("proceeds to OTP call when RL_LOGIN_EMAIL passes", async () => {
    const env = makeEnv(true);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const resp = await handleAdminLogin(makeUrlEncodedPost("info@lustiqueco.co.za"), env, fetchMock);
    expect(resp.status).toBe(200); // check-email page
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("skips RL_LOGIN_EMAIL check gracefully when binding is absent (optional field)", async () => {
    const envNoRl = makeEnv(true, false); // no RL_LOGIN_EMAIL in env
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const resp = await handleAdminLogin(makeUrlEncodedPost("info@lustiqueco.co.za"), envNoRl, fetchMock);
    expect(resp.status).toBe(200); // still reaches check-email page
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2 — Run the failing test**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker" && npx vitest run src/booking/dashboard.rateLimit.test.ts
```

Expected: all 8 tests fail — `handleAdminLogin` does not yet check `RL_LOGIN_EMAIL`.

- [ ] **Step 3 — Modify `worker/src/booking/dashboard.ts`**

**Step 3a — Add import.** Anchor: line 14 of the unmodified file reads exactly:

```ts
import type { Env } from "../index";
```

Replace with:

```ts
import type { Env } from "../index";
import { checkRateLimit, RATE_LIMITS } from "../lib/rateLimit";
```

**Step 3b — Extend `DashboardEnv`.** Anchor: lines 17–19 of the unmodified file read exactly:

```ts
// Env used by dashboard handlers — Env + auth fields
export interface DashboardEnv extends Env {
  SUPABASE_JWT_SECRET: string;
}
```

Replace with:

```ts
// Env used by dashboard handlers — Env + auth fields
export interface DashboardEnv extends Env {
  SUPABASE_JWT_SECRET: string;
  // Wave D3: email-keyed rate limit for POST /api/admin/login (optional — absent in tests that don't need it)
  RL_LOGIN_EMAIL?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}
```

**Step 3c — Add email rate-limit check inside `handleAdminLogin`.** Anchor: lines 263–282 of the unmodified file read exactly (the block from the email validation check through to the `// Fire-and-forget` comment):

```ts
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return htmlResponse(
      `<p>Invalid email address. <a href="/api/admin/login">Try again</a>.</p>`,
      400,
    );
  }

  // Fire-and-forget: always show "check your email" to avoid user enumeration
  try {
    await fetchFn(`${env.SUPABASE_URL}/auth/v1/otp`, {
```

Replace with:

```ts
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return htmlResponse(
      `<p>Invalid email address. <a href="/api/admin/login">Try again</a>.</p>`,
      400,
    );
  }

  // Wave D3: email-keyed rate limit — blunts distributed OTP abuse across many IPs.
  // Applied after email validation (email is now known) and before the Supabase OTP call.
  // The IP-keyed guard (RL_LOGIN) lives in index.ts and fires before this handler is called.
  if (env.RL_LOGIN_EMAIL) {
    const rl = await checkRateLimit(env.RL_LOGIN_EMAIL, email, RATE_LIMITS.LOGIN_EMAIL);
    if (!rl.success) {
      const resp = htmlResponse(
        `<p>Too many requests. Please try again later. <a href="/api/admin/login">Return to login</a>.</p>`,
        429,
      );
      const headers = new Headers(resp.headers);
      headers.set("retry-after", String(rl.retryAfter));
      return new Response(resp.body, { status: 429, headers });
    }
  }

  // Fire-and-forget: always show "check your email" to avoid user enumeration
  try {
    await fetchFn(`${env.SUPABASE_URL}/auth/v1/otp`, {
```

- [ ] **Step 4 — Run the tests (expect PASS)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker" && npx vitest run src/booking/dashboard.rateLimit.test.ts
```

Expected:
```
✓ src/booking/dashboard.rateLimit.test.ts (8)
Test Files  1 passed (1)
```

- [ ] **Step 5 — Run the full test suite (no regressions)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker" && npm run test
```

Expected: all tests pass.

- [ ] **Step 6 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique" && git add worker/src/booking/dashboard.ts worker/src/booking/dashboard.rateLimit.test.ts && git commit -m "feat(worker): add email-keyed RL_LOGIN_EMAIL guard inside handleAdminLogin (D3)"
```

---

## Task 5 — (Phase 2 / Deferred) KV sliding-window counters for true 15-min / 1-hour limits

This task is **not required for Wave D3 go-live**. The `[[ratelimits]]` burst guards from Tasks 1–4 alone satisfy the D3 security requirement. This section documents what Phase 2 adds so the decision is not lost.

**Trigger condition:** implement when Pieter decides to add a Workers KV binding.

**What it adds:**
- `wrangler kv namespace create lustique-rate-limits` + a `[[kv_namespaces]]` stanza in `wrangler.toml` binding `RL_KV`.
- A KV-backed sliding window counter per `IP+routeKey+windowBucket`.
  - 15-min window: `windowBucket = Math.floor(Date.now() / (15 * 60 * 1000))`
  - 1-hour window: `windowBucket = Math.floor(Date.now() / (60 * 60 * 1000))`
- `checkKvRateLimit(kv, key, windowMs, limit)` in `worker/src/lib/rateLimitKv.ts`.
- Called **after** the `[[ratelimits]]` burst guard passes (two-layer check).
- Pieter action: create the KV namespace, add the `[[kv_namespaces]]` binding, re-run `wrangler types`.

**No code is written here** — this is a design note only.

---

## Pieter / One-time Setup

### P-1 — Run `wrangler types` after Task 2

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker" && npx wrangler types
```

Regenerates `worker-configuration.d.ts` so `RL_LOGIN`, `RL_LOGIN_EMAIL`, `RL_BOOKING`, `RL_ENQUIRY`, `RL_ADMIN` appear as `RateLimit` in the auto-generated `Env`. Required before the first `wrangler deploy`. (If it errors due to network, see the fallback note in Task 2 Step 2b.)

### P-2 — Deploy and verify bindings in the CF dashboard

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker" && npx wrangler deploy
```

After deploy:
1. Open CF dashboard → Workers → `lustique-form-handler` → Settings → Bindings.
2. Confirm five `RL_*` bindings appear.
3. **`namespace_id` collision check:** if the deploy errors with a namespace conflict, increment all five `namespace_id` values by 100 (`1101`–`1105`) in `wrangler.toml` and redeploy. A `--dry-run` cannot catch API-side namespace conflicts; this check requires an actual deploy attempt.

### P-3 — Verify live rate-limiting with curl

```bash
# 6 rapid POST requests to /api/admin/login — the 6th must return 429
for i in $(seq 1 6); do
  echo "Request $i:";
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://lustiqueco.co.za/api/admin/login \
    -H "content-type: application/x-www-form-urlencoded" \
    -d "email=info%40lustiqueco.co.za";
done
```

Expected: requests 1–5 return 200 (check-email page), request 6 returns 429.

```bash
# 4 rapid POST requests to /api/booking/request — the 4th must return 429
for i in $(seq 1 4); do
  echo "Request $i:";
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://lustiqueco.co.za/api/booking/request \
    -H "content-type: application/json" \
    -d '{"brideName":"Test"}';
done
```

Expected: requests 1–3 return 422 (incomplete body — validation fails before the handler does anything expensive), request 4 returns 429.

### P-4 — No new secrets required

This wave adds no new secrets. The five rate-limiting bindings are `wrangler.toml` configuration, not CF Secrets. The existing nine secrets are unchanged.

---

## Self-review — Spec Coverage

| Constraint / Question | Where satisfied |
|---|---|
| CF Workers Rate Limiting binding (free tier) | AD-1, Task 2 |
| `[[ratelimits]]` wrangler.toml syntax confirmed via context7 | AD-1 |
| `name =` (not `binding =`) is the correct field — confirmed and sole shape shown | AD-1; Task 2 Step 2a shows only one canonical stanza shape |
| `namespace_id` semantics — arbitrary integer, CF creates on deploy | AD-1 |
| Pieter action to verify namespace_id validity after first deploy | P-2 |
| Only period=10 or period=60 supported | AD-2 |
| 15-min / 1-hour windows expressed as 60s burst guards; KV deferred to Phase 2 | AD-2 |
| Granularity documented precisely (not silently pretended to be 15-min) | AD-2 table |
| Middleware at `worker/src/lib/rateLimit.ts` | AD-3, Task 1 |
| All limits as named constants in one place (`RATE_LIMITS`) | Task 1 Step 3 |
| 429 through existing security-headers wrapper (`json()` + `rate429()`) | AD-4, Task 3 Step 3e |
| `Retry-After` header on 429 | AD-4; Tasks 3e, 4 Step 3c |
| JSON body matches existing Worker error shape `{ ok, error }` | AD-4 |
| Keying by CF-Connecting-IP for all routes | AD-5, Tasks 3f–3i |
| Login additionally keyed by email | AD-5, AD-8, Task 4 |
| Same limits prod + staging (single env) | AD-6 |
| POST /api/admin/login covered (IP at router + email inside handler) | Tasks 3g + 4 |
| GET /api/admin/* JWT-gated routes covered | Task 3g (RL_ADMIN before JWT dispatch) |
| Legacy ADMIN_SECRET routes covered (the four routes at lines 330–347) | AD-7, Task 3h |
| POST /api/booking/request covered | Task 3f |
| POST /api/enquiry covered | Task 3i |
| POST /api/booking/yoco-webhook exempt | AD-2 table; no RL check added for that path |
| All code tasks are TDD with complete test + implementation code | Tasks 1–4 each: write test → fail → implement → pass → commit |
| No placeholder / TODO / TBD in code blocks | All code blocks are complete and runnable |
| `shared/pricing` not touched | Confirmed — no pricing file modified |
| `npm install` not run in sandbox | No new packages; flagged as rule in Global Constraints |
| `wrangler types` re-run after binding change | P-1 |
| Task 3 sub-steps applied in document order (3a … 3i) | Stated explicitly in Task 3 preamble; each anchor quotes surrounding unmodified lines |
| Each insertion anchor unambiguous against unmodified file | Tasks 3c–3i each quote exact surrounding lines |
| extractLoginEmail / multipart test: deterministic, no smoke-test escape hatch | Task 4: 8 concrete tests — 2 URL-encoded, 2 multipart, 1 header, 1 key-assertion, 1 pass-through, 1 absent-binding; no deferrals |
| Router-level login rate limit is POST-only (GET /api/admin/login is not limited) | Task 3g: `if (req.method === "POST" && env.RL_LOGIN)` |
| namespace_id validation Pieter action stated explicitly | P-2 |
