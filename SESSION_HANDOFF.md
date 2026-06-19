# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Wave C.3 DONE · **Updated:** 2026-06-19 (Sonnet)

## ▶ NEXT (Sonnet, Build lane)

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` · **Repo:** `github.com/Layer-Zero-Ops/lustique-site` (private)

### Wave C complete — push to production + Pieter gate

Wave C.3 (notifications bell) is done ✅ — `51a1a89`. 315 tests green.

**⚠️ Push pending — Pieter must authorise:**
```
git push origin main
```
(17 commits ahead of origin. Wrangler CD auto-deploys the Worker on push.)

**Pieter action needed before dashboard can be used:**
- Apply migrations 0009–0011 (Supabase SQL editor)
- `wrangler secret put SUPABASE_JWT_SECRET` (value from Supabase Settings → API → JWT Secret)
- Follow RUNBOOK §10 (create Zandeline's auth user, configure Brevo SMTP, patch email template)

**Pieter dashboard tasks still pending (Wave-S; no code):**
(unchanged from Wave B.3 baton)

**Pieter dashboard tasks still pending (Wave-S; no code):**
1. CF Zone Transform Rule — set security headers (CSP/HSTS/X-Frame/Referrer/Permissions-Policy) on `http.host eq "lustiqueco.co.za"` (full values in SEO/security plan §1a)
2. CF WAF Rate-Limit Rules — 5 rules (booking/request, enquiry, admin, token pages, zone fallback; plan §3)
3. CF Health Checks — `/api/health` + `/` → email alerts (plan §5)
4. TLS Full-strict + Always Use HTTPS in CF dashboard
5. Supabase Pro upgrade (before first live deposit — plan §6)
6. GA4 property → replace `G-XXXXXXXXXX` in `site/src/data/site.ts` with real Measurement ID, then redeploy

## 🟦 Decisions
Both decisions that gated early build are resolved; #3–#7 (build-sequence doc §Decisions) are operational confirmations for Wave B/C.
1. **Yoco fee model — ✅ RESOLVED 2026-06-18: Lustique ABSORBS the fee.** Bride pays exactly the quoted amount; no fee added; no gross-up in the live path; `business_settings.fee_model='absorb'`. (Still pending, non-blocking: verify the real Yoco rate from the portal — now only for margin reporting, not for charging.)
2. **Review step — ✅ RESOLVED 2026-06-18: INTERIM.** Per-line invoice editing ships on the **token-link review page in Wave A** (token-gated, live in days); Wave B re-homes the same editing logic behind the logged-in dashboard (no rework). `quote_revisions`/`rejections` move into the Wave-A migration.

---

## The re-plan (read in this order)
- **Spec:** `docs/superpowers/specs/2026-06-18-lustique-replan-spec.md` — corrected flow + state machine, capacity soft-block (#1), payment-gating (#4), **Yoco v2 incl. the 🔴 critical bug + fees (#19) + deposit selection (#3) + failure→EFT (#6) + balance link (#5)**, churn vocab (#18), brand voice (#10). Supersedes the 2026-06-05 booking-core spec.
- **Dashboard/data plan:** `docs/superpowers/plans/2026-06-18-lustique-dashboard-data-plan.md` — dashboard review/edit/approve + reject loop + editable templates (#2/#9/#11), real-time notifications (#8), CRM + IMAP (#7/#13), analytics + data strategy (#12/#17), ML verdict (#14 → defer).
- **SEO/security/infra plan:** `docs/superpowers/plans/2026-06-18-lustique-seo-security-infra-plan.md` — #16 + cookie consent + monitoring + backups.
- **Build sequence (master):** `docs/superpowers/plans/2026-06-18-lustique-replan-build-sequence.md` — waves, migrations, effort, the 7 decisions, ▶ NEXT.

### Key planner calls (reconciling the design fan-out)
- **Status vocabulary:** add `quote_sent`/`accepted`/`rejected`/`invoice_expired`; wire dormant `cancelled`; retire `confirmed`/`expired`. **Payment failure stays on the `payments` row** (not a booking status) — keeps the lifecycle linear, retries don't bounce it.
- **Sequencing:** the corrected booking core is **dashboard-agnostic** → ships first on token-links (no auth). The dashboard (#2/#8) + CRM/analytics pull roadmap **Phase 2 forward** and make **Phase 1 auth a prerequisite** — the single biggest sequencing shift vs the original "no-auth v1" spec.
- **Notifications:** Supabase Realtime over a persistent `notifications` table (+ 60s polling heartbeat); SSE rejected (Workers can't hold sockets).
- **CRM import:** one-time re-runnable CSV, not a Sheets sync. **IMAP:** Gmail API in a scheduled Supabase Edge Function (not raw IMAP), metadata+snippet+deep-link only (POPIA), optional/last.
- **ML:** none now — SQL + transparent heuristics; revisit behind the data layer in years.

---

## Current state (as-built, pre-re-plan)
- `lustiqueco.co.za` **live** via CF Workers Assets ✅ · Worker `lustique-form-handler` deployed ✅
- Full booking→payment loop built S1–S9, **152 tests** ✅ — **BUT the Yoco webhook is broken against real events (Wave 0 fixes it)**
- 9 non-Wave Worker secrets bound ✅ · Wave keys pending
- Supabase migrations 0001–0004 applied ✅ · Brevo sender verified ✅ · Turnstile live ✅

## CI / Deploy state
- **GitHub:** `Layer-Zero-Ops/lustique-site` · Site live ✅ · Worker deployed (6+ secrets, R2, cron `0 6 * * *`) ✅
- **Supabase:** 0001–0004 applied · bank details seeded (placeholders — Zandeline fills before live)

## State (done-ledger)
- **Wave C.3 DONE ✅ 2026-06-19 (Sonnet)** — `51a1a89`. Notifications bell: `GET /api/admin/notifications` (JWT-gated, returns `{count, items[]}` of unread rows); `POST /api/admin/notifications/read` (mark one UUID or all as read; UUID guard blocks filter injection). `adminShell` updated: bell button + count badge in sidebar, dropdown with DOM-built items (`.textContent` not `innerHTML` — XSS-safe), 60s poll, close-on-outside-click. 10 new tests → 315 green. **Push pending: `git push origin main` (Pieter to authorise).**
- **Wave C.2 DONE ✅ 2026-06-19 (Sonnet)** — `8267985`. 6 JWT-gated admin dashboard views: booking detail (`/api/admin/booking/:id`) with inline quote editor + PATCH `/api/admin/quote/:id` (records quote_revision, recalculates deposit/balance); sent-quotes (`/api/admin/quotes`, 7-day expiry countdown, urgent flag ≤2d); payments (`/api/admin/payments`, Yoco vs EFT indicator, status badges); rejections (`/api/admin/rejections`, reason code/text, booking links); calendar (`/api/admin/calendar`, month grid coloured by load vs capacity, POST sets slots, slots=0=hard-blocked); templates (`/api/admin/templates`, list + edit form with subject/body_html/enabled, iframe live preview). 28 new tests → 305 green.
- **Wave C.1 DONE ✅ 2026-06-19 (Sonnet)** — `6ba417f`. Phase-1 auth spine: migrations 0009–0011 (profiles + booking_artists + read-only RLS; notifications + message_templates seeded; contacts + bookings.contact_id). `auth.ts`: `verifySupabaseJwt` (HS256 WebCrypto), `getCookieValue`, `getAdminSession` (JWT verify → profiles.role='admin' check), `__Host-sb_session` cookie helpers. `dashboard.ts`: `handleAdminLogin` (GET form + POST OTP to Supabase `/auth/v1/otp`), `handleAdminAuthCallback` (token_hash exchange via `/auth/v1/verify` → session cookie), `handleAdminAuthLogout` (clear cookie), `handleAdminDashboard` (Inbox view: pipeline board of active bookings, 7-view nav, quiet-luxury admin shell). All JWT-gated; 33 new tests → 277 green. RUNBOOK §10: Supabase Auth setup steps (Brevo SMTP, profile seed, email template patch). Pieter must apply migrations + bind SUPABASE_JWT_SECRET secret + follow RUNBOOK §10 before dashboard is usable.
- **Wave B.3 DONE ✅ 2026-06-19 (Sonnet)** — `9a2d6ca`. `GET /api/admin/quote-pdf?token=ADMIN_SECRET&id=<id>` — Zandeline's printable quote page. Timing-safe ADMIN_SECRET auth (no signed token needed). Reads `getBookingByIdForInvoice` (quote_lines, deposit_pct, quote_sent_at). Quiet-luxury styling matching invoice.ts; shows expiry date (quote_sent_at + 7 days), service breakdown, totals, status badge for all 6 statuses. Admin-only note + noindex meta. No EFT bank details (quote ≠ payment request). 23 new tests → 244 green.
- **Wave B.2 DONE ✅ 2026-06-19 (Sonnet)** — `2a374d2`. `/api/admin/invoices` — all bookings sorted by wedding date, status badges for all 9 statuses, ZAR financial columns, pre-signed "View ↗" invoice link per row (`signActionToken("invoice", 2-year TTL)` via `Promise.all`). 20 new tests → 221 green.
- **Wave B.1 DONE ✅ 2026-06-19 (Sonnet)** — `c30e5a8`. `/api/admin/accounting` — KPI cards (total revenue, outstanding, pipeline), revenue by month table, outstanding deposit_paid bookings, pipeline snapshot. `?export=csv` streams all bookings as CSV. `listAccountingRows` in db.ts. 13 new tests → 201 green.
- **Wave A.2 impl commit ✅ 2026-06-19 (Sonnet)** — `532cf53`. Caught uncommitted impl files (admin.ts, db.ts, review.ts, util.ts, index.ts) from prior session — committed separately from the test-only commits.
- **Wave A.2 DONE ✅ 2026-06-19 (Sonnet)** — `cc33e2b` + `7c3f301`. accept.test.ts (12 tests) + reject.test.ts (9 tests) written. invoiceExpirySweep: finds quote_sent bookings >7 days old → transitions to invoice_expired + audits (race-safe). SA public holidays in workingDaysBefore (Easter algorithm, 10 fixed dates). Admin set_slots capacity editor (slots=0 = hard block, N = soft cap). All wired into daily cron. 188 tests green. **Wave integration dropped entirely** — Wave API access permanently broken; Wave B (internal invoicing/accounting) is the replacement.
- **Wave OAuth DONE ✅ 2026-06-19 (Sonnet)** — `9377507`. `wave.ts` now uses OAuth refresh-token flow: `WAVE_REFRESH_TOKEN + WAVE_CLIENT_ID + WAVE_CLIENT_SECRET` → short-lived `access_token` per request. `WAVE_API_KEY` legacy fallback retained. Guards in `review.ts` + `yoco.ts` updated. `wave.test.ts` type fixed. 158 tests green. **NOTE: Wave integration is being dropped (see Wave A.2 entry). wave.ts/wave-auth.mjs will be removed in Wave B cleanup.**
- **Wave A.1 DONE ✅ 2026-06-19 (Sonnet)** — `f70d0f6`. Accept/reject quote flow, capacity soft-block, corrected state machine. State: `requested → quote_sent → accepted → deposit_paid → settled`. New files: `accept.ts` (bride picks deposit %, T3 transition, Yoco checkout), `reject.ts` (T4 bride-decline). Modified: `review.ts` (approve sends Accept/Reject quote email, no Yoco at review time), `request.ts` (depositPct removed, soft-block), `db.ts` (DateAvailability, insertRejection), `yoco.ts`/`confirm.ts` (legacy fallback for "confirmed" bookings). Migrations 0006–0008. 158 tests green (was 160 pre-Wave-A tests, netted down to 158 after removing one deleted validation test, updated 11 failing tests). **Still to write:** `accept.test.ts` + `reject.test.ts`.
- **Wave-S DONE ✅ 2026-06-19 (Sonnet)** — `c67e19c` + `984235d`. Security headers (`withSec`/`secHeaderMap`) on every Worker `/api/*` response + `site/public/_headers` for all CF Pages static responses (free-plan alternative to Transform Rules). `/api/health` liveness endpoint. Turnstile on `/api/enquiry`. Consent-gated GA4. "Manage cookies" link. Twitter meta, noindex on sample pages, sitemap cleaned, JSON-LD enriched. TLS Full (strict) + Always Use HTTPS set in CF dashboard. UptimeRobot monitoring both `lustiqueco.co.za` and `/api/health` (5 min). WAF rate-limit rules + CF Health Checks deferred (Pro only). Supabase Pro + GA4 ID still pending Pieter action.
- **Wave 0 DONE ✅ 2026-06-18 (Sonnet)** — `a3990a5`. Fixed 3 live defects: C-A wrong event name (`checkout.succeeded` → `payment.succeeded`/`payment.failed`), C-B wrong sig scheme (custom hex → Standard Webhooks: `webhook-signature`, base64, `id.ts.body`, 3-min window), C-C misleading "incl. card fee" copy removed (absorb model locked). Added `payment.failed` → EFT fallback emails + `pendingPaymentSweep` cron (24h stale-pending). Migration `0005_payment_failure.sql`. `YOCO_FEE_PCT` var (margin reporting only). Kind-branched transitions. 160 tests (was 152). **Gate still pending:** register webhook in Yoco portal (events: `payment.succeeded`, `payment.failed`, `refund.succeeded`), apply migration 0005, capture one real test event each, verify fee rate in portal → record in PRICING.md.
- **Booking re-plan PLANNED ✅ 2026-06-18 (Opus)** — 4 docs (spec + dashboard/data + SEO/security + build-sequence) from a 14-agent code map + design fan-out. **Verified the live Yoco webhook is broken** (wrong event name + signature scheme) against Yoco docs → Wave 0 hotfix is the new ▶ NEXT. All 19 Jun-18 corrections folded into the spec/plans. Old 2026-06-05 booking-core spec superseded.
- **Live domain smoke 3/3 ✅ 2026-06-18** — `4331191`. (Note: smoke used a synthetic `checkout.succeeded`; did NOT exercise a real Yoco event — see Wave 0.)
- **S9 Invoice system ✅ 2026-06-17** — `86db29c`. Branded printable invoice, 2-year signed token. 152 tests.
- **S8 Wave integration ✅ 2026-06-17** — `67de542`. Wave GraphQL client; blocked-dates admin; migration `0004`.
- **S7b /book page ✅ 2026-06-17** — `e833b65`. sessionStorage handoff.
- **S7 Yoco payment links ✅ 2026-06-17** — `9b5a7f9`. (Webhook event/signature defects found in re-plan — Wave 0.)
- **S6b review page ✅** `7c99b26` · **S6 availability gate ✅** `089fe4f` · **Site live ✅** 2026-06-17 · **S1–S5 ✅** 89 tests + RUNBOOK.

## Pointers
- Go-live RUNBOOK: `docs/RUNBOOK-go-live.md` · Workflow: `.github/workflows/deploy-worker.yml` · Migrations: `supabase/migrations/`
- Key docs: `PLAN.md` (stale on payments/travel/CRM — see spec §8) · `PRICING.md` (money authority) · `BRAND.md` · `ARCHITECTURE.md`
- Agency-platform roadmap: `docs/ROADMAP-agency-platform.md` (the re-plan pulls Phase 2 forward; Phase 1 auth becomes a prerequisite)

## ⇄ Umbrella

**⬆ To umbrella — 🟢 SHIPPED: Booking re-plan delivered (Opus, 2026-06-18)**
Full re-plan of booking flow + dashboard + Yoco + CRM + analytics + ML + SEO/security, from a 14-agent fan-out. **Surfaced a live payment bug** (Yoco webhook never fires on real events) — Wave 0 hotfix queued as build ▶ NEXT. The re-plan confirms the agency-platform roadmap's Phase-1-auth-then-Phase-2-dashboard sequence is now a hard dependency of the corrected booking core (corrections #2/#8 pull Phase 2 forward). 7 decisions await Pieter (build-sequence doc §Decisions); none block the Wave 0 hotfix.

**⬆ To umbrella — ⚪ DECISION: Studio-wide secrets architecture** — two-tier pattern (client secrets in client Supabase vault, LZ as directory). Logged. Defer to post-launch.

**⬇ From umbrella (2026-06-18 — bridge drain):** 🟢 SHIPPED (booking re-plan + Wave 0) folded into umbrella done-ledger. Umbrella project state updated: Opus re-plan COMPLETE, Wave A is ▶ NEXT. No blockers from umbrella lane.
