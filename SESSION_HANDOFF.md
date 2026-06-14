# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) next · **Phase:** Launch-readiness ✅ BUILT + Opus-reconciled → Sonnet: FF-merge to local `main` + prune, then go-live (account-gated) · **Updated:** 2026-06-14 (Opus — reconciled launch-readiness; git-verified)

## ▶ NEXT
🟢 **Sonnet — finish the launch-readiness branch, then stand by for go-live.**

**A. Integrate + prune (UNBLOCKED — do now).** `claude/launch-readiness` is a clean fast-forward over `main` (4 commits `37147d5..7c853b3` + this reconcile's baton commit; 7 files +326/−30; `npm run smoke` wired; tree clean; all old branch tips are ancestors of `main` → plain `-d` is safe). Land it on local `main` and clean up:
```
git checkout main
git merge --ff-only claude/launch-readiness
git worktree remove .claude/worktrees/infallible-satoshi-95b8fb
git branch -d claude/infallible-satoshi-95b8fb claude/s2-booking-request \
  claude/s3-booking-confirm claude/s4-eft-payments claude/s5-balance-cron claude/launch-readiness
```
After this `git branch` should show only `main`. Record the merge in the done-ledger + prime ▶ NEXT for go-live.
⚠️ **Do NOT push** — see push note below.

**B. Go-live (BLOCKED on 5 human prereqs).** Run **`docs/RUNBOOK-go-live.md`** end-to-end — the account-prereqs checklist runner (5 prereqs → security gate → secrets → deploy → DNS → manual + `npm run smoke` verification). Do **not** start until Pieter/Zandeline confirm the 5 account prerequisites. Product rule locked (Pieter 2026-06-12): the bride is told her date is BOOKED only once the EFT deposit is *received* (mark-paid), not at confirm.

> ⚠️ **`main` is local-only — push deferred to launch.** No upstream is set; `origin/main` is still the old `384ecbb` (Pass-1). All of S1–S5 + launch-readiness is intentionally unpushed — the first push to GitHub happens at go-live when Cloudflare Pages is wired (RUNBOOK step 4). Do **not** push as routine housekeeping.

## 🛑 Launch (Phase C go-live) — account-gated, PARALLEL track
Authoritative procedure: **`docs/RUNBOOK-go-live.md`** (supersedes the scattered Launch notes + S4 Phase C). Launch is blocked only on the 5 human prerequisites in that runbook.

## State

### Completed (done-ledger — curated; git holds per-commit detail)
- Pass 1 (Astro parity) ✅ · Pass 1.5 (elevation) ✅ · tag `pass-1-parity`
- Booking core spec ✅ adversarially reviewed (`docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md`)
- **S1 data layer ✅** — schema (incl. `settled_at`, `balance_reminder_sent_at`) + `workingDaysBefore` helper. 36 tests.
- **S2 request-to-book ✅** — token sign/hash, `countBookingsOnDate`, `handleBookingRequest`, quote form, booking-received page.
- **S3 confirm gate ✅** — `verifyToken`, guarded `requested→confirmed|declined`, confirm page, EFT deposit email, thank-you pages. 56 tests.
- **S4 EFT payments A+B ✅** — confirm email = payment invitation; purpose-scoped action tokens; `getBookingById` + generalized `transitionBooking`; EFT `mark-paid` (`confirmed→deposit_paid`); `wrangler.toml` Phase C config (live route + 10 secret slots). 71 tests.
- **S5 balance cron ✅** — `balance.ts` (GET+POST+sweep) · `listBookingsDueForBalanceReminder` · routes + `balanceSweep` cron. 14-working-day EFT balance reminder + `deposit_paid→settled`. 83 tests, 54.66 KiB. (`b1b68ba..b0575e3`)
- **Launch-readiness ✅ BUILT 2026-06-14 (Sonnet) + Opus-reconciled** — branch `claude/launch-readiness`, 4 commits (`37147d5..7c853b3`), 7 files +326/−30: `smoke-helpers.ts` (`buildSmokeBooking` + `evaluateStep`, TDD) · `smoke.test.ts` (`SMOKE_BASE_URL`-gated live walk) · `npm run smoke` (worker/package.json) · `docs/RUNBOOK-go-live.md` (authoritative). 89 tests green, 3 skipped (live walk gated), bundle 54.66 KiB unchanged. **Opus git-verified**: clean FF over `main`, tree clean. Merge to local `main` = ▶ NEXT step A.

## Build lane / branch
- `main` @ `be82436` (local-only) — S1–S5 + launch-readiness spec/plan docs.
- `claude/launch-readiness` @ `7c853b3` (+ this reconcile's baton commit) — clean FF over `main`; merge + prune = ▶ NEXT step A.
- Merged feature branches to delete on merge (all ancestors of `main`): `claude/s2-booking-request` · `claude/s3-booking-confirm` · `claude/s4-eft-payments` · `claude/s5-balance-cron`.
- Stale worktree to remove: `.claude/worktrees/infallible-satoshi-95b8fb` (branch `claude/infallible-satoshi-95b8fb` @ `384ecbb`, old Pass-1).

## Booking build sequence
S1 ✅ → S2 ✅ → S3 ✅ → S4 EFT v1 ✅ → S5 balance cron ✅ → Launch-readiness ✅ → **go-live (account-gated, next)** · S6 emails (Brevo polish · later, needs Opus plan) · Yoco v2 (later, needs Opus plan)

## Pointers
- Go-live (authoritative): `docs/RUNBOOK-go-live.md`
- Spec: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md` *(balance section is Yoco-era — superseded by EFT-first)*
- Launch-readiness: spec `docs/superpowers/specs/2026-06-13-lustique-launch-readiness-design.md` + plan `docs/superpowers/plans/2026-06-13-lustique-launch-readiness.md`
- Plans: `docs/superpowers/plans/` — S1–S5 + go-live (`2026-06-12-lustique-eft-payments-and-go-live.md`, `2026-06-13-lustique-booking-s5-balance-cron.md`)
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`

## ⇄ Umbrella  (project ↔ Studio Manager · empty unless pending · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** none
**⬇ From umbrella:** none
