# SESSION_HANDOFF — Lustique

**Lane:** 🛑 Go-live (account-gated) · **Phase:** All code merged to `main` — standing by for 5 prereqs then go-live · **Updated:** 2026-06-14 (Sonnet — FF-merge + full prune ✅)

## ▶ NEXT

**Model:** Opus  **Lane:** Plan  (then Sonnet builds)

🛑 **Go-live (BLOCKED — 2 Opus decisions + 3 Pieter/Zandeline actions).**

**Step 1 — Opus plan session (DECISION 1 + DECISION 2 are Opus-scope: one-way-door code + schema changes):**

- **DECISION 1 — secrets home:** per-Worker secrets (RUNBOOK step 4 as written; zero code; fastest to launch) vs. wire the account Secrets Store (`[[secrets_store_secrets]]` bindings + `await env.X.get()` refactor across 4 files + 89-test mock rework + `.dev.vars` update). Umbrella read (non-binding): launch on per-Worker; migrate to Store later. **Opus decides + plans.**
- **DECISION 2 — EFT admin mechanism:** Pieter wants EFT details admin-managed (not secrets). No admin UI exists today. EFT is **not deploy-blocking but is first-booking-blocking**. Options: (a) `business_settings` table seeded via SQL — zero UI, add-later-no-redeploy; (b) simple admin route behind auth. **Opus decides + plans.**

**Step 2 — Sonnet build session:** execute whatever Opus planned for DECISION 1 + 2.

**Step 3 — Pieter closes 3 remaining checklist items (parallel, no code):**
1. Turnstile **site key** → update `site/src/data/site.ts` (frontend const, not a secret)
2. Brevo sender verify → verify `hello@lustiqueco.co.za` as a Brevo sender identity
3. MX/SPF check → nameservers are on CF (zone active) — confirm MX records carried over or Zandeline's inbox is down

**Step 4 — go-live session:** run `docs/RUNBOOK-go-live.md` end-to-end. `main` is local-only; first push is RUNBOOK step 4.

> ⚠️ **`main` is local-only — push deferred to launch.** Do **not** push as routine housekeeping.

**Prereqs status (2026-06-15):**
- ✅ CF zone `lustiqueco.co.za` — Active in hello@ account
- ✅ Supabase project — created in client-builds org; `lustique` schema + `lustique_owner` role provisioned
- ✅ 5 secrets in CF account-level Secrets Store (see DECISION 1 above for binding plan)
- ⏳ Turnstile site key → `site.ts` (Pieter)
- ⏳ Brevo sender verification (Pieter)
- ⏳ EFT mechanism (DECISION 2 — Opus plans; Sonnet builds)
- ⏳ MX/SPF carry-over confirm (Pieter)

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
