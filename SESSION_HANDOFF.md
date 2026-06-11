# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** S2 closeout → S3 build · **Updated:** 2026-06-11 (Opus — S3 plan written)

## ▶ NEXT
🟢 **Sonnet build — two sequential steps** (S3 plan is written + approved; see Pointers):

**Step 1 — close out S2** (gates the S3 build):
1. 🛑 **Pieter: `npm install`** (repo root) to regenerate the lockfile for the `@lustique/pricing` dep — HARD PAUSE, sandbox blocks installs.
2. 🟢 **Sonnet:** commit `worker/package.json` + `package-lock.json`; re-run `npm test` in `worker/` from clean (expect 38 green); merge `claude/s2-booking-request` → `main`; prune stray `infallible-satoshi` `384ecbb`; branch `claude/s3-booking-confirm` from updated `main`.

**Step 2 — build S3 (confirm gate)** from `docs/superpowers/plans/2026-06-11-lustique-booking-s3-confirm-gate.md` using **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans**. TDD Phase A (worker: `verifyToken` → db lookup + guarded transition → `confirm.ts` GET → POST → wire routes) → Phase B (Astro confirmed/declined pages + EFT copy fix) → Phase C (verify + closeout).
- **S3 adds NO new npm dep** — builds + tests run fully offline; no install pause inside S3.
- **EFT bank details** are a *deploy* gate (below), not a build blocker — tests use placeholders.
- Definition of Done + verification commands are in the plan's §Phase C.

**S3 decisions locked (Pieter, 2026-06-11):** EFT-first for launch — no Yoco; the bride pays `deposit_net_cents` by bank transfer (S4 swaps in Yoco pay-link + webhook). Hybrid UI — Worker renders the token-gated GET confirm page → 303-redirects to static Astro thank-you pages. Three baton-shorthand fixes folded into the plan: status is **`requested`** (not "pending"), TTL is **14 days** (not 72h), the confirm link goes to **Zandeline** (not the bride; her confirm triggers the bride's deposit email).

## State

### Completed
- Pass 1 (Astro parity) ✅ · Pass 1.5 (elevation) ✅ · tag `pass-1-parity`
- Booking core spec written + adversarially reviewed ✅ (`docs/.../specs/2026-06-05-lustique-booking-core-design.md`)
- **S1 data layer ✅ DONE + VERIFIED** (merged to `main` 2026-06-07): 36 tests green (24 pricing + 12 worker), worker bundles clean, schema + money math audited faithful to spec.
- **S2 request-to-book — code-complete + tests green** (Sonnet-recorded 2026-06-11: 38 worker tests, site builds 24 pages). Branch `claude/s2-booking-request` @ `200671e` (last code commit `b8a6135`). ⚠️ **Not merged; `worker/package.json` uncommitted** — closeout pending (see ▶ NEXT). Promotes to DONE + VERIFIED once npm-install'd, committed clean, and merged to `main`.
- **S3 confirm gate — plan ✅ WRITTEN + APPROVED** (Opus 2026-06-11): `docs/superpowers/plans/2026-06-11-lustique-booking-s3-confirm-gate.md`. EFT-first (no Yoco), hybrid UI; ~13 new worker tests across `verifyToken` / db lookup+guard / `confirm.ts`. Build gated on S2 closeout (branch `claude/s3-booking-confirm` from updated `main`).

### S2 shipped (build commits, oldest→newest)
| Commit | What |
|--------|------|
| `4a7aa34` | HMAC token sign + SHA-256 hash helpers (`token.ts`) |
| `56ed1e8` | token structural test + tamper test + toHex helper |
| `148f6d7` | `countBookingsOnDate` for same-date conflict warning |
| `5c00d60` | empty-array guard test for countBookingsOnDate |
| `3c5712c` | `handleBookingRequest` handler (Turnstile, recompute, token, dual email) |
| `a065620` | Brevo partial-failure handling, `esc()` single-quote, SAST date, DB null guard |
| `571bcb4` | wire `POST /api/booking/request` in `index.ts` |
| `9531878` | site: deposit-%, consent, Turnstile widget in `quote.astro` |
| `bb3d7e5` | `booking-request.ts` script + `booking-received.astro` |
| `b8a6135` | fix: reset Turnstile widget + rename shadowed rand variable |

## Build lane / branch
- **S2 closeout (🟢 Sonnet, after Pieter's `npm install`):** commit `worker/package.json` + lockfile → merge `claude/s2-booking-request` → `main` → prune strays. Gates the S3 *build* (not the S3 plan, which is spec-driven and parallelable).
- S3 build lane: create `claude/s3-booking-confirm` from updated `main`.
- ⚠️ Strays still present: `pedantic` is *this Opus reconcile session's* cwd — removable only after this session closes; `infallible-satoshi` removable now.

## Open decisions / account gates (Pieter — parallel; unblock live deploy, not the build)
- **Supabase**: Zandeline creates client-owned project, invites `hello@layerzerostudios.com` as Administrator (region `af-south-1` preferred); then apply `0001_booking_core.sql`; set `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` via `wrangler secret put`.
- **Turnstile**: create widget → replace `1x00000000000000000000AA` in `site/src/data/site.ts` with real site key; set `TURNSTILE_SECRET` via `wrangler secret put`; also set `SIGNING_SECRET` (random 32B hex).
- **EFT deposit details** (S3 launch): Zandeline provides bank name + account name + account no. + branch code → set `EFT_BANK` / `EFT_ACCOUNT_NAME` / `EFT_ACCOUNT_NO` / `EFT_BRANCH_CODE` via `wrangler secret put` (+ `worker/.dev.vars` for local). These appear in the bride's confirm email; placeholders are fine for the build/tests.
- **Yoco** (S4): verify exact endpoints + webhook signature + her real online fee rate for `YOCO_FEE_RATE`.
- DNS home: GoDaddy vs Cloudflare (leaning Cloudflare for scoped admin).
- **WAF rule**: after S2 deploys, add Cloudflare WAF rate-limit: `POST /api/booking/request` → max 5 req/IP/hour.
- 🔐 Carryover: rotate the exposed Sanity Viewer token when next touching secrets.
- Email migration in flight: GoDaddy → Google Workspace. `info@` blocked (conflicting personal Google acct) → fix via Admin console Transfer tool before cutting MX.

## Booking build sequence
S1 data layer ✅ → **S2 request-to-book ✅** (closeout pending) → **S3 confirm gate** (plan ✅, building) → S4 payments (Yoco) → S5 balance cron → S6 emails (5 Brevo types)

## Pointers
- Spec: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md`
- S3 plan (next ▶): `docs/superpowers/plans/2026-06-11-lustique-booking-s3-confirm-gate.md`
- S2 plan (done): `docs/superpowers/plans/2026-06-11-lustique-booking-s2-request.md`
- S1 plan (done): `docs/superpowers/plans/2026-06-05-lustique-booking-s1-data-layer.md`
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`

## ⇄ Umbrella  (project ↔ Studio Manager · empty unless pending · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** none
**⬇ From umbrella:** none
