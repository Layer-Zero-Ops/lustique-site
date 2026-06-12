# Lustique Booking S3 — Confirm Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the confirm gate — Zandeline opens a single-use token link, sees the booking, and confirms (→ bride gets EFT deposit details) or declines (→ bride gets a gentle no).

**Architecture:** A new `worker/src/booking/confirm.ts` adds two route handlers. `GET /api/booking/confirm?token=` is **render-only** (mail scanners pre-fetch GET, so it must never mutate — spec §12). `POST /api/booking/confirm` verifies the HMAC token, does a **guarded** `requested → confirmed|declined` transition (atomic PostgREST compare-and-set), emails the bride via Brevo, writes an audit record, and 303-redirects to a static Astro thank-you page. Token authenticity verification is added to `token.ts`; the token-hash lookup + guarded transition are added to `db.ts`.

**Tech Stack:** TypeScript Cloudflare Worker (no framework, if-chain router), Web Crypto (HMAC-SHA256), Supabase via PostgREST + injected `fetch`, Brevo transactional email, Vitest (dependency-injected `fetch`, no SDK mocks), Astro static pages (BaseLayout).

---

## Context

**Why now:** S1 (data layer) and S2 (request-to-book) are done — a bride can submit a request, which signs a single-use token, stores `sha256(token)` as `confirm_token_hash`, and emails Zandeline a `…/api/booking/confirm?token=` link. S3 is the other half: consuming that link to move the booking `requested → confirmed` (or `declined`) and tell the bride how to pay.

**Decisions locked (Pieter, 2026-06-11):**
- **EFT-first for launch, not Yoco.** Zandeline takes deposits by bank transfer at first; the goal is to ship ASAP. This is *simpler* than the spec's Yoco flow, not just a deferral: EFT has no payment-processor gross-up, so the bride pays `deposit_net_cents` exactly — no `payments` row, no checkout, no webhook. S3 sends a complete, deployable "date confirmed → pay your deposit by EFT" email now. **S4 (Yoco)** later swaps the EFT instructions block for an automated pay-link + `payments` row + webhook.
- **Hybrid UI.** The Worker renders the dynamic, token-gated GET confirm page; after the action it redirects to static Astro `booking-confirmed.astro` / `booking-declined.astro` thank-you pages (BaseLayout, on-brand), mirroring the existing `booking-received.astro`.

**Three spec/baton reconciliations folded in (the baton's S3 shorthand was loose):**
1. Status is **`requested`**, not "pending" — the `booking_status` enum (migration `0001`) is `requested, confirmed, deposit_paid, settled, declined, cancelled, expired`. The guard is `status=eq.requested`.
2. Token TTL is **14 days**, not 72h (`TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000` in `request.ts`; the token embeds an HMAC-protected `exp_iso`).
3. The confirm link goes to **Zandeline**, not the bride — `request.ts` emails the `confirm?token=` URL to `NOTIFY_EMAIL`. The bride's deposit email is the *result* of Zandeline confirming.

**Build gate / branch:** S3 adds **no new npm dependency** (uses existing `token`/`db`/`audit` + Web Crypto + `fetch`), so there is **no `npm install` pause inside S3**. However, the S3 *build* should start from a `main` that already contains the merged S2 work. **Prerequisite:** S2 closeout (commit `worker/package.json` + lockfile, merge `claude/s2-booking-request` → `main`) must land first; then branch `claude/s3-booking-confirm` from updated `main`. (This plan + the baton are committed on `claude/s2-booking-request` and ride into `main` with the S2 merge.)

---

## File Structure

**Worker (Phase A — TDD):**
- `worker/src/booking/token.ts` *(modify)* — add `verifyToken()` + `fromBase64Url()` + `timingSafeEqualHex()`.
- `worker/src/booking/token.test.ts` *(modify)* — add a `verifyToken` describe block.
- `worker/src/booking/db.ts` *(modify)* — add `getBookingByTokenHash()` + `transitionRequestedBooking()` + `ConfirmBookingRow` type.
- `worker/src/booking/db.test.ts` *(modify)* — add lookup + guarded-transition tests.
- `worker/src/booking/confirm.ts` *(create)* — `BookingConfirmEnv`, `renderConfirmPage` (GET), `handleBookingConfirm` (POST), email/HTML helpers.
- `worker/src/booking/confirm.test.ts` *(create)* — GET render + POST confirm/decline tests.
- `worker/src/index.ts` *(modify)* — wire the two routes; add EFT fields to `Env`; allow `GET` in `corsHeaders`.

**Site (Phase B):**
- `site/src/pages/booking-confirmed.astro` *(create)* — Zandeline-facing "you confirmed it" thank-you.
- `site/src/pages/booking-declined.astro` *(create)* — Zandeline-facing "you declined it" thank-you.
- `site/src/pages/booking-received.astro` *(modify)* — EFT copy reconciliation (was "Yoco payment link").
- `worker/src/booking/request.ts` *(modify)* — EFT copy reconciliation in the two S2 emails.

Each Worker file has one clear responsibility: `token.ts` = crypto, `db.ts` = data access, `confirm.ts` = the endpoint. This mirrors the S2 layout exactly.

---

## Phase A — Worker (TDD)

### Task A1: `verifyToken` in token.ts

**Files:**
- Modify: `worker/src/booking/token.ts`
- Test: `worker/src/booking/token.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `worker/src/booking/token.test.ts`. (Check the existing imports at the top of the file; ensure `signToken` and the new `verifyToken` are imported from `./token`.)

```ts
import { verifyToken } from "./token"; // add to the existing import if not present

describe("verifyToken", () => {
  const SECRET = "signing-secret";
  const ID = "11111111-2222-3333-4444-555555555555";

  it("round-trips a freshly signed token", async () => {
    const token = await signToken(ID, new Date(Date.now() + 60_000), SECRET);
    const v = await verifyToken(token, SECRET);
    expect(v).not.toBeNull();
    expect(v!.bookingId).toBe(ID);
    expect(v!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null for a tampered token", async () => {
    const token = await signToken(ID, new Date(Date.now() + 60_000), SECRET);
    expect(await verifyToken(token + "x", SECRET)).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const token = await signToken(ID, new Date(Date.now() + 60_000), "other-secret");
    expect(await verifyToken(token, SECRET)).toBeNull();
  });

  it("returns null for a structurally malformed token", async () => {
    expect(await verifyToken("not-a-real-token", SECRET)).toBeNull();
  });

  it("authenticates an expired token but reports a past expiry (caller enforces TTL)", async () => {
    const token = await signToken(ID, new Date(Date.now() - 1000), SECRET);
    const v = await verifyToken(token, SECRET);
    expect(v).not.toBeNull();
    expect(v!.expiresAt.getTime()).toBeLessThan(Date.now());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npx vitest run src/booking/token.test.ts`
Expected: FAIL — `verifyToken is not a function` / import error.

- [ ] **Step 3: Implement** — append to `worker/src/booking/token.ts` (reuses the existing `enc`, `hmacHex`):

```ts
/** Decode a base64url string (inverse of the private toBase64Url). */
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npx vitest run src/booking/token.test.ts`
Expected: PASS (existing 11 + new 5 = 16 in this file).

- [ ] **Step 5: Commit**

```bash
git add worker/src/booking/token.ts worker/src/booking/token.test.ts
git commit -m "feat(worker): verifyToken — authenticate confirm tokens (S3)"
```

---

### Task A2: `getBookingByTokenHash` + `transitionRequestedBooking` in db.ts

**Files:**
- Modify: `worker/src/booking/db.ts`
- Test: `worker/src/booking/db.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `worker/src/booking/db.test.ts` (mirror the existing `res()`/`vi.fn()` pattern already in that file; add the two new names to the `./db` import):

```ts
import { getBookingByTokenHash, transitionRequestedBooking } from "./db";

const dbEnv = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "svc" };

describe("getBookingByTokenHash", () => {
  it("returns the row when the hash matches", async () => {
    const row = { id: "b1", reference: "LUS-2026-AAA", status: "requested" };
    const f = vi.fn().mockResolvedValue(res([row]));
    const got = await getBookingByTokenHash(dbEnv, "deadbeef", f as unknown as typeof fetch);
    expect(got).toEqual(row);
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain("confirm_token_hash=eq.deadbeef");
  });

  it("returns null when no row matches", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    expect(await getBookingByTokenHash(dbEnv, "nope", f as unknown as typeof fetch)).toBeNull();
  });
});

describe("transitionRequestedBooking", () => {
  it("PATCHes guarded on status=eq.requested and returns the updated row", async () => {
    const updated = { id: "b1", status: "confirmed" };
    const f = vi.fn().mockResolvedValue(res([updated]));
    const got = await transitionRequestedBooking(
      dbEnv, "b1", { status: "confirmed" }, f as unknown as typeof fetch,
    );
    expect(got).toEqual(updated);
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain("id=eq.b1");
    expect(url).toContain("status=eq.requested");
  });

  it("returns null when the guard matches 0 rows (already handled)", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    const got = await transitionRequestedBooking(
      dbEnv, "b1", { status: "confirmed" }, f as unknown as typeof fetch,
    );
    expect(got).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npx vitest run src/booking/db.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement** — append to `worker/src/booking/db.ts` (reuses the existing `rest`, `headers`):

```ts
/** The columns the confirm gate needs from a booking row. */
export interface ConfirmBookingRow {
  id: string;
  reference: string;
  status: string;
  bride_name: string;
  bride_email: string;
  wedding_date: string;
  venue: string | null;
  town: string | null;
  province: string | null;
  party_size: number;
  total_cents: number;
  deposit_pct: number;
  deposit_net_cents: number;
  balance_net_cents: number;
  confirm_token_expires_at: string;
  confirm_token_used_at: string | null;
}

const CONFIRM_COLS =
  "id,reference,status,bride_name,bride_email,wedding_date,venue,town,province," +
  "party_size,total_cents,deposit_pct,deposit_net_cents,balance_net_cents," +
  "confirm_token_expires_at,confirm_token_used_at";

/** Look a booking up by its stored confirm_token_hash. Returns null if none. */
export async function getBookingByTokenHash(
  env: DbEnv,
  hash: string,
  f: typeof fetch = fetch,
): Promise<ConfirmBookingRow | null> {
  const r = await f(
    rest(env, `bookings?confirm_token_hash=eq.${encodeURIComponent(hash)}&select=${CONFIRM_COLS}`),
    { headers: headers(env) },
  );
  if (!r.ok) throw new Error(`getBookingByTokenHash ${r.status}`);
  const rows = (await r.json()) as ConfirmBookingRow[];
  return rows.length ? rows[0]! : null;
}

/**
 * Guarded transition: PATCH the booking only while it is still `requested`.
 * The `&status=eq.requested` filter makes this an atomic compare-and-set — if the
 * row has already moved on (double-submit, scanner, prior decline), 0 rows update
 * and we return null. Lets the caller treat a lost race as a no-op, not a success.
 */
export async function transitionRequestedBooking(
  env: DbEnv,
  id: string,
  patch: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  const r = await f(rest(env, `bookings?id=eq.${encodeURIComponent(id)}&status=eq.requested`), {
    method: "PATCH",
    headers: { ...headers(env), prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`transitionRequestedBooking ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  return rows.length ? rows[0]! : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npx vitest run src/booking/db.test.ts`
Expected: PASS (existing 7 + new 4 = 11 in this file).

- [ ] **Step 5: Commit**

```bash
git add worker/src/booking/db.ts worker/src/booking/db.test.ts
git commit -m "feat(worker): token-hash lookup + guarded requested-transition (S3)"
```

---

### Task A3: `confirm.ts` — render-only GET page

**Files:**
- Create: `worker/src/booking/confirm.ts`
- Test: `worker/src/booking/confirm.test.ts`

- [ ] **Step 1: Write the failing tests** — create `worker/src/booking/confirm.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderConfirmPage } from "./confirm";
import { signToken } from "./token";

const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const BOOKING_ID = "11111111-2222-3333-4444-555555555555";
const SIGNING_SECRET = "signing-secret";

const env = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_KEY: "svc",
  BREVO_API_KEY: "brevo-key",
  NOTIFY_EMAIL: "z@lustique.co.za",
  ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  SIGNING_SECRET,
  EFT_BANK: "FNB",
  EFT_ACCOUNT_NAME: "Lustique Co",
  EFT_ACCOUNT_NO: "62000000000",
  EFT_BRANCH_CODE: "250655",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

const bookingRow = (over: Record<string, unknown> = {}) => ({
  id: BOOKING_ID, reference: "LUS-2026-111122", status: "requested",
  bride_name: "Anke van der Berg", bride_email: "anke@example.com",
  wedding_date: "2027-11-14", venue: "Red Ivory", town: "Hartbeespoort", province: "Gauteng",
  party_size: 7, total_cents: 882600, deposit_pct: 50,
  deposit_net_cents: 441300, balance_net_cents: 441300,
  confirm_token_expires_at: "2027-01-01T00:00:00Z", confirm_token_used_at: null,
  ...over,
});

const validToken = (ttlMs = 14 * 24 * 3600 * 1000) =>
  signToken(BOOKING_ID, new Date(Date.now() + ttlMs), SIGNING_SECRET);
const getReq = (token: string) =>
  new Request(`https://worker/api/booking/confirm?token=${encodeURIComponent(token)}`);

describe("renderConfirmPage (GET) — render-only", () => {
  it("renders the booking summary + confirm and decline forms", async () => {
    const token = await validToken();
    const f = vi.fn().mockResolvedValueOnce(res([bookingRow()]));
    const resp = await renderConfirmPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Anke van der Berg");
    expect(html).toContain('name="action" value="confirm"');
    expect(html).toContain('name="action" value="decline"');
    expect(f).toHaveBeenCalledOnce(); // GET reads, never mutates
  });

  it("shows 'already handled' (no forms) for a non-requested booking", async () => {
    const token = await validToken();
    const f = vi.fn().mockResolvedValueOnce(
      res([bookingRow({ status: "confirmed", confirm_token_used_at: "2026-06-11T10:00:00Z" })]),
    );
    const resp = await renderConfirmPage(env, getReq(token), f as unknown as typeof fetch);
    const html = await resp.text();
    expect(html).toContain("already been handled");
    expect(html).not.toContain('value="confirm"');
  });

  it("rejects a tampered token without touching the DB", async () => {
    const token = (await validToken()) + "x";
    const f = vi.fn();
    const resp = await renderConfirmPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("shows an expired page for a past-exp token, before any DB call", async () => {
    const token = await signToken(BOOKING_ID, new Date(Date.now() - 1000), SIGNING_SECRET);
    const f = vi.fn();
    const resp = await renderConfirmPage(env, getReq(token), f as unknown as typeof fetch);
    expect(resp.status).toBe(410);
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npx vitest run src/booking/confirm.test.ts`
Expected: FAIL — cannot find module `./confirm`.

- [ ] **Step 3: Implement** — create `worker/src/booking/confirm.ts` with the env type, shared helpers, and the GET handler (the POST handler is added in A4):

```ts
// worker/src/booking/confirm.ts
/**
 * GET + POST /api/booking/confirm — the confirm gate (spec §5, §7, §12).
 *
 * GET  = render-only hosted page (Zandeline sees the booking + Confirm/Decline
 *        buttons). NO mutation — mail scanners pre-fetch GET, so the state change
 *        is POST-only (spec §12 prefetch safety).
 * POST = verify token → guarded `requested → confirmed|declined` → email the
 *        bride → 303 redirect to the static thank-you page.
 *
 * v1 takes deposits by EFT (no Yoco). S4 swaps the EFT block for a Yoco pay-link.
 */
import { getBookingByTokenHash, transitionRequestedBooking, type ConfirmBookingRow } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { verifyToken, hashToken } from "./token";

export interface BookingConfirmEnv extends AuditEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
  EFT_BANK: string;
  EFT_ACCOUNT_NAME: string;
  EFT_ACCOUNT_NO: string;
  EFT_BRANCH_CODE: string;
}

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
const zar = (cents: number) => `R ${(cents / 100).toLocaleString("en-ZA")}`;

type LoadResult =
  | { ok: true; booking: ConfirmBookingRow }
  | { ok: false; reason: "invalid" | "expired" | "handled" };

/** Verify the token, look the booking up by hash, classify its state. */
async function loadBooking(
  env: BookingConfirmEnv,
  token: string,
  f: typeof fetch,
): Promise<LoadResult> {
  const v = await verifyToken(token, env.SIGNING_SECRET);
  if (!v) return { ok: false, reason: "invalid" };
  if (v.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  const booking = await getBookingByTokenHash(env, await hashToken(token), f);
  if (!booking) return { ok: false, reason: "invalid" };
  if (booking.status !== "requested" || booking.confirm_token_used_at) {
    return { ok: false, reason: "handled" };
  }
  return { ok: true, booking };
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function pageShell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — Lustique Co.</title><style>
body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2b;background:#f7f3ef;}
.card{max-width:540px;margin:6vh auto;background:#fff;border-radius:14px;padding:2.4rem 2rem;box-shadow:0 6px 30px rgba(0,0,0,.06);}
h1{font-size:1.5rem;margin:0 0 1rem;color:#8a3a52;}
table{border-collapse:collapse;margin:1rem 0;width:100%;}td{padding:4px 0;vertical-align:top;}
td.k{color:#8a7d72;white-space:nowrap;padding-right:14px;width:1%;}
.actions{display:flex;gap:.8rem;flex-wrap:wrap;margin-top:1.6rem;}
button{font:inherit;font-weight:600;border:0;border-radius:9px;padding:.75em 1.5em;cursor:pointer;}
.confirm{background:#8a3a52;color:#fff;}.decline{background:#efe7e0;color:#6b5d52;}
.muted{color:#8a7d72;font-size:.9rem;}</style></head><body><div class="card">${inner}</div></body></html>`;
}

const invalidHtml = () =>
  pageShell("Link not valid", "<h1>This link isn't valid</h1><p>Please use the most recent confirm link from your email.</p>");
const expiredHtml = () =>
  pageShell("Link expired", "<h1>This link has expired</h1><p>Confirm links are valid for 14 days. Ask the bride to re-submit, or reach out to her directly.</p>");
const handledHtml = () =>
  pageShell("Already handled", "<h1>This booking has already been handled</h1><p>It's no longer pending — there's nothing more to do here.</p>");

function confirmPageBody(b: ConfirmBookingRow, token: string): string {
  const where = [b.venue, b.town, b.province].filter(Boolean).join(", ") || "—";
  return `<h1>Confirm this booking</h1>
<p>Review the request, then confirm to email <strong>${esc(b.bride_name)}</strong> her EFT deposit details, or decline to send a gentle no.</p>
<table>
<tr><td class="k">Bride</td><td><strong>${esc(b.bride_name)}</strong><br><span class="muted">${esc(b.bride_email)}</span></td></tr>
<tr><td class="k">Date</td><td><strong>${esc(b.wedding_date)}</strong></td></tr>
<tr><td class="k">Venue</td><td>${esc(where)}</td></tr>
<tr><td class="k">Party</td><td>${b.party_size} looks</td></tr>
<tr><td class="k">Total</td><td><strong>${zar(b.total_cents)}</strong></td></tr>
<tr><td class="k">Deposit</td><td>${b.deposit_pct}% — <strong>${zar(b.deposit_net_cents)}</strong> due now</td></tr>
<tr><td class="k">Reference</td><td>${esc(b.reference)}</td></tr>
</table>
<div class="actions">
<form method="POST" action="/api/booking/confirm"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="action" value="confirm"><button class="confirm" type="submit">Confirm &amp; email deposit details</button></form>
<form method="POST" action="/api/booking/confirm"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="action" value="decline"><button class="decline" type="submit">Decline</button></form>
</div>
<p class="muted" style="margin-top:1.4rem;">This link is single-use and expires 14 days after the request.</p>`;
}

/** GET — render-only. Never mutates (spec §12 prefetch safety). */
export async function renderConfirmPage(
  env: BookingConfirmEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return htmlResponse(invalidHtml(), 400);
  const loaded = await loadBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "expired") return htmlResponse(expiredHtml(), 410);
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(invalidHtml(), 400);
  }
  return htmlResponse(pageShell("Confirm booking", confirmPageBody(loaded.booking, token)));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npx vitest run src/booking/confirm.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/booking/confirm.ts worker/src/booking/confirm.test.ts
git commit -m "feat(worker): render-only GET confirm page (S3)"
```

---

### Task A4: `confirm.ts` — POST confirm/decline transition + EFT email

**Files:**
- Modify: `worker/src/booking/confirm.ts`
- Test: `worker/src/booking/confirm.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `worker/src/booking/confirm.test.ts` (add `handleBookingConfirm` to the `./confirm` import; add a `postReq` helper):

```ts
import { handleBookingConfirm } from "./confirm";

const postReq = (token: string, action: string) =>
  new Request("https://worker/api/booking/confirm", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, action }).toString(),
  });

describe("handleBookingConfirm (POST) — confirm", () => {
  it("transitions to confirmed, emails EFT details, audits, 303-redirects", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow()]))                        // 1 getBookingByTokenHash
      .mockResolvedValueOnce(res([bookingRow({ status: "confirmed" })])) // 2 transitionRequestedBooking
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))              // 3 Brevo → bride
      .mockResolvedValueOnce(res({}, 201));                              // 4 insertAudit (via writeAudit)
    const resp = await handleBookingConfirm(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toContain("/booking-confirmed.html?ref=LUS-2026-111122");

    const patchUrl = f.mock.calls[1]![0] as string;
    expect(patchUrl).toContain("status=eq.requested");
    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.status).toBe("confirmed");
    expect(patch.confirmed_at).toBeTruthy();
    expect(patch.confirm_token_used_at).toBeTruthy();

    const email = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(email.htmlContent).toContain("62000000000");       // EFT account no.
    expect(email.htmlContent).toContain("LUS-2026-111122");   // payment reference
  });

  it("does not re-email when the guarded transition matches 0 rows", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow()]))  // looked requested at read time
      .mockResolvedValueOnce(res([]));             // ...but lost the race on PATCH
    const resp = await handleBookingConfirm(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);                 // "already handled" page, not a redirect
    expect(f).toHaveBeenCalledTimes(2);            // no Brevo, no audit
  });

  it("still redirects and logs confirm.email-failed when Brevo throws post-transition", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow()]))
      .mockResolvedValueOnce(res([bookingRow({ status: "confirmed" })]))
      .mockRejectedValueOnce(new Error("Brevo 503"))  // bride email fails
      .mockResolvedValueOnce(res({}, 201));           // confirm.email-failed audit
    const resp = await handleBookingConfirm(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(303);
    const audit = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(audit.event_type).toBe("confirm.email-failed");
  });
});

describe("handleBookingConfirm (POST) — decline", () => {
  it("transitions to declined, emails a gentle decline, 303 to declined page", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow()]))
      .mockResolvedValueOnce(res([bookingRow({ status: "declined" })]))
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))
      .mockResolvedValueOnce(res({}, 201));
    const resp = await handleBookingConfirm(env, postReq(token, "decline"), f as unknown as typeof fetch);
    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toContain("/booking-declined.html");
    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.status).toBe("declined");
    expect(patch.declined_at).toBeTruthy();
  });

  it("rejects a tampered token with no DB mutation", async () => {
    const f = vi.fn();
    const resp = await handleBookingConfirm(env, postReq("garbage.token", "confirm"), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npx vitest run src/booking/confirm.test.ts`
Expected: FAIL — `handleBookingConfirm is not a function`.

- [ ] **Step 3: Implement** — append to `worker/src/booking/confirm.ts`:

```ts
async function brevoEmail(
  env: BookingConfirmEnv,
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
      to: [to], subject, htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}

function confirmEmailHtml(env: BookingConfirmEnv, b: ConfirmBookingRow): string {
  return `<p>Hi ${esc(b.bride_name)},</p>
<p>Wonderful news — your date <strong>${esc(b.wedding_date)}</strong> is confirmed. To officially secure it, please pay your deposit by EFT:</p>
<table style="border-collapse:collapse;font:15px/1.7 system-ui,sans-serif;margin:.6rem 0 1rem;">
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Deposit due</td><td><strong>${zar(b.deposit_net_cents)}</strong> (${b.deposit_pct}%)</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Bank</td><td>${esc(env.EFT_BANK)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Account name</td><td>${esc(env.EFT_ACCOUNT_NAME)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Account no.</td><td>${esc(env.EFT_ACCOUNT_NO)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Branch code</td><td>${esc(env.EFT_BRANCH_CODE)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Payment reference</td><td><strong>${esc(b.reference)}</strong></td></tr>
</table>
<p style="font-size:.92rem;color:#8a7d72;">Please use <strong>${esc(b.reference)}</strong> as your payment reference so we can match it to your booking. The balance of ${zar(b.balance_net_cents)} is payable closer to your day.</p>
<p>Once we see your deposit, your date is locked in and we'll start planning the details.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

function declineEmailHtml(b: ConfirmBookingRow): string {
  return `<p>Hi ${esc(b.bride_name)},</p>
<p>Thank you so much for thinking of Lustique for <strong>${esc(b.wedding_date)}</strong>.</p>
<p>Sadly we're not able to take this booking — most often that's because the date is already fully committed with our artists. We're truly sorry to miss your day.</p>
<p>If your plans shift or you'd like to explore another date, we'd love to hear from you at <a href="mailto:info@lustiqueco.co.za">info@lustiqueco.co.za</a>.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

/** POST — verify, guarded transition, email, redirect. The mutation lives here, never in GET. */
export async function handleBookingConfirm(
  env: BookingConfirmEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const action = String(form?.get("action") ?? "confirm");
  const origin = env.ALLOWED_ORIGIN || "";
  const decline = action === "decline";

  if (!token || (action !== "confirm" && action !== "decline")) {
    return htmlResponse(invalidHtml(), 400);
  }

  const loaded = await loadBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(loaded.reason === "expired" ? expiredHtml() : invalidHtml(), loaded.reason === "expired" ? 410 : 400);
  }

  const b = loaded.booking;
  const now = new Date().toISOString();
  const patch = decline
    ? { status: "declined", declined_at: now, confirm_token_used_at: now }
    : { status: "confirmed", confirmed_at: now, confirm_token_used_at: now };

  const updated = await transitionRequestedBooking(env, b.id, patch, fetchImpl);
  if (!updated) return htmlResponse(handledHtml(), 200); // lost the race — don't email twice

  try {
    if (decline) {
      await brevoEmail(env, { email: b.bride_email, name: b.bride_name },
        "An update on your Lustique booking", declineEmailHtml(b), fetchImpl);
    } else {
      await brevoEmail(env, { email: b.bride_email, name: b.bride_name },
        "Your date is confirmed — deposit details inside · Lustique Co.", confirmEmailHtml(env, b), fetchImpl);
    }
    await writeAudit(env, { bookingId: b.id, eventType: decline ? "confirm.declined" : "confirm.confirmed", payload: { reference: b.reference } }, fetchImpl);
  } catch {
    // Transition already committed — log for recovery, still land Zandeline on the thank-you page.
    await writeAudit(env, { bookingId: b.id, eventType: "confirm.email-failed", payload: { reference: b.reference, action } }, fetchImpl).catch(() => {});
  }

  return redirect(`${origin}/booking-${decline ? "declined" : "confirmed"}.html?ref=${encodeURIComponent(b.reference)}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npx vitest run src/booking/confirm.test.ts`
Expected: PASS (4 GET + 5 POST = 9 tests in this file).

- [ ] **Step 5: Commit**

```bash
git add worker/src/booking/confirm.ts worker/src/booking/confirm.test.ts
git commit -m "feat(worker): POST confirm/decline transition + EFT deposit email (S3)"
```

---

### Task A5: Wire routes in index.ts + EFT env fields

**Files:**
- Modify: `worker/src/index.ts`

(No unit test — the codebase has no `index.test.ts`; this is verified by the typecheck/bundle dry-run in Phase C. Keep the change minimal.)

- [ ] **Step 1: Add the import** — at the top of `worker/src/index.ts`, alongside the existing `handleBookingRequest` import:

```ts
import { renderConfirmPage, handleBookingConfirm } from "./booking/confirm";
```

- [ ] **Step 2: Add the EFT fields to `Env`** — extend the existing `Env` interface (after the `TURNSTILE_SECRET` line, before `AUDIT`):

```ts
  // EFT deposit details (v1 — set at deploy; S4 replaces with Yoco)
  EFT_BANK: string;
  EFT_ACCOUNT_NAME: string;
  EFT_ACCOUNT_NO: string;
  EFT_BRANCH_CODE: string;
```

- [ ] **Step 3: Allow GET in `corsHeaders`** — change the `access-control-allow-methods` line:

```ts
    "access-control-allow-methods": "GET, POST, OPTIONS",
```

- [ ] **Step 4: Wire the two routes** — inside `fetch`, immediately after the existing `POST /api/booking/request` block and before the `/api/enquiry` 404 guard:

```ts
    // GET /api/booking/confirm?token= — render-only confirm page (S3, prefetch-safe §12)
    if (req.method === "GET" && url.pathname === "/api/booking/confirm") {
      return renderConfirmPage(env, req);
    }
    // POST /api/booking/confirm — confirm/decline transition (S3)
    if (req.method === "POST" && url.pathname === "/api/booking/confirm") {
      return handleBookingConfirm(env, req);
    }
```

- [ ] **Step 5: Verify the bundle typechecks** (full suite + dry-run):

Run: `cd worker && npx vitest run && npx wrangler deploy --dry-run --outdir /tmp/s3-dry`
Expected: all tests PASS; dry-run prints "Total Upload …" with no TypeScript errors. (If `Env` is missing an EFT field that `BookingConfirmEnv` requires, the dry-run typecheck fails here — add it.)

- [ ] **Step 6: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): wire GET+POST /api/booking/confirm routes (S3)"
```

> **Deploy note (account gate, not a build step):** `EFT_BANK / EFT_ACCOUNT_NAME / EFT_ACCOUNT_NO / EFT_BRANCH_CODE` are Zandeline's real bank details — supply at deploy via `wrangler secret put` (kept out of git) and a local `worker/.dev.vars` for `wrangler dev`. Add them to the open-gates list in `SESSION_HANDOFF.md`.

---

## Phase B — Site (Astro)

### Task B1: Thank-you pages (confirmed + declined)

**Files:**
- Create: `site/src/pages/booking-confirmed.astro`
- Create: `site/src/pages/booking-declined.astro`

These are Zandeline-facing (she clicks Confirm/Decline and lands here). Mirror `booking-received.astro` exactly: `BaseLayout`, `page-hero`, `section/wrap prose`, and the `?ref=` reveal script.

- [ ] **Step 1: Create `site/src/pages/booking-confirmed.astro`**

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
const title = "Booking Confirmed — Lustique Co.";
const desc = "This booking has been confirmed and the bride has been sent her deposit details.";
---
<BaseLayout slug="booking-confirmed.html" title={title} desc={desc}>
  <section class="page-hero">
    <span class="eyebrow">Confirmed</span>
    <h1>Booking confirmed.</h1>
    <p id="refLine">The bride has been emailed her EFT deposit details. Once the deposit lands, her date is secured.</p>
  </section>
  <section class="section"><div class="wrap prose">
    <p class="note center" style="margin-top:1rem;">You can close this tab. The booking now shows as <strong>confirmed</strong>.</p>
    <p class="note center" style="margin-top:2.4rem;">Blessings,<br>The Lustique Cosmetology Team</p>
  </div></section>

  <script is:inline>
    (function () {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && /^LUS-\d{4}-[A-Z0-9]+$/.test(ref)) {
        const line = document.getElementById("refLine");
        if (line) line.innerHTML =
          "Booking <strong>" + ref + "</strong> is confirmed. The bride has been emailed her EFT deposit details; once it lands, her date is secured.";
      }
    })();
  </script>
</BaseLayout>
```

- [ ] **Step 2: Create `site/src/pages/booking-declined.astro`**

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
const title = "Booking Declined — Lustique Co.";
const desc = "This booking has been declined and the bride has been notified.";
---
<BaseLayout slug="booking-declined.html" title={title} desc={desc}>
  <section class="page-hero">
    <span class="eyebrow">Declined</span>
    <h1>Booking declined.</h1>
    <p id="refLine">The bride has been sent a gentle note letting her know.</p>
  </section>
  <section class="section"><div class="wrap prose">
    <p class="note center" style="margin-top:1rem;">You can close this tab. No further action is needed.</p>
    <p class="note center" style="margin-top:2.4rem;">Blessings,<br>The Lustique Cosmetology Team</p>
  </div></section>

  <script is:inline>
    (function () {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && /^LUS-\d{4}-[A-Z0-9]+$/.test(ref)) {
        const line = document.getElementById("refLine");
        if (line) line.innerHTML =
          "Booking <strong>" + ref + "</strong> has been declined. The bride has been sent a gentle note letting her know.";
      }
    })();
  </script>
</BaseLayout>
```

- [ ] **Step 3: Build to verify both pages emit**

Run: `cd site && npm run build`
Expected: build succeeds; `site/dist/booking-confirmed.html` and `site/dist/booking-declined.html` exist; page count goes 24 → 26.

- [ ] **Step 4: Commit**

```bash
git add site/src/pages/booking-confirmed.astro site/src/pages/booking-declined.astro
git commit -m "feat(site): booking-confirmed + booking-declined thank-you pages (S3)"
```

---

### Task B2: EFT copy reconciliation (was "Yoco")

The EFT-first decision makes three S2 "Yoco link" mentions inaccurate. These are string-only edits; no test asserts on this phrasing (`request.test.ts` only checks for `/api/booking/confirm?token=` and `"2 other active booking"`), so the suite stays green.

**Files:**
- Modify: `site/src/pages/booking-received.astro`
- Modify: `worker/src/booking/request.ts`

- [ ] **Step 1: `booking-received.astro`** — replace the two "deposit link" / "Yoco payment link" mentions:
  - The `#refLine` paragraph and its `<script>` twin (`"…send your deposit link — usually within a few hours."`) → `"…send your deposit details — usually within a few hours."`
  - The numbered list item `"You receive a Yoco payment link for your deposit — paying it officially secures your date."` → `"You receive your deposit payment details by email — paying secures your date."`

- [ ] **Step 2: `request.ts`** — update the S2 email copy to match EFT-first:
  - Zandeline button (the `<a …>` text): `"Confirm &amp; send deposit link"` → `"Confirm &amp; send deposit details"`
  - Zandeline footnote: `"Confirming sends the bride a Yoco deposit link. The token expires in 14 days."` → `"Confirming emails the bride her EFT deposit details. The token expires in 14 days."`
  - Bride email line: `"…we'll send you a link to pay your deposit and officially secure your date."` → `"…we'll send you your deposit payment details to officially secure your date."`

- [ ] **Step 3: Verify nothing broke**

Run: `cd worker && npx vitest run src/booking/request.test.ts && cd ../site && npm run build`
Expected: request tests PASS (12); site build succeeds.

- [ ] **Step 4: Commit**

```bash
git add site/src/pages/booking-received.astro worker/src/booking/request.ts
git commit -m "chore(site,worker): EFT-first copy — replace Yoco-link wording (S3)"
```

---

## Phase C — Verification + closeout

- [ ] **Full worker suite green:** `cd worker && npx vitest run`
  Expected: all files pass. Count rises from 38 → ~51 (token 11→16, db 7→11, request 12, audit 2, util 4, + new confirm 9).
- [ ] **Bundle typechecks:** `cd worker && npx wrangler deploy --dry-run --outdir /tmp/s3-dry` → no TS errors.
- [ ] **Site builds:** `cd site && npm run build` → 26 pages, includes `booking-confirmed.html` + `booking-declined.html`.
- [ ] **Prefetch-safety grep (the one invariant that matters):** confirm the GET path performs no transition.
  `grep -n "transitionRequestedBooking" worker/src/booking/confirm.ts` → appears **only** inside `handleBookingConfirm` (POST), never in `renderConfirmPage` (GET).
- [ ] **No stray Yoco-link copy:** `grep -rni "yoco" site/src worker/src` → only the S4-deferred code comments remain (no user-facing "Yoco link" email/page copy).
- [ ] **Update `SESSION_HANDOFF.md`:** record S3 shipped (commit table), promote on green, prime ▶ NEXT for **S4 — payments (Yoco)**, add the EFT bank-details deploy gate to the open-gates list. Emit **🟢 BUILD DONE → back to Opus** to plan S4.

### Definition of Done
- `GET /api/booking/confirm?token=` renders the booking + Confirm/Decline forms for a valid `requested` booking; shows invalid/expired/handled pages otherwise; **never mutates**.
- `POST /api/booking/confirm` with `action=confirm` moves `requested → confirmed` (guarded), stamps `confirmed_at` + `confirm_token_used_at`, emails the bride EFT deposit details (amount + bank details + reference), audits `confirm.confirmed`, and 303-redirects to `booking-confirmed.html`.
- `action=decline` moves `requested → declined`, stamps `declined_at` + `confirm_token_used_at`, emails a gentle decline, audits `confirm.declined`, redirects to `booking-declined.html`.
- Double-submit / tampered / expired / already-handled tokens are all handled safely (no double email, no spurious transition).
- All worker tests green; bundle typechecks; site builds with the two new pages.

---

## Spec coverage self-review

- **§5 state machine** — `requested → confirmed` and `requested → declined` (incl. `action=decline`) implemented with a guarded transition; `confirmed_at`/`declined_at`/`confirm_token_used_at` stamped. `confirmed → deposit_paid` stays out of scope (manual/EFT reconciliation, or S4 Yoco webhook). ✅
- **§7 confirm endpoint** — GET render-only page + POST mutation, both wired. The Yoco-checkout step of §7's POST is intentionally **out of scope** (EFT-first per Pieter; S4 adds Yoco). ✅ (scoped deviation documented)
- **§12 token verify** — base64url-decode → split → recompute HMAC → constant-time compare; expiry enforced by caller; single-use via `confirm_token_used_at` + the `status=eq.requested` guard; GET is prefetch-safe. ✅
- **§6 schema** — uses real columns (`status`, `confirm_token_hash`, `confirm_token_expires_at`, `confirm_token_used_at`, `confirmed_at`, `declined_at`, `deposit_net_cents`, `balance_net_cents`, `reference`). ✅
- **§10 emails** — Email #3 (confirmed → bride) delivered as EFT deposit details (Yoco pay-link is the S4 form of this email); decline email delivered. ✅ (EFT variant)
- **Type consistency** — `verifyToken`, `getBookingByTokenHash`/`ConfirmBookingRow`, `transitionRequestedBooking`, `renderConfirmPage`, `handleBookingConfirm`, `BookingConfirmEnv` are used with identical names across tasks. ✅
