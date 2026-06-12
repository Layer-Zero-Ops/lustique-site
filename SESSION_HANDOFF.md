# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** S3 ✅ DONE + VERIFIED → S4 (Yoco payments) next · **Updated:** 2026-06-12 (Sonnet — S3 shipped)

## ▶ NEXT
🟢 **Sonnet build — S4 Yoco payments** (needs Opus plan first):

**Pre-step:** Pieter close the `infallible-satoshi` worktree session, then from the main checkout:
```
git worktree remove .claude/worktrees/infallible-satoshi-95b8fb
git branch -d claude/infallible-satoshi-95b8fb
```

**S4 scope (Yoco pay-link + webhook + `payments` row):**
- Replace the EFT block in `confirm.ts` with a Yoco checkout link (via Yoco Payments API)
- Add `POST /api/payment/yoco-webhook` handler: verify signature → `deposit_paid` transition → `payments` row → email bride
- S4 needs Opus to plan it first (new spec/plan doc).

**Open deploy gates (parallel — unblock live launch, not the build):**
- **Supabase**: Zandeline creates project → invite `hello@layerzerostudios.com` as Administrator → apply `0001_booking_core.sql` → set `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
- **Turnstile**: create widget → replace placeholder in `site/src/data/site.ts` → set `TURNSTILE_SECRET` + `SIGNING_SECRET`
- **EFT details** (launch gate): Zandeline's bank name + account name + account no. + branch code → `wrangler secret put EFT_BANK` etc.
- **Yoco** (S4): verify exact Payments API endpoints + webhook signature + her real online fee rate for `YOCO_FEE_RATE`
- DNS home: GoDaddy vs Cloudflare (leaning Cloudflare)
- **WAF rule**: after deploy, Cloudflare WAF rate-limit `POST /api/booking/request` → 5 req/IP/hour
- Email migration: GoDaddy → Google Workspace (`info@` blocked by personal acct — Admin console Transfer tool)
- 🔐 Rotate exposed Sanity Viewer token when next touching secrets

## State

### Completed
- Pass 1 (Astro parity) ✅ · Pass 1.5 (elevation) ✅ · tag `pass-1-parity`
- Booking core spec written + adversarially reviewed ✅ (`docs/.../specs/2026-06-05-lustique-booking-core-design.md`)
- **S1 data layer ✅ DONE + VERIFIED** (merged `main` 2026-06-07): 36 tests green (24 pricing + 12 worker), worker bundles clean.
- **S2 request-to-book ✅ DONE + VERIFIED** (merged `main` 2026-06-12): 38 worker tests, 24 site pages. Commits: token sign/hash → countBookingsOnDate → handleBookingRequest → site quote form → booking-received page.
- **S3 confirm gate ✅ DONE + VERIFIED** (branch `claude/s3-booking-confirm`, 2026-06-12): 56 worker tests green, bundle clean (35.46 KiB), site 26 pages.

### S3 shipped (build commits, oldest→newest)
| Commit | What |
|--------|------|
| `3e263c3` | `verifyToken` — authenticate confirm tokens |
| `ad61bc7` | token-hash lookup + guarded `requested`-transition in `db.ts` |
| `28f0a7f` | render-only GET confirm page (`confirm.ts` + tests) |
| `3c95e3d` | POST confirm/decline transition + EFT deposit email |
| `1059e0b` | wire `GET+POST /api/booking/confirm` routes in `index.ts` |
| `3344d77` | `booking-confirmed.astro` + `booking-declined.astro` thank-you pages |
| `ac38285` | EFT-first copy — replace Yoco-link wording in `booking-received.astro` + `request.ts` |
| `6f908e3` | EFT-first copy — fix Yoco-link mention in `quote.astro` |

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
- **S3 complete:** `claude/s3-booking-confirm` — ready to merge to `main` once Pieter reviews and the account gates are met for deploy.
- **S4 build lane:** branch `claude/s4-yoco-payments` from `main` after S3 merges (needs Opus plan first).
- ⚠️ Stale worktree: `infallible-satoshi-95b8fb` — prune after that session closes (branch fully merged; see ▶ NEXT).

## Booking build sequence
S1 data layer ✅ → S2 request-to-book ✅ → **S3 confirm gate ✅** → **S4 payments (Yoco)** → S5 balance cron → S6 emails (5 Brevo types)

## Pointers
- Spec: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md`
- S3 plan (done): `docs/superpowers/plans/2026-06-11-lustique-booking-s3-confirm-gate.md`
- S2 plan (done): `docs/superpowers/plans/2026-06-11-lustique-booking-s2-request.md`
- S1 plan (done): `docs/superpowers/plans/2026-06-05-lustique-booking-s1-data-layer.md`
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`

## ⇄ Umbrella  (project ↔ Studio Manager · empty unless pending · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** none
**⬇ From umbrella:** none
