# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** S3 ✅ → S4 (EFT payments) + go-live · plan ✅ · **Updated:** 2026-06-12 (Opus — S4-EFT plan + reconcile)

## ▶ NEXT
🟢 **Sonnet build — S4 (EFT payments) + go-live** from `docs/superpowers/plans/2026-06-12-lustique-eft-payments-and-go-live.md` (plan ✅ approved 2026-06-12). Use **superpowers:subagent-driven-development** or **executing-plans** for Phases A–B.

**Pre-step (S3 closeout):** S3 is ✅ DONE + VERIFIED (Opus re-verified 56 green + 9 commits match the plan this session). Merge `claude/s3-booking-confirm` → `main`, prune the stale worktree, branch `claude/s4-eft-payments` from updated `main`:
```
git worktree remove .claude/worktrees/infallible-satoshi-95b8fb
git branch -d claude/infallible-satoshi-95b8fb
```

**Phase A (TDD, small):** reword the bride's confirm email → a payment *invitation* (drop "your date is confirmed"). The correctness fix for the rule below.
**Phase B (TDD):** self-serve mark-paid flow — purpose-scoped action token + `GET/POST /api/booking/mark-paid` → guarded `confirmed → deposit_paid` → bride "your date is secured" email; confirm also emails Zandeline her mark-paid link.
**Phase C (ops runbook):** go-live — Supabase project + migration, Turnstile, EFT secrets, `wrangler.toml` route (`lustiqueco.co.za/api/*`) + R2 bucket create, Cloudflare Pages, DNS cutover, end-to-end smoke test.
- Builds + tests fully offline; **no new npm dep.** Phase C deploy is account-gated (gates below).
- **A+C alone = a correct launchable EFT site** (manual post-payment confirm); **B automates** it. Recommended: A+B before launch. Yoco becomes **S4-v2** (automates the mark-paid step) — deferred.

### 🔑 Product rule locked (Pieter 2026-06-12)
**The bride is told her date is BOOKED only once the EFT deposit is RECEIVED** — not at Zandeline's confirm. Confirm email = payment *invitation*; mark-paid (deposit received) = the *real* confirmation + `deposit_paid`. Yoco's webhook will automate the mark-paid step in S4-v2.

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
- **S3 confirm gate ✅ DONE + VERIFIED** (branch `claude/s3-booking-confirm`, 2026-06-12): 56 worker tests green, bundle clean (35.46 KiB), site 26 pages. *(Opus reconcile 2026-06-12: re-ran suite → 56 green; 9 commits map 1:1 to the plan. Ledger accurate.)*
- **S4 EFT payments + go-live — plan ✅ WRITTEN + APPROVED** (Opus 2026-06-12): `docs/superpowers/plans/2026-06-12-lustique-eft-payments-and-go-live.md`. Corrects the bride-confirmation timing (payment-gated) + adds the manual mark-paid flow + the go-live runbook. ~12 new worker tests. Yoco deferred to S4-v2.

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
- **S3 complete + verified:** `claude/s3-booking-confirm` — merge to `main` as the S4 pre-step (see ▶ NEXT). The S4-EFT plan + this baton are committed here and ride into `main` with that merge.
- **S4 build lane:** branch `claude/s4-eft-payments` from updated `main` after S3 merges (plan ✅ — no Opus dependency left).
- ⚠️ Stale worktree: `infallible-satoshi-95b8fb` — prune during the S3 closeout (branch fully merged; commands in ▶ NEXT).

## Booking build sequence
S1 data layer ✅ → S2 request-to-book ✅ → **S3 confirm gate ✅** → **S4 payments — EFT v1 (plan ✅, building) · Yoco v2 later** → S5 balance cron → S6 emails (5 Brevo types)

## Pointers
- Spec: `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md`
- S4-EFT plan (next ▶): `docs/superpowers/plans/2026-06-12-lustique-eft-payments-and-go-live.md`
- S3 plan (done): `docs/superpowers/plans/2026-06-11-lustique-booking-s3-confirm-gate.md`
- S2 plan (done): `docs/superpowers/plans/2026-06-11-lustique-booking-s2-request.md`
- S1 plan (done): `docs/superpowers/plans/2026-06-05-lustique-booking-s1-data-layer.md`
- Key docs: `PLAN.md` · `BRAND.md` · `PRICING.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md` · `SETUP.md`

## ⇄ Umbrella  (project ↔ Studio Manager · empty unless pending · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** none
**⬇ From umbrella:** none
