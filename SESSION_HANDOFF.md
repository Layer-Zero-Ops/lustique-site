# SESSION_HANDOFF — Lustique

**Lane:** 🔵 PLAN SET (Opus → Sonnet) · **Phase:** Wave D planned; ready to build · **Updated:** 2026-06-21 (Opus → Sonnet handoff)

## ▶ NEXT (Sonnet, Build lane) — 🔵 PLAN SET

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` (or branch per wave-item) · **Repo:** `github.com/Layer-Zero-Ops/lustique-site` (private)

**Build Wave D — post-launch platform**, in order **D3 → D1 → D4 → D2**. Use **`superpowers:executing-plans`** (or `subagent-driven-development`) — each plan is bite-sized TDD with complete code.

**Each plan has a `⚠️ Build corrections` checklist at the very top — apply those fixes FIRST; they override conflicting inline text (adversarial-review findings).**
1. **D3 · rate limiting** → `docs/superpowers/plans/2026-06-21-lustique-wave-d3-rate-limiting.md` — no migration, no open decisions, no Pieter prereqs; protects the already-live `/api/*`. **Start here.**
2. **D1 · Sanity CMS** → `docs/superpowers/plans/2026-06-21-lustique-wave-d1-sanity-cms.md` — independent; needs the Sanity-project Pieter prereqs + `npm install` in your terminal.
3. **D4 · artist allocation** → `docs/superpowers/plans/2026-06-21-lustique-wave-d4-artist-allocation.md` — migration `0013_artists.sql`; build before D2.
4. **D2 · Google Calendar** → `docs/superpowers/plans/2026-06-21-lustique-wave-d2-google-calendar.md` — migration `0014`; last (uses D4 artist emails as attendees).

Master sequence (updated): `docs/superpowers/plans/2026-06-18-lustique-replan-build-sequence.md` (§Wave D + §Migration sequence). **Cross-cutting:** `worker/` has **no `tsconfig.json`** — add a minimal one (typescript is already a devDep) or use `npx wrangler deploy --dry-run` for type checks (in every corrections list). **319 tests are green today — keep them green.**

🔵 **PLAN SET — switch to Sonnet (`/model sonnet`) to build.** D3 is fully unblocked; D1/D2 need one-time external setup and D4 needs migration `0013` applied (see Pieter actions).

---

### 🟣 Wave D — planning brief (✅ COMPLETE 2026-06-21 — produced the four plan docs above; retained below for traceability)

#### D1 · Sanity CMS
**Why:** Zandeline needs to update content herself — portfolio images, team bios, blog articles, service descriptions, promotions — without a developer. Currently all content is hard-coded in Astro `.astro` files.

**Locked constraints:**
- Stack: Astro (static, CF Pages) + Sanity v3
- Accounts: client-owned Sanity project (LZ invited as admin). Sanity free tier sufficient at this volume.
- Deployment: Astro fetches at build time (static). No SSR — CF Pages free tier.
- Existing pages that need CMS backing (priority order):
  1. `site/src/pages/portfolio.astro` — gallery images + captions
  2. `site/src/pages/team.astro` — artist cards (name, bio, photo, specialisms)
  3. `site/src/pages/blog.astro` + `blog-*.astro` — articles (currently 3 hard-coded pages)
  4. `site/src/pages/services.astro` — service descriptions + pricing copy (not pricing logic — that lives in `shared/pricing`)
  5. `site/src/pages/index.astro` — hero headline, testimonials section
- `shared/pricing/` is NOT touched by CMS — pricing logic stays in TypeScript.
- Blog currently has 3 hard-coded pages (`blog-2026-trends.astro`, `blog-bridal-trial.astro`, `blog-choosing-artist.astro`). These migrate to Sanity-driven dynamic routes.

**Opus must answer:**
- Schema design for each content type (portfolio, team member, blog post, service, testimonial)
- Astro integration pattern: `@sanity/astro` vs raw `@sanity/client` fetch in `getStaticPaths`
- Where Sanity Studio lives: hosted (`sanity.io/manage`) vs embedded route in the Astro site (`/studio`)
- Webhook-triggered rebuild on Sanity publish → CF Pages build hook
- Image handling: Sanity CDN (`sanity.io/images/...`) vs CF Images — recommend one
- Migration path for the 3 existing hard-coded blog pages
- What Zandeline's day-1 publishing flow looks like end-to-end

---

#### D2 · Google Calendar integration
**Why:** When a booking reaches `deposit_paid`, Zandeline and all 9 artists need the date blocked on their shared calendar automatically. Currently bookings only live in the DB; there is no calendar sync.

**Locked constraints:**
- One shared Lustique Google Calendar (not per-artist OAuth). All 9 artists subscribe to it as viewers.
- Trigger point: `deposit_paid` state transition (Worker `confirm.ts` → `handleYocoWebhook` sets `deposit_paid`; EFT path: `balance.ts` → `handleMarkPaid`)
- Stack: CF Worker (already has `SUPABASE_URL` + service key). No Supabase Edge Functions preferred — keep all async logic in the Worker.
- Google Calendar API: service account (not user OAuth) — simpler, no refresh token rotation. LZ creates a service account, shares the Lustique calendar with it.
- Existing `booking_artists` table: `(booking_id, artist_id, role)` — artist allocation UI is D4; for D2 assume "all artists on the booking" initially.
- Events must include: bride name, wedding date, venue/town, party size, reference number. No sensitive financial data in calendar events.
- Cancellation/rejection must delete the calendar event (`bookings.google_event_id` column needed).

**Opus must answer:**
- Service account setup steps (what LZ does once; what goes into Worker secrets)
- Worker secret name(s) and shape (service account JSON → individual fields, or base64-encoded JSON blob)
- Which Worker file handles the push (new `calendar.ts` or inline in `confirm.ts`/`balance.ts`)
- Migration needed: `bookings.google_event_id TEXT` column
- Error handling: calendar push fails → booking still transitions (non-blocking); retry strategy
- Event deletion path: which Worker handlers trigger delete (reject, cancel)
- Whether a backfill script is needed for existing `deposit_paid` bookings

---

#### D3 · Worker rate limiting
**Why:** The Worker has no rate limiting beyond Turnstile on the enquiry form. Before go-live, the API endpoints need protection — especially `/api/admin/login` (OTP abuse) and `/api/booking/*` (enumeration).

**Locked constraints:**
- CF Workers Rate Limiting binding (free tier) — no CF Pro WAF. Already decided.
- Worker is deployed as `lustique-form-handler` on `lustiqueco.co.za/api/*`
- Existing protection: Cloudflare Turnstile on `POST /api/enquiry` (bot protection, already live)
- `wrangler.toml` already has the R2 binding pattern to follow for new bindings

**Endpoints to protect (Opus to confirm limits):**
- `POST /api/admin/login` — OTP request; suggest 5 req/15 min per IP
- `POST /api/enquiry` — already has Turnstile; add IP rate limit as belt-and-suspenders
- `POST /api/booking/request` — booking creation; suggest 3 req/hour per IP
- `GET /api/admin/*` — already JWT-gated; rate limit as defence-in-depth
- Yoco webhook endpoints — should be exempt (Yoco IPs) or very high limit

**Opus must answer:**
- CF Workers Rate Limiting binding declaration in `wrangler.toml`
- Where the rate-limit middleware lives (new `lib/rateLimit.ts` helper vs inline per route)
- Response shape on limit exceeded (429 + JSON body matching existing Worker error pattern)
- Whether to rate-limit by IP, by email (for login), or both
- Whether limits should differ between production and staging

---

#### D4 · Artist allocation workflow
**Why:** `booking_artists` table exists (`booking_id, artist_id, role, assigned_at`) but there is no UI for Zandeline to assign which artist(s) attend which booking. This is needed before multi-artist scheduling becomes a real problem (the calendar in the dashboard currently shows load vs capacity, but doesn't show per-artist assignments).

**Locked constraints:**
- Dashboard is server-rendered HTML in `worker/src/booking/dashboard.ts` (same pattern as all other admin views)
- Artists are not yet stored in the DB — they are currently hardcoded. There is no `artists` table. D4 must include a migration to create one and seed the 9 artists.
- `booking_artists` schema: `id UUID PK, booking_id UUID FK, artist_id UUID FK, role TEXT ('lead'|'assistant'), assigned_at TIMESTAMPTZ`
- Assignment happens at `quote_sent` or `accepted` stage (not at request — availability not yet confirmed)
- Zandeline assigns from the booking detail page (`GET /api/admin/booking/:id`)

**Opus must answer:**
- `artists` table schema (name, email, phone, active flag, specialisms)
- Seed data for the 9 Lustique artists (names known from `BRAND.md`/team page — pull them)
- Migration number (next after 0012 = **0013**)
- UI design for the assignment widget on the booking detail page (dropdown + add/remove, or checkbox list)
- API surface: new Worker route(s) for assigning/removing artists from a booking
- How this feeds into the calendar view (D2 dependency: when D2 ships, assigned artists → calendar event attendees)
- Whether artists need login access (out of scope for now — just allocation by Zandeline)

---

### Pieter actions still open (carry forward)
1. **Test dashboard login** — `lustiqueco.co.za/api/admin/login` → `info@lustiqueco.co.za` → click magic link → confirm Inbox loads. CF Pages deploy was triggered at ~19:50 SAST 2026-06-21.
2. **Migration 0012** — confirm applied: Supabase Dashboard → Database → Migrations
3. **Yoco online checkout rate** — Yoco Business Portal → Settings → Pricing → Online Payments → record rate → update `YOCO_FEE_PCT` in `wrangler.toml` + `PRICING.md §9`
4. **GA4 Measurement ID** — swap `G-XXXXXXXXXX` in `site/src/data/site.ts` once Google Workspace + GA4 live
5. **Wave D / D1 (Sanity)** — create the client-owned Sanity project (note Project ID), add Zandeline as editor, set CF Pages build env vars (`SANITY_PROJECT_ID`, `SANITY_DATASET=production`, `SANITY_API_VERSION`), create a CF Pages deploy hook + point a Sanity publish webhook at it. (Full list in the D1 plan §Pieter.)
6. **Wave D / D2 (Calendar)** — create a Google Cloud project + service account, enable Calendar API, share the one shared Lustique calendar with the service-account email, `wrangler secret put GOOGLE_SA_KEY_B64` (base64 of the SA JSON), set `GOOGLE_CALENDAR_ID` var. **Apply migration `0014` before deploying the Worker.** (Full list in the D2 plan §Pieter.)
7. **Wave D / D4 (Artists)** — apply migration `0013_artists.sql` (`supabase db push`); later collect real artist emails from Zandeline to replace the seeded placeholders.
8. **`npm install` (your terminal — sandbox blocks installs)** — D1 `site/`: `@sanity/client @sanity/image-url@^1.0.0 astro-portabletext@^0.13.0 vitest @vitest/coverage-v8`; D1 `studio/`: `sanity @sanity/vision react react-dom typescript`.

### Known open (not blocking go-live)
- **Brevo custom SMTP** — still not connecting (tried 587 + 465, zero Brevo log entries). Admin magic link email currently comes from `noreply@mail.app.supabase.io`. Functional, not branded. Revisit separately — likely a Brevo account config issue (sender domain vs SMTP relay permissions).
- **Admin email template** — Lustique-branded template designed (see last Sonnet session) but can't be applied to Supabase without working custom SMTP. Template HTML is in the session transcript.

### Recently closed (2026-06-21)
- ✅ **Admin login unblocked** — `2c27d7b`. Root causes found + fixed: (1) no auth user existed in Supabase (`create_user:false` silently no-ops); (2) Site URL was `localhost:3000`; (3) Supabase default magic link puts `access_token` in URL fragment which Workers can't read. Fix: created `info@lustiqueco.co.za` auth user + seeded `profiles` row (`role='admin'`); set Site URL to `https://lustiqueco.co.za`; added fragment-extraction JS to `BaseLayout.astro` (catches `#access_token=...&type=magiclink` on any page, redirects to `/api/admin/auth/callback?access_token=...`); updated `handleAdminAuthCallback` to handle three flows (token_hash / access_token query param / no-params JS extraction page). Custom SMTP left disabled — Supabase built-in relay works for Zandeline's single-user admin login.
- ✅ POPIA consent checkbox on enquiry form (`quote.astro` + `enquiry.ts`) — `1898a51`
- ✅ Privacy policy cookies section — specific cookie table (`lc_cookie`, `_ga`, `_ga_*`) with types + retention
- ✅ PRICING.md §9 — Yoco fee reference (in-person rates logged; online rate pending portal confirmation)
- ✅ Pre-existing curly-quote bug in `quote.astro` lines 80-89 — `#promoToggle`, `#sendEnquiry`, `#estimateBreakdown` were silently unfindable via `getElementById` in production; fixed to ASCII double quotes

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
- **Wave D PLANNED ✅ 2026-06-21 (Opus)** — four Sonnet-buildable plan docs written + adversarially verified via a 3-pass workflow (recon → design → refute; 13 agents/pass, design+verify on Sonnet to spare Opus budget). `plans/2026-06-21-lustique-wave-d{3-rate-limiting,1-sanity-cms,4-artist-allocation,2-google-calendar}.md`, each with a top `⚠️ Build corrections` checklist folding in the adversarial-review fixes. Master sequence updated (Wave D slotted; old analytics "Wave D" **renamed Wave DL** to free the letter; migrations `0013` artists → `0014` calendar). **Opus calls locked:** D4 = dedicated `artists` table + re-point `booking_artists.artist_id` FK profiles→artists (not profiles/auth.users — booking_artists is empty); D2 = **one** calendar event per booking (create at deposit_paid, PATCH at settled, delete on cancel). Build order **D3 → D1 → D4 → D2**. ▶ NEXT for Sonnet.
- **Yoco webhook DONE ✅ 2026-06-21 (Sonnet)** — `78a8a79`. Registered `payment.created` + `payment.refunded` via Yoco API (subscription `ep_3FS4qYCmXojK0ODkXWo5HZfk3Ff`). Corrected event names (Wave 0 assumed `payment.succeeded`/`refund.succeeded` — Yoco's actual names confirmed via API validation error). `YOCO_WEBHOOK_SECRET` bound to Worker. 319 tests green. **Pieter: save `whsec_...` to Supabase Vault as `YOCO_WEBHOOK_SECRET`.**
- **Admin login redesign DONE ✅ 2026-06-21 (Sonnet)** — `d6b7ceb`. Quiet-luxury restyle: logo centred, champagne card border, Georgia italic heading, blush pill CTA, ivory background, pencil peony illustration bottom-right (`mix-blend-mode:multiply`, `peony.png` in CF Pages assets). "Check your inbox" confirmation page restyled to match. 319 tests green.
- **Email 8 (Google Review) DONE ✅ 2026-06-20 (Sonnet)** — `d482434`. `reviewEmailSweep`: daily cron, 48h after `wedding_date`, settled bookings only, fetches `google_review_url` from `business_settings`, sends emailShell thank-you + blush CTA, stamps `review_email_sent_at`, audits. Migration 0012. 4 tests → 319 green. **Pieter: apply migration 0012 to live DB.**
- **Email templates DONE ✅ 2026-06-20 (Sonnet)** — `dd1f994`. Shared `worker/src/lib/email.ts`: `emailShell()`, `emailTable()`, `emailBtn()`, `emailNote()`, `sendEmail()`, `getEftSettings()` — single quiet-luxury wrapper for all 7 bride emails (ivory card, champagne dividers, Georgia italic headings, blush pill CTA). Consolidated 5 duplicate `brevoEmail()` + 3 duplicate `getEftSettings()` across booking files. `balance.ts` now reads EFT details from `business_settings` (not env vars). `0002_business_settings.sql` updated with real TymeBank details. Live SQL provided above for Pieter to run. 315 tests green.
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

**⬆ To umbrella — 🟢 SHIPPED: Wave D planned (Opus, 2026-06-21)**
Four Sonnet-buildable plan docs (Sanity CMS · Google Calendar · Worker rate limiting · artist allocation) + master-sequence update, from a 3-pass recon→design→adversarial-verify workflow. Two architecture one-way-doors resolved by Opus (D4 dedicated `artists` table + FK re-point; D2 single calendar event per booking). Build lane is unblocked (D3 needs nothing; D1/D2/D4 need the one-time external setup logged in Pieter actions). No umbrella decision needed.

**⬆ To umbrella — 🟢 SHIPPED: Booking re-plan delivered (Opus, 2026-06-18)**
Full re-plan of booking flow + dashboard + Yoco + CRM + analytics + ML + SEO/security, from a 14-agent fan-out. **Surfaced a live payment bug** (Yoco webhook never fires on real events) — Wave 0 hotfix queued as build ▶ NEXT. The re-plan confirms the agency-platform roadmap's Phase-1-auth-then-Phase-2-dashboard sequence is now a hard dependency of the corrected booking core (corrections #2/#8 pull Phase 2 forward). 7 decisions await Pieter (build-sequence doc §Decisions); none block the Wave 0 hotfix.

**⬆ To umbrella — ⚪ DECISION: Studio-wide secrets architecture** — two-tier pattern (client secrets in client Supabase vault, LZ as directory). Logged. Defer to post-launch.

**⬇ From umbrella (2026-06-18 — bridge drain):** 🟢 SHIPPED (booking re-plan + Wave 0) folded into umbrella done-ledger. Umbrella project state updated: Opus re-plan COMPLETE, Wave A is ▶ NEXT. No blockers from umbrella lane.
