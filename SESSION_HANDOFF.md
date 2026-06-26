# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** ENV-RETROFIT → TASK-D · **Updated:** 2026-06-26

---

## ▶ NEXT (Sonnet, fresh session — BUILD)

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` (then immediately create `dev`)

**▶ NEXT: ENV-RETROFIT (env-standards §5) — do this before TASK-D.**

**Why this matters now:** Lustique is working directly on `main`. A broken CF Pages build on `main` takes the live site down — we just lived this (the `_redirects` bug blocked every deploy for 2+ days). Once `dev` exists, broken builds only break the preview URL; `lustiqueco.co.za` stays live on the last good `main` build.

See `~/Layer-Zero-Studios/_ops/ENVIRONMENT-STANDARDS.md` §5:
1. Create long-lived **`dev`** branch off `main`.
2. Document local dev bring-up: `supabase start` (apply all migrations) + `wrangler dev` + Astro dev server; `.env.local` with Yoco **test** keys, Turnstile test keys, Brevo sandbox.
3. Add `[env.staging]` to `worker/wrangler.toml` → `lustique-form-handler-staging`; point at `lustique_staging` Supabase schema.
4. Set staging secrets: `wrangler secret put <NAME> --env staging` = test values; top-level = live.
5. Add promotion flow line to this baton: `feature → dev (staging) → PR → main (prod)`.

**After ENV-RETROFIT:** TASK-D — Yoco "Pay Now" deposit selection button.
- ✅ **EFT confirmed working 2026-06-25 — TASK-D is unblocked** (build on `dev` with Yoco test keys, never against prod).

Also: **Website reliability monitoring** — UptimeRobot (free, 5-min checks on `lustiqueco.co.za`) + CF Pages deployment email notifications — low-effort, do alongside ENV-RETROFIT.

---

## ✅ Completed this session (2026-06-26)

### Email visual redesign + inbox preheaders — **PUSHED** (commit 66dbcf1)
- `worker/src/lib/email.ts` — `emailShell` redesigned: brand blush top border (`border-top:3px solid #C4877A`), responsive `max-width:520px` card, `role="presentation"` on all tables, physical address + website URL in footer, `lang="en"`, `preheader` parameter with ghost-text padding technique
- Preheader text added to all **15 bride-facing emails** across 8 files (`request.ts`, `review.ts`, `confirm.ts`, `balance.ts`, `admin-actions.ts`, `yoco.ts`, `dashboard.ts`, `review-email.ts`) — inbox previews now show meaningful copy instead of raw HTML
- 409/412 tests still passing after changes

### Contact page map — **PUSHED** (commit 2136ba7)
- `site/src/pages/contact.astro` — replaced placeholder div with OpenStreetMap iframe pinned at `lat:-25.7986, lng:28.3127` (242 Frangipani St); `loading="lazy"`, `referrerpolicy="no-referrer"`, "View larger map →" link below
- `site/public/_headers` — added `https://www.openstreetmap.org` to `frame-src` in CSP

### CF Pages deploy fix — **PUSHED** (commits 1a9cbaf + 1173a09)
- `site/public/_redirects` — removed absolute URL `https://www.lustiqueco.co.za/*` line (CF Pages only allows relative source paths; this was silently blocking every deploy since commit 373f6b7 on 2026-06-25)
- Empty trigger commit to kick off fresh auto-deploy after the fix
- **Root cause:** CF Pages `_redirects` is separate from CF Redirect Rules; absolute URL sources only valid in Redirect Rules, not `_redirects`

### Supabase: `google_review_url` set ✅
- Pieter ran the UPSERT — `business_settings.google_review_url` now contains the direct GBP write-a-review link
- Review email sweep (already built in `review-email.ts` + wired to daily cron) is now fully operational

---

## ✅ Completed previous session (2026-06-25)

### Perf (commit a3fc0a4)
- `BaseLayout.astro` — Google Fonts async (`media="print"` + `onload`); `preloadImage` prop + `<noscript>` fallback
- `index.astro` — `preloadImage="/assets/hero.jpg"` → LCP improvement
- `_headers` — 30-day `Cache-Control` on `/assets/*`, favicons, webmanifest

### SEO + 522 fix (commit 373f6b7)
- `index.astro` title → "Bridal Makeup Artist Pretoria | Lustique Co."; desc keyword-rich; location added to body copy
- `services.astro` + `about.astro` — keyword-first titles
- `site.ts` — schema `@type: ["HealthAndBeautyBusiness","BeautySalon"]`; `areaServed` expanded; `knowsAbout`, `paymentAccepted`, `currenciesAccepted` added
- **CF Redirect Rule deployed** — `https://www.lustiqueco.co.za/*` → `https://lustiqueco.co.za/$1` (301); fixes 522 from GBP link

### Estimator + invoice/email/resend (commit 48b35d6)
- Travel: round-trip vs FREE_KM, display updated, Photon → Nominatim geocoder
- Promo fix: both makeup AND hair required for cheapest-look-free eligibility
- Invoice quality pass: line items, due date, resend-invoice button
- Email encoding fix, `emailShell` trusted-HTML heading

---

## 🟠 TASK-D — Yoco "Pay Now" button on invoice (after ENV-RETROFIT)

Customer clicks "Pay Now" → deposit selection modal (25% / 50% / 100%) → Yoco checkout.
DB: `bookings.rejection_reason text` (new migration) + `deposit_pct` field.
Payment outcome: webhook → `deposit_paid` → dashboard notification + `payment_links` table.
**Build entirely on `dev` with Yoco test keys — never against prod.**

---

## 🟠 TASK-E — Dashboard notifications (partially done)

Wired: `deposit_paid`, `balance_due`, `contact_added` (commit eab986c).
Remaining: `enquiry_received`, `invoice_rejected`.

⚠ **Pieter action required:** Apply migration 0020:
```sql
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'balance_due';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'contact_added';
```

---

## Pieter actions still open

1. **UptimeRobot** — free account, monitor `https://lustiqueco.co.za` (5-min checks, email alerts)
2. **Cloudflare Pages** → Settings → Notifications → add email for deployment failures (so future broken builds are caught immediately — would have caught the 2-day outage above)
3. **Migration 0020** — apply `ALTER TYPE notification_type ...` (see TASK-E above)
4. **Migration 0018** — apply `supabase/migrations/0018_public_read_policies.sql` (public read for `artists` + `portfolio_images`)
5. **CF Pages env vars** — add `SUPABASE_URL` + `SUPABASE_ANON_KEY` as Cloudflare Pages build env vars
6. **`SUPABASE_JWT_SECRET`** — `wrangler secret put SUPABASE_JWT_SECRET` → value from Supabase Settings → API → JWT Secret (required for dashboard auth gate)
7. **Brevo newsletter list ID** — create list → share numeric ID → enables newsletter task
8. **Artist headshots** — Elria, Jana, Janeke, Marize, Maroné, Monique, René, Samantha (team page hides until photos provided)

---

## Current state (as-built, 2026-06-26)

**Promotion flow (once ENV-RETROFIT done):** `feature/* → dev (staging preview) → PR → main (prod)`

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
- Review email cron: fully operational (google_review_url now set ✅)

### Supabase migrations applied (0001–0019)
- 0012: `review_email_sent_at` column + `google_review_url` in `business_settings` ✅
- ⚠ 0018: public read policies — **NOT YET APPLIED**
- ⚠ 0020: notification_type enum values — **NOT YET APPLIED**

### Site (Cloudflare Pages — auto-deploys from `main`)
- Public site live at `lustiqueco.co.za` ✅
- Deploy triggered at commit `1173a09` — should be live (was blocked 2026-06-25 → 2026-06-26 by `_redirects` bug, now fixed)
- Contact page: OSM map live ✅
- Email redesign: live ✅

---

## Key files
- `PLAN.md` · `PRICING.md` · `BRAND.md` · `ARCHITECTURE.md`
- `worker/src/booking/dashboard.ts` — admin UI shell + booking detail
- `worker/src/booking/enquiries.ts` — Forms/enquiry handlers incl. Generate Invoice
- `worker/src/booking/invoice.ts` — public invoice page (Wave-style ✅)
- `worker/src/booking/staffing.ts` — artist roster + event staffing tab
- `worker/src/booking/admin-actions.ts` — send-quote handler (supports resend)
- `worker/src/lib/email.ts` — email shell + all helpers (redesigned 2026-06-26)
- `site/src/scripts/estimator.ts` — live estimator (geocoder + map + pricing)
- `site/public/_headers` — CSP (OSM tiles + iframe allowed)
- `shared/pricing/` — pricing logic (single source of truth)

## ⇄ Umbrella  (project ↔ Studio Manager · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** *(clear)*
**⬇ From umbrella:** *(folded — ENV-RETROFIT urgency + SUPABASE_JWT_SECRET gate applied to baton above)*
