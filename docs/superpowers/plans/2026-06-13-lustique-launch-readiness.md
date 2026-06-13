# Lustique Launch-Readiness Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Build on a fresh branch off `main` (e.g. `claude/launch-readiness`); commit per task.

**Goal:** Make go-live a clean one-shot — a `SMOKE_BASE_URL`-gated live smoke walk that drives `confirmed → deposit_paid → settled` against the deployed worker, plus one authoritative go-live runbook.

**Architecture:** Two pure helpers (TDD'd in vitest) + one gated integration spec that orchestrates them against the live worker, reusing the worker's own `token.ts` so tokens are forged exactly as production verifies them. No new dependency (vitest is already installed; `npm install` is Pieter-only). No worker source/behaviour change. Plus a Markdown runbook that supersedes today's scattered Launch notes.

**Tech Stack:** TypeScript, Vitest (already installed), PostgREST (Supabase via `fetch`), Cloudflare Worker.

**Design spec:** `docs/superpowers/specs/2026-06-13-lustique-launch-readiness-design.md` (read it first).

---

## File Structure

- Create `worker/src/booking/smoke-helpers.ts` — pure helpers: `buildSmokeBooking` (seed row + confirm token/hash) and `evaluateStep` (assertion comparator). Importable + unit-tested.
- Create `worker/src/booking/smoke-helpers.test.ts` — unit tests for both helpers (run by normal `vitest run`).
- Create `worker/src/booking/smoke.test.ts` — the `SMOKE_BASE_URL`-gated live walk (skipped in normal `vitest run`).
- Modify `worker/package.json` — add `"smoke"` script.
- Create `docs/RUNBOOK-go-live.md` — the authoritative runbook.
- Modify `SESSION_HANDOFF.md` (Launch → pointer) and `docs/superpowers/plans/2026-06-12-lustique-eft-payments-and-go-live.md` (Phase C → "superseded" note).

Why `src/booking/` for the test files: vitest's include glob is `src/**/*.test.ts` ([vitest.config.ts](../../../worker/vitest.config.ts)) and every existing test already lives there. `smoke-helpers.ts` is imported only by test files, so it is never in the deployed bundle.

---

## Task 1: `buildSmokeBooking` seed helper

**Files:**
- Create: `worker/src/booking/smoke-helpers.ts`
- Test: `worker/src/booking/smoke-helpers.test.ts`

The seed must carry `confirm_token_hash` because S3 looks the booking up by *stored hash*, not id ([confirm.ts:46](../../../worker/src/booking/confirm.ts), [db.ts:134](../../../worker/src/booking/db.ts)). So the `id` is generated client-side, the confirm token is minted against it, and its sha256 hash is stored on the row — all before insert. Sentinel `2099-12-31` wedding date can never collide with the per-date capacity guard; `SMOKE TEST` bride name is unmistakable in any inbox/DB. Every NOT-NULL column from migration `0001_booking_core.sql` is populated.

- [ ] **Step 1: Write the failing test** — create `worker/src/booking/smoke-helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSmokeBooking } from "./smoke-helpers";
import { hashToken, verifyToken } from "./token";

describe("buildSmokeBooking", () => {
  it("produces a valid requested row whose confirm_token_hash matches the minted token", async () => {
    const { id, confirmToken, row } = await buildSmokeBooking("test-secret", "ops@example.com");
    expect(row.id).toBe(id);
    expect(row.status).toBe("requested");
    expect(String(row.bride_name)).toMatch(/^SMOKE TEST /);
    expect(row.wedding_date).toBe("2099-12-31");
    expect(row.bride_email).toBe("ops@example.com");
    expect(row.confirm_token_hash).toBe(await hashToken(confirmToken));
    for (const k of [
      "reference", "idempotency_key", "occasion", "bride_phone", "party_size",
      "estimate_input", "total_cents", "quote_lines", "deposit_pct",
      "deposit_net_cents", "balance_net_cents", "consent_at", "confirm_token_expires_at",
    ]) {
      expect(row[k], `missing NOT NULL column ${k}`).toBeDefined();
    }
  });

  it("mints a confirm token that verifies back to the row id", async () => {
    const { id, confirmToken } = await buildSmokeBooking("s", "a@b.com");
    const v = await verifyToken(confirmToken, "s");
    expect(v?.bookingId).toBe(id);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd worker && npx vitest run src/booking/smoke-helpers.test.ts`
Expected: FAIL — `buildSmokeBooking` not exported / module missing.

- [ ] **Step 3: Implement** — create `worker/src/booking/smoke-helpers.ts`:

```ts
/**
 * Pure helpers for the live smoke walk (design:
 * docs/superpowers/specs/2026-06-13-lustique-launch-readiness-design.md).
 * No I/O here — these are unit-tested; the live orchestration lives in smoke.test.ts.
 */
import { signToken, hashToken } from "./token";

export interface SmokeSeed {
  id: string;
  confirmToken: string;
  row: Record<string, unknown>;
}

/**
 * Build a valid `requested` booking row with its confirm token + stored hash
 * already wired. id is generated client-side so the token can be minted before
 * insert (S3 resolves the booking by confirm_token_hash). Sentinel 2099 date +
 * "SMOKE TEST" name keep test data isolated and unmistakable.
 */
export async function buildSmokeBooking(
  signingSecret: string,
  brideEmail: string,
  now: Date = new Date(),
): Promise<SmokeSeed> {
  const id = crypto.randomUUID();
  const stamp = now.toISOString();
  const confirmExp = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14d (matches S2)
  const confirmToken = await signToken(id, confirmExp, signingSecret);
  const confirm_token_hash = await hashToken(confirmToken);
  const row: Record<string, unknown> = {
    id,
    reference: `SMOKE-${stamp}`,
    idempotency_key: `smoke-${id}`,
    status: "requested",
    occasion: "wedding",
    wedding_date: "2099-12-31",
    bride_name: `SMOKE TEST ${stamp}`,
    bride_email: brideEmail,
    bride_phone: "+27000000000",
    party_size: 1,
    estimate_input: {},
    total_cents: 100000,
    quote_lines: [],
    deposit_pct: 50,
    deposit_net_cents: 50000,
    balance_net_cents: 50000,
    consent_at: stamp,
    confirm_token_hash,
    confirm_token_expires_at: confirmExp.toISOString(),
  };
  return { id, confirmToken, row };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd worker && npx vitest run src/booking/smoke-helpers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/booking/smoke-helpers.ts worker/src/booking/smoke-helpers.test.ts
git commit -m "test(worker): buildSmokeBooking smoke-walk seed helper"
```

---

## Task 2: `evaluateStep` assertion comparator

**Files:**
- Modify: `worker/src/booking/smoke-helpers.ts`
- Modify: `worker/src/booking/smoke-helpers.test.ts`

A pure function over a re-read row + the booking's audit events. It encodes the locked assertion depth (status + timestamp + success audit + no `*.email-failed`). Returns failure strings (empty = pass) so the walk can surface a precise diff.

- [ ] **Step 1: Write the failing test** — append to `worker/src/booking/smoke-helpers.test.ts`:

```ts
import { evaluateStep } from "./smoke-helpers";

const exp = { label: "confirm", status: "confirmed", timestampField: "confirmed_at", successEvent: "confirm.confirmed" };

describe("evaluateStep", () => {
  it("passes when status, timestamp and success audit are present and no email-failed", () => {
    const fails = evaluateStep(exp, {
      row: { status: "confirmed", confirmed_at: "2026-06-13T00:00:00Z" },
      auditEvents: [{ event_type: "confirm.confirmed" }],
    });
    expect(fails).toEqual([]);
  });

  it("flags a missing timestamp", () => {
    const fails = evaluateStep(exp, {
      row: { status: "confirmed", confirmed_at: null },
      auditEvents: [{ event_type: "confirm.confirmed" }],
    });
    expect(fails.join()).toContain("confirmed_at not set");
  });

  it("flags an email-failed audit even when status advanced", () => {
    const fails = evaluateStep(exp, {
      row: { status: "confirmed", confirmed_at: "t" },
      auditEvents: [{ event_type: "confirm.confirmed" }, { event_type: "confirm.email-failed" }],
    });
    expect(fails.join()).toContain("email-failed");
  });

  it("flags a wrong status and a missing booking", () => {
    expect(evaluateStep(exp, { row: { status: "requested", confirmed_at: null }, auditEvents: [] }).join()).toContain("status");
    expect(evaluateStep(exp, { row: null, auditEvents: [] }).join()).toContain("not found");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd worker && npx vitest run src/booking/smoke-helpers.test.ts`
Expected: FAIL — `evaluateStep` not exported.

- [ ] **Step 3: Implement** — append to `worker/src/booking/smoke-helpers.ts`:

```ts
export interface StepExpectation {
  label: string;          // "confirm" | "mark-paid" | "mark-balance-paid"
  status: string;         // expected booking status after the step
  timestampField: string; // column that must be non-null, e.g. "confirmed_at"
  successEvent: string;   // audit event_type that must be present
}

export interface StepActual {
  row: Record<string, unknown> | null;       // re-read booking row
  auditEvents: Array<{ event_type: string }>; // all audit rows for the booking
}

/** Pure evaluation of one transition step. Returns failure messages (empty = pass). */
export function evaluateStep(exp: StepExpectation, actual: StepActual): string[] {
  const fails: string[] = [];
  const row = actual.row;
  if (!row) return [`${exp.label}: booking row not found`];
  if (row.status !== exp.status) fails.push(`${exp.label}: status ${String(row.status)} != ${exp.status}`);
  if (!row[exp.timestampField]) fails.push(`${exp.label}: ${exp.timestampField} not set`);
  const types = actual.auditEvents.map((e) => e.event_type);
  if (!types.includes(exp.successEvent)) {
    fails.push(`${exp.label}: audit missing ${exp.successEvent} (saw ${types.join(",") || "none"})`);
  }
  const failed = types.filter((t) => t.endsWith(".email-failed"));
  if (failed.length) fails.push(`${exp.label}: email-failed audit present (${failed.join(",")})`);
  return fails;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd worker && npx vitest run src/booking/smoke-helpers.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add worker/src/booking/smoke-helpers.ts worker/src/booking/smoke-helpers.test.ts
git commit -m "test(worker): evaluateStep smoke assertion comparator"
```

---

## Task 3: the gated live walk + `npm run smoke`

**Files:**
- Create: `worker/src/booking/smoke.test.ts`
- Modify: `worker/package.json`

This is an integration orchestration, not a unit test — it is verified by the **rehearsal** (runbook), not by `vitest run`. It is gated by `SMOKE_BASE_URL` so a normal `vitest run` skips it entirely (suite stays green). Gotchas baked in: confirm POST 303s to the static site, so use `redirect:"manual"` and assert via DB+audit only (undici reports a manual redirect as status `0`); the audit FK is `on delete set null`, so cleanup deletes `audit_log` rows *before* the booking.

- [ ] **Step 1: Create the walk** — `worker/src/booking/smoke.test.ts`:

```ts
/**
 * LIVE post-intake smoke walk (design:
 * docs/superpowers/specs/2026-06-13-lustique-launch-readiness-design.md).
 *
 * Gated: runs ONLY when SMOKE_BASE_URL is set (`npm run smoke`); skipped in a
 * normal `vitest run`. Seeds a booking in Supabase, then drives
 *   confirm -> mark-paid -> mark-balance-paid
 * against the DEPLOYED worker with minted tokens, asserting the Supabase row +
 * audit after each step. NOT end-to-end: intake (/api/booking/request + Turnstile)
 * is covered by a manual form submission in the runbook.
 *
 * Required env: SMOKE_BASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY,
 *               SIGNING_SECRET, SMOKE_BRIDE_EMAIL. Optional: SMOKE_KEEP=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signActionToken } from "./token";
import { buildSmokeBooking, evaluateStep } from "./smoke-helpers";

const BASE = process.env.SMOKE_BASE_URL ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const SIGNING_SECRET = process.env.SIGNING_SECRET ?? "";
const BRIDE_EMAIL = process.env.SMOKE_BRIDE_EMAIL ?? "";
const KEEP = !!process.env.SMOKE_KEEP;
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

const sb = (path: string) => `${SUPABASE_URL}/rest/v1/${path}`;
const sbHeaders = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" };

async function sbInsert(row: Record<string, unknown>): Promise<void> {
  const r = await fetch(sb("bookings"), { method: "POST", headers: { ...sbHeaders, prefer: "return=minimal" }, body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`seed insert ${r.status}: ${await r.text()}`);
}
async function sbReadBooking(id: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(sb(`bookings?id=eq.${id}&select=status,confirmed_at,deposit_paid_at,settled_at`), { headers: sbHeaders });
  if (!r.ok) throw new Error(`read booking ${r.status}`);
  return ((await r.json()) as Array<Record<string, unknown>>)[0] ?? null;
}
async function sbReadAudit(id: string): Promise<Array<{ event_type: string }>> {
  const r = await fetch(sb(`audit_log?booking_id=eq.${id}&select=event_type&order=created_at.asc`), { headers: sbHeaders });
  if (!r.ok) throw new Error(`read audit ${r.status}`);
  return (await r.json()) as Array<{ event_type: string }>;
}
/** Delete smoke bookings + their audit rows. audit_log FK is on-delete-set-null, so audit first. */
async function sbSweepSmoke(): Promise<void> {
  const r = await fetch(sb(`bookings?bride_name=like.SMOKE*&select=id`), { headers: sbHeaders });
  if (!r.ok) throw new Error(`sweep select ${r.status}`);
  for (const { id } of (await r.json()) as Array<{ id: string }>) {
    await fetch(sb(`audit_log?booking_id=eq.${id}`), { method: "DELETE", headers: sbHeaders });
  }
  await fetch(sb(`bookings?bride_name=like.SMOKE*`), { method: "DELETE", headers: sbHeaders });
}
/** POST form-encoded. Manual redirect: confirm 303s to the static site; don't follow it. */
async function postForm(path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
}
const actionToken = (id: string, purpose: string) =>
  signActionToken(id, new Date(Date.now() + NINETY_DAYS), SIGNING_SECRET, purpose);

describe.skipIf(!BASE)("live post-intake smoke walk", () => {
  let id = "";
  let confirmToken = "";

  beforeAll(async () => {
    for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY: SERVICE_KEY, SIGNING_SECRET, SMOKE_BRIDE_EMAIL: BRIDE_EMAIL })) {
      if (!v) throw new Error(`smoke walk needs env ${k}`);
    }
    await sbSweepSmoke(); // idempotent pre-sweep
    const seed = await buildSmokeBooking(SIGNING_SECRET, BRIDE_EMAIL);
    id = seed.id;
    confirmToken = seed.confirmToken;
    await sbInsert(seed.row);
  });

  afterAll(async () => { if (!KEEP) await sbSweepSmoke(); });

  it("seed -> confirmed", async () => {
    await postForm("/api/booking/confirm", { token: confirmToken, action: "confirm" }); // 303 -> static site
    const fails = evaluateStep(
      { label: "confirm", status: "confirmed", timestampField: "confirmed_at", successEvent: "confirm.confirmed" },
      { row: await sbReadBooking(id), auditEvents: await sbReadAudit(id) },
    );
    expect(fails, fails.join("\n")).toEqual([]);
  });

  it("confirmed -> deposit_paid", async () => {
    const resp = await postForm("/api/booking/mark-paid", { token: await actionToken(id, "deposit") });
    expect(resp.status).toBe(200);
    const fails = evaluateStep(
      { label: "mark-paid", status: "deposit_paid", timestampField: "deposit_paid_at", successEvent: "payment.deposit-recorded" },
      { row: await sbReadBooking(id), auditEvents: await sbReadAudit(id) },
    );
    expect(fails, fails.join("\n")).toEqual([]);
  });

  it("deposit_paid -> settled", async () => {
    const resp = await postForm("/api/booking/mark-balance-paid", { token: await actionToken(id, "balance") });
    expect(resp.status).toBe(200);
    const fails = evaluateStep(
      { label: "mark-balance-paid", status: "settled", timestampField: "settled_at", successEvent: "payment.balance-recorded" },
      { row: await sbReadBooking(id), auditEvents: await sbReadAudit(id) },
    );
    expect(fails, fails.join("\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: Add the npm script** — in `worker/package.json`, add to `"scripts"`:

```json
    "smoke": "vitest run src/booking/smoke.test.ts"
```

- [ ] **Step 3: Verify the suite stays green with the walk skipped**

Run: `cd worker && npx vitest run`
Expected: PASS — all existing tests + the 6 helper tests green; the `live post-intake smoke walk` describe is **skipped** (no `SMOKE_BASE_URL`). Total still reports green.

- [ ] **Step 4: Verify the bundle is untouched**

Run: `cd worker && npx wrangler deploy --dry-run --outdir /tmp/lr-dry`
Expected: success — `smoke-helpers.ts` / test files are not imported by `index.ts`, so the deployed bundle is unchanged.

- [ ] **Step 5: Commit**

```bash
git add worker/src/booking/smoke.test.ts worker/package.json
git commit -m "feat(worker): SMOKE_BASE_URL-gated live smoke walk + npm run smoke"
```

> The walk's **first real execution is the rehearsal** in the runbook (against `wrangler dev` once Supabase exists), then the go-live run against the deployed worker. It is intentionally not executed here.

---

## Task 4: the go-live runbook (+ supersede the scattered sources)

**Files:**
- Create: `docs/RUNBOOK-go-live.md`
- Modify: `SESSION_HANDOFF.md` (collapse the Launch section to a pointer)
- Modify: `docs/superpowers/plans/2026-06-12-lustique-eft-payments-and-go-live.md` (Phase C → "superseded" note)

- [ ] **Step 1: Create `docs/RUNBOOK-go-live.md`** with exactly this content:

````markdown
# Lustique — Go-Live Runbook (EFT launch)

The single source for taking Lustique live. Supersedes the old baton Launch summary
and the S4 plan's Phase C. 🛑 = account-gated (Pieter/Zandeline); everything else is
Sonnet-runnable once unblocked. Do the account prerequisites first.

## 1. Account prerequisites (🛑 — parallelizable, any order)
- [ ] **Supabase** — create the client-owned project (region `af-south-1`), invite
      `hello@layerzerostudios.com` as Administrator. Apply the migration by pasting
      `supabase/migrations/0001_booking_core.sql` into the Supabase **SQL editor** and
      running it (no CLI config exists). Capture the project URL + the **service-role** key.
- [ ] **Turnstile** — create a widget for `lustiqueco.co.za`; note the **site key** + **secret**.
- [ ] **Brevo** — verify `info@lustiqueco.co.za` as a sender; capture the **API key**.
- [ ] **EFT details** — bank, account name, account no., branch code from Zandeline.
- [ ] **Cloudflare** — add `lustiqueco.co.za` (Free plan) so the zone exists.

## 2. Rehearse the smoke walk (as soon as Supabase exists — before full deploy)
- [ ] Put the secrets in `worker/.dev.vars` (git-ignored). Run the worker locally:
      `cd worker && npx wrangler dev` (serves `http://localhost:8787`).
- [ ] In another shell, run the walk against local:
      `SMOKE_BASE_URL=http://localhost:8787 SUPABASE_URL=… SUPABASE_SERVICE_KEY=… SIGNING_SECRET=… SMOKE_BRIDE_EMAIL=you@example.com npm run smoke`
- [ ] Expect 3 green steps (`confirmed`, `deposit_paid`, `settled`). This proves the
      script itself before launch day. (Gated on Supabase only — not on deploy.)

## 3. 🔐 Security gate — HARD BLOCKER before any origin push
- [ ] Rotate the exposed **Sanity Viewer token** (it is committed; the first push publishes it).
- [ ] Secret-scan the working tree — confirm no live keys are committed.
- [ ] Only now is `main` safe to push (step 6 connects GitHub to Pages).

## 4. Worker config + secrets
- [ ] One-time bucket: `cd worker && npx wrangler r2 bucket create lustique-audit`.
- [ ] Set the 10 secrets with `wrangler secret put`: `BREVO_API_KEY`, `NOTIFY_EMAIL`,
      `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SIGNING_SECRET` (random 32-byte hex),
      `TURNSTILE_SECRET`, `EFT_BANK`, `EFT_ACCOUNT_NAME`, `EFT_ACCOUNT_NO`, `EFT_BRANCH_CODE`.
      (Skip `YOCO_*` until S4-v2.)
- [ ] Confirm `ALLOWED_ORIGIN = "https://lustiqueco.co.za"` in `[vars]`.

## 5. Front-end config
- [ ] Replace the Turnstile placeholder `1x00000000000000000000AA` in
      `site/src/data/site.ts` with the real **site key**; commit.

## 6. Deploy
- [ ] Worker: `cd worker && npx wrangler deploy` (binds `lustiqueco.co.za/api/*` once the zone is active).
- [ ] Site: push `main` to origin (first publish — gated by step 3), then connect the
      GitHub repo to **Cloudflare Pages** (build `npm run build` in `site/`, output `dist/`);
      bind the apex + `www` custom domains.

## 7. DNS cutover (🛑 Pieter)
- [ ] Point `lustiqueco.co.za` nameservers GoDaddy → Cloudflare (registrar stays GoDaddy).
- [ ] Preserve the existing GoDaddy/Workspace **MX + SPF** records.
- [ ] Set SSL/TLS to **Full (strict)** once Pages is bound.

## 8. Verify go-live
- [ ] **Manual (intake):** submit one real request on the live form → bride gets
      "request received"; Zandeline gets the confirm link. (Proves intake + Turnstile —
      the part the script can't.)
- [ ] **Scripted (transition chain):** run `npm run smoke` with `SMOKE_BASE_URL` = the
      deployed worker origin. Expect 3 green steps. **Note:** this emails one clearly-marked
      "SMOKE TEST" admin notification to the live `NOTIFY_EMAIL` (Zandeline) — warn her.
- [ ] **Cron:** confirm the daily trigger is registered (Cloudflare dashboard /
      `wrangler deployments`). Optional: exercise `balanceSweep` locally once via
      `wrangler dev --test-scheduled`.

## 9. Post-launch (deferred)
- [ ] Cloudflare WAF: rate-limit `POST /api/booking/request` → 5 req/IP/hour.
````

- [ ] **Step 2: Collapse the baton Launch section** — in `SESSION_HANDOFF.md`, replace the entire `## 🛑 Launch …` section (down to but not including `## State`) with:

```markdown
## 🛑 Launch (Phase C go-live) — account-gated, PARALLEL track
The authoritative go-live procedure now lives in **`docs/RUNBOOK-go-live.md`** (5 account
prereqs → security gate → secrets → deploy → DNS → manual + `npm run smoke` verification).
Launch is blocked only on the 5 human prerequisites in that runbook. Product rule locked
(Pieter 2026-06-12): the bride is told her date is BOOKED only once the EFT deposit is
*received* (mark-paid), not at confirm.
```

- [ ] **Step 3: Mark the S4 Phase C superseded** — in `docs/superpowers/plans/2026-06-12-lustique-eft-payments-and-go-live.md`, insert directly under the `## Phase C — Go-live runbook (EFT launch)` heading:

```markdown
> **⚠️ Superseded (2026-06-13):** the authoritative go-live procedure is now
> `docs/RUNBOOK-go-live.md` (covers through S5 + the live smoke walk). This Phase C
> is kept for history only.
```

- [ ] **Step 4: Commit**

```bash
git add docs/RUNBOOK-go-live.md SESSION_HANDOFF.md docs/superpowers/plans/2026-06-12-lustique-eft-payments-and-go-live.md
git commit -m "docs: authoritative go-live runbook (supersedes scattered Launch + S4 Phase C)"
```

---

## Verification / Definition of Done
- `cd worker && npx vitest run` → all green; the `live post-intake smoke walk` describe is **skipped** without `SMOKE_BASE_URL`; the 6 helper tests pass.
- `cd worker && npx wrangler deploy --dry-run` → clean (deployed bundle unchanged).
- `npm run smoke` exists; the rehearsal procedure is documented in the runbook (run once Supabase lands).
- `docs/RUNBOOK-go-live.md` is the single authoritative runbook; the baton Launch section + the S4 Phase C both point to it.
- The 🔐 security gate (Sanity rotation + secret-scan) is sequenced as a hard blocker before the first origin push.
- No worker source/behaviour change; no new deployed secrets.

## Self-review (plan vs spec)
- **Spec A (smoke script):** Tasks 1–3 — seed (sentinel date, confirm-hash), minted tokens via `token.ts`, status+timestamp+audit assertions, `*.email-failed` guard, pre-sweep + `finally` cleanup, R2 untouched, gated + `npm run smoke`. ✅
- **Spec B (runbook):** Task 4 — authoritative runbook, supersede pointers, security gate before push, manual-intake + scripted-transition pairing, cron note. ✅
- **Locked decisions:** GitHub-connected Pages with Sanity/secret-scan as a pre-push blocker (runbook §3/§6); assert depth status+timestamp+audit (`evaluateStep`). ✅
- **OUT:** no live cron invocation, no Turnstile/DNS automation, no S6, no inbox reads. ✅
- **No-placeholder check:** every code/doc step shows complete content; types (`SmokeSeed`, `StepExpectation`, `StepActual`, `evaluateStep`, `buildSmokeBooking`) are consistent across tasks. ✅
