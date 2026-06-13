# Lustique — Launch-Readiness Pass (design spec)

**Date:** 2026-06-13 · **Lane:** planned on Opus, built on Sonnet · **Status:** approved (Pieter, 2026-06-13)

**Goal:** Make go-live a clean one-shot when the 5 client/account prerequisites land — by (A) a scripted, repeatable post-deploy verification of the booking transition chain against the *deployed* worker, and (B) one authoritative go-live runbook that supersedes today's two scattered, partly-stale sources.

**Why now:** The booking app is functionally code-complete through S5 on local `main`; launch is gated only on human/account work (Supabase, Turnstile, Brevo, EFT details, Cloudflare zone). This pass is unblocked build-lane work that de-risks the *actual* goal (launch) rather than adding deferred polish. It also has **template value**: Lustique is Layer Zero's client #1 and the reusable custom-build template, so both artifacts are written env-driven / un-hardcoded to lift into the template later.

---

## Scope decisions (locked)

- **Smoke test = scripted live walk** against the deployed worker (not local-only, not manual-only).
- **Assertion depth = status + timestamp + audit:** per step assert the row's new status, its `*_at` timestamp is set, the success audit event is present, AND no `*.email-failed` event exists for the booking.
- **Pages deploy = GitHub-connected** (auto-deploy + preview URLs; best for the template). Consequence: the **first `git push` of `main` to origin** publishes all of S1–S5's history, so **rotating the exposed Sanity Viewer token + a secret-scan of the tree are HARD BLOCKERS before that push** — sequenced as such in the runbook.

---

## A. `worker/test/smoke.test.ts` — post-intake transition walk

A **vitest integration spec** gated by the `SMOKE_BASE_URL` env var — inert in a normal `vitest run` (gate skips it), active only when that var is set. Wired as `npm run smoke` (= `vitest run test/smoke.test.ts`, run with the live env). Implemented as a vitest file — **not** a `tsx`/node script — so it reuses the already-installed test runner and TypeScript handling and imports `token.ts` directly: **no new dependency**, which matters because `npm install` only runs in Pieter's terminal (sandbox blocks it). **Not** an end-to-end test: it deliberately starts *after* intake. The public `POST /api/booking/request` path (Turnstile challenge + validation + the two intake emails) needs a real browser and is covered by **one manual form submission** in the runbook. The script proves the part unit tests can't — the **wiring** (bound routes, prod secrets, live Supabase, Brevo auth) across the signed-token transition chain.

### Configuration (all from env — nothing hardcoded)
`SMOKE_BASE_URL` (deployed worker origin) · `SUPABASE_URL` · `SUPABASE_SERVICE_KEY` · `SIGNING_SECRET` · `SMOKE_BRIDE_EMAIL` (an inbox the operator controls). These are **production** secrets for the real run — sourced from the secret store into the shell / a git-ignored file, never committed (see SECURITY.md).

### Flow
1. **Pre-sweep (idempotent):** delete any stale rows where `bride_name LIKE 'SMOKE TEST%'` (audit_log first, then bookings — FK-safe) so re-runs never accumulate junk.
2. **Seed** one `requested` booking directly via Supabase PostgREST (service key, `Prefer: return=representation` to get the generated `id`). Use a **sentinel far-future `wedding_date` (2099-xx-xx)** so it can never collide with the per-date capacity guard or real weddings, and `bride_name = "SMOKE TEST <ISO timestamp>"` for unmistakable identification. Populate every NOT-NULL column per migration `0001_booking_core.sql` and every column the handlers read (`CONFIRM_COLS`). **Critical asymmetry:** the seed MUST set the confirm-token-hash column to `hashToken(confirmToken)` (S3 confirm resolves the booking by *stored token hash*, not id). The action-token steps below do **not** need any stored hash.
3. **Confirm** — mint a 3-part confirm token with the worker's own `signToken(id, exp, SIGNING_SECRET)` (imported from `src/booking/token.ts` — single HMAC source of truth), `POST /api/booking/confirm` with `{token, action:"confirm"}`. Assert: row → `confirmed`, `confirmed_at` set, the confirm success audit event present, no `*.email-failed`.
4. **Mark deposit paid** — mint a 4-part `deposit` action token via `signActionToken(id, exp, SIGNING_SECRET, "deposit")`, `POST /api/booking/mark-paid`. Assert: row → `deposit_paid`, `deposit_paid_at` set, `payment.deposit-recorded` present, no `*.email-failed`.
5. **Mark balance paid** — mint a `balance` action token, `POST /api/booking/mark-balance-paid`. Assert: row → `settled`, `settled_at` set, `payment.balance-recorded` present, no `*.email-failed`.
6. **Cleanup** — in a `finally`, delete the test booking + its Supabase `audit_log` rows (audit_log first, then booking). `--keep` retains them for inspection. **R2 audit objects are left untouched** — they are immutable append-only by design ([audit.ts](../../../worker/src/booking/audit.ts)); deleting them fights their purpose, and they are isolated under the test booking's id.
7. **Result** — exit 0 on full pass; non-zero on first failure, printing the step, the expected-vs-actual diff, and the offending booking row + its audit rows for triage.

### Verified interfaces (checked against source 2026-06-13)
- Routes: `GET|POST /api/booking/confirm`, `/api/booking/mark-paid`, `/api/booking/mark-balance-paid` ([index.ts](../../../worker/src/index.ts)).
- Action-token purposes: `"deposit"` (S4), `"balance"` (S5, [balance.ts:80](../../../worker/src/booking/balance.ts)). TTL 90 days.
- Success audit events: `payment.deposit-recorded`, `payment.balance-recorded`; failures audit `payment.email-failed` while the handler still returns 200 ([balance.ts:151-158](../../../worker/src/booking/balance.ts)) — which is *why* the email check must assert on audit, not HTTP status. (Confirm's exact success event name to be pinned from `confirm.ts` during planning.)
- `writeAudit` dual-writes R2 + the Supabase `audit_log` table ([audit.ts](../../../worker/src/booking/audit.ts), migration `0001` line 61).

### Operational notes (must appear in the runbook)
- **Zandeline gets one test email per run.** At confirm, the deployed worker emails the real `NOTIFY_EMAIL` (also the Brevo *sender*) her mark-paid link. The script can't override a deployed secret, so this is unavoidable — the `"SMOKE TEST"` bride-name makes it obviously a test. Warn her, or run before her address is the live `NOTIFY_EMAIL`.
- Bride-facing emails go to `SMOKE_BRIDE_EMAIL` (operator-controlled).

### Testing approach (honest about the TDD mandate)
The project mandates TDD for booking logic; a live HTTP walk can't be TDD'd. Resolution: extract the **pure helpers** — the seed-row builder (returns a valid booking object) and the expected/actual assertion comparator (+ audit-event-presence check) — into an importable module and **TDD them** with ordinary unit tests in the same (already-installed) vitest. The live orchestration is the `SMOKE_BASE_URL`-gated integration spec, verified by the **rehearsal** (below), not by unit tests.

---

## B. `docs/RUNBOOK-go-live.md` — one authoritative go-live runbook

Supersedes the baton's Launch summary **and** the S4 plan's Phase C (which predates S5 and stops at `deposit_paid`). Carries every Phase-C nuance forward verbatim (paste-migration-into-SQL-editor, MX/SPF preservation, SSL/TLS Full-strict, the exact 10-secret list). The baton's Launch section collapses to a one-line pointer at this file; the S4 plan's Phase C gets a "superseded by" note so the two never silently diverge again.

### Ordered checklist
1. **Account prerequisites** (🛑 Pieter/Zandeline): Supabase (+ run migration in SQL editor) · Turnstile widget · Brevo sender verify · EFT details · Cloudflare zone.
2. **Rehearsal (as soon as Supabase exists):** run `npm run smoke` against `wrangler dev` (real/test Supabase + Brevo in git-ignored `.dev.vars`). Same script, `SMOKE_BASE_URL=http://localhost:8787`. Proves the script itself before launch day. *(This step is gated on Supabase — the first prereq — not on full deploy.)*
3. **🔐 Security gate (HARD BLOCKER before any origin push):** rotate the exposed Sanity Viewer token; secret-scan the working tree (no live keys committed). Only then is `main` safe to publish.
4. **Worker:** `wrangler r2 bucket create lustique-audit` · set the 10 secrets · confirm `ALLOWED_ORIGIN`.
5. **Front-end:** replace the Turnstile placeholder in `site/src/data/site.ts` with the real site key; commit.
6. **Deploy:** `cd worker && npx wrangler deploy`. Then **push `main` to origin** (first publish — gated by step 3) and connect the GitHub repo to Cloudflare Pages (build `npm run build` in `site/`, output `dist/`); bind apex + `www`.
7. **DNS cutover** (🛑 Pieter): GoDaddy nameservers → Cloudflare; preserve MX + SPF; SSL/TLS Full (strict).
8. **Verify go-live:**
   - **Manual:** submit one real booking on the live form → bride gets "request received", Zandeline gets the confirm link. *(Proves intake + Turnstile — the part the script skips.)*
   - **Scripted:** `npm run smoke` against the deployed worker → proves `requested→confirmed→deposit_paid→settled` wiring end-of-chain.
   - Confirm the daily cron is registered (dashboard / `wrangler deployments`); optional one-time local `wrangler dev --test-scheduled` to exercise `balanceSweep`.
9. **Post-launch (deferred):** Cloudflare WAF rate-limit `POST /api/booking/request` → 5/IP/hour.

---

## Out of scope (YAGNI)
- Live on-demand invocation of the `balanceSweep` cron (already unit-tested; runbook just confirms registration + optional local `--test-scheduled`).
- Turnstile / DNS / Pages automation (one-time manual ops).
- S6 email-content polish (separate layer).
- Reading bride inboxes / deliverability (we assert Brevo *acceptance* via audit, not delivery).
- Decline / guard-miss paths in the live walk (covered by unit tests; the live gate is the happy path to `settled`).

## Definition of done
- `worker/test/smoke.test.ts` (the `SMOKE_BASE_URL`-gated walk) + extracted pure helpers exist; `npm run smoke` wired; helpers unit-tested green; the gated walk stays inert in a normal `vitest run`; a documented rehearsal against `wrangler dev` passes once Supabase exists.
- `docs/RUNBOOK-go-live.md` is the single authoritative runbook; baton Launch section + S4 Phase C both point to it.
- The security gate (Sanity rotation + secret-scan) is sequenced as a hard blocker before the first origin push.
- No new worker source/behavior changes; no new *deployed* secrets (the `SMOKE_*` vars are operator runtime config); `cd worker && npx vitest run` stays green (the gated walk skips) and `wrangler deploy --dry-run` clean.
