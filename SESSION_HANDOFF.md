# SESSION_HANDOFF — Lustique

**Lane:** 🔵 Plan (Opus) · **Phase:** Booking S3 planning · **Updated:** 2026-06-11

## ▶ NEXT
🔵 Opus — **plan S3 — confirm gate** using `superpowers:writing-plans`.

Source: spec §5 (state machine), §7 (GET + POST `/api/booking/confirm`), §12 (token verify: base64url-decode → split payload → HMAC recompute → compare hash). S2 is the complete, tested request endpoint; `confirm_token_hash` is in the DB; S3 consumes it.

Key S3 decisions to lock in:
- `GET /api/booking/confirm?token=…` → serves a confirmation landing page (or redirects to site)
- `POST /api/booking/confirm` → verifies token against `confirm_token_hash`, transitions status `pending → confirmed`, emails bride "your date is confirmed" + Yoco deposit link
- Token expiry handling (spec §12: 72h), already-consumed tokens, status guard (only `pending` may confirm)
- Worker additions: `verifyToken(token, stored_hash, signing_secret)` helper in `token.ts`, `confirmBooking` DB function, `handleBookingConfirm` handler

## State

### Completed
- Pass 1 (Astro parity) ✅ · Pass 1.5 (elevation) ✅ · tag `pass-1-parity`
- Booking core spec written + adversarially reviewed ✅ (`docs/.../specs/2026-06-05-lustique-booking-core-design.md`)
- **S1 data layer ✅ DONE + VERIFIED** (merged to `main` 2026-06-07): 36 tests green (24 pricing + 12 worker), worker bundles clean, schema + money math audited faithful to spec.
- **S2 request-to-book ✅ DONE + VERIFIED** (merged 2026-06-11): 38 worker tests green, site builds clean (24 pages). Branch: `claude/s2-booking-request`, last commit `b8a6135`.

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
- Merge `claude/s2-booking-request` → `main` before starting S3 plan
- S3 build lane: create `claude/s3-booking-confirm` from updated `main`

## Open decisions / account gates (Pieter — parallel; unblock live deploy, not the build)
- **Supabase**: Zandeline creates client-owned project, invites `hello@layerzerostudios.com` as Administrator (region `af-south-1` preferred); then apply `0001_booking_core.sql`; set `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` via `wrangler secret put`.
- **Turnstile**: create widget → replace `1x00000000000000000000AA` in `site/src/data/site.ts` with real site key; set `TURNSTILE_SECRET` via `wrangler secret put`; also set `SIGNING_SECRET` (random 32B hex).
- **Yoco** (S4): verify exact endpoints + webhook signature + her real online fee rate for `YOCO_FEE_RATE`.
- DNS home: GoDaddy vs Cloudflare (leaning Cloudflare for scoped admin).
- **WAF rule**: after S2 deploys, add Cloudflare WAF rate-limit: `POST /api/booking/request` → max 5 req/IP/hour.
- 🔐 Carryover: rotate the exposed Sanity Viewer token when next touching secrets.
- Email migration in flight: GoDaddy → Google Workspace. `info@` blocked (conflicting personal Google acct) → fix via Admin console Transfer tool before cutting MX.

## Booking build sequence
S1 data layer ✅ → **S2 request-to-book ✅** → **S3 confirm gate** (next) → S4 payments (Yoco) → S5 balance cron → S6 emails (5 Brevo types)

## Pointers
- Spec: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md`
- S2 plan (done): `docs/superpowers/plans/2026-06-11-lustique-booking-s2-request.md`
- S1 plan (done): `docs/superpowers/plans/2026-06-05-lustique-booking-s1-data-layer.md`
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`
