# SESSION_HANDOFF — Lustique

**Lane:** 🔵 Plan (Opus) · **Phase:** Booking S2 planning · **Updated:** 2026-06-07

## ▶ NEXT
🔵 Opus: plan **S2 — request-to-book endpoint** using **superpowers:writing-plans**. Source: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md` (§5 flow, §9 request endpoint, §10 validation, §12 security). S1 is the complete, tested data layer — build on it.

## State
- Pass 1 (Astro parity) ✅ · Pass 1.5 (elevation) ✅
- Booking core spec written + adversarially reviewed ✅ (`docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md`)
- **S1 data layer ✅ DONE** — all 7 tasks committed + 36 tests green (24 pricing + 12 worker); merged to `main` 2026-06-07
- Logo + OG share image done ✅ (committed 5325024)
- `shared/pricing` — 24 tests green ✅ (17 estimate + 7 payments)
- `worker/src/booking/` — util, db, audit + tests ✅
- `supabase/migrations/0001_booking_core.sql` written ✅ — apply gated on client Supabase project
- Email migration in flight: GoDaddy → Google Workspace. `info@` blocked (conflicting personal Google acct) → fix via Admin console Transfer tool before cutting MX.

## Open decisions / account gates
- Client Supabase project: Zandeline creates, invites `hello@layerzerostudios.com` as Administrator (region `af-south-1` preferred)
- Yoco API: verify exact endpoints + webhook signature + her real online fee rate for `YOCO_FEE_RATE`
- DNS home: GoDaddy vs Cloudflare (leaning Cloudflare for scoped admin)

## Booking build sequence
S1 data layer ✅ → **S2** request-to-book → S3 confirm gate → S4 payments (Yoco) → S5 balance cron → S6 emails (5 Brevo types)

## Pointers
- Spec: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md`
- S1 plan (done): `docs/superpowers/plans/2026-06-05-lustique-booking-s1-data-layer.md`
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`
- Last commit: merged `build/pass-1-astro-port` → `main` 2026-06-07
