# SESSION_HANDOFF — Lustique

**Lane:** 🔵 Plan (Opus) · **Phase:** S5 ✅ merged to `main` (local-only) → Opus planning next layer · **Updated:** 2026-06-13 (Opus — reconciled S5)

## ▶ NEXT
🔵 **Opus — plan the next layer.** Reconcile done: S5 FF-merged into local `main` (`b0575e3`, 83/83 green, 54.66 KiB). Pending decision (Pieter): **S6 email polish** (keep the build lane warm) vs **pause until Phase C account prereqs land**. Once chosen → brainstorm + write the plan, prime ▶ NEXT, 🔵 hand to Sonnet.

> ⚠️ **`main` is local-only — push deferred to launch.** No upstream is set; `origin/main` is still the old `384ecbb` (Pass-1). All of S1–S5 is intentionally unpushed — the first push to GitHub happens at go-live when Cloudflare Pages is wired (Launch step 4). Do **not** push `main` as routine reconcile.

## 🛑 Launch (Phase C go-live) — account-gated, PARALLEL track (does not block planning)
All app code is ✅ on local `main`. Go-live is blocked only on these human prerequisites:

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
4. Connect GitHub → Cloudflare Pages (build `npm run build` in `site/`, output `dist/`); bind apex + `www`. **← first `git push` of `main` to origin happens here.**
5. 🛑 DNS cutover: GoDaddy nameservers → Cloudflare; preserve MX + SPF; SSL/TLS Full (strict)
6. End-to-end smoke: 3 emails + DB walk `requested → confirmed → deposit_paid → settled`

### 🔑 Product rule locked (Pieter 2026-06-12)
**The bride is told her date is BOOKED only once the EFT deposit is RECEIVED** — not at Zandeline's confirm. Confirm email = payment *invitation*; mark-paid (deposit received) = the *real* confirmation + `deposit_paid`. Yoco's webhook will automate mark-paid (deposit + balance) in S4-v2.

**Open deploy gates (parallel — unblock live launch, not the build):**
- **Yoco** (v2): verify Payments API endpoints + webhook signature + real online fee rate for `YOCO_FEE_RATE` (deferred; EFT-first is live rail)
- **WAF rule**: after deploy, Cloudflare WAF rate-limit `POST /api/booking/request` → 5 req/IP/hour
- Email migration: GoDaddy → Google Workspace (`info@` blocked by personal acct — Admin console Transfer tool)
- 🔐 Rotate exposed Sanity Viewer token when next touching secrets

## State

### Completed (done-ledger — curated; git holds per-commit detail)
- Pass 1 (Astro parity) ✅ · Pass 1.5 (elevation) ✅ · tag `pass-1-parity`
- Booking core spec ✅ adversarially reviewed (`docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md`)
- **S1 data layer ✅** — schema (incl. `settled_at`, `balance_reminder_sent_at`) + `workingDaysBefore` helper pre-provisioned for S5. 36 tests.
- **S2 request-to-book ✅** — token sign/hash, `countBookingsOnDate`, `handleBookingRequest`, quote form, booking-received page.
- **S3 confirm gate ✅** — `verifyToken`, guarded `requested→confirmed|declined`, confirm page, EFT deposit email, thank-you pages. 56 tests.
- **S4 EFT payments A+B ✅** — confirm email = payment invitation; purpose-scoped action tokens; `getBookingById` + generalized `transitionBooking`; EFT `mark-paid` (`confirmed→deposit_paid`) + routes; `wrangler.toml` Phase C config (live route + 10 secret slots). 71 tests, 42.56 KiB.
- **S5 balance cron ✅ merged to `main` (local) 2026-06-13** — `balance.ts` (GET+POST+sweep) · `listBookingsDueForBalanceReminder` in `db.ts` · routes + `balanceSweep` cron in `index.ts`. 14-working-day EFT balance reminder + `deposit_paid→settled` mark-balance-paid. 83 tests, 54.66 KiB. Commits `b1b68ba..b0575e3`.

## Build lane / branch
- `main` @ `b0575e3` (local-only — see push note in ▶ NEXT).
- `claude/s5-balance-cron` — merged; safe to delete: `git branch -d claude/s5-balance-cron`.
- ⚠️ Stale branches/worktree to prune (Sonnet housekeeping, non-blocking):
  - worktree: `git worktree remove .claude/worktrees/infallible-satoshi-95b8fb && git branch -d claude/infallible-satoshi-95b8fb`
  - merged feature branches: `claude/s2-booking-request` · `claude/s3-booking-confirm` · `claude/s4-eft-payments`

## Booking build sequence
S1 ✅ → S2 ✅ → S3 ✅ → S4 EFT v1 ✅ → S5 balance cron ✅ → **S6 emails (Brevo polish · candidate next)** · Yoco v2 (later)

## Pointers
- Spec: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md` *(balance section is Yoco-era — superseded by EFT-first)*
- Plans: `docs/superpowers/plans/` — S1–S5 + go-live (`2026-06-12-lustique-eft-payments-and-go-live.md`, `2026-06-13-lustique-booking-s5-balance-cron.md`)
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`

## ⇄ Umbrella  (project ↔ Studio Manager · empty unless pending · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** none
**⬇ From umbrella:** none
