# SESSION_HANDOFF — Lustique

**Lane:** 🔵 Plan (Opus) next · **Phase:** Launch-readiness ✅ BUILT → Opus reconcile + prune stale worktrees · **Updated:** 2026-06-14 (Sonnet — launch-readiness pass built)

## ▶ NEXT
🔵 **Opus — reconcile + hand off to go-live.** Launch-readiness pass ✅ built on `claude/launch-readiness` (4 tasks, 89 tests green, bundle 54.66 KiB unchanged). Merge `claude/launch-readiness` → `main`. Prune stale worktree + merged branches (see Build lane below). Then prime ▶ NEXT for go-live: next Sonnet session = account prereqs checklist runner (once Pieter/Zandeline unblock).

> ⚠️ **`main` is local-only — push deferred to launch.** No upstream is set; `origin/main` is still the old `384ecbb` (Pass-1). All of S1–S5 is intentionally unpushed — the first push to GitHub happens at go-live when Cloudflare Pages is wired (Launch step 4). Do **not** push `main` as routine reconcile.

## 🛑 Launch (Phase C go-live) — account-gated, PARALLEL track
The authoritative go-live procedure now lives in **`docs/RUNBOOK-go-live.md`** (5 account
prereqs → security gate → secrets → deploy → DNS → manual + `npm run smoke` verification).
Launch is blocked only on the 5 human prerequisites in that runbook. Product rule locked
(Pieter 2026-06-12): the bride is told her date is BOOKED only once the EFT deposit is
*received* (mark-paid), not at confirm.

## State

### Completed (done-ledger — curated; git holds per-commit detail)
- Pass 1 (Astro parity) ✅ · Pass 1.5 (elevation) ✅ · tag `pass-1-parity`
- Booking core spec ✅ adversarially reviewed (`docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md`)
- **S1 data layer ✅** — schema (incl. `settled_at`, `balance_reminder_sent_at`) + `workingDaysBefore` helper pre-provisioned for S5. 36 tests.
- **S2 request-to-book ✅** — token sign/hash, `countBookingsOnDate`, `handleBookingRequest`, quote form, booking-received page.
- **S3 confirm gate ✅** — `verifyToken`, guarded `requested→confirmed|declined`, confirm page, EFT deposit email, thank-you pages. 56 tests.
- **S4 EFT payments A+B ✅** — confirm email = payment invitation; purpose-scoped action tokens; `getBookingById` + generalized `transitionBooking`; EFT `mark-paid` (`confirmed→deposit_paid`) + routes; `wrangler.toml` Phase C config (live route + 10 secret slots). 71 tests, 42.56 KiB.
- **S5 balance cron ✅ merged to `main` (local) 2026-06-13** — `balance.ts` (GET+POST+sweep) · `listBookingsDueForBalanceReminder` in `db.ts` · routes + `balanceSweep` cron in `index.ts`. 14-working-day EFT balance reminder + `deposit_paid→settled` mark-balance-paid. 83 tests, 54.66 KiB. Commits `b1b68ba..b0575e3`.
- **Launch-readiness pass ✅ BUILT 2026-06-14** (Sonnet — branch `claude/launch-readiness`, 4 commits): `buildSmokeBooking` seed helper (TDD) · `evaluateStep` assertion comparator (TDD) · `SMOKE_BASE_URL`-gated live walk (`smoke.test.ts`) + `npm run smoke` · `docs/RUNBOOK-go-live.md` (authoritative; baton Launch section + S4 Phase C superseded). 89 tests green, 3 skipped (live walk gated), bundle 54.66 KiB unchanged. Merge to `main` pending Opus reconcile.

## Build lane / branch
- `main` @ `b0575e3` (local-only — see push note in ▶ NEXT).
- `claude/s5-balance-cron` — merged; safe to delete: `git branch -d claude/s5-balance-cron`.
- ⚠️ Stale branches/worktree to prune (Sonnet housekeeping, non-blocking):
  - worktree: `git worktree remove .claude/worktrees/infallible-satoshi-95b8fb && git branch -d claude/infallible-satoshi-95b8fb`
  - merged feature branches: `claude/s2-booking-request` · `claude/s3-booking-confirm` · `claude/s4-eft-payments`

## Booking build sequence
S1 ✅ → S2 ✅ → S3 ✅ → S4 EFT v1 ✅ → S5 balance cron ✅ → **Launch-readiness (planned → build next)** · S6 emails (Brevo polish · later) · Yoco v2 (later)

## Pointers
- Spec: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md` *(balance section is Yoco-era — superseded by EFT-first)*
- Plans: `docs/superpowers/plans/` — S1–S5 + go-live (`2026-06-12-lustique-eft-payments-and-go-live.md`, `2026-06-13-lustique-booking-s5-balance-cron.md`)
- Launch-readiness (▶ build next): spec `docs/superpowers/specs/2026-06-13-lustique-launch-readiness-design.md` + plan `docs/superpowers/plans/2026-06-13-lustique-launch-readiness.md`
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`

## ⇄ Umbrella  (project ↔ Studio Manager · empty unless pending · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** none
**⬇ From umbrella:** none
