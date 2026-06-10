# Lustique Booking S2 — Request-to-Book — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

S1 (the booking data layer) is **done, merged, and verified**: 36 tests green, the Worker bundles, and the schema + money math + idempotency were audited faithful to the design spec. S2 is the next layer in the booking sequence (S1 ✅ → **S2** → S3 confirm → S4 Yoco → S5 cron → S6 emails).

**What S2 delivers:** the bride goes from the live estimate to a **persisted, server-priced booking request** that emails Zandeline a signed confirm link and the bride a "received" note. It is the first half of the `request → confirm → deposit` loop; S3 consumes the token to confirm.

**Decisions locked with Pieter (2026-06-10):**
1. **S2 = the full request leg** (validate → recompute → persist `requested` → generate confirm token + store hash → send both request emails). S3 = the render-only GET confirm page + POST confirm. *Why S2 owns token-gen + emails:* `bookings.confirm_token_hash` is `NOT NULL` and only the **hash** is stored, so the token must be generated at insert and the raw token (the only copy) emailed in the same step — it cannot be deferred to S3.
2. **Front-end is in scope** — Phase A (Worker endpoint, TDD) then Phase B (Astro estimator UI, build/e2e).
3. **Per-IP rate limiting = a Cloudflare edge rule at deploy** (not Worker code); the in-code, unit-tested abuse controls are **Turnstile + honeypot + idempotency**. (Documented in §Account/Deploy gates.)

**Goal:** Add `POST /api/booking/request` (server-authoritative pricing + persistence + signed confirm token + two Brevo emails) and the estimator "Request to book" UI that drives it.

**Architecture:** Extend the single-`fetch` router in `worker/src/index.ts` with one new POST route delegating to `worker/src/booking/request.ts`. New pure modules (`token`, `validation`, `turnstile`, `emails`) sit beside the S1 `db`/`util`/`audit` modules; all I/O takes an injected `fetch`/`now`/`uuid` for offline unit tests. The Worker gains a dependency on the `@lustique/pricing` workspace for the authoritative `computeEstimate` recompute. The front-end reuses `readInput()` from `estimator.ts` and mirrors the existing `enquiry.ts` submit pattern.

**Tech Stack:** Cloudflare Worker (TypeScript, ESM, dependency-free, `fetch`-only), WebCrypto (`crypto.subtle` HMAC-SHA256 + SHA-256), Supabase PostgREST, Brevo, Cloudflare Turnstile, `@lustique/pricing` (shared money/estimate engine), vitest, Astro.

**Account/build gate:** every task below **builds + unit-tests fully offline**. Going *live* needs (Pieter, in parallel): the client-owned Supabase project (apply `0001_booking_core.sql`), the Turnstile **site-key** (front-end) + **secret** (Worker), and the `wrangler secret put` values. No account is needed to write or test S2.

---

## File Structure

| File | Create / Modify | Responsibility |
|---|---|---|
| `worker/package.json` | Modify | add `@lustique/pricing` dependency |
| `worker/src/email.ts` | Create | extracted `brevoEmail` + `esc` + `cap` (injectable `fetch`), shared by enquiry + booking |
| `worker/src/index.ts` | Modify | import email helpers from `./email`; add `POST /api/booking/request` route |
| `worker/src/booking/token.ts` | Create | `signToken` / `hashToken` / `verifyToken` (HMAC-SHA256 + SHA-256, base64url) |
| `worker/src/booking/validation.ts` | Create | `parseBookingRequest` — typed body validation (honeypot, future date, consent, deposit %, email/phone) |
| `worker/src/booking/turnstile.ts` | Create | `verifyTurnstile` — Cloudflare siteverify call |
| `worker/src/booking/emails.ts` | Create | pure `requestBrideEmail` / `requestZandelineEmail` HTML builders |
| `worker/src/booking/db.ts` | Modify | add `countBookingsByDate` (same-date warning) |
| `worker/src/booking/request.ts` | Create | `handleBookingRequest` — orchestration |
| `worker/src/booking/*.test.ts` | Create | one test file per new module |
| `site/src/scripts/estimator.ts` | Modify | `export` `readInput()` for reuse |
| `site/src/pages/quote.astro` | Modify | deposit % selector, consent checkbox, Turnstile widget, "Request to book" button |
| `site/src/scripts/booking-request.ts` | Create | builds payload (incl. client-minted idempotency key) → POSTs `/api/booking/request` (mirrors `enquiry.ts`) |

**Reused as-is (do not reinvent):** `worker/src/booking/db.ts` (`insertBooking` idempotent, `insertAudit`), `worker/src/booking/util.ts` (`makeReference`), `worker/src/booking/audit.ts` (`writeAudit`), `shared/pricing` (`computeEstimate`, `randToCents`, `splitDeposit`), and `site/src/scripts/enquiry.ts` as the front-end submit template.

**Test command (all tasks):** `npm test -w lustique-form-handler` (worker) · `npm test -w @lustique/pricing` (pricing) · bundle proof `cd worker && npm exec -- wrangler deploy --dry-run --outdir /tmp/lustique-dry` · site `cd site && npm run build`.

---

## Phase A — Worker endpoint (TDD)

### Task A0: Wire `@lustique/pricing` into the Worker

**Files:**
- Modify: `worker/package.json`
- Verify: `shared/pricing/package.json` (exports resolve for esbuild)
- Test: `worker/src/booking/pricing-import.test.ts`

- [ ] **Step 1: Confirm pricing's entry point**

Read `shared/pricing/package.json`. Confirm it exposes the source via `"main"`/`"module"`/`"exports"` pointing at `src/index.ts` (the site already consumes it, so resolution exists). If no field resolves to `src/index.ts`, add `"exports": { ".": "./src/index.ts" }`.

- [ ] **Step 2: Add the dependency**

In `worker/package.json` add to a `"dependencies"` block:
```json
"dependencies": { "@lustique/pricing": "*" }
```
Run `npm install` **(flag to Pieter — sandbox blocks installs)** or rely on the hoisted workspace link.

- [ ] **Step 3: Write the failing smoke test**
```ts
// worker/src/booking/pricing-import.test.ts
import { describe, it, expect } from "vitest";
import { computeEstimate, randToCents, splitDeposit } from "@lustique/pricing";

describe("pricing import from worker", () => {
  it("computes and converts a known estimate", () => {
    const r = computeEstimate({
      occasion: "wedding", brideHairLen: "medium",
      partyHair: { short: 0, medium: 0, long: 0, xlong: 0 },
      bmMakeup: 0, bmHair: 0, momMakeup: 0, momHair: 0,
      fgAge: "over", fgMakeup: 0, fgHair: 0, fgHairLen: "short",
      guestMakeup: 0, guestHair: 0, requestedArtists: 0,
      promo: { kind: "none" }, travel: { band: "studio" },
    });
    expect(r.total).toBeGreaterThan(0);
    expect(randToCents(r.total)).toBe(r.total * 100);
    expect(splitDeposit(100000, 50)).toEqual({ depositNetCents: 50000, balanceNetCents: 50000 });
  });
});
```

- [ ] **Step 4: Run — verify pass + bundle**

`npm test -w lustique-form-handler` → PASS. Then `cd worker && npm exec -- wrangler deploy --dry-run --outdir /tmp/lustique-dry` → bundles (proves esbuild resolves the workspace package). If the bundle fails to resolve `@lustique/pricing`, fix the exports in Step 1.

- [ ] **Step 5: Commit**
```bash
git add worker/package.json shared/pricing/package.json worker/src/booking/pricing-import.test.ts
git commit -m "chore(worker): depend on @lustique/pricing for authoritative recompute"
```

---

### Task A1: Extract the Brevo email helper (DRY, injectable fetch)

**Files:**
- Create: `worker/src/email.ts`
- Modify: `worker/src/index.ts` (import from `./email`; remove local copies)
- Test: `worker/src/email.test.ts`

> Why: `request.ts` and the enquiry handler both send Brevo email. Extracting avoids a circular import (request → index) and makes `fetch` injectable for tests.

- [ ] **Step 1: Write the failing test**
```ts
// worker/src/email.test.ts
import { describe, it, expect, vi } from "vitest";
import { brevoEmail, esc, cap } from "./email";

describe("esc/cap", () => {
  it("escapes html and caps length", () => {
    expect(esc('<b>&"')).toBe("&lt;b&gt;&amp;\"");
    expect(cap("abcdef", 3)).toBe("abc…");
  });
});
describe("brevoEmail", () => {
  it("POSTs to Brevo with the api key and sender", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    await brevoEmail({ BREVO_API_KEY: "k", NOTIFY_EMAIL: "info@x.co" } as any,
      { email: "b@x.co", name: "B" }, "Subj", "<p>hi</p>", f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init!.headers as any)["api-key"]).toBe("k");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

`npm test -w lustique-form-handler` → FAIL (`Cannot find module './email'`).

- [ ] **Step 3: Create `worker/src/email.ts`**
```ts
/** Shared transactional-email + HTML helpers. `fetch` injectable for tests. */
export interface EmailEnv { BREVO_API_KEY: string; NOTIFY_EMAIL: string; }

export const esc = (s = "") =>
  s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
/** Defensive length cap — never trust client-sent lengths (SECURITY.md §2). */
export const cap = (s = "", n = 600) => (s.length > n ? s.slice(0, n) + "…" : s);

export async function brevoEmail(
  env: EmailEnv,
  to: { email: string; name?: string },
  subject: string,
  html: string,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: env.NOTIFY_EMAIL, name: "Lustique Co." }, to: [to], subject, htmlContent: html }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}
```

- [ ] **Step 4: Update `worker/src/index.ts`**

Remove the local `esc`, `cap`, and `brevoEmail` definitions (lines ~51–98). Add at top: `import { brevoEmail, esc, cap } from "./email";`. Leave the enquiry handler otherwise unchanged.

- [ ] **Step 5: Run tests + bundle**

`npm test -w lustique-form-handler` → PASS. `cd worker && npm exec -- wrangler deploy --dry-run --outdir /tmp/lustique-dry` → bundles (proves the enquiry path still compiles).

- [ ] **Step 6: Commit**
```bash
git add worker/src/email.ts worker/src/email.test.ts worker/src/index.ts
git commit -m "refactor(worker): extract shared brevoEmail/esc/cap into email.ts"
```

---

### Task A2: Confirm-token module (sign / hash / verify)

**Files:**
- Create: `worker/src/booking/token.ts`
- Test: `worker/src/booking/token.test.ts`

> Spec §12: `token = base64url( bookingId | exp | HMAC-SHA256(bookingId|exp, SIGNING_SECRET) )`; store `sha256(token)`; enforce expiry + single-use. `verifyToken` is consumed in S3 but built+tested now (one cohesive module).

- [ ] **Step 1: Write the failing test**
```ts
// worker/src/booking/token.test.ts
import { describe, it, expect } from "vitest";
import { signToken, hashToken, verifyToken } from "./token";

const SECRET = "test-signing-secret";
const ID = "11111111-2222-3333-4444-555555555555";

describe("token", () => {
  it("signs deterministically and hashes to 64 hex chars", async () => {
    const exp = 2_000_000_000_000;
    const t1 = await signToken(ID, exp, SECRET);
    const t2 = await signToken(ID, exp, SECRET);
    expect(t1).toBe(t2);
    expect(await hashToken(t1)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("verifies a valid, unexpired token", async () => {
    const exp = 2_000_000_000_000;
    const t = await signToken(ID, exp, SECRET);
    expect(await verifyToken(t, SECRET, exp - 1)).toEqual({ ok: true, bookingId: ID });
  });
  it("rejects an expired token", async () => {
    const exp = 1_000;
    const t = await signToken(ID, exp, SECRET);
    expect((await verifyToken(t, SECRET, exp + 1)).ok).toBe(false);
  });
  it("rejects a tampered token / wrong secret", async () => {
    const t = await signToken(ID, 2_000_000_000_000, SECRET);
    expect((await verifyToken(t, "wrong", 1)).ok).toBe(false);
    expect((await verifyToken(t + "x", SECRET, 1)).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -w lustique-form-handler` → FAIL (`Cannot find module './token'`).

- [ ] **Step 3: Create `worker/src/booking/token.ts`**
```ts
/** Signed single-use confirm links (spec §12). WebCrypto only — no deps. */
const enc = new TextEncoder();

const b64url = (bytes: Uint8Array): string => {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string): string => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

async function hmac(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** `exp` is epoch ms. Returns the raw token (only copy — goes straight into the email link). */
export async function signToken(bookingId: string, exp: number, secret: string): Promise<string> {
  const payload = `${bookingId}|${exp}`;
  const sig = b64url(await hmac(payload, secret));
  return b64url(enc.encode(`${payload}|${sig}`));
}

/** sha256(token) hex — what we persist as confirm_token_hash. */
export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyToken(
  token: string, secret: string, nowMs: number,
): Promise<{ ok: true; bookingId: string } | { ok: false; reason: string }> {
  let raw: string;
  try { raw = fromB64url(token); } catch { return { ok: false, reason: "malformed" }; }
  const parts = raw.split("|");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [bookingId, expStr, sig] = parts as [string, string, string];
  const expected = b64url(await hmac(`${bookingId}|${expStr}`, secret));
  if (!timingSafeEqual(sig, expected)) return { ok: false, reason: "bad-signature" };
  if (Number(expStr) < nowMs) return { ok: false, reason: "expired" };
  return { ok: true, bookingId };
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -w lustique-form-handler` → PASS (token suite green).

- [ ] **Step 5: Commit**
```bash
git add worker/src/booking/token.ts worker/src/booking/token.test.ts
git commit -m "feat(worker): HMAC confirm-token sign/hash/verify (spec §12)"
```

---

### Task A3: Request validation

**Files:**
- Create: `worker/src/booking/validation.ts`
- Test: `worker/src/booking/validation.test.ts`

> Spec §8/§12 + DoD §14.6/§14.8: honeypot, future `wedding_date`, valid phone, `consent === true`, `deposit_pct ∈ {25,50,100}`. Returns a typed value, an error string, or `spam`.

- [ ] **Step 1: Write the failing test**
```ts
// worker/src/booking/validation.test.ts
import { describe, it, expect } from "vitest";
import { parseBookingRequest } from "./validation";

const base = () => ({
  idempotencyKey: "id-1", turnstileToken: "tt",
  estimateInput: { occasion: "wedding" }, // shape checked by computeEstimate later
  brideName: "Ada", brideEmail: "ada@x.co", bridePhone: "0821234567",
  weddingDate: "2027-01-01", depositPct: 50, consent: true,
});
const NOW = new Date("2026-06-10T00:00:00Z");

describe("parseBookingRequest", () => {
  it("accepts a valid payload", () => {
    const r = parseBookingRequest(base(), NOW);
    expect(r.ok).toBe(true);
  });
  it("flags honeypot as spam", () => {
    expect(parseBookingRequest({ ...base(), hp_company: "bot" }, NOW)).toEqual({ spam: true });
  });
  it("rejects a past date", () => {
    const r = parseBookingRequest({ ...base(), weddingDate: "2020-01-01" }, NOW);
    expect(r).toMatchObject({ ok: false });
  });
  it("requires consent", () => {
    expect(parseBookingRequest({ ...base(), consent: false }, NOW)).toMatchObject({ ok: false });
  });
  it("rejects a bad deposit %", () => {
    expect(parseBookingRequest({ ...base(), depositPct: 30 }, NOW)).toMatchObject({ ok: false });
  });
  it("rejects a bad email", () => {
    expect(parseBookingRequest({ ...base(), brideEmail: "nope" }, NOW)).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`Cannot find module './validation'`).

- [ ] **Step 3: Create `worker/src/booking/validation.ts`**
```ts
import type { EstimateInput } from "@lustique/pricing";

export interface BookingRequest {
  idempotencyKey: string;
  turnstileToken: string;
  estimateInput: EstimateInput;
  brideName: string;
  brideEmail: string;
  bridePhone: string;
  weddingDate: string;            // YYYY-MM-DD
  town?: string; province?: string; venue?: string;
  depositPct: 25 | 50 | 100;
  consent: boolean;
  notes?: string;
}
export type ParseResult =
  | { ok: true; value: BookingRequest }
  | { ok: false; error: string }
  | { spam: true };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function parseBookingRequest(body: unknown, now: Date): ParseResult {
  const b = (body ?? {}) as Record<string, unknown>;
  if (str(b.hp_company) !== "") return { spam: true };

  const idempotencyKey = str(b.idempotencyKey);
  const turnstileToken = str(b.turnstileToken);
  const brideName = str(b.brideName);
  const brideEmail = str(b.brideEmail);
  const bridePhone = str(b.bridePhone);
  const weddingDate = str(b.weddingDate);
  const depositPct = b.depositPct as number;
  const consent = b.consent === true;

  if (!idempotencyKey) return { ok: false, error: "Missing request id." };
  if (!turnstileToken) return { ok: false, error: "Bot check missing." };
  if (brideName.length < 2) return { ok: false, error: "Please add your name." };
  if (!EMAIL.test(brideEmail)) return { ok: false, error: "Please add a valid email." };
  if (bridePhone.replace(/\D/g, "").length < 7) return { ok: false, error: "Please add a valid phone number." };

  const d = new Date(weddingDate + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return { ok: false, error: "Please choose a valid date." };
  if (d.getTime() <= now.getTime()) return { ok: false, error: "The date must be in the future." };

  if (![25, 50, 100].includes(depositPct)) return { ok: false, error: "Choose a deposit of 25%, 50% or 100%." };
  if (!consent) return { ok: false, error: "Please accept the terms to continue." };
  if (typeof b.estimateInput !== "object" || b.estimateInput === null)
    return { ok: false, error: "Missing estimate details." };

  return {
    ok: true,
    value: {
      idempotencyKey, turnstileToken, brideName, brideEmail, bridePhone, weddingDate,
      town: str(b.town) || undefined, province: str(b.province) || undefined, venue: str(b.venue) || undefined,
      depositPct: depositPct as 25 | 50 | 100, consent,
      estimateInput: b.estimateInput as EstimateInput,
      notes: str(b.notes) || undefined,
    },
  };
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**
```bash
git add worker/src/booking/validation.ts worker/src/booking/validation.test.ts
git commit -m "feat(worker): booking request validation (future date, consent, deposit %)"
```

---

### Task A4: Turnstile verification

**Files:**
- Create: `worker/src/booking/turnstile.ts`
- Test: `worker/src/booking/turnstile.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// worker/src/booking/turnstile.test.ts
import { describe, it, expect, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

describe("verifyTurnstile", () => {
  it("returns true on success", async () => {
    const f = vi.fn().mockResolvedValue(ok({ success: true }));
    expect(await verifyTurnstile("secret", "tok", "1.2.3.4", f as unknown as typeof fetch)).toBe(true);
  });
  it("returns false on failure", async () => {
    const f = vi.fn().mockResolvedValue(ok({ success: false }));
    expect(await verifyTurnstile("secret", "tok", null, f as unknown as typeof fetch)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Create `worker/src/booking/turnstile.ts`**
```ts
/** Server-side Cloudflare Turnstile check (SECURITY.md §2). `fetch` injectable. */
export async function verifyTurnstile(
  secret: string, token: string, ip: string | null, f: typeof fetch = fetch,
): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const r = await f("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  if (!r.ok) return false;
  const data = (await r.json()) as { success?: boolean };
  return data.success === true;
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**
```bash
git add worker/src/booking/turnstile.ts worker/src/booking/turnstile.test.ts
git commit -m "feat(worker): Cloudflare Turnstile server verification"
```

---

### Task A5: `countBookingsByDate` (same-date warning)

**Files:**
- Modify: `worker/src/booking/db.ts`
- Test: `worker/src/booking/db.test.ts` (add a case)

- [ ] **Step 1: Add the failing test** (append to `db.test.ts`)
```ts
import { countBookingsByDate } from "./db";
describe("countBookingsByDate", () => {
  it("counts bookings already holding a date", async () => {
    const f = vi.fn().mockResolvedValue(res([{ id: "a" }, { id: "b" }]));
    expect(await countBookingsByDate(env, "2027-01-01", f as unknown as typeof fetch)).toBe(2);
    expect((f.mock.calls[0]![0] as string)).toContain("wedding_date=eq.2027-01-01");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`countBookingsByDate` is not exported).

- [ ] **Step 3: Add to `worker/src/booking/db.ts`**
```ts
/** How many bookings already hold a date — feeds Zandeline's same-date warning (spec §10). */
export async function countBookingsByDate(env: DbEnv, weddingDate: string, f: typeof fetch = fetch): Promise<number> {
  const r = await f(rest(env, `bookings?wedding_date=eq.${encodeURIComponent(weddingDate)}&select=id`), { headers: headers(env) });
  if (!r.ok) throw new Error(`countBookingsByDate ${r.status}`);
  const rows = (await r.json()) as unknown[];
  return Array.isArray(rows) ? rows.length : 0;
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**
```bash
git add worker/src/booking/db.ts worker/src/booking/db.test.ts
git commit -m "feat(worker): countBookingsByDate for same-date confirm warning"
```

---

### Task A6: Request-stage email builders

**Files:**
- Create: `worker/src/booking/emails.ts`
- Test: `worker/src/booking/emails.test.ts`

> Pure functions returning `{ subject, html }` (spec §10 #1, #2). The confirm URL points at the S3 GET page (`${origin}/api/booking/confirm?token=…`). Use `esc` from `../email`.

- [ ] **Step 1: Write the failing test**
```ts
// worker/src/booking/emails.test.ts
import { describe, it, expect } from "vitest";
import { requestBrideEmail, requestZandelineEmail } from "./emails";

describe("request emails", () => {
  it("bride email greets by name and quotes the reference", () => {
    const e = requestBrideEmail("Ada", "LUS-2026-ABC123");
    expect(e.html).toContain("Ada");
    expect(e.html).toContain("LUS-2026-ABC123");
  });
  it("zandeline email includes the confirm link, total and same-date warning", () => {
    const e = requestZandelineEmail({
      reference: "LUS-2026-ABC123", brideName: "Ada", brideEmail: "ada@x.co", bridePhone: "082",
      weddingDate: "2027-01-01", occasion: "wedding", partySize: 5, totalRand: 9365,
      depositPct: 50, confirmUrl: "https://lustiqueco.co.za/api/booking/confirm?token=T", otherOnDate: 1,
    });
    expect(e.html).toContain("https://lustiqueco.co.za/api/booking/confirm?token=T");
    expect(e.html).toContain("9 365"); // or "9365" — match your formatter
    expect(e.html).toContain("1 other");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Create `worker/src/booking/emails.ts`**
```ts
import { esc } from "../email";

// ICU-free thousands grouping (Workers has limited Intl) → "R 9 365"
const rand = (r: number) => "R " + Math.round(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function requestBrideEmail(name: string, reference: string): { subject: string; html: string } {
  return {
    subject: "We've received your booking request — Lustique Co.",
    html: `<p>Hi ${esc(name)},</p>
      <p>Thank you — we have your booking request (ref <strong>${esc(reference)}</strong>) and Zandeline is
      confirming availability for your date now. You'll get a secure deposit link as soon as it's confirmed.</p>
      <p>Blessings,<br/>The Lustique Cosmetology Team</p>`,
  };
}

export interface ZandelineArgs {
  reference: string; brideName: string; brideEmail: string; bridePhone: string;
  weddingDate: string; occasion: string; partySize: number; totalRand: number;
  depositPct: number; confirmUrl: string; otherOnDate: number;
}
export function requestZandelineEmail(a: ZandelineArgs): { subject: string; html: string } {
  const warn = a.otherOnDate > 0
    ? `<p style="color:#9E5F58;"><strong>⚠️ ${a.otherOnDate} other booking(s)</strong> already hold ${esc(a.weddingDate)}.</p>` : "";
  return {
    subject: `New booking request — ${esc(a.brideName)} · ${esc(a.weddingDate)}`,
    html: `<p><strong>${esc(a.brideName)}</strong> — ${esc(a.occasion)}<br/>${esc(a.brideEmail)} · ${esc(a.bridePhone)}</p>
      ${warn}
      <p>Date: <strong>${esc(a.weddingDate)}</strong> · Party: <strong>${a.partySize}</strong><br/>
      Total: <strong>${rand(a.totalRand)}</strong> · Deposit: <strong>${a.depositPct}%</strong> · Ref ${esc(a.reference)}</p>
      <p><a href="${esc(a.confirmUrl)}" style="background:#9E5F58;color:#FAF6F0;padding:12px 20px;border-radius:8px;text-decoration:none;">Review &amp; confirm →</a></p>
      <p style="font-size:12px;color:#6b5c52;">This link opens a confirmation page; it does not confirm by itself.</p>`,
  };
}
```

- [ ] **Step 4: Run to verify pass** — PASS (adjust the `9 365` assertion to your `rand()` formatter output).

- [ ] **Step 5: Commit**
```bash
git add worker/src/booking/emails.ts worker/src/booking/emails.test.ts
git commit -m "feat(worker): request-stage email builders (bride received + Zandeline confirm)"
```

---

### Task A7: `handleBookingRequest` orchestration

**Files:**
- Create: `worker/src/booking/request.ts`
- Test: `worker/src/booking/request.test.ts`

> Honeypot → Turnstile → validate → recompute (`computeEstimate`, wrapped) → `splitDeposit` → **mint uuid → reference → token → hash** → `insertBooking` (idempotent) → if new: `writeAudit` + both emails → respond `{ ok, reference }`. Detect new-vs-duplicate by comparing the returned id to the minted id, so a retry returns the same reference and sends **no** duplicate emails.

- [ ] **Step 1: Write the failing test**
```ts
// worker/src/booking/request.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleBookingRequest } from "./request";

const validInput = {
  occasion: "wedding", brideHairLen: "medium",
  partyHair: { short: 0, medium: 0, long: 0, xlong: 0 },
  bmMakeup: 0, bmHair: 0, momMakeup: 0, momHair: 0,
  fgAge: "over", fgMakeup: 0, fgHair: 0, fgHairLen: "short",
  guestMakeup: 0, guestHair: 0, requestedArtists: 0,
  promo: { kind: "none" }, travel: { band: "studio" },
};
const body = () => ({
  idempotencyKey: "k1", turnstileToken: "tt", estimateInput: validInput,
  brideName: "Ada", brideEmail: "ada@x.co", bridePhone: "0821234567",
  weddingDate: "2027-01-01", depositPct: 50, consent: true,
});
const env = {
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "svc",
  SIGNING_SECRET: "sign", TURNSTILE_SECRET: "ts",
  BREVO_API_KEY: "b", NOTIFY_EMAIL: "info@x.co", ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
} as any;

// fetch router keyed by URL substring
function makeFetch(insertId: string) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("siteverify")) return new Response(JSON.stringify({ success: true }));
    if (url.includes("/rest/v1/bookings") && init?.method === "POST")
      return new Response(JSON.stringify([{ id: insertId, reference: "LUS-2026-NEW001" }]), { status: 201 });
    if (url.includes("/rest/v1/audit_log")) return new Response("{}", { status: 201 });
    if (url.includes("api.brevo.com")) return new Response("{}", { status: 201 });
    if (url.includes("wedding_date=eq.")) return new Response(JSON.stringify([{ id: insertId }]));
    return new Response("[]");
  });
}

describe("handleBookingRequest", () => {
  const now = () => new Date("2026-06-10T00:00:00Z");
  const uuid = () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("persists, audits, emails, returns the reference (happy path)", async () => {
    const f = makeFetch(uuid()); // returned id === minted id ⇒ new
    const r = await handleBookingRequest(body(), env, "1.2.3.4", { fetch: f as any, now, uuid });
    expect(r.status).toBe(200);
    expect((r.body as any).reference).toBe("LUS-2026-NEW001");
    expect(f.mock.calls.filter((c) => String(c[0]).includes("api.brevo.com")).length).toBe(2);
  });
  it("swallows honeypot silently with no insert", async () => {
    const f = makeFetch(uuid());
    const r = await handleBookingRequest({ ...body(), hp_company: "x" }, env, null, { fetch: f as any, now, uuid });
    expect(r.status).toBe(200);
    expect(f.mock.calls.some((c) => String(c[0]).includes("/rest/v1/bookings"))).toBe(false);
  });
  it("rejects a failed Turnstile (403)", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("siteverify") ? new Response(JSON.stringify({ success: false })) : new Response("[]"));
    const r = await handleBookingRequest(body(), env, null, { fetch: f as any, now, uuid });
    expect(r.status).toBe(403);
  });
  it("rejects invalid input (422)", async () => {
    const f = makeFetch(uuid());
    const r = await handleBookingRequest({ ...body(), consent: false }, env, null, { fetch: f as any, now, uuid });
    expect(r.status).toBe(422);
  });
  it("on a duplicate returns the same reference and sends no emails", async () => {
    const f = makeFetch("different-existing-id"); // returned id !== minted id ⇒ duplicate
    const r = await handleBookingRequest(body(), env, null, { fetch: f as any, now, uuid });
    expect(r.status).toBe(200);
    expect(f.mock.calls.some((c) => String(c[0]).includes("api.brevo.com"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Create `worker/src/booking/request.ts`**
```ts
import { computeEstimate, randToCents, splitDeposit } from "@lustique/pricing";
import { insertBooking, countBookingsByDate } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { makeReference } from "./util";
import { signToken, hashToken } from "./token";
import { verifyTurnstile } from "./turnstile";
import { parseBookingRequest } from "./validation";
import { requestBrideEmail, requestZandelineEmail } from "./emails";
import { brevoEmail } from "../email";

export interface RequestEnv extends AuditEnv {
  SIGNING_SECRET: string; TURNSTILE_SECRET: string;
  BREVO_API_KEY: string; NOTIFY_EMAIL: string; ALLOWED_ORIGIN: string;
}
interface Deps { fetch?: typeof fetch; now?: () => Date; uuid?: () => string; }
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;          // 14 days (spec §12)
const SANITY_CAP_CENTS = 20_000_000;                     // R200,000 (spec §8)

export async function handleBookingRequest(
  body: unknown, env: RequestEnv, ip: string | null, deps: Deps = {},
): Promise<{ status: number; body: object }> {
  const f = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());

  const parsed = parseBookingRequest(body, now());
  if ("spam" in parsed) return { status: 200, body: { ok: true } };       // silent swallow
  if (!parsed.ok) return { status: 422, body: { ok: false, error: parsed.error } };
  const v = parsed.value;

  if (!(await verifyTurnstile(env.TURNSTILE_SECRET, v.turnstileToken, ip, f)))
    return { status: 403, body: { ok: false, error: "Bot check failed — please retry." } };

  let result;
  try { result = computeEstimate(v.estimateInput); }
  catch { return { status: 422, body: { ok: false, error: "We couldn't read your estimate details." } }; }

  const totalCents = randToCents(result.total);
  const { depositNetCents, balanceNetCents } = splitDeposit(totalCents, v.depositPct);
  const nowMs = now().getTime();
  const id = uuid();
  const reference = makeReference(id, new Date(nowMs).getUTCFullYear());
  const exp = nowMs + TOKEN_TTL_MS;
  const token = await signToken(id, exp, env.SIGNING_SECRET);
  const confirmTokenHash = await hashToken(token);

  const row = {
    id, reference, idempotency_key: v.idempotencyKey, status: "requested",
    occasion: v.estimateInput.occasion, wedding_date: v.weddingDate,
    bride_name: v.brideName, bride_email: v.brideEmail, bride_phone: v.bridePhone,
    town: v.town ?? null, province: v.province ?? null, venue: v.venue ?? null,
    party_size: result.heads, estimate_input: v.estimateInput,
    total_cents: totalCents, quote_lines: result.lines,
    deposit_pct: v.depositPct, deposit_net_cents: depositNetCents, balance_net_cents: balanceNetCents,
    consent_at: new Date(nowMs).toISOString(),
    confirm_token_hash: confirmTokenHash, confirm_token_expires_at: new Date(exp).toISOString(),
    notes: totalCents > SANITY_CAP_CENTS ? "⚠ over R200k — manual review" : (v.notes ?? null),
  };

  const inserted = await insertBooking(env, row, f);
  const isNew = inserted.id === id;                 // dup ⇒ original (different id) returned

  if (isNew) {
    await writeAudit(env, { bookingId: id, eventType: "request.created",
      payload: { reference, total_cents: totalCents, deposit_pct: v.depositPct } }, f, now);
    const otherOnDate = Math.max(0, (await countBookingsByDate(env, v.weddingDate, f)) - 1);
    const confirmUrl = `${env.ALLOWED_ORIGIN}/api/booking/confirm?token=${encodeURIComponent(token)}`;
    const bride = requestBrideEmail(v.brideName, reference);
    await brevoEmail(env, { email: v.brideEmail, name: v.brideName }, bride.subject, bride.html, f);
    const z = requestZandelineEmail({
      reference, brideName: v.brideName, brideEmail: v.brideEmail, bridePhone: v.bridePhone,
      weddingDate: v.weddingDate, occasion: v.estimateInput.occasion, partySize: result.heads,
      totalRand: result.total, depositPct: v.depositPct, confirmUrl, otherOnDate,
    });
    await brevoEmail(env, { email: env.NOTIFY_EMAIL, name: "Lustique" }, z.subject, z.html, f);
  }

  return { status: 200, body: { ok: true, reference: inserted.reference } };
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -w lustique-form-handler` → PASS (all 5 cases).

- [ ] **Step 5: Commit**
```bash
git add worker/src/booking/request.ts worker/src/booking/request.test.ts
git commit -m "feat(worker): handleBookingRequest — recompute, persist, sign token, email"
```

---

### Task A8: Route `POST /api/booking/request` in `index.ts`

**Files:**
- Modify: `worker/src/index.ts`
- Test: `worker/src/index.test.ts` (new — minimal dispatch test)

- [ ] **Step 1: Write the failing dispatch test**
```ts
// worker/src/index.test.ts
import { describe, it, expect, vi } from "vitest";
import worker from "./index";
const env = { ALLOWED_ORIGIN: "*" } as any;

describe("router", () => {
  it("404s unknown routes", async () => {
    const r = await worker.fetch(new Request("https://w/api/nope", { method: "POST", body: "{}" }), env);
    expect(r.status).toBe(404);
  });
  it("routes /api/booking/request (422 on empty body, not 404)", async () => {
    const r = await worker.fetch(new Request("https://w/api/booking/request", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), env);
    expect(r.status).not.toBe(404);
  });
});
```
> Note: with `{}` the request fails Turnstile/validation before any network call, so no live deps are needed for this dispatch test.

- [ ] **Step 2: Run to verify it fails** — FAIL (route 404s).

- [ ] **Step 3: Modify `worker/src/index.ts`**

Add `import { handleBookingRequest } from "./booking/request";`. In `fetch`, after the OPTIONS handler, before the enquiry block, add:
```ts
if (req.method === "POST" && url.pathname === "/api/booking/request") {
  let payload: unknown;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Malformed request." }, 400, origin); }
  const ip = req.headers.get("cf-connecting-ip");
  try {
    const out = await handleBookingRequest(payload, env, ip);
    return json(out.body, out.status, origin);
  } catch {
    return json({ ok: false, error: "We couldn't process that — please email info@lustiqueco.co.za." }, 502, origin);
  }
}
```
Also update the stale TODO comment (lines ~155–156) to reflect that `/api/booking/request` now exists (S3/S4 add confirm + webhook).

- [ ] **Step 4: Run tests + bundle** — `npm test -w lustique-form-handler` → PASS; `cd worker && npm exec -- wrangler deploy --dry-run --outdir /tmp/lustique-dry` → bundles.

- [ ] **Step 5: Commit**
```bash
git add worker/src/index.ts worker/src/index.test.ts
git commit -m "feat(worker): route POST /api/booking/request"
```

---

## Phase B — Front-end (Astro, build + manual e2e)

> Build-tested, not unit-tested. Live e2e is gated on the Supabase project + the Turnstile **site-key**. Until then, verify the build and the payload shape.

### Task B1: Add the request fields + Turnstile to `quote.astro`

**Files:**
- Modify: `site/src/pages/quote.astro`

- [ ] **Step 1: Add a deposit selector + consent + Turnstile + button** (in the final form step, matching the existing `.field` / `.btn` conventions from `site/src/styles/global.css`):
```html
<div class="field">
  <label>Deposit to secure your date</label>
  <select id="depositPct">
    <option value="50" selected>50% — recommended</option>
    <option value="25">25%</option>
    <option value="100">100% — pay in full</option>
  </select>
</div>
<div class="field">
  <label class="consent">
    <input type="checkbox" id="consent" />
    I agree to the <a href="/privacy" target="_blank" rel="noopener">privacy terms</a> and to be contacted about my booking.
  </label>
</div>
<!-- Turnstile: data-sitekey is the PUBLIC key (set at deploy); managed widget -->
<div class="cf-turnstile" data-sitekey="PUBLIC_TURNSTILE_SITE_KEY" data-theme="light"></div>
<button type="button" id="requestBookingBtn" class="btn btn-primary">Request to book</button>
<p id="bookingStatus" class="note" role="status" aria-live="polite"></p>
```
Add the Turnstile script once in the page head/layout: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`. (Honeypot `hp_company` + `weddingDate` already exist.)

- [ ] **Step 2: Verify build** — `cd site && npm run build` → succeeds; page still renders. Commit.
```bash
git add site/src/pages/quote.astro
git commit -m "feat(site): deposit %, consent, Turnstile + Request-to-book button"
```

### Task B2: `booking-request.ts` submit script

**Files:**
- Modify: `site/src/scripts/estimator.ts` (export `readInput`)
- Create: `site/src/scripts/booking-request.ts`

- [ ] **Step 1: Export `readInput`** from `estimator.ts` (`export function readInput()` — it currently builds the `EstimateInput`).

- [ ] **Step 2: Create `site/src/scripts/booking-request.ts`** — model it on `enquiry.ts` (same 15s-timeout + single-retry + error UI). On `#requestBookingBtn` click:
```ts
import { readInput } from "./estimator";

const $ = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
function turnstileToken(): string {
  return (document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value ?? "";
}
async function submit() {
  const status = document.getElementById("bookingStatus")!;
  if (!($("consent") as HTMLInputElement)?.checked) { status.textContent = "Please accept the terms first."; return; }
  const payload = {
    idempotencyKey: crypto.randomUUID(),
    turnstileToken: turnstileToken(),
    estimateInput: readInput(),
    brideName: `${$("fName")?.value ?? ""} ${$("lName")?.value ?? ""}`.trim(),
    brideEmail: $("email")?.value ?? "",
    bridePhone: $("phone")?.value ?? "",
    weddingDate: ($("weddingDate")?.value || $("eventDate")?.value || $("lessonsDate")?.value || ""),
    town: $("townInput")?.value, province: $("provinceInput")?.value, venue: $("venueInput")?.value,
    depositPct: Number($("depositPct")?.value ?? 50),
    consent: ($("consent") as HTMLInputElement)?.checked === true,
    hp_company: $("hp_company")?.value ?? "",
  };
  // fetch("/api/booking/request", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(payload) })
  // — copy the timeout + retry + 4xx/5xx handling from enquiry.ts; on { ok:true, reference } show:
  //   "Request sent — check your inbox. Zandeline will confirm your date shortly. Ref: <reference>"
}
document.getElementById("requestBookingBtn")?.addEventListener("click", submit);
```
Wire the script into `quote.astro` (same way `enquiry.ts` / `estimator.ts` are imported).

- [ ] **Step 3: Verify build** — `cd site && npm run build` → succeeds. Commit.
```bash
git add site/src/scripts/estimator.ts site/src/scripts/booking-request.ts site/src/pages/quote.astro
git commit -m "feat(site): Request-to-book submit (idempotency key, recompute payload)"
```

---

## Verification (Definition of Done — S2)

Run after Phase A and again after Phase B:
- [ ] `npm test -w @lustique/pricing` → 24 pass (unchanged).
- [ ] `npm test -w lustique-form-handler` → **all pass** (12 from S1 + new: token, validation, turnstile, db count, emails, request handler, router).
- [ ] `cd worker && npm exec -- wrangler deploy --dry-run --outdir /tmp/lustique-dry` → bundles (route + pricing import resolve).
- [ ] `cd site && npm run build` → builds; `npx astro check` → 0 errors.
- [ ] **Spec/DoD mapping:** §14.1 row with **server-recomputed** `total_cents` ✅ (handler ignores any client total); §14.6 validation tests (future date, consent, dedupe) + token sign/verify incl. expiry & reuse ✅; §14.7 duplicate retry → same reference, no second row, **no duplicate emails** ✅ (id-compare); §14.8 consent captured (`consent_at`) + Turnstile + honeypot ✅.
- [ ] **Live e2e (gated — do once accounts land):** apply `0001_booking_core.sql`; `wrangler secret put` the 6 secrets; set the Turnstile site-key in `quote.astro`; submit the estimator (bride *medium* + 3 bridesmaids + 2 mothers + 1 flower girl, promo on → "from R 8 865") → a `bookings(requested)` row appears, Zandeline + bride emails arrive, the confirm link renders (once S3 ships).

## Self-Review (run before handoff)
- **Spec coverage:** §5 `—→requested` transition ✅ (A7 + audit `request.created`); §7 request row ✅; §8 recompute + gross-up + sanity cap ✅; §10 #1/#2 emails ✅; §12 signed token + honeypot + Turnstile + consent ✅. *Out of S2 (correctly):* confirm GET/POST (S3), Yoco (S4), cron (S5).
- **Type consistency:** `BookingRequest` (validation) → row keys match `0001_booking_core.sql` columns exactly; `RequestEnv extends AuditEnv` (which extends `DbEnv`) + email/signing/turnstile secrets — all already on the `Env` interface in `index.ts`.
- **Reuse:** `insertBooking`, `writeAudit`, `makeReference`, `computeEstimate`, `randToCents`, `splitDeposit`, `brevoEmail`, `enquiry.ts` pattern — no reinvention.

## Account / Deploy gates (Pieter — parallel, not blocking the build)
- Client-owned **Supabase** project created + `0001_booking_core.sql` applied; `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` set via `wrangler secret put`.
- **Turnstile**: create a widget → site-key into `quote.astro`, `TURNSTILE_SECRET` via `wrangler secret put`.
- `SIGNING_SECRET` (random 32+ bytes) via `wrangler secret put`.
- **Per-IP rate limit:** add a Cloudflare rule on `/api/booking/request` (e.g. 5/min/IP) at deploy — the in-code controls are Turnstile + honeypot + idempotency.
- (Carryover from spec §12) 🔐 rotate the exposed Sanity Viewer token when next touching secrets.

## Execution Handoff
Plan saved. Recommended: **`superpowers:subagent-driven-development`** (fresh subagent per task, two-stage review) — or **`superpowers:executing-plans`** (inline, batched checkpoints). Per the device standard: **Opus wrote this plan; Sonnet builds it.**
