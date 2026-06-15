# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Go-live ready — 3 Pieter actions pending · **Updated:** 2026-06-15 (Sonnet — DECISION 1+2 shipped)

## ▶ NEXT

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` · **Working tree:** repo root (single tree, no worktree)

---

### Go-live session

When the 3 Pieter actions below are confirmed complete, open a **go-live session** and run `docs/RUNBOOK-go-live.md` step-by-step.

**3 Pieter actions (parallel — no code, Pieter does these):**
1. **Turnstile site key** — copy from CF dashboard → update `site/src/data/site.ts` (`PUBLIC_TURNSTILE_SITE_KEY` constant), commit
2. **Brevo sender** — verify `hello@lustiqueco.co.za` as a sender identity (Settings → Senders → Add sender)
3. **CF DNS** — confirm MX + SPF records are present on the `lustiqueco.co.za` CF zone (Zandeline's @lustiqueco.co.za inbox depends on this)

Product rule locked (Pieter 2026-06-12): bride is told her date is BOOKED only once the EFT deposit is *received* (mark-paid), not at confirm.

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
- **DECISION 1+2 ✅ 2026-06-15 (Sonnet)** — `061c616`. DECISION 1: per-Worker `wrangler secret put` (RUNBOOK step 4, 6 secrets, 5 pre-staged in CF Secrets Store). DECISION 2: `business_settings` table (`0002_business_settings.sql`); Worker reads EFT details via `getEftSettings()` from DB at request time; EFT fields removed from env. 89 tests pass.

## Build lane / branch
- `main` @ `a7e631d` — pushed to `github.com/Layer-Zero-Ops/lustique-site` (private). GitHub Actions deploys Worker on push to `main` (needs `CF_API_TOKEN` secret — see Pieter actions). CF Pages connects to this repo for site deploys.

## Booking build sequence
S1 ✅ → S2 ✅ → S3 ✅ → S4 EFT v1 ✅ → S5 balance cron ✅ → Launch-readiness ✅ → Integrate+prune ✅ → DECISION 1+2 ✅ → **go-live (account-gated, next)** · S6 emails (Brevo polish · later, needs Opus plan) · Yoco v2 (later, needs Opus plan)

## Pointers
- Go-live (authoritative): `docs/RUNBOOK-go-live.md`
- Spec: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md` *(balance section is Yoco-era — superseded by EFT-first)*
- Launch-readiness: spec `docs/superpowers/specs/2026-06-13-lustique-launch-readiness-design.md` + plan `docs/superpowers/plans/2026-06-13-lustique-launch-readiness.md`
- Plans: `docs/superpowers/plans/` — S1–S5 + go-live (`2026-06-12-lustique-eft-payments-and-go-live.md`, `2026-06-13-lustique-booking-s5-balance-cron.md`)
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`

## ⇄ Umbrella  (project ↔ Studio Manager · empty unless pending · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** 🟢 FYI — DECISION 1+2 shipped (`061c616`). Lustique is go-live ready pending 3 Pieter actions (Turnstile site key · Brevo sender verify · CF DNS check). No further code sessions needed until those land.
**⬇ From umbrella:** *(inbox cleared 2026-06-15)*
