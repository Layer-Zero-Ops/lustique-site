# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Booking S2 build · **Updated:** 2026-06-10

## ▶ NEXT
🟢 Sonnet: **build S2 — request-to-book** from `docs/superpowers/plans/2026-06-10-lustique-booking-s2-request-to-book.md` using **superpowers:subagent-driven-development** (fresh subagent per task + review) or **superpowers:executing-plans** (inline, batched). Plan is approved; work task-by-task, Phase A (Worker, TDD) then Phase B (Astro UI).
- **First task (A0) adds `@lustique/pricing` to `worker/package.json` → needs `npm install` in Pieter's terminal** (sandbox blocks installs). Pause there.
- Builds + unit-tests fully offline; **live** deploy is gated on the account actions below (not on the build).
- Definition of Done + verification commands are in the plan's §Verification.

## State
- Pass 1 (Astro parity) ✅ · Pass 1.5 (elevation) ✅ · tag `pass-1-parity`
- Booking core spec written + adversarially reviewed ✅ (`docs/.../specs/2026-06-05-lustique-booking-core-design.md`)
- **S1 data layer ✅ DONE + VERIFIED** (Opus reconcile 2026-06-10): 36 tests green (24 pricing + 12 worker), worker bundles clean (`wrangler --dry-run`), schema + money math (`grossUp`/`splitDeposit`) + idempotent insert audited faithful to spec. Merged to `main` 2026-06-07.
- **S2 plan ✅ WRITTEN + APPROVED** (2026-06-10) — `docs/.../plans/2026-06-10-lustique-booking-s2-request-to-book.md`. Decisions locked: S2 = full request leg (incl. token-gen + 2 emails; `confirm_token_hash NOT NULL` forces it), S3 = confirm-consume; front-end in scope; per-IP rate-limit = Cloudflare edge rule.
- `supabase/migrations/0001_booking_core.sql` written ✅ — apply gated on client Supabase project.
- Email migration in flight: GoDaddy → Google Workspace. `info@` blocked (conflicting personal Google acct) → fix via Admin console Transfer tool before cutting MX.

## Build lane / branch
- This plan + baton are committed on branch **`claude/pedantic-montalcini-6f4816`** (synced to `main` @ `cc3a217`, now ahead by the plan commit). Per the S1 pattern, build S2 on a branch and merge to `main` when green. To start the Sonnet build from `main`'s baton instead, fast-forward `main` to this branch first.

## Open decisions / account gates (Pieter — parallel; unblock live deploy, not the build)
- **Supabase**: Zandeline creates client-owned project, invites `hello@layerzerostudios.com` as Administrator (region `af-south-1` preferred); then apply `0001_booking_core.sql`; set `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` via `wrangler secret put`.
- **Turnstile**: create widget → site-key into `quote.astro`, `TURNSTILE_SECRET` via secret; also `SIGNING_SECRET` (random 32B).
- **Yoco** (S4): verify exact endpoints + webhook signature + her real online fee rate for `YOCO_FEE_RATE`.
- DNS home: GoDaddy vs Cloudflare (leaning Cloudflare for scoped admin).
- 🔐 Carryover: rotate the exposed Sanity Viewer token when next touching secrets.

## Booking build sequence
S1 data layer ✅ → **S2 request-to-book** (plan approved, building) → S3 confirm gate → S4 payments (Yoco) → S5 balance cron → S6 emails (5 Brevo types)

## Pointers
- Spec: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md`
- S2 plan (next): `docs/superpowers/plans/2026-06-10-lustique-booking-s2-request-to-book.md`
- S1 plan (done): `docs/superpowers/plans/2026-06-05-lustique-booking-s1-data-layer.md`
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`
- When S2 verifies green: record in this ledger, prime ▶ NEXT for **S3 (confirm gate)**, emit 🟢 BUILD DONE → back to Opus to plan S3.
