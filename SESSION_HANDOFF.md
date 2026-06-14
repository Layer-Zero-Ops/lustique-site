# SESSION_HANDOFF — Lustique

**Lane:** 🛑 Go-live (account-gated) · **Phase:** All code merged to `main` — standing by for 5 prereqs then go-live · **Updated:** 2026-06-14 (Sonnet — FF-merge + full prune ✅)

## ▶ NEXT
🛑 **Go-live (BLOCKED on 5 human prereqs — Pieter/Zandeline).**

Run **`docs/RUNBOOK-go-live.md`** end-to-end once all 5 account prerequisites are confirmed. Sequence: prereqs checklist → security gate → secrets → deploy → DNS → `npm run smoke` verification.

**5 prerequisites (all Pieter/Zandeline actions — parallel, not sequential):**
1. Supabase project in `af-south-1` — create in the LZS Client Builds org (`ywoovdpnphcogwgoqhst`), schema `lustique` + `lustique_owner` role already provisioned
2. Cloudflare Turnstile widget — create widget, grab site key + secret key
3. Brevo sender verify — verify `hello@lustiqueco.co.za` as a Brevo sender identity
4. EFT details from Zandeline — bank name, account holder, account number, branch code
5. Cloudflare zone `lustiqueco.co.za` — domain must be in CF (for Pages deployment)

> ⚠️ **`main` is local-only — push deferred to launch.** The first push to GitHub happens at go-live when Cloudflare Pages is wired (RUNBOOK step 4). Do **not** push as routine housekeeping.

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
**⬇ From umbrella:** none
