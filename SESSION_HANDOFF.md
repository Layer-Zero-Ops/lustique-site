# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Pre-launch — two small tasks, then go-live · **Updated:** 2026-06-15 (umbrella — decisions resolved, baton cleared)

## ▶ NEXT

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` · **Working tree:** repo root (single tree, no worktree)

---

### Context (read first — 2 minutes)

All S1–S5 code is complete and merged to `main` (`e08f338`, 89 tests green). The only work remaining before go-live is two small tasks below, plus three Pieter actions that run in parallel.

**Do NOT push `main` to GitHub.** The first push happens inside `docs/RUNBOOK-go-live.md` step 4 when Cloudflare Pages is wired. Routine housekeeping pushes will break the deploy flow.

---

### Task A — DECISION 1: secrets binding (document only, no code change)

**Decision (locked):** use per-Worker secrets — the RUNBOOK as-written, zero code change, fastest path to launch. The 5 secrets are already stored in the CF account-level Secrets Store but are NOT visible to the Worker (Workers read per-Worker bindings, not the Store). Pieter must run `wrangler secret put` for each one.

**Your job:**
1. Read `docs/RUNBOOK-go-live.md` step 4 (secrets section)
2. Confirm the `wrangler secret put` commands are already there and unambiguous — if unclear, tighten the wording
3. Add a callout box to the RUNBOOK: *"5 secrets are pre-staged in the CF account Secrets Store. Run `wrangler secret put` for each — values are already in the Store dashboard."*
4. List the 5 secrets explicitly: `BREVO_API_KEY` · `SUPABASE_URL` · `SUPABASE_SERVICE_KEY` · `TURNSTILE_SECRET` · `SIGNING_SECRET` (generate this one: `openssl rand -hex 32`)
5. Note: `SANITY_API_KEY` is in the Store but the Worker never reads it — skip it

No code change. No migration. RUNBOOK edit only.

---

### Task B — DECISION 2: EFT admin mechanism (migration + Worker code)

**Decision (locked):** `business_settings` table, seeded via SQL. No UI now; add later without a redeploy. EFT is not deploy-blocking but IS first-booking-blocking (Zandeline must enter her bank details before the system can send real payment instructions to brides).

**Your job:**

1. **Migration** — add to `supabase/migrations/` (next number):
```sql
CREATE TABLE lustique.business_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE lustique.business_settings ENABLE ROW LEVEL SECURITY;
-- service_role bypasses RLS; no anon access

-- Seed with placeholders (Zandeline fills in via Supabase dashboard or seed script)
INSERT INTO lustique.business_settings (key, value) VALUES
  ('eft_bank_name',        'PLACEHOLDER'),
  ('eft_account_holder',   'PLACEHOLDER'),
  ('eft_account_number',   'PLACEHOLDER'),
  ('eft_branch_code',      'PLACEHOLDER'),
  ('eft_reference_prefix', 'LUSTIQUE');
```

2. **Worker** — wherever the confirm email assembles EFT payment instructions, replace any hardcoded values with a lookup:
```typescript
const getSetting = async (key: string) => {
  const { data } = await supabase
    .from('business_settings')
    .select('value')
    .eq('key', key)
    .single()
  return data?.value ?? ''
}
```
Read the 5 keys above and inject into the email template. Cache the result for the duration of the request (no need for a global cache at this traffic level).

3. **RUNBOOK** — add a step to the pre-launch checklist: *"Update business_settings in Supabase dashboard: replace the 4 PLACEHOLDER rows with Zandeline's real bank details."*

4. **Tests** — mock the `business_settings` lookup in any test that exercises the confirm email path. Verify all 89 tests still pass.

---

### After both tasks

- Confirm 89 tests still pass (`npm test`)
- Update this baton:
  - Mark Tasks A + B done in State
  - Set `▶ NEXT` = go-live session (Sonnet · `docs/RUNBOOK-go-live.md`)
  - List the 3 remaining Pieter actions (below) so the go-live session opens with a clear checklist

**3 Pieter actions (parallel — no code, Pieter does these independently):**
1. Turnstile **site key** → copy from CF dashboard → update `site/src/data/site.ts` (a frontend constant, not a secret)
2. Brevo → verify `hello@lustiqueco.co.za` as a sender identity (Settings → Senders → Add sender)
3. CF DNS → confirm MX + SPF records carried over when zone went active (nameservers are already on CF) — if missing, Zandeline's @lustiqueco.co.za inbox is dead

Product rule locked (Pieter 2026-06-12): the bride is told her date is BOOKED only once the EFT deposit is *received* (mark-paid), not at confirm.

## 🛑 Launch — account-gated
Authoritative procedure: **`docs/RUNBOOK-go-live.md`** (supersedes scattered Launch notes + S4 Phase C).

## State

### Completed (done-ledger — curated; git holds per-commit detail)
- Pass 1 (Astro parity) ✅ · Pass 1.5 (elevation) ✅ · tag `pass-1-parity`
- Booking core spec ✅ adversarially reviewed (`docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md`)
- **S1 data layer ✅** — schema (incl. `settled_at`, `balance_reminder_sent_at`) + `workingDaysBefore` helper. 36 tests.
- **S2 request-to-book ✅** — token sign/hash, `countBookingsOnDate`, `handleBookingRequest`, quote form, booking-received page.
- **S3 confirm gate ✅** — `verifyToken`, guarded `requested→confirmed|declined`, confirm page, EFT deposit email, thank-you pages. 56 tests.
- **S4 EFT payments A+B ✅** — confirm email = payment invitation; purpose-scoped action tokens; `getBookingById` + generalized `transitionBooking`; EFT `mark-paid` (`confirmed→deposit_paid`); `wrangler.toml` Phase C config (live route + 10 secret slots). 71 tests.
- **S5 balance cron ✅** — `balance.ts` (GET+POST+sweep) · `listBookingsDueForBalanceReminder` · routes + `balanceSweep` cron. 14-working-day EFT balance reminder + `deposit_paid→settled`. 83 tests, 54.66 KiB. (`b1b68ba..b0575e3`)
- **Launch-readiness ✅ BUILT 2026-06-14 (Sonnet) + Opus-reconciled** — `smoke-helpers.ts` (`buildSmokeBooking` + `evaluateStep`, TDD) · `smoke.test.ts` (`SMOKE_BASE_URL`-gated live walk) · `npm run smoke` · `docs/RUNBOOK-go-live.md` (authoritative). 89 tests green, 3 skipped (live walk gated), bundle 54.66 KiB unchanged.
- **Integrate + prune ✅ 2026-06-14 (Sonnet)** — `claude/launch-readiness` FF-merged → `main` (`be82436..e08f338`, 7 files +344/−39). All feature branches deleted (`s2/s3/s4/s5/launch-readiness`). Stale worktree `infallible-satoshi-95b8fb` + branch `claude/infallible-satoshi-95b8fb` removed. Repo now: `main` only, single working tree. Local `main` @ `e08f338`.

## Build lane / branch
- `main` @ `e08f338` (local-only) — complete: S1–S5 + launch-readiness. Only branch; single working tree.
- ⚠️ No upstream set; push is intentionally deferred to go-live (RUNBOOK step 4).

## Booking build sequence
S1 ✅ → S2 ✅ → S3 ✅ → S4 EFT v1 ✅ → S5 balance cron ✅ → Launch-readiness ✅ → Integrate+prune ✅ → **go-live (account-gated, next)** · S6 emails (Brevo polish · later, needs Opus plan) · Yoco v2 (later, needs Opus plan)

## Pointers
- Go-live (authoritative): `docs/RUNBOOK-go-live.md`
- Spec: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md` *(balance section is Yoco-era — superseded by EFT-first)*
- Launch-readiness: spec `docs/superpowers/specs/2026-06-13-lustique-launch-readiness-design.md` + plan `docs/superpowers/plans/2026-06-13-lustique-launch-readiness.md`
- Plans: `docs/superpowers/plans/` — S1–S5 + go-live (`2026-06-12-lustique-eft-payments-and-go-live.md`, `2026-06-13-lustique-booking-s5-balance-cron.md`)
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`

## ⇄ Umbrella  (project ↔ Studio Manager · empty unless pending · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** none
**⬇ From umbrella:** *(inbox cleared 2026-06-15 — folded into State + ▶ NEXT above)*
