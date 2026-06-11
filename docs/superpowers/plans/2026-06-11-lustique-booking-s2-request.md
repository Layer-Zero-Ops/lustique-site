# Booking Core — S2 Request-to-Book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `POST /api/booking/request` endpoint and the site form that drives it — a bride fills in the estimator, chooses a deposit %, ticks consent, and submits; the Worker recomputes the price server-side, persists the booking, and emails Zandeline a signed confirm link + the bride a "received" confirmation.

**Architecture:** The Worker gains `booking/token.ts` (HMAC-SHA256 sign + sha256 hash helpers), extends `booking/db.ts` with a same-date count query, and adds `booking/request.ts` containing the full handler. `@lustique/pricing` is added to the Worker's dependencies so `computeEstimate` can be imported directly. On the site side, `readInput()` is exported from `estimator.ts` and imported by the new `booking-request.ts` script, which adds deposit-% fields, a consent checkbox, and a Turnstile widget to `quote.astro`. A new `booking-received.astro` page confirms submission.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers, Web Crypto API (`crypto.subtle`), Cloudflare Turnstile, Brevo (existing `brevoEmail` helper extended inline), Astro.

**Spec:** [`2026-06-05-lustique-booking-core-design.md`](../specs/2026-06-05-lustique-booking-core-design.md) (§5 state machine, §7 Worker surface, §8 money, §10 notifications, §12 security).

**Builds on:** S1 — `worker/src/booking/{db,audit,util}.ts` + `shared/pricing/src/payments.ts` + schema migration all done and tested.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `worker/package.json` | Modify | Add `@lustique/pricing: "*"` to `dependencies` |
| `worker/src/booking/token.ts` | Create | `signToken` + `hashToken` — HMAC-SHA256 helpers; S2 signs, S3 verifies |
| `worker/src/booking/token.test.ts` | Create | Determinism, charset, and hash-length tests |
| `worker/src/booking/db.ts` | Modify | Add `countBookingsOnDate` for the same-date warning in Zandeline's email |
| `worker/src/booking/db.test.ts` | Modify | Tests for `countBookingsOnDate` |
| `worker/src/booking/request.ts` | Create | `handleBookingRequest`: Turnstile → validate → recompute → insert → sign → email × 2 |
| `worker/src/booking/request.test.ts` | Create | Happy path + honeypot + validation failures + dedupe + sanity-cap tests |
| `worker/src/index.ts` | Modify | Add `POST /api/booking/request` route |
| `site/src/scripts/estimator.ts` | Modify | Export `readInput` so `booking-request.ts` can import it |
| `site/src/pages/quote.astro` | Modify | Turnstile widget + deposit-% radio + consent checkbox + "Request to book" section (weddings only) + Turnstile script |
| `site/src/scripts/booking-request.ts` | Create | Collect EstimateInput + bride fields + idempotencyKey → POST `/api/booking/request` → navigate |
| `site/src/pages/booking-received.astro` | Create | "Your date is being held" landing page shown after submission |

---

## Task 1: HMAC token helpers

**Files:**
- Create: `worker/src/booking/token.ts`
- Create: `worker/src/booking/token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// worker/src/booking/token.test.ts
import { describe, it, expect } from "vitest";
import { signToken, hashToken } from "./token";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const EXP = new Date("2026-07-01T00:00:00Z");
const SECRET = "test-signing-secret";

describe("signToken", () => {
  it("returns only base64url chars (no +, /, or = padding)", async () => {
    const t = await signToken(ID, EXP, SECRET);
    expect(t).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
  it("is deterministic for the same inputs", async () => {
    expect(await signToken(ID, EXP, SECRET)).toBe(await signToken(ID, EXP, SECRET));
  });
  it("differs when the booking ID changes", async () => {
    const other = await signToken("different-id", EXP, SECRET);
    expect(await signToken(ID, EXP, SECRET)).not.toBe(other);
  });
  it("differs when the secret changes", async () => {
    expect(await signToken(ID, EXP, SECRET)).not.toBe(await signToken(ID, EXP, "other-secret"));
  });
  it("differs when the expiry changes", async () => {
    const laterExp = new Date("2026-08-01T00:00:00Z");
    expect(await signToken(ID, EXP, SECRET)).not.toBe(await signToken(ID, laterExp, SECRET));
  });
});

describe("hashToken", () => {
  it("returns a 64-char lowercase hex string (SHA-256)", async () => {
    expect(await hashToken("any-token")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is deterministic", async () => {
    expect(await hashToken("x")).toBe(await hashToken("x"));
  });
  it("produces different hashes for different inputs", async () => {
    expect(await hashToken("a")).not.toBe(await hashToken("b"));
  });
  it("hashes a real signed token without throwing", async () => {
    const t = await signToken(ID, EXP, SECRET);
    const h = await hashToken(t);
    expect(h).toHaveLength(64);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w lustique-form-handler`
Expected: FAIL — `Cannot find module './token'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
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

async function hmacHex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w lustique-form-handler`
Expected: PASS — all `token` tests green, existing `db`/`audit`/`util` tests still green.

- [ ] **Step 5: Commit**

```bash
git add worker/src/booking/token.ts worker/src/booking/token.test.ts
git commit -m "feat(worker): HMAC token sign + SHA-256 hash helpers for confirm link"
```

---

## Task 2: DB — same-date count

**Files:**
- Modify: `worker/src/booking/db.ts`
- Modify: `worker/src/booking/db.test.ts`

- [ ] **Step 1: Add the failing test** — append to `worker/src/booking/db.test.ts` after the existing `keepWarm` suite

```ts
import { countBookingsOnDate } from "./db";
// (add countBookingsOnDate to the import line at the top of the file)

describe("countBookingsOnDate", () => {
  it("returns the count from the PostgREST aggregate", async () => {
    const f = vi.fn().mockResolvedValue(res([{ count: "3" }]));
    const n = await countBookingsOnDate(env, "2026-11-14", f as unknown as typeof fetch);
    expect(n).toBe(3);
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain("wedding_date=eq.2026-11-14");
    expect(url).toContain("status=not.in.(expired,declined,cancelled)");
  });
  it("returns 0 when no active bookings exist on that date", async () => {
    const f = vi.fn().mockResolvedValue(res([{ count: "0" }]));
    expect(await countBookingsOnDate(env, "2026-12-25", f as unknown as typeof fetch)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w lustique-form-handler`
Expected: FAIL — `countBookingsOnDate is not a function`.

- [ ] **Step 3: Add `countBookingsOnDate` to `worker/src/booking/db.ts`** — append after `insertAudit`

```ts
/**
 * Count active bookings (not expired/declined/cancelled) on a given wedding date.
 * Used for the same-date warning in Zandeline's confirm email (spec §10).
 * PostgREST aggregate: select=count() returns [{ count: "N" }].
 */
export async function countBookingsOnDate(
  env: DbEnv,
  weddingDate: string, // "YYYY-MM-DD"
  f: typeof fetch = fetch,
): Promise<number> {
  const r = await f(
    rest(
      env,
      `bookings?select=count()&wedding_date=eq.${encodeURIComponent(weddingDate)}&status=not.in.(expired,declined,cancelled)`,
    ),
    { headers: headers(env) },
  );
  if (!r.ok) throw new Error(`countBookingsOnDate ${r.status}`);
  const rows = (await r.json()) as Array<{ count: string }>;
  return parseInt(rows[0]?.count ?? "0", 10);
}
```

Also add `countBookingsOnDate` to the import list in `db.test.ts`:
```ts
import { insertBooking, updateBookingStatus, findPaymentByYocoId, keepWarm, countBookingsOnDate } from "./db";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w lustique-form-handler`
Expected: PASS — all `db` tests green including the two new `countBookingsOnDate` tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/booking/db.ts worker/src/booking/db.test.ts
git commit -m "feat(worker): add countBookingsOnDate for same-date conflict warning"
```

---

## Task 3: `handleBookingRequest` endpoint

**Files:**
- Modify: `worker/package.json` (add `@lustique/pricing` dep — do this first so the import resolves)
- Create: `worker/src/booking/request.ts`
- Create: `worker/src/booking/request.test.ts`

- [ ] **Step 1: Add `@lustique/pricing` to Worker dependencies**

In `worker/package.json`, add a `"dependencies"` key:

```json
{
  "name": "lustique-form-handler",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@lustique/pricing": "*"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.80.0"
  }
}
```

Run: `npm install` (at repo root — Pieter's terminal)
Expected: workspace symlink for `@lustique/pricing` resolves cleanly.

- [ ] **Step 2: Write the failing test**

```ts
// worker/src/booking/request.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleBookingRequest } from "./request";
import type { EstimateResult } from "@lustique/pricing";

// ── helpers ─────────────────────────────────────────────────────────────────
const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const BOOKING_ID = "11111111-2222-3333-4444-555555555555";

const env = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_KEY: "svc",
  BREVO_API_KEY: "brevo-key",
  NOTIFY_EMAIL: "z@lustique.co.za",
  ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  SIGNING_SECRET: "signing-secret",
  TURNSTILE_SECRET: "ts-secret",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

const mockResult: EstimateResult = {
  total: 8826, heads: 7, destination: false, occasion: "wedding",
  lines: [{ label: "Bride", amount: 3090 }],
};
const mockCompute = vi.fn().mockReturnValue(mockResult);

const validBody = {
  brideName: "Anke van der Berg",
  brideEmail: "anke@example.com",
  bridePhone: "0671234567",
  weddingDate: "2027-11-14", // far future
  town: "Hartbeespoort",
  province: "Gauteng",
  venue: "Red Ivory",
  depositPct: 50,
  idempotencyKey: "client-key-001",
  consentAt: "2026-06-11T10:00:00Z",
  hp_company: "",
  cfTurnstileToken: "valid-ts-token",
  occasion: "wedding",
  brideHairLen: "long",
  partyHair: { short: 0, medium: 2, long: 1, xlong: 0 },
  bmMakeup: 3, bmHair: 3,
  momMakeup: 1, momHair: 1,
  fgAge: "under", fgMakeup: 0, fgHair: 0, fgHairLen: "short",
  guestMakeup: 0, guestHair: 0,
  requestedArtists: 1,
  promo: { kind: "cheapestLookFree", minPeople: 4 },
  travel: { band: "mid" },
};

/** Build a happy-path fetch chain: Turnstile → count → insert → audit_log → Brevo ×2 */
function happyChain() {
  return vi.fn()
    .mockResolvedValueOnce(res({ success: true }))                                       // 1. Turnstile
    .mockResolvedValueOnce(res([{ count: "0" }]))                                        // 2. countBookingsOnDate
    .mockResolvedValueOnce(res([{ id: BOOKING_ID, reference: "LUS-2026-111122" }], 201)) // 3. insertBooking
    .mockResolvedValueOnce(res({}, 201))                                                 // 4. audit_log
    .mockResolvedValueOnce(res({ messageId: "m1" }, 201))                               // 5. Brevo → Zandeline
    .mockResolvedValueOnce(res({ messageId: "m2" }, 201));                              // 6. Brevo → bride
}

function makeReq(body: unknown) {
  return new Request("https://worker/api/booking/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── tests ────────────────────────────────────────────────────────────────────
describe("handleBookingRequest — happy path", () => {
  it("returns 200 with the booking reference", async () => {
    const f = happyChain();
    const resp = await handleBookingRequest(env, makeReq(validBody), f, mockCompute, () => BOOKING_ID);
    expect(resp.status).toBe(200);
    const data = await resp.json() as { ok: boolean; reference: string };
    expect(data.ok).toBe(true);
    expect(data.reference).toMatch(/^LUS-/);
  });

  it("sends two Brevo emails (Zandeline + bride)", async () => {
    const f = happyChain();
    await handleBookingRequest(env, makeReq(validBody), f, mockCompute, () => BOOKING_ID);
    // calls: Turnstile, countBookingsOnDate, insertBooking, audit_log, Brevo×2
    expect(f).toHaveBeenCalledTimes(6);
    const brevoCall1 = f.mock.calls[4]![0] as string;
    const brevoCall2 = f.mock.calls[5]![0] as string;
    expect(brevoCall1).toBe("https://api.brevo.com/v3/smtp/email");
    expect(brevoCall2).toBe("https://api.brevo.com/v3/smtp/email");
  });

  it("includes the confirm URL in Zandeline's email body", async () => {
    const f = happyChain();
    await handleBookingRequest(env, makeReq(validBody), f, mockCompute, () => BOOKING_ID);
    const zandelineBody = JSON.parse((f.mock.calls[4]![1] as RequestInit).body as string);
    expect(zandelineBody.htmlContent).toContain("/api/booking/confirm?token=");
  });

  it("includes the same-date warning when another booking holds the date", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res({ success: true }))
      .mockResolvedValueOnce(res([{ count: "2" }]))                                      // 2 existing
      .mockResolvedValueOnce(res([{ id: BOOKING_ID, reference: "LUS-2026-111122" }], 201))
      .mockResolvedValueOnce(res({}, 201))
      .mockResolvedValueOnce(res({ messageId: "1" }, 201))
      .mockResolvedValueOnce(res({ messageId: "2" }, 201));
    await handleBookingRequest(env, makeReq(validBody), f, mockCompute, () => BOOKING_ID);
    const zandelineBody = JSON.parse((f.mock.calls[4]![1] as RequestInit).body as string);
    expect(zandelineBody.htmlContent).toContain("2 other booking");
  });

  it("flags bookings over R200,000 in notes but still returns 200", async () => {
    const bigCompute = vi.fn().mockReturnValue({ ...mockResult, total: 250_001 });
    const f = happyChain();
    const resp = await handleBookingRequest(env, makeReq(validBody), f, bigCompute, () => BOOKING_ID);
    expect(resp.status).toBe(200);
    const insertedBody = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect((insertedBody as unknown[])[0] as { notes: string } | undefined ?? insertedBody)
      // PostgREST receives a single object (not array) for insert
    expect(JSON.stringify(insertedBody)).toContain("manual review");
  });
});

describe("handleBookingRequest — honeypot + validation", () => {
  it("silently drops a honeypot hit (hp_company filled)", async () => {
    const f = vi.fn(); // should NOT be called
    const resp = await handleBookingRequest(
      env, makeReq({ ...validBody, hp_company: "spam-bot" }), f, mockCompute, () => BOOKING_ID,
    );
    expect(resp.status).toBe(200);
    expect((await resp.json() as { ok: boolean }).ok).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects when Turnstile fails", async () => {
    const f = vi.fn().mockResolvedValueOnce(res({ success: false }));
    const resp = await handleBookingRequest(env, makeReq(validBody), f, mockCompute, () => BOOKING_ID);
    expect(resp.status).toBe(422);
    expect((await resp.json() as { error: string }).error).toMatch(/[Bb]ot/);
  });

  it("rejects a wedding date in the past", async () => {
    const f = vi.fn().mockResolvedValueOnce(res({ success: true })); // Turnstile ok
    const resp = await handleBookingRequest(
      env, makeReq({ ...validBody, weddingDate: "2020-01-01" }), f, mockCompute, () => BOOKING_ID,
    );
    expect(resp.status).toBe(422);
    expect((await resp.json() as { error: string }).error).toMatch(/future/i);
  });

  it("rejects when consent is missing", async () => {
    const f = vi.fn().mockResolvedValueOnce(res({ success: true }));
    const resp = await handleBookingRequest(
      env, makeReq({ ...validBody, consentAt: "" }), f, mockCompute, () => BOOKING_ID,
    );
    expect(resp.status).toBe(422);
    expect((await resp.json() as { error: string }).error).toMatch(/consent/i);
  });

  it("rejects an invalid depositPct", async () => {
    const f = vi.fn().mockResolvedValueOnce(res({ success: true }));
    const resp = await handleBookingRequest(
      env, makeReq({ ...validBody, depositPct: 33 }), f, mockCompute, () => BOOKING_ID,
    );
    expect(resp.status).toBe(422);
    expect((await resp.json() as { error: string }).error).toMatch(/deposit/i);
  });
});

describe("handleBookingRequest — dedupe", () => {
  it("returns 200 without re-emailing when the idempotency_key already exists", async () => {
    const EXISTING_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"; // different from BOOKING_ID
    const f = vi.fn()
      .mockResolvedValueOnce(res({ success: true }))               // Turnstile
      .mockResolvedValueOnce(res([{ count: "0" }]))                // count
      .mockResolvedValueOnce(res([{ id: EXISTING_ID, reference: "LUS-2026-EXIST" }], 201)); // existing row
    const resp = await handleBookingRequest(env, makeReq(validBody), f, mockCompute, () => BOOKING_ID);
    expect(resp.status).toBe(200);
    expect((await resp.json() as { reference: string }).reference).toBe("LUS-2026-EXIST");
    expect(f).toHaveBeenCalledTimes(3); // no emails
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w lustique-form-handler`
Expected: FAIL — `Cannot find module './request'`.

- [ ] **Step 4: Write the implementation**

```ts
// worker/src/booking/request.ts
/**
 * POST /api/booking/request — the request-to-book endpoint (spec §7, §8, §10, §12).
 * Dependency injection makes every external call testable (fetch, computeFn, newId).
 */
import {
  computeEstimate, randToCents, splitDeposit,
  type EstimateInput, type EstimateResult,
} from "@lustique/pricing";
import { insertBooking, countBookingsOnDate } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { signToken, hashToken } from "./token";
import { makeReference } from "./util";

// ── env interface ─────────────────────────────────────────────────────────────
export interface BookingRequestEnv extends AuditEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
  TURNSTILE_SECRET: string;
}

// ── request body ─────────────────────────────────────────────────────────────
interface RequestBody {
  brideName?: string;
  brideEmail?: string;
  bridePhone?: string;
  weddingDate?: string;
  town?: string;
  province?: string;
  venue?: string;
  depositPct?: unknown;
  idempotencyKey?: string;
  consentAt?: string;
  hp_company?: string;
  cfTurnstileToken?: string;
  occasion?: string;
  brideHairLen?: string;
  partyHair?: unknown;
  bmMakeup?: unknown; bmHair?: unknown;
  momMakeup?: unknown; momHair?: unknown;
  fgAge?: string; fgMakeup?: unknown; fgHair?: unknown; fgHairLen?: string;
  guestMakeup?: unknown; guestHair?: unknown;
  evMakeup?: unknown; evHair?: unknown; evHairLen?: string;
  lessonsAttending?: unknown;
  requestedArtists?: unknown;
  promo?: unknown;
  travel?: unknown;
}

// ── token TTL (spec §12 — 14 days) ──────────────────────────────────────────
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// ── sanity cap (spec §8) ─────────────────────────────────────────────────────
const SANITY_CAP_RAND = 200_000;

// ── helpers (private to this module) ─────────────────────────────────────────
const esc = (s = "") => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
const n = (v: unknown): number => Math.max(0, parseInt(String(v ?? 0), 10) || 0);

async function brevoEmail(
  env: BookingRequestEnv,
  to: { email: string; name?: string },
  subject: string,
  html: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const r = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: env.NOTIFY_EMAIL, name: "Lustique Co." },
      to: [to],
      subject,
      htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}

async function verifyTurnstile(token: string, secret: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const r = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
    });
    if (!r.ok) return false;
    return ((await r.json()) as { success: boolean }).success === true;
  } catch {
    return false;
  }
}

function validate(b: RequestBody): string | "spam" | null {
  if (b.hp_company?.trim()) return "spam";
  if (!b.brideName || b.brideName.trim().length < 2) return "Please add your name.";
  if (!b.brideEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.brideEmail)) return "Please add a valid email address.";
  if (!b.bridePhone || b.bridePhone.trim().length < 6) return "Please add a contact number.";
  if (!b.weddingDate) return "Please add your wedding date.";
  if (b.weddingDate <= new Date().toISOString().slice(0, 10)) return "Your wedding date must be in the future.";
  if (!b.consentAt) return "Please tick the consent box to proceed.";
  if (![25, 50, 100].includes(Number(b.depositPct))) return "Please choose a deposit percentage (25%, 50%, or 100%).";
  if (!b.idempotencyKey) return "Missing submission key — please reload and try again.";
  return null;
}

function toEstimateInput(b: RequestBody): EstimateInput {
  return {
    occasion: (b.occasion ?? "wedding") as EstimateInput["occasion"],
    brideHairLen: (b.brideHairLen ?? "medium") as EstimateInput["brideHairLen"],
    partyHair: (b.partyHair as EstimateInput["partyHair"]) ?? { short: 0, medium: 0, long: 0, xlong: 0 },
    bmMakeup: n(b.bmMakeup), bmHair: n(b.bmHair),
    momMakeup: n(b.momMakeup), momHair: n(b.momHair),
    fgAge: b.fgAge === "over" ? "over" : "under",
    fgMakeup: n(b.fgMakeup), fgHair: n(b.fgHair),
    fgHairLen: (b.fgHairLen ?? "medium") as EstimateInput["fgHairLen"],
    guestMakeup: n(b.guestMakeup), guestHair: n(b.guestHair),
    evMakeup: n(b.evMakeup), evHair: n(b.evHair),
    evHairLen: (b.evHairLen ?? "medium") as EstimateInput["evHairLen"],
    lessonsAttending: n(b.lessonsAttending),
    requestedArtists: n(b.requestedArtists),
    promo: (b.promo as EstimateInput["promo"]) ?? { kind: "none" },
    travel: (b.travel as EstimateInput["travel"]) ?? { band: "studio" },
  };
}

// ── main handler ─────────────────────────────────────────────────────────────
export async function handleBookingRequest(
  env: BookingRequestEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
  computeFn: (input: EstimateInput) => EstimateResult = computeEstimate,
  newId: () => string = () => crypto.randomUUID(),
): Promise<Response> {
  const origin = env.ALLOWED_ORIGIN || "*";
  const json = (data: unknown, status: number) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json", "access-control-allow-origin": origin },
    });

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ ok: false, error: "Malformed request." }, 400);
  }

  // 1. Honeypot (before any I/O)
  const problem = validate(body);
  if (problem === "spam") return json({ ok: true }, 200);

  // 2. Turnstile bot check
  const tsOk = await verifyTurnstile(body.cfTurnstileToken ?? "", env.TURNSTILE_SECRET, fetchImpl);
  if (!tsOk) return json({ ok: false, error: "Bot check failed — please refresh and try again." }, 422);

  // 3. Field validation
  if (problem) return json({ ok: false, error: problem }, 422);

  // 4. Server-authoritative price recompute (spec §8 — never trust client total)
  const estimateInput = toEstimateInput(body);
  const result = computeFn(estimateInput);
  const totalCents = randToCents(result.total);
  const depositPct = Number(body.depositPct) as 25 | 50 | 100;
  const { depositNetCents, balanceNetCents } = splitDeposit(totalCents, depositPct);
  const notes = result.total > SANITY_CAP_RAND
    ? `⚠️ Total R${result.total.toLocaleString()} exceeds R${SANITY_CAP_RAND.toLocaleString()} — manual review.`
    : null;

  // 5. Pre-generate bookingId + sign token before insert (spec §12)
  const bookingId = newId();
  const tokenExpiry = new Date(Date.now() + TOKEN_TTL_MS);
  const token = await signToken(bookingId, tokenExpiry, env.SIGNING_SECRET);
  const tokenHash = await hashToken(token);
  const reference = makeReference(bookingId, new Date().getUTCFullYear());

  // 6. Same-date count for the warning in Zandeline's email (spec §10)
  const sameDateCount = await countBookingsOnDate(env, body.weddingDate!, fetchImpl);

  // 7. Insert (idempotent — on conflict returns the existing row)
  const returned = await insertBooking(
    env,
    {
      id: bookingId,
      reference,
      idempotency_key: body.idempotencyKey,
      status: "requested",
      occasion: estimateInput.occasion,
      wedding_date: body.weddingDate,
      bride_name: body.brideName!.trim(),
      bride_email: body.brideEmail!.trim().toLowerCase(),
      bride_phone: body.bridePhone!.trim(),
      town: body.town?.trim() || null,
      province: body.province?.trim() || null,
      venue: body.venue?.trim() || null,
      party_size: result.heads,
      estimate_input: estimateInput,
      total_cents: totalCents,
      quote_lines: result.lines,
      deposit_pct: depositPct,
      deposit_net_cents: depositNetCents,
      balance_net_cents: balanceNetCents,
      consent_at: body.consentAt,
      confirm_token_hash: tokenHash,
      confirm_token_expires_at: tokenExpiry.toISOString(),
      notes,
    },
    fetchImpl,
  );

  // Dedupe: booking already existed — confirm link already sent; just return the ref
  if (returned.id !== bookingId) {
    return json({ ok: true, reference: returned.reference }, 200);
  }

  // 8. Audit
  await writeAudit(
    env,
    { bookingId, eventType: "request.created", payload: { reference, totalCents, depositPct } },
    fetchImpl,
  );

  // 9. Email Zandeline — booking details + confirm link + same-date warning (spec §10)
  const confirmUrl = `${env.ALLOWED_ORIGIN}/api/booking/confirm?token=${encodeURIComponent(token)}`;
  const sameDateHtml = sameDateCount > 0
    ? `<p style="color:#b91c1c;font-weight:600;margin:0 0 .8rem;">⚠️ ${sameDateCount} other active booking${sameDateCount === 1 ? "" : "s"} already hold${sameDateCount === 1 ? "s" : ""} this date.</p>`
    : "";
  await brevoEmail(
    env,
    { email: env.NOTIFY_EMAIL, name: "Lustique" },
    `Booking request — ${body.brideName!.trim()} · ${body.weddingDate}`,
    `<p><strong>${esc(body.brideName!.trim())}</strong><br/>
     ${esc(body.brideEmail!.trim())} · ${esc(body.bridePhone!.trim())}</p>
     ${sameDateHtml}
     <table style="border-collapse:collapse;font:14px/1.6 system-ui,sans-serif;margin:.4rem 0 .8rem;">
       <tr><td style="color:#8a7d72;padding:2px 12px 2px 0;white-space:nowrap;">Date</td><td><strong>${esc(body.weddingDate!)}</strong></td></tr>
       <tr><td style="color:#8a7d72;padding:2px 12px 2px 0;white-space:nowrap;">Venue</td><td>${esc([body.venue, body.town, body.province].filter(Boolean).join(", ") || "—")}</td></tr>
       <tr><td style="color:#8a7d72;padding:2px 12px 2px 0;white-space:nowrap;">Party size</td><td>${result.heads} looks</td></tr>
       <tr><td style="color:#8a7d72;padding:2px 12px 2px 0;white-space:nowrap;">Server total</td><td><strong>R ${result.total.toLocaleString()}</strong></td></tr>
       <tr><td style="color:#8a7d72;padding:2px 12px 2px 0;white-space:nowrap;">Deposit</td><td>${depositPct}% (R ${(depositNetCents / 100).toLocaleString()} net)</td></tr>
       <tr><td style="color:#8a7d72;padding:2px 12px 2px 0;white-space:nowrap;">Reference</td><td>${esc(reference)}</td></tr>
     </table>
     ${notes ? `<p style="color:#b91c1c;">${esc(notes)}</p>` : ""}
     <p style="margin:1.2rem 0;">
       <a href="${esc(confirmUrl)}" style="display:inline-block;background:#8a3a52;color:#fff;padding:.7em 1.6em;border-radius:8px;text-decoration:none;font-weight:600;">Confirm &amp; send deposit link</a>
     </p>
     <p style="font-size:.88rem;color:#8a7d72;">Confirming sends the bride a Yoco deposit link. The token expires in 14 days.</p>`,
    fetchImpl,
  );

  // 10. Email bride — "received" confirmation (spec §10)
  await brevoEmail(
    env,
    { email: body.brideEmail!.trim(), name: body.brideName!.trim() },
    "Your booking request is with us — Lustique Co.",
    `<p>Hi ${esc(body.brideName!.trim())},</p>
     <p>We have your booking request for <strong>${esc(body.weddingDate!)}</strong>.</p>
     <p>Your reference is <strong>${esc(reference)}</strong>.</p>
     <p>Zandeline will review artist availability and confirm within 24 hours. Once confirmed we'll send you a link to pay your deposit and officially secure your date.</p>
     <p>Blessings,<br/>The Lustique Cosmetology Team</p>`,
    fetchImpl,
  );

  return json({ ok: true, reference }, 200);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w lustique-form-handler`
Expected: PASS — all `request` tests green; all prior suites still green.

If any test fails on `crypto.randomUUID is not a function`, add to `worker/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 6: Commit**

```bash
git add worker/package.json worker/src/booking/request.ts worker/src/booking/request.test.ts
git commit -m "feat(worker): POST /api/booking/request handler with Turnstile, recompute, token, dual email"
```

---

## Task 4: Wire the route in `index.ts`

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add the import** at the top of `worker/src/index.ts` alongside the existing booking imports

```ts
import { handleBookingRequest } from "./booking/request";
```

- [ ] **Step 2: Add the route** inside the `fetch` handler, after the CORS OPTIONS check and before the 404 fallback

Replace the existing route check:
```ts
if (req.method !== "POST" || url.pathname !== "/api/enquiry") {
  return json({ ok: false, error: "Not found" }, 404, origin);
}
```

With:
```ts
// POST /api/booking/request — request-to-book endpoint (S2)
if (req.method === "POST" && url.pathname === "/api/booking/request") {
  return handleBookingRequest(env, req);
}

if (req.method !== "POST" || url.pathname !== "/api/enquiry") {
  return json({ ok: false, error: "Not found" }, 404, origin);
}
```

- [ ] **Step 3: Verify the Worker builds**

Run: `cd worker && npx wrangler deploy --dry-run --outdir dist-dry`
Expected: builds with no errors. Then: `rm -rf dist-dry`.

- [ ] **Step 4: Run the full worker test suite**

Run: `npm test -w lustique-form-handler`
Expected: PASS — all suites green.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): wire POST /api/booking/request to handleBookingRequest"
```

---

## Task 5: Site form extension

**Files:**
- Modify: `site/src/scripts/estimator.ts` (export `readInput`)
- Modify: `site/src/pages/quote.astro` (Turnstile widget + deposit-% + consent + "Request to book" section)
- Modify: `site/src/data/site.ts` (add `TURNSTILE_SITE_KEY`)

> **Account gate:** The real Turnstile site key comes from the Cloudflare dashboard (create a widget at https://dash.cloudflare.com → Turnstile). Use the test key `1x00000000000000000000AA` during development (always passes, no visual challenge).

- [ ] **Step 1: Add `TURNSTILE_SITE_KEY` to `site/src/data/site.ts`**

Append to the file:

```ts
// Cloudflare Turnstile site key — public (safe to commit).
// Dev/test: "1x00000000000000000000AA" (always passes). Replace with real key at deploy.
export const TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
```

- [ ] **Step 2: Export `readInput` from `estimator.ts`**

In `site/src/scripts/estimator.ts`, change line:
```ts
function readInput(): EstimateInput {
```
To:
```ts
export function readInput(): EstimateInput {
```

No other changes — this makes the function importable by `booking-request.ts`.

- [ ] **Step 3: Add the "Secure your date" section to `quote.astro`**

In `site/src/pages/quote.astro`:

**a.** Add the Turnstile script tag. After the existing Leaflet `<script>` tag at the top of `BaseLayout`, add:

```astro
<script is:inline src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```

**b.** Import `TURNSTILE_SITE_KEY` in the frontmatter:

Change:
```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
const title = "Get a Quote — Lustique Co.";
```
To:
```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import { TURNSTILE_SITE_KEY } from "../data/site";
const title = "Get a Quote — Lustique Co.";
```

**c.** Add the "Secure your date" section. Find the closing `</div></section>` after the existing `</form>` tag and insert the booking section INSIDE the `<form>`, directly after the final `form-step` (the "Your vision" step that contains the `#sendEnquiry` button). Add before the closing `</form>`:

```astro
      <!-- Booking section: shown for weddings only; hidden for other occasions (booking-request.ts) -->
      <div class="form-step reveal" id="bookingSection" style="display:none;margin-top:2rem;padding-top:2rem;border-top:1px solid rgba(60,42,42,.12);">
        <h3>Secure your date</h3>
        <p class="step-sub">Skip the 24-hour wait — request your date right now. Zandeline will confirm availability within a few hours and send you a Yoco deposit link.</p>

        <div class="field">
          <label>Deposit percentage</label>
          <p class="note" style="margin:.2rem 0 .7rem;">Your deposit secures the date; the balance is due 14 working days before your wedding. Amounts include the card processing fee.</p>
          <div style="display:flex;flex-direction:column;gap:.55rem;" id="depositOptions">
            <label style="display:flex;align-items:center;gap:.7rem;cursor:pointer;"><input type="radio" name="depositPct" value="25" style="width:auto;"> <span><strong>25%</strong> — <span class="deposit-amt" data-pct="25">calculating…</span></span></label>
            <label style="display:flex;align-items:center;gap:.7rem;cursor:pointer;"><input type="radio" name="depositPct" value="50" checked style="width:auto;"> <span><strong>50%</strong> — <span class="deposit-amt" data-pct="50">calculating…</span></span></label>
            <label style="display:flex;align-items:center;gap:.7rem;cursor:pointer;"><input type="radio" name="depositPct" value="100" style="width:auto;"> <span><strong>100%</strong> — <span class="deposit-amt" data-pct="100">calculating…</span></span></label>
          </div>
        </div>

        <div class="field" style="margin-top:1.1rem;">
          <label style="display:flex;align-items:flex-start;gap:.7rem;font-size:.92rem;color:#5c5048;cursor:pointer;">
            <input type="checkbox" id="consentBooking" style="width:auto;margin-top:.18em;flex-shrink:0;">
            <span>I consent to Lustique Co. collecting and storing my personal information to process this booking, in accordance with the <a href="privacy.html" style="color:var(--burgundy);">privacy policy</a>. Required.</span>
          </label>
        </div>

        <div class="cf-turnstile" data-sitekey={TURNSTILE_SITE_KEY} style="margin:1.1rem 0;"></div>

        <button type="button" class="btn btn-primary" id="requestBooking" style="width:100%;justify-content:center;background:var(--burgundy);">Request to book →</button>
        <p class="note center" id="bookingStatus" role="alert" style="margin-top:1rem;color:var(--burgundy);"></p>
      </div>
```

**d.** Add the `booking-request.ts` script at the bottom of the page alongside the existing scripts:

```astro
  <script>import "../scripts/booking-request.ts";</script>
```

- [ ] **Step 4: Build the site to verify no TypeScript or Astro errors**

Run: `npm run build -w site`
Expected: build completes cleanly. (The Turnstile script loads at runtime; no build-time check needed for the widget.)

- [ ] **Step 5: Commit**

```bash
git add site/src/data/site.ts site/src/scripts/estimator.ts site/src/pages/quote.astro
git commit -m "feat(site): deposit-%, consent, and Turnstile widget for request-to-book flow"
```

---

## Task 6: Booking request script + received page

**Files:**
- Create: `site/src/scripts/booking-request.ts`
- Create: `site/src/pages/booking-received.astro`

- [ ] **Step 1: Create `site/src/scripts/booking-request.ts`**

```ts
/**
 * /quote — "Request to book" submit handler.
 * Reads the estimator form state (via the shared readInput export), collects the
 * bride's personal details + deposit choice + consent + Turnstile token, and POSTs
 * to /api/booking/request. On success navigates to /booking-received?ref=...
 */
import { readInput } from "./estimator";
import { grossUp, splitDeposit, randToCents, YOCO_FEE_RATE } from "@lustique/pricing";

// ── DOM helpers (private) ─────────────────────────────────────────────────────
const el = (id: string) => document.getElementById(id);
const val = (id: string) => {
  const e = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  return e ? e.value.trim() : "";
};
const rand = (cents: number) => (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── deposit-% live labels ─────────────────────────────────────────────────────
function updateDepositLabels(totalRand: number | null): void {
  document.querySelectorAll<HTMLElement>(".deposit-amt").forEach((span) => {
    const pct = parseInt(span.dataset.pct ?? "50", 10) as 25 | 50 | 100;
    if (!totalRand || totalRand <= 0) { span.textContent = "—"; return; }
    const totalCents = randToCents(totalRand);
    const { depositNetCents } = splitDeposit(totalCents, pct);
    const payable = grossUp(depositNetCents, YOCO_FEE_RATE);
    span.textContent = `R ${rand(payable)} incl. card fee`;
  });
}

// ── show/hide booking section ─────────────────────────────────────────────────
function applyOccasionToBookingSection(): void {
  const occ = (document.getElementById("occasion") as HTMLSelectElement | null)?.value ?? "wedding";
  const section = el("bookingSection");
  if (section) section.style.display = occ === "wedding" ? "" : "none";
}

// ── submit ────────────────────────────────────────────────────────────────────
async function postBookingRequest(data: unknown): Promise<{ ok: boolean; reference?: string; error?: string; retriable: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch("/api/booking/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
      signal: ctrl.signal,
    });
    const out = (await r.json().catch(() => ({}))) as { ok?: boolean; reference?: string; error?: string };
    if (r.ok && out.ok) return { ok: true, reference: out.reference, retriable: false };
    return { ok: false, error: out.error, retriable: r.status >= 500 };
  } catch {
    return { ok: false, retriable: true };
  } finally {
    clearTimeout(timer);
  }
}

function getTurnstileToken(): string {
  const input = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
  return input?.value ?? "";
}

// ── wiring ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Keep deposit labels in sync with the live estimate
  const estimateEl = el("estimateAmount");
  if (estimateEl) {
    const observer = new MutationObserver(() => {
      const text = estimateEl.textContent ?? "";
      const match = text.replace(/\s/g, "").match(/[\d]+/);
      const rand = match ? parseInt(match[0], 10) : null;
      updateDepositLabels(rand);
    });
    observer.observe(estimateEl, { childList: true, subtree: true, characterData: true });
  }

  // Show/hide booking section based on occasion
  applyOccasionToBookingSection();
  document.getElementById("occasion")?.addEventListener("change", applyOccasionToBookingSection);

  // Submit handler
  const btn = el("requestBooking") as HTMLButtonElement | null;
  const statusEl = el("bookingStatus");
  const say = (msg: string) => { if (statusEl) statusEl.textContent = msg; };

  btn?.addEventListener("click", async () => {
    const consent = (el("consentBooking") as HTMLInputElement | null)?.checked;
    if (!consent) {
      say("Please tick the consent box to proceed.");
      return;
    }
    const depositRadio = document.querySelector<HTMLInputElement>('input[name="depositPct"]:checked');
    if (!depositRadio) {
      say("Please choose a deposit percentage.");
      return;
    }
    const cfToken = getTurnstileToken();
    if (!cfToken) {
      say("Security check not ready — please wait a moment and try again.");
      return;
    }

    const estimateInput = readInput();
    const body = {
      ...estimateInput,
      brideName: [val("fName"), val("lName")].filter(Boolean).join(" "),
      brideEmail: val("email"),
      bridePhone: val("phone"),
      weddingDate: val("weddingDate"),
      town: val("townInput"),
      province: val("provinceInput"),
      venue: val("venueInput"),
      depositPct: parseInt(depositRadio.value, 10),
      consentAt: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
      hp_company: val("hp_company"),
      cfTurnstileToken: cfToken,
    };

    if (!body.brideName || !body.brideEmail) {
      say("Please add your name and email so we can reach you.");
      return;
    }
    if (!body.weddingDate) {
      say("Please add your wedding date.");
      return;
    }

    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Sending…";
    say("");

    let result = await postBookingRequest(body);
    if (!result.ok && result.retriable) {
      say("Connection hiccup — trying once more…");
      await new Promise((r) => setTimeout(r, 1200));
      result = await postBookingRequest(body);
    }

    if (result.ok && result.reference) {
      window.location.href = `booking-received.html?ref=${encodeURIComponent(result.reference)}`;
      return;
    }

    say(result.error ?? "Something went wrong — please email info@lustiqueco.co.za and we'll help you directly.");
    btn.disabled = false;
    btn.textContent = label;
  });
});
```

- [ ] **Step 2: Create `site/src/pages/booking-received.astro`**

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
const title = "Request Received — Lustique Co.";
const desc = "Your booking request is with Zandeline — she'll confirm and send your deposit link shortly.";
---
<BaseLayout slug="booking-received.html" title={title} desc={desc}>
  <section class="page-hero">
    <span class="eyebrow">Date request received</span>
    <h1>Your date is being held.</h1>
    <p id="refLine">Zandeline will confirm availability and send your deposit link — usually within a few hours.</p>
  </section>
  <section class="section"><div class="wrap prose">
    <p style="text-align:center;font-size:1.12rem;">Here's what happens next:</p>
    <ol style="max-width:46ch;margin:1.5rem auto;line-height:2;">
      <li>Zandeline reviews your request and confirms artist availability.</li>
      <li>You receive a Yoco payment link for your deposit — paying it officially secures your date.</li>
      <li>We'll reach out to start planning the details of your day.</li>
    </ol>
    <p class="note center" style="margin-top:2rem;">Didn't receive a confirmation email? Check your spam folder or email <a href="mailto:info@lustiqueco.co.za">info@lustiqueco.co.za</a>.</p>
    <p class="note center" style="margin-top:2.4rem;">Blessings,<br>The Lustique Cosmetology Team</p>
  </div></section>

  <script is:inline>
    // Show the reference number if it was passed in the URL (?ref=LUS-2026-...)
    (function () {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (ref && /^LUS-\d{4}-[A-Z0-9]+$/.test(ref)) {
        const line = document.getElementById("refLine");
        if (line) {
          line.innerHTML =
            "Your reference is <strong>" + ref + "</strong>. " +
            "Zandeline will confirm availability and send your deposit link — usually within a few hours.";
        }
      }
    })();
  </script>
</BaseLayout>
```

- [ ] **Step 3: Build and visually check the page**

Run: `npm run build -w site`
Expected: build succeeds; `booking-received.html` appears in `site/dist/`.

Run the dev server: `npm run dev -w site`
Open: `http://localhost:4321/booking-received.html?ref=LUS-2026-TEST1A`
Expected: "Your reference is **LUS-2026-TEST1A**" appears in the subtitle paragraph.

- [ ] **Step 4: Check the quote page in the browser**

Open: `http://localhost:4321/quote.html`
- Select **Wedding** occasion → the "Secure your date" section should be visible.
- Select **Matric** → the section should hide.
- Fill in bride + party details → the deposit % labels should show amounts ("R 2 578 incl. card fee" etc.) that update as the estimate changes.
- Tick the consent box → required before submitting.

> Note: submitting will fail with "Bot check failed" in dev because the Turnstile test key needs the `api.js` script to be loaded (it typically passes automatically with the `1x00000000000000000000AA` test key, but only when the Turnstile script is served over HTTPS or localhost).

- [ ] **Step 5: Commit**

```bash
git add site/src/scripts/booking-request.ts site/src/pages/booking-received.astro
git commit -m "feat(site): booking-request.ts script + booking-received confirmation page"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Covered by |
|---|---|
| Bride submits via form with date + depositPct | Task 5 (quote.astro) + Task 6 (booking-request.ts) |
| Honeypot + validate (date future, phone, consent) | Task 3 (`validate()` in request.ts) |
| Turnstile server-side verify | Task 3 (`verifyTurnstile()`) |
| Server-authoritative price recompute | Task 3 (`computeFn(estimateInput)`) |
| Dedupe on `idempotency_key` | Task 3 (pre-generate bookingId, check `returned.id !== bookingId`) |
| Insert `bookings(requested)` | Task 3 (via `insertBooking`) |
| Sign confirm token + store hash | Task 1 (token.ts) + Task 3 |
| Email Zandeline with confirm link + same-date warning | Task 3 (brevoEmail × 1) |
| Email bride "received" | Task 3 (brevoEmail × 1) |
| Sanity cap > R200,000 → flag, never reject | Task 3 (`notes` field) |
| 100% deposit → `balanceNetCents = 0` | Task 3 (via `splitDeposit`, already tested in S1) |
| R2 + audit_log on `request.created` | Task 3 (`writeAudit`) |
| Deposit % live UI labels | Task 6 (`updateDepositLabels` via MutationObserver) |
| POPIA consent checkbox | Task 5 (quote.astro) + Task 6 (client validation) |
| Bride lands on return page | Task 6 (`booking-received.astro`) |

**Gaps checked:** Per-IP rate limit — spec says Turnstile + per-IP; implemented as Turnstile in Worker code. True IP-rate limiting in a stateless Worker requires KV or Durable Objects (out of S2 scope). Add a Cloudflare WAF rate-limit rule at deploy time targeting `POST /api/booking/request`: max 5 requests/IP/hour. Document this in the deploy checklist in `SESSION_HANDOFF.md`.

**Placeholder scan:** none found.

**Type consistency:** `EstimateInput` used in `toEstimateInput()` (request.ts Task 3), `readInput()` (estimator.ts Task 5), and `booking-request.ts` (Task 6) all reference the same type from `@lustique/pricing`. `splitDeposit` and `grossUp` return types match usage in `request.ts` and `booking-request.ts`. `DbEnv` → `AuditEnv` → `BookingRequestEnv` extension chain is additive.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-11-lustique-booking-s2-request.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`.

**Which approach?**

**If Subagent-Driven chosen:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`

**If Inline Execution chosen:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`

---

## After S2

Update `SESSION_HANDOFF.md` ▶ NEXT to:
> 🔵 Opus: plan **S3 — confirm gate** using `superpowers:writing-plans`. Source: spec §5 (state machine), §7 (GET + POST /api/booking/confirm), §12 (token verify: base64url-decode → split → HMAC recompute → compare hash). S2 is the complete, tested request endpoint — the confirm_token_hash is in the DB; S3 consumes it.
