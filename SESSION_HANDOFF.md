# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Estimator reliability + UX · **Updated:** 2026-06-25

---

## ▶ NEXT (Sonnet, fresh session — BUILD)

**Model:** Sonnet · **Lane:** Build · **Branch:** `main`

**▶ NEXT: TASK-D — Yoco "Pay Now" deposit selection button (after Pieter confirms EFT flow working end-to-end).**

Before starting TASK-D, Pieter must confirm: "EFT is working — go ahead with Pay Now."

Also still open: **Website reliability monitoring** — recommend UptimeRobot (free, 5-min checks on `lustiqueco.co.za`) + Cloudflare Pages deployment failure email notifications. A customer reported an access error. We don't know the cause yet. This is low-effort hardening worth doing before TASK-D.

---

## ✅ Completed this session (2026-06-25)

### SEO + 522 fix (2026-06-25) — **PUSHED** (commit 373f6b7)
- `site/src/pages/index.astro` — title → "Bridal Makeup Artist Pretoria | Lustique Co."; desc keyword-rich; "based in La Montagne, Pretoria" added to body copy
- `site/src/pages/services.astro` — title → "Bridal Makeup & Hair Artist Pretoria | Lustique Co. Services"
- `site/src/pages/about.astro` — title → "About Lustique Co. — Bridal Artists in Pretoria"
- `site/src/data/site.ts` — schema `@type` now `["HealthAndBeautyBusiness","BeautySalon"]`; `areaServed` expanded to typed City/State objects; added `knowsAbout`, `paymentAccepted`, `currenciesAccepted`
- `site/public/_redirects` — www→apex 301 redirect added
- **CF Redirect Rule deployed** — `https://www.lustiqueco.co.za/*` → `https://lustiqueco.co.za/$1` (301); fixes 522 error from Google Business Profile link

### Estimator — all 5 fixes shipped (not yet pushed to origin)

**Files modified (uncommitted — Pieter pushes manually):**
- `shared/pricing/src/estimate.ts` — `travelForKm()` now compares ROUND TRIP against `FREE_KM=30` (not one-way). Big Red Barn 22 km → 44 km round trip → R308, no longer shown as free.
- `shared/pricing/src/estimate.test.ts` — tests updated to match corrected formula + promo fix; 25/25 pass.
- `shared/pricing/src/estimate.ts` — `addRole()` promo fix: partial-service adults (makeup-only or hair-only) no longer qualify for "cheapest look free". Both makeup AND hair required for a look to be eligible.
- `site/src/scripts/estimator.ts`:
  - Removed duplicate local `const FREE_KM = 30` (was shadowing shared package import)
  - `routeFrom()` now displays `≈ 22 km one-way (44 km round trip)` and compares round-trip against free zone
  - Geocoder switched **Photon → Nominatim** (`countrycodes=za`) — far better SA venue accuracy; Red Ivory Estate in Hartbeespoort will now resolve correctly
- `site/public/_headers` — CSP fixes:
  - Added `https://*.tile.openstreetmap.org` to `img-src` (Leaflet tiles were blocked — this was why the map was blank)
  - Replaced `https://photon.komoot.io` with `https://nominatim.openstreetmap.org` in `connect-src`
- `site/src/pages/quote.astro`:
  - Button: "Request my quote" → **"Request to Book"**
  - Travel note: "free within 30 km" → "first 30 km round trip is free"
  - Fallback dropdown: "Within 30 km (free)" → "Within 15 km one-way / 30 km round trip (free)"

### Invoice + email quality pass (2026-06-25)

**Files modified:**
- `worker/src/booking/db.ts` — `quote_lines` added to `ConfirmBookingRow` + `CONFIRM_COLS`; `getBookingByIdForInvoice` simplified
- `worker/src/lib/email.ts` — `emailShell` and `emailBtnLink` treat heading/label as trusted HTML (no double-escape); all callers updated to `esc()` user data in headings
- `worker/src/booking/admin-actions.ts` — `depositInvoiceEmailHtml` now shows line items + venue + 3 clean deposit rows; `invoiceLinkEmailHtml` + `handleAdminResendInvoice` added
- `worker/src/booking/invoice.ts` — due date fixed (`quote_sent_at + 14d`); event date formatted ("24 September 2026"); T&Cs travel wording fixed; "Secure your date" CTA added for `quote_sent` bookings
- `worker/src/booking/dashboard.ts` — "Resend Invoice →" button added for `quote_sent`, `accepted`, `deposit_paid`, `settled` status bookings
- `worker/src/index.ts` — `POST /api/admin/booking/:id/resend-invoice` route wired
- `worker/src/booking/admin-actions.test.ts` — stale `quote_sent`-should-error test corrected
- `worker/src/booking/invoice.test.ts` — date format assertion updated to "15 September 2026"

### Earlier in session (from previous context)

- ✅ `quote_sent` bookings: added "Resend Deposit Invoice" + "Decline" action buttons in booking detail
- ✅ `handleAdminSendQuote` now supports both `requested` (initial send) and `quote_sent` (resend without status change)
- ✅ Staffing tab: full artist roster grid (name, specialism, upcoming events with Lead badges) prepended above the Confirmed Upcoming Events table
- ✅ Team page: artists without `photo_url` are now hidden until headshots are provided

---

## 🟠 TASK-D — Yoco "Pay Now" button on invoice (LAST — after EFT confirmed working)

**Trigger:** Pieter says "EFT is working — go ahead."

### Spec
Customer clicks "Pay Now" on invoice page → deposit selection modal:
- 25% of invoice total (R X,XXX)
- 50% of invoice total (R X,XXX)
- 100% of invoice total (R X,XXX)

Popup also has "Reject" button → asks reason → marks booking `rejected`, emails Zandeline, stores reason.

On "Proceed" → Yoco payment link generated → customer redirected to Yoco checkout.

**DB changes needed:**
- `bookings.rejection_reason text` column (new migration)
- `deposit_pct` set when customer selects 25/50/100

**Payment outcome:**
- Success: Yoco webhook → `deposit_paid` → dashboard notification
- Store in `payment_links` table: `booking_id`, `amount_cents`, `deposit_pct_selected`, `yoco_checkout_id`, `yoco_payment_url`, `status`, `created_at`

---

## 🟠 TASK-E — Dashboard notifications (partially done)

Notification bell wired to: deposit_paid, balance_due, contact_added (commit eab986c).

⚠ **Pieter action required:** Apply migration 0020 in Supabase SQL editor:
```sql
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'balance_due';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'contact_added';
```

Remaining triggers (not yet wired): enquiry_received, invoice_rejected.

---

## Pieter actions still open

1. **Push uncommitted estimator fixes to origin** — `shared/pricing/`, `site/public/_headers`, `site/src/pages/quote.astro`, `site/src/scripts/estimator.ts`
2. **UptimeRobot** — free account, monitor `https://lustiqueco.co.za` (5-min checks, email alerts)
3. **Cloudflare Pages** → Settings → Notifications → add email for deployment failures
4. **Migration 0020** — apply `ALTER TYPE notification_type ...` (see TASK-E above)
5. **Migration 0018** — apply `supabase/migrations/0018_public_read_policies.sql` (public read for `artists` + `portfolio_images`)
6. **CF Pages env vars** — add `SUPABASE_URL` + `SUPABASE_ANON_KEY` as Cloudflare Pages build env vars
7. **Brevo newsletter list ID** — create list → share numeric ID → enables newsletter task
8. **Artist headshots** — Elria, Jana, Janeke, Marize, Maroné, Monique, René, Samantha (team page hides them until photos provided)
9. **Hard-refresh Safari** on quote page (Cmd+Shift+R) to clear stale JS cache after estimator changes

---

## Current state (as-built, 2026-06-25)

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
- Invoice decline flow (TASK-D/reject ✅)

### Supabase migrations applied (0001–0019)
- 0019: `enquiries.booking_id` FK ✅
- ⚠ 0018: public read policies — **NOT YET APPLIED**
- ⚠ 0020: notification_type enum values — **NOT YET APPLIED**

### Site (Cloudflare Pages — auto-deploys from `main`)
- Public site live at `lustiqueco.co.za` ✅
- Estimator fixes locally complete — push needed ⚠
- ⚠ Pages show real data only after migration 0018 + CF Pages env vars are set

---

## Key files
- `PLAN.md` · `PRICING.md` · `BRAND.md` · `ARCHITECTURE.md`
- `worker/src/booking/dashboard.ts` — admin UI shell + booking detail
- `worker/src/booking/enquiries.ts` — Forms/enquiry handlers incl. Generate Invoice
- `worker/src/booking/invoice.ts` — public invoice page (Wave-style ✅)
- `worker/src/booking/staffing.ts` — artist roster + event staffing tab
- `worker/src/booking/admin-actions.ts` — send-quote handler (supports resend)
- `site/src/scripts/estimator.ts` — live estimator (geocoder + map + pricing)
- `site/public/_headers` — CSP (OSM tiles now allowed)
- `shared/pricing/` — pricing logic (single source of truth)

## ⇄ Umbrella  (project ↔ Studio Manager · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** *(clear — env-standards DECISION folded to umbrella agenda 2026-06-25)*
**⬇ From umbrella:** 🟢 **ENV-STANDARD WRITTEN + RETROFIT DISPATCHED (2026-06-25, Opus).** The studio standard is live at `~/Layer-Zero-Studios/_ops/ENVIRONMENT-STANDARDS.md` v1.0. **Lustique is retrofit priority #1 — do this BEFORE TASK-D.** Sonnet build task (see §2a, §2c, §5):
> 1. Create long-lived **`dev`** branch off `main`.
> 2. **dev (local) env:** document bring-up — `supabase start` (local DB, apply all migrations for parity) + `wrangler dev` + Astro dev server; `.env.local` with **Yoco test keys** (`sk_test_*`), Turnstile test keys, Brevo sandbox. **Build + test TASK-D entirely here** — never against prod.
> 3. **staging (free hosted):** add `[env.staging]` to `worker/wrangler.toml` → `lustique-form-handler-staging` on `staging.lustiqueco.co.za/api/*`; CF Pages preview deploys `dev` automatically. Point staging at a **`lustique_staging` Supabase schema** (Rung 2 — free; mirror migrations + RLS) since Supabase is client-owned and Branching is Pro-only.
> 4. Per-env secrets: `wrangler secret put <NAME> --env staging` = **test** values; top-level = live. Same names, different values.
> 5. Add the promotion-flow line to this baton: `feature → dev (staging) → PR → main (prod)`.
>
> **Phase 2 (later):** when Lustique adopts Supabase Pro before first live deposit, enable **Branching** → promote staging to Rung 3 (isolated per-PR DB). No re-architecture.
>
> **Pieter spend choice (non-blocking):** default keeps you free through TASK-D. If Pieter wants a paid isolated hosted staging DB now (~$35/mo), jump straight to Rung 3 instead of step 3's schema. Default = free-first.
