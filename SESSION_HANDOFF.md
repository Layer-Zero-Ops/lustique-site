# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** S5 balance cron (plan ✅ → build) ∥ Phase C go-live (account-gated) · **Updated:** 2026-06-13 (Opus — S5 planned; S4 ledger reconciled)

## ▶ NEXT
🟢 **Build S5 — balance automation** (unblocked; no account access needed). Execute
`docs/superpowers/plans/2026-06-13-lustique-booking-s5-balance-cron.md` task-by-task (TDD,
5 tasks, commit per task) via `superpowers:executing-plans` (or `subagent-driven-development`).

S5 = *14 working days before the wedding, the daily cron emails the bride her outstanding EFT
balance; Zandeline marks it received to move the booking `deposit_paid → settled`.* It mirrors
the S4 EFT `mark-paid` loop one state later (token purpose `"balance"`). **No migration, no new
secrets** (`settled_at` + `balance_reminder_sent_at` already in the schema; cron already wired) —
so it builds + unit-tests on today's `main`, fully in parallel with the launch track below.

- Create `worker/src/booking/balance.ts` (+ test); add `listBookingsDueForBalanceReminder` to `db.ts`; wire `GET|POST /api/booking/mark-balance-paid` + call `balanceSweep(env)` in `scheduled()`.
- Verify (lean): `cd worker && npm test` green · `npx wrangler deploy --dry-run` clean · grep the new route/purpose/stamp.
- Live end-to-end smoke is **deferred to the account-gated go-live** (same blocked path as Phase C's smoke).

## 🛑 Launch (Phase C go-live) — account-gated, PARALLEL track (does not block S5)
All app code is ✅ on `main`. Go-live is blocked only on these human prerequisites:

**Account prerequisites (🛑 Pieter/Zandeline — parallelizable, any order):**
- [ ] **Supabase** — create project (`af-south-1`) → invite `hello@layerzerostudios.com` as Admin → run `supabase/migrations/0001_booking_core.sql` → capture URL + service-role key
- [ ] **Turnstile** — create widget for `lustiqueco.co.za` → replace `1x00000000000000000000AA` in `site/src/data/site.ts` → note secret
- [ ] **Brevo** — verify `info@lustiqueco.co.za` sender → capture API key
- [ ] **EFT details** — bank, account name, account no., branch code from Zandeline
- [ ] **Cloudflare zone** — add `lustiqueco.co.za` (Free plan)

**Once prerequisites done (Sonnet-runnable in order):**
1. `cd worker && npx wrangler r2 bucket create lustique-audit`
2. `wrangler secret put` ×10: `BREVO_API_KEY` `NOTIFY_EMAIL` `SUPABASE_URL` `SUPABASE_SERVICE_KEY` `SIGNING_SECRET` (random 32-byte hex) `TURNSTILE_SECRET` `EFT_BANK` `EFT_ACCOUNT_NAME` `EFT_ACCOUNT_NO` `EFT_BRANCH_CODE`
3. `cd worker && npx wrangler deploy`
4. Connect GitHub → Cloudflare Pages (build `npm run build` in `site/`, output `dist/`); bind apex + `www`
5. 🛑 DNS cutover: GoDaddy nameservers → Cloudflare; preserve MX + SPF; SSL/TLS Full (strict)
6. End-to-end smoke: 3 emails + DB walk `requested → confirmed → deposit_paid` (+ `→ settled` once S5 is live)

### 🔑 Product rule locked (Pieter 2026-06-12)
**The bride is told her date is BOOKED only once the EFT deposit is RECEIVED** — not at Zandeline's
confirm. Confirm email = payment *invitation*; mark-paid (deposit received) = the *real*
confirmation + `deposit_paid`. Yoco's webhook will automate mark-paid (deposit + balance) in S4-v2.

**Open deploy gates (parallel — unblock live launch, not the build):**
- **Yoco** (v2): verify Payments API endpoints + webhook signature + real online fee rate for `YOCO_FEE_RATE` (deferred; EFT-first is live rail)
- **WAF rule**: after deploy, Cloudflare WAF rate-limit `POST /api/booking/request` → 5 req/IP/hour
- Email migration: GoDaddy → Google Workspace (`info@` blocked by personal acct — Admin console Transfer tool)
- 🔐 Rotate exposed Sanity Viewer token when next touching secrets

## State

### Completed (done-ledger — curated; git holds per-commit detail)
- Pass 1 (Astro parity) ✅ · Pass 1.5 (elevation) ✅ · tag `pass-1-parity`
- Booking core spec written + adversarially reviewed ✅ (`docs/.../specs/2026-06-05-lustique-booking-core-design.md`)
- **S1 data layer ✅** (merged `main` 2026-06-07): 36 tests green; schema (incl. `settled_at`, `balance_reminder_sent_at`) + `workingDaysBefore` helper pre-provisioned for S5.
- **S2 request-to-book ✅** (merged `main` 2026-06-12): token sign/hash, `countBookingsOnDate`, `handleBookingRequest`, quote form, booking-received page.
- **S3 confirm gate ✅** (merged `main` 2026-06-12): `verifyToken`, guarded `requested→confirmed|declined`, render-only confirm page, EFT deposit email, thank-you pages. 56 tests.
- **S4 EFT payments A+B ✅** (merged `main` 2026-06-12): confirm email = payment invitation; purpose-scoped action tokens; `getBookingById` + generalized `transitionBooking`; EFT `mark-paid` (`confirmed→deposit_paid`) + routes. 71 tests, bundle 42.56 KiB. `wrangler.toml` Phase C config (live route + 10 secret slots) also on `main`.
- **S5 balance cron — PLANNED ✅** (Opus 2026-06-13): plan `docs/superpowers/plans/2026-06-13-lustique-booking-s5-balance-cron.md`. Ready to build (see ▶ NEXT).

## Build lane / branch
- On `main`, clean. S2/S3/S4 all merged (fast-forward).
- S5 builds on a fresh branch off `main` (e.g. `claude/s5-balance-cron`).
- ⚠️ Stale worktree `infallible-satoshi-95b8fb` (branch has 0 unique commits) — prune once Claude isn't running from it: `git worktree remove .claude/worktrees/infallible-satoshi-95b8fb && git branch -d claude/infallible-satoshi-95b8fb`.

## Booking build sequence
S1 ✅ → S2 ✅ → S3 ✅ → **S4 EFT v1 ✅ (deploy-gated) · Yoco v2 later** → **S5 balance cron (plan ✅ → building)** → S6 emails (Brevo polish)

## Pointers
- S5 plan (next ▶): `docs/superpowers/plans/2026-06-13-lustique-booking-s5-balance-cron.md`
- Spec: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md` *(balance section is Yoco-era — superseded by EFT-first; touch-up deferred)*
- S4-EFT + go-live plan: `docs/superpowers/plans/2026-06-12-lustique-eft-payments-and-go-live.md`
- S1/S2/S3 plans: `docs/superpowers/plans/2026-06-{05,11,11}-lustique-booking-s{1,2,3}-*.md`
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`

## ⇄ Umbrella  (project ↔ Studio Manager · empty unless pending · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** none
**⬇ From umbrella:** none
