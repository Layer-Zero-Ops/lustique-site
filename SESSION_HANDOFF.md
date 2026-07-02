# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** TASK-D ✅ merged → Yoco staging verification in progress · **Updated:** 2026-07-02

---

## ▶ NEXT (fresh session — BUILD)

**Model:** Sonnet · **Branch:** `dev` (PR #1 already merged — TASK-D + venue directory + promo library are all live on `dev`/staging)

### Immediate: finish the Yoco staging test (in progress, one click from done)

A test booking is already seeded and ready — **don't recreate it**, just pick up here:

1. Pieter (or you, once he shares the session) goes to:
   `https://lustique-form-handler-staging.summer-cake-2b02.workers.dev/api/admin/booking/35dd00cc-7481-47e3-a814-87d7925ac08e`
2. Click **"Send Quote"** — this mints the real invoice link and emails it to `pieter+yoco-test@layerzerostudios.com` (a Gmail `+`-alias test inbox, not a real bride)
3. Open the invoice link from that email → click "Pay Deposit" → complete checkout with Yoco's **test card** (`4111 1111 1111 1111`, any future expiry, any 3-digit CVV — or pull the exact one from the Yoco App → Sales → Payment Gateway → Test card details)
4. **Then verify the result via Supabase directly** (project `ywoovdpnphcogwgoqhst`, table `bookings`/`payments`) — don't just trust the UI:
   ```sql
   select status, deposit_pct, deposit_net_cents from bookings where id = '35dd00cc-7481-47e3-a814-87d7925ac08e';
   select status, yoco_checkout_id, net_cents from payments where booking_id = '35dd00cc-7481-47e3-a814-87d7925ac08e';
   ```
   Expect: booking `status = deposit_paid`, payment `status = paid`. If the payment row stays `pending`, the webhook didn't fire/verify — check `worker/src/booking/yoco.ts` signature verification and confirm `YOCO_WEBHOOK_SECRET` on staging matches what's registered in the Yoco dashboard for this environment's webhook endpoint.
5. **Once confirmed working**: this is what "lift the EFT main option, allow Yoco" was blocked on — go back to Pieter's original ask and change whatever UI/copy currently favors EFT (check `worker/src/booking/invoice.ts` — the deposit modal already tries Yoco first with EFT as fallback-on-failure, so "lifting EFT as main" may already effectively be the current behavior — confirm what Pieter actually wants changed before touching pricing/payment-flow code).

### Known staging config gaps still open
- `staging.lustiqueco.co.za` DNS CNAME still not created (Pieter's call — see `worker/wrangler.toml` comments). Currently using `lustique-form-handler-staging.summer-cake-2b02.workers.dev` instead (workers.dev subdomain enabled this session, with explicit approval — admin routes still gated by secrets, not open to the world, but worth revisiting once DNS exists properly).
- Staging secrets now complete: `YOCO_SECRET_KEY` (test mode, `sk_test_...`), `YOCO_WEBHOOK_SECRET`, `SUPABASE_JWT_SECRET` all set this session, sourced from Supabase vault (`ywoovdpnphcogwgoqhst` project) where available, or set directly by Pieter for the ones not in vault.
- A stray mis-named secret (webhook secret value used as the secret *name*) was created and deleted this session — cosmetic, cleaned up, no lasting issue.

### TASK-E — Dashboard notifications (remaining)

Two notification types still unwired:
- `enquiry_received` — fire when new enquiry lands (currently no bell notification)
- `invoice_rejected` — fire when bride declines invoice (bell not triggered yet)

**Where the code is:**
- `worker/src/booking/dashboard.ts` — notification bell + `handleAdminNotifications`
- `worker/src/booking/enquiries.ts` — `persistEnquiry` and form handler (add `insertNotification` call here)
- `worker/src/booking/invoice.ts` — `handleInvoiceReject` already calls `insertNotification` for `invoice_rejected` ✅ (check: migration 0020 must be applied)

⚠ **Pieter action required before TASK-E works:** Apply migration 0020:
```sql
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'balance_due';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'contact_added';
```

---

## ✅ Completed this session (2026-07-01, part 2) — promo library + FREE_KM + venue-search polish

**Not yet committed** — same working tree as the venue-directory work below, still on `feature/task-d-yoco-deposit`.

- **Free travel threshold raised 30km → 40km round trip** — `FREE_KM` in `shared/pricing/src/constants.ts`, plus `PRICING.md` and all quote-page copy updated to match.
- **Venue-search UX fixes**: HERE Autosuggest sometimes returns duplicate records for the same place — now deduped by normalized name. Added arrow-key + Enter keyboard navigation with visible highlighting so reaching a suggestion below the fold never depends on a scroll gesture working.
- **Promo engine rebuilt as a dashboard-configurable library** (the 4+ promo was previously hardcoded as `ACTIVE_PROMO`):
  - `shared/pricing/src/types.ts` — `Promo` extended from 1 kind to 7: `cheapestLookFree`, `flatCreditOnMinParty`, `milestoneTiers`, `weekdayDiscount`, `seasonalWindow`, `earlyBirdLeadTime`, `bundledValueAdd`. `EstimateInput` gained optional `weddingDayOfWeek`/`weddingMonth`/`monthsUntilWedding` (computed by the caller, not `Date.now()` inside `computeEstimate`, so it stays pure/testable). `EstimateResult` gained `perks: string[]` for zero-price-effect badges.
  - `shared/pricing/src/promoPresets.ts` — **10 curated promos**, hand-designed with real financial-engineering rationale (see chat for the full write-up on why each is legitimate — no fabricated reference pricing). 8 apply live to the estimator; 2 (`bring-your-bestie` referral, `welcome-back-loyalty`) are backend-only, applied manually by Zandeline since they depend on verifying a second real booking.
  - `worker/src/booking/promos.ts` — new **Promotions** dashboard tab (`GET/POST /api/admin/promos`): Zandeline picks up to 5 presets into her library, then which one (if any) is live. Public `GET /api/promo/active` is what the site fetches.
  - `worker/src/booking/db.ts` — added `getBusinessSetting`/`setBusinessSetting` (business_settings is a plain key/value store, already existed for EFT details etc. — no new table).
  - `supabase/migrations/0023_promo_library.sql` — seeds `cheapest-look-free` as the default library+active so nothing changes until Zandeline touches the new tab.
  - `site/src/scripts/estimator.ts` — fetches `/api/promo/active` on load instead of importing a hardcoded constant; falls back to no-promo gracefully if the fetch fails (verified in browser — page never breaks). Renders `perks` as badges. Computes wedding-date facts from `#weddingDate` for the date-aware promo kinds.
- 51 new tests (9 promo-kind + 5 preset-catalog tests in `shared/pricing`, 9 `promos.ts` handler tests, 4 `db.ts` business_settings tests, plus assorted). **498 tests passing total** across `site`/`worker`/`shared/pricing`.
- ⚠ **Not independently browser-verified with a promo actually live** — fetch-mocking across a full page navigation wasn't reliable within this session; the computation logic has full unit coverage (47 pricing tests) and the fetch/fallback wiring was confirmed live in-browser, but the "promo active → renders correctly end-to-end in a real browser" path is unit-tested, not manually eyeballed. Worth a quick manual check once deployed to staging.

---

## ✅ Completed this session (2026-07-01, part 1) — venue directory + matching accuracy

**Not yet committed** — sitting in the working tree on `feature/task-d-yoco-deposit` alongside TASK-D. Needs a branch decision before it ships (new commit on this branch vs. a fresh branch off `dev`).

- **`site/src/data/sa-wedding-venues.json`** — 226-venue directory (sa-venues.com + OpenStreetMap + HERE Discover), each entry cross-verified against an independent business-listing search and tagged `precision`/`verified`. `site/src/data/sa-wedding-venues-review.json` holds everything the pipeline didn't auto-trust (corrected locations, conflicts, dropped candidates) for manual follow-up.
- **`site/src/scripts/venueMatch.ts` (+ `.test.ts`, 12 tests)** — pure, unit-tested fuzzy venue-name matching, extracted out of the DOM code.
- **`site/src/scripts/estimator.ts`** — venue lookup rebuilt: live search-as-you-type (HERE Autosuggest, blends our verified directory with HERE's live index) replaced the static datalist + "drag pin blindly" fallback; directory matches now show a confirm step instead of applying silently; destination weddings (>200km) now show an indicative travel + minimum artist-accommodation range instead of a bare "we'll tailor it".
- **`shared/pricing`** — added `estimateDestinationExtras()` (4 new tests): informational-only travel + R1000/artist/night (min 2 nights) accommodation estimate for destination weddings. Does **not** change `computeEstimate()`'s official total — that still zeroes travel and stays personally-confirmed.
- **Venue-match telemetry** — `supabase/migrations/0022_venue_match_log.sql` (✅ **applied** by Pieter, 2026-07-01) + `worker/src/booking/venueMatchLog.ts` (7 tests) + wired routes:
  - `POST /api/venue-match-log` — anonymous, fire-and-forget, logs which of 8 outcomes each venue lookup resolved to
  - `GET /api/admin/venue-match-stats?token=ADMIN_SECRET` — counts per outcome (same token gate as `/api/admin/accounting`)
  - Once the Worker with this code deploys, data starts collecting — check back in a few weeks for real first-time-accuracy numbers instead of guessing from directory size.
- All 466 tests passing across `site` / `worker` / `shared/pricing`.

---

## ✅ Completed this session (2026-06-26)

### TASK-D — Yoco deposit modal on invoice page (PR #1, branch feature/task-d-yoco-deposit)
- `worker/src/booking/invoice.ts` — replaced "Secure your date" link with inline "Pay Deposit" modal; added deposit selection (25%/50%/100%) with correct amounts; JS fetches `POST /api/booking/invoice/pay` → redirects to Yoco checkout; EFT fallback modal shown if Yoco fails
- New endpoint `handleInvoicePay` — verifies invoice token, validates depositPct, transitions `quote_sent → accepted`, creates Yoco checkout, inserts payment row, returns `{ checkoutUrl }` JSON; on Yoco failure returns `{ eftOnly: true, eft: {...} }`
- `worker/src/index.ts` — wired `POST /api/booking/invoice/pay` route
- 9 new tests added — 418/421 passing total

### ENV-RETROFIT — dev branch model (commit b04e9d9, pushed)
- `worker/wrangler.toml` — `[env.staging]` block: `lustique-form-handler-staging`, separate R2 bucket, ratelimit namespaces
- `worker/.dev.vars.example` — local dev secrets template
- `site/.env.local.example` — Astro local env template
- `SETUP.md` — Local Dev Bring-Up section (full local stack runbook)
- `.gitignore` — `.dev.vars` added; `!.env.local.example` exception
- **`dev` branch created and pushed** to `origin/dev` ✅

**Promotion flow (live):** `feature/* → dev (CF Pages preview + staging Worker) → PR → main (prod)`

### Email visual redesign + inbox preheaders (commit 66dbcf1)
- `worker/src/lib/email.ts` — brand blush border, responsive card, preheader parameter + ghost-text
- Preheader text on all 15 bride-facing emails across 8 files
- 409/412 tests passing

### Contact page map (commit 2136ba7)
- OSM iframe pinned at 242 Frangipani St; CSP updated

### CF Pages deploy fix (commits 1a9cbaf + 1173a09)
- `_redirects` absolute URL removed (CF Pages only allows relative source paths)

### Supabase: `google_review_url` set ✅
- Review email sweep fully operational

---

## 🟠 TASK-E — Dashboard notifications (remaining)

Wired: `deposit_paid`, `balance_due`, `contact_added` (commit eab986c).
Remaining: `enquiry_received`, `invoice_rejected`.

Note: `invoice_rejected` is already called in `handleInvoiceReject` but migration 0020 must be applied first.

⚠ **Pieter action required:** Apply migration 0020 (see NEXT above).

---

## Pieter actions still open

1. ~~Review + merge PR #1~~ ✅ **Merged 2026-07-01** — `dev` now has TASK-D + venue directory/matching + promo library, all fast-forwarded from `main` first to avoid conflicts (see git log for the merge commit).
2. **CF Pages env var** — add `PUBLIC_HERE_API_KEY=-3XlCZXtw1RNbKmaw-F4w5nhn2TA8wuV3YCzjJsU_0Y` as a build env var in the CF Pages dashboard (Settings → Environment variables → Production). Also restrict the key in HERE developer dashboard to domain `lustiqueco.co.za/*`.
3. **Worker local `.dev.vars`** — copy `.dev.vars.example`, fill in `YOCO_SECRET_KEY=sk_test_*` + Supabase keys from `supabase start`
4. **Site local `.env.local`** — copy `site/.env.local.example`, fill in from `supabase start` + add `PUBLIC_HERE_API_KEY=`
5. **Migration 0020** — `ALTER TYPE notification_type ADD VALUE` (blocks TASK-E)
6. **Migration 0018** — apply `supabase/migrations/0018_public_read_policies.sql`
7. **CF Pages env vars (Supabase)** — add `SUPABASE_URL` + `SUPABASE_ANON_KEY` as CF Pages build env vars
8. ~~`SUPABASE_JWT_SECRET`~~ ✅ **Set on both production and staging** (staging done 2026-07-02)
9. ~~Staging Worker secrets~~ ✅ **Done 2026-07-02** — `YOCO_SECRET_KEY` (test), `YOCO_WEBHOOK_SECRET`, `SUPABASE_JWT_SECRET` all set. `staging.lustiqueco.co.za` DNS still not created — using the `workers.dev` URL instead for now (see ▶ NEXT).
10. **UptimeRobot** — free monitor on `https://lustiqueco.co.za`
11. **CF Pages notifications** — email on deploy failures
12. **Artist headshots** — Elria, Jana, Janeke, Marize, Maroné, Monique, René, Samantha
13. **Brevo newsletter list ID** — create list → share numeric ID
14. **NEW: finish the Yoco staging test** — see ▶ NEXT at the top of this doc, one click away from done
15. **NEW: `staging.lustiqueco.co.za` DNS CNAME** — Cloudflare dashboard → DNS → add CNAME `staging` → `lustique-form-handler-staging.summer-cake-2b02.workers.dev` (proxied). Not urgent — `workers.dev` URL works for testing meanwhile.
16. **NEW: decide "lift EFT as main option"** — once Yoco staging test passes, revisit what this actually means in the UI (`worker/src/booking/invoice.ts` deposit modal already tries Yoco first, EFT is shown only if Yoco checkout creation fails — clarify with Pieter whether more than that needs to change).

---

## Current state (as-built, 2026-07-02)

**Promotion flow:** `feature/* → dev (CF Pages preview + staging Worker) → PR → main (prod)`

### Branch state
- `main` — production, live at lustiqueco.co.za (unchanged this session — nothing has reached prod yet)
- `origin/dev` — **now has everything**: TASK-D, venue directory + live search + matching telemetry, dashboard promo library, FREE_KM 30→40 change. Fast-forwarded to match `main` first, then PR #1 merged on top cleanly.
- `feature/task-d-yoco-deposit` — merged into `dev`, can be deleted once confirmed no longer needed
- **Staging Worker deployed** with all of the above (`lustique-form-handler-staging`, reachable at `lustique-form-handler-staging.summer-cake-2b02.workers.dev` — workers.dev subdomain explicitly enabled this session)

### Worker (`lustique-form-handler`) — on `main`
- Booking flow end-to-end ✅
- Admin dashboard: all nav tabs ✅
- Staffing tab: artist roster + event assignments ✅
- Forms tab: enquiry list + detail + "Generate Invoice" ✅
- Contacts: list + Add / CSV import ✅
- Portfolio: gallery + ordering ✅
- Blog: CRUD ✅
- Calendar feed: `/api/calendar.ics?key=ICAL_KEY` ✅
- Invoice page: Wave-style layout (TASK-C ✅)
- Invoice page: deposit modal + `/api/booking/invoice/pay` (TASK-D ✅, in PR)
- Review email cron: fully operational ✅

### Supabase migrations applied (0001–0023)
- ⚠ 0018: public read policies — **NOT YET APPLIED**
- ⚠ 0020: notification_type enum values — **NOT YET APPLIED**
- ✅ 0022: venue_match_log table — **applied 2026-07-01**
- ✅ 0023: promo_library defaults — **applied 2026-07-01**

### Site (Cloudflare Pages — auto-deploys from `main`)
- Public site live at `lustiqueco.co.za` ✅
- Contact page: OSM map live ✅
- Email redesign: live ✅

---

## Key files
- `PLAN.md` · `PRICING.md` · `BRAND.md` · `ARCHITECTURE.md` · `SETUP.md` (local dev runbook)
- `worker/wrangler.toml` — production + staging env config
- `worker/.dev.vars.example` — local dev secrets template
- `worker/src/booking/dashboard.ts` — admin UI shell + booking detail
- `worker/src/booking/enquiries.ts` — Forms/enquiry handlers incl. Generate Invoice
- `worker/src/booking/invoice.ts` — public invoice page + deposit modal (TASK-D)
- `worker/src/lib/email.ts` — email shell + all helpers
- `site/src/scripts/estimator.ts` — live estimator
- `site/public/_headers` — CSP
- `shared/pricing/` — pricing logic (single source of truth)

## ⇄ Umbrella  (project ↔ Studio Manager · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** PR #1 merged into `dev` 2026-07-01 — TASK-D + venue directory/matching + promo library all on staging now. Yoco staging payment test in progress (one click from done — see ▶ NEXT). Nothing has reached `main`/production yet; deploy-protection intact. TASK-E still unblocked-pending on migration 0020.
**⬇ From umbrella:** ✅ 2026-06-30 — TASK-D ⬆ folded. Umbrella confirms deploy-protection is holding (work is on `feature/task-d-yoco-deposit` + `dev`, not `main`); site at `lustiqueco.co.za` unaffected. TASK-E unblocked once Pieter applies migration 0020.
