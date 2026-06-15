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
**⬇ From umbrella (2026-06-15 · Studio Manager):**
- **🟢 Studio identity rule (Pieter directive):** every build lives under the studio identity (`hello@` + `Layer-Zero-Ops` GitHub org), never personal `Kempie-29`. **Lustique item (non-urgent):** the Sanity project is under `Kempie-29` (Continue-with-GitHub), but Sanity is **not wired into the build yet** (Pass 2 / deferred; site content is static) so the token is inert. Before Sanity goes live: stand up / transfer the project under a hello@ magic-link account, then bind `SANITY_*` as Cloudflare **Pages** build vars (not a Worker/Store secret). Ref `_ops/IDENTITY-AND-ACCOUNTS.md` §7.
- **🟢 Go-live state reconcile — what Pieter has done as of 2026-06-15:**
  - CF zone `lustiqueco.co.za` = **Active** in the hello@ Cloudflare account (prereq #5 ✅). ⚠ Active ⇒ nameservers already on CF — **verify MX/SPF carried over** or Zandeline's @lustiqueco.co.za inbox (the booking-notify address) may be down.
  - Supabase project created (prereq #1 ✅; client-builds org `ywoovdpnphcogwgoqhst`, `lustique` schema).
  - **5 secrets currently in the CF _account-level_ Secrets Store** (not per-Worker, not bound): `BREVO_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `TURNSTILE_SECRET`, `SANITY_API_KEY`. The Worker reads per-Worker string secrets (`env.X`) → these are invisible to it as-is (see DECISION 1). `SANITY_API_KEY` is inert regardless (the Worker never reads Sanity).
  - **EFT:** Pieter is deferring the values and wants them **admin-managed, not secrets** (see DECISION 2).
  - Still open on the runbook checklist: Turnstile **site key** → `site/src/data/site.ts` (frontend, not a store); **Brevo sender `hello@lustiqueco.co.za` verification** (≠ having the API key); `NOTIFY_EMAIL` (must equal the verified sender); `SIGNING_SECRET` (generate `openssl rand -hex 32`); **security gate** (RUNBOOK step 3 secret-scan — the committed Sanity token is low-stakes/unused, rotate only if the scan flags a live one).
- **⚪ DECISION 1 — secrets home (Lustique Opus owns):** per-Worker secrets (RUNBOOK step 4 as written; zero code; fastest) **vs** wire the account Secrets Store (`[[secrets_store_secrets]]` bindings + `await env.X.get()` refactor across `index.ts`/`request.ts`/`confirm.ts`/`balance.ts` + 89-test mock rework + `.dev.vars` for the local smoke walk). Umbrella's read (non-binding): launch on per-Worker; keep the Store entries as a later migration seed. **Your call to plan.**
- **⚪ DECISION 2 — EFT mechanism (Lustique Opus owns):** Pieter wants admin-managed EFT. No admin dashboard exists today (flow is token-link-driven; tables = `bookings`/`payments`/`audit_log`). EFT is **not deploy-blocking but is first-booking-blocking**. Umbrella's read (non-binding): a `business_settings` table seeded via SQL delivers "add later, no redeploy"; the admin UI is a fast-follow. Both touch Worker code + schema → Lustique Opus plan → Sonnet build.
- *Umbrella did not touch this baton's ▶ NEXT / State. Fold the above into your `next` reconcile, then clear this inbox (move to State or delete).*
