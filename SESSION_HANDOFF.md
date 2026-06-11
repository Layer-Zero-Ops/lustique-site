# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Booking S2 build · **Updated:** 2026-06-11

## ▶ NEXT
🟢 Sonnet — **prune 2 strays, then resume S2.**

**Step 0 — remove the two merged stray worktrees** (both verified ancestors of `main`, safe). Run from this primary worktree — never from inside a worktree you're removing:
```
git worktree remove .claude/worktrees/pedantic-montalcini-6f4816
git worktree remove .claude/worktrees/infallible-satoshi-95b8fb
git branch -d claude/pedantic-montalcini-6f4816 claude/infallible-satoshi-95b8fb
```

**Step 1 — resume the S2 build — request-to-book** from [`docs/superpowers/plans/2026-06-11-lustique-booking-s2-request.md`](docs/superpowers/plans/2026-06-11-lustique-booking-s2-request.md) using **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans** (inline). Mid-build: Tasks 1–3 committed through `3c5712c` (token helpers · `countBookingsOnDate` · `request.ts` handler); `worker/package.json` carries the uncommitted `@lustique/pricing` add → **awaiting `npm install` in Pieter's terminal** (the current pause point). Remaining: Task 4 (wire `/api/booking/request` in `index.ts`) · Task 5 (site form) · Task 6 (`booking-request.ts` + `booking-received.astro`).

6 tasks in dependency order:
1. Token helpers (`token.ts` + tests) — standalone
2. DB extension `countBookingsOnDate` — standalone
3. `handleBookingRequest` endpoint (`request.ts` + tests) — **depends on Tasks 1+2**
4. Wire route in `index.ts` — depends on Task 3
5. Site form extension (export `readInput`, Turnstile widget, deposit-% radio, consent) — standalone
6. `booking-request.ts` + `booking-received.astro` — depends on Task 5

**Task 1 adds `@lustique/pricing` to `worker/package.json` → needs `npm install` in Pieter's terminal after Task 1 Step 1.** Builds + unit-tests run fully offline after that; live deploy is gated on account actions below.

**WAF deploy note:** after S2 ships, add Cloudflare WAF rate-limit rule: `POST /api/booking/request` → max 5 req/IP/hour. Document in deploy checklist — not in Worker code.

## State
- Pass 1 (Astro parity) ✅ · Pass 1.5 (elevation) ✅ · tag `pass-1-parity`
- Booking core spec written + adversarially reviewed ✅ (`docs/.../specs/2026-06-05-lustique-booking-core-design.md`)
- **S1 data layer ✅ DONE + VERIFIED** (Opus reconcile 2026-06-10): 36 tests green (24 pricing + 12 worker), worker bundles clean (`wrangler --dry-run`), schema + money math (`grossUp`/`splitDeposit`) + idempotent insert audited faithful to spec. Merged to `main` 2026-06-07.
- **S2 plan ✅ WRITTEN + APPROVED** (2026-06-11) — [`docs/superpowers/plans/2026-06-11-lustique-booking-s2-request.md`](docs/superpowers/plans/2026-06-11-lustique-booking-s2-request.md). Decisions locked: S2 = full request leg (incl. token-gen + 2 emails; `confirm_token_hash NOT NULL` forces it), S3 = confirm-consume; front-end in scope; per-IP rate-limit = Cloudflare WAF rule (not Worker code). 6 tasks, TDD throughout.
- `supabase/migrations/0001_booking_core.sql` written ✅ — apply gated on client Supabase project.
- Email migration in flight: GoDaddy → Google Workspace. `info@` blocked (conflicting personal Google acct) → fix via Admin console Transfer tool before cutting MX.

## Build lane / branch
- **Canonical build lane: `claude/s2-booking-request`** in the primary worktree (`~/Layer-Zero-Studios/Custom Builds/Lustique`), last build commit `3c5712c` (ahead of `main` `f4eb9ca`), `worker/package.json` modified (mid-build). Per the S1 pattern, build S2 here and merge to `main` when green.
- Reconciled 2026-06-11 (Opus): this section previously (mis)named `claude/pedantic-montalcini-6f4816` — a stray reconcile worktree, not the build lane. Both strays (`pedantic` @ `52848bf`, `infallible-satoshi` @ `384ecbb`) are merged into `main`; ▶ NEXT Step 0 removes them.

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
- S2 plan (building): [`docs/superpowers/plans/2026-06-11-lustique-booking-s2-request.md`](docs/superpowers/plans/2026-06-11-lustique-booking-s2-request.md)
- S1 plan (done): `docs/superpowers/plans/2026-06-05-lustique-booking-s1-data-layer.md`
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`
- When S2 verifies green: record in this ledger, prime ▶ NEXT as: 🔵 Opus: plan **S3 — confirm gate** using `superpowers:writing-plans`. Source: spec §5 (state machine), §7 (GET + POST `/api/booking/confirm`), §12 (token verify: base64url-decode → split payload → HMAC recompute → compare hash). S2 is the complete, tested request endpoint; `confirm_token_hash` is in the DB; S3 consumes it. Emit 🟢 BUILD DONE → back to Opus.
