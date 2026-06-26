# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** TASK-D (Yoco deposit) · **Updated:** 2026-06-26

---

## ▶ NEXT (Sonnet, fresh session — BUILD)

**Model:** Sonnet · **Lane:** Build · **Branch:** `dev` (always feature branches off `dev`)

### Pieter — one-time actions before TASK-D

Before starting TASK-D, Pieter should complete these (then Claude can build):

1. **Push `main` to GitHub** — run `git push origin main` in the project dir (1 commit ahead: ENV-RETROFIT setup). The classifier blocked it; this commit is safe (infra/config only, no user-facing app code).
2. **Yoco test keys** — copy `.dev.vars.example` → `worker/.dev.vars` and fill in `sk_test_*` from your [Yoco test dashboard](https://payments.yoco.com).
3. **`supabase start`** — run in project root; paste API URL + anon key + service_role key + JWT secret into `worker/.dev.vars` and `site/.env.local`.
4. **Migration 0020** (notification_type enum — blocked since TASK-E):
   ```sql
   ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'balance_due';
   ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'contact_added';
   ```
5. **Migration 0018** — apply `supabase/migrations/0018_public_read_policies.sql` (public read for `artists` + `portfolio_images`).
6. **(Optional) UptimeRobot** — free, monitor `https://lustiqueco.co.za` (5-min checks).
7. **(Optional) CF Pages** → Settings → Notifications → add email for deployment failures.

### TASK-D — Yoco "Pay Now" deposit selection button

**Build on `dev` branch. All work on feature branches off `dev`. Never touch `main` directly.**

Customer flow:
1. Bride opens invoice → clicks "Pay Deposit"
2. Modal: choose 25% / 50% / 100% of total
3. Worker calls Yoco API → returns checkout URL → redirect to Yoco
4. Yoco webhook → `/api/yoco/webhook` → mark `deposit_paid` → notify admin

Schema needed (migration 0021+ — apply locally via `supabase start`):
- `bookings.deposit_pct int` (25 / 50 / 100)
- `payment_links` table: `booking_id, yoco_checkout_id, amount_cents, status, created_at`
- `bookings.rejection_reason text` (already planned)

---

## ✅ Completed this session (2026-06-26)

### ENV-RETROFIT — dev branch model (commit b04e9d9, local main — push pending)
- `worker/wrangler.toml` — `[env.staging]` block: `lustique-form-handler-staging`, separate R2 bucket (`lustique-audit-staging`), ratelimit namespaces 2001–2005
- `worker/.dev.vars.example` — local dev secrets template for `wrangler dev`
- `site/.env.local.example` — Astro local env template
- `SETUP.md` — Local Dev Bring-Up section prepended (full local stack runbook)
- `.gitignore` — `.dev.vars` added; `!.env.local.example` exception added
- **`dev` branch created and pushed** to `origin/dev` ✅

**Promotion flow (now live):** `feature/* → dev (CF Pages preview + staging Worker) → PR → main (prod)`

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

## 🟠 TASK-E — Dashboard notifications (partially done)

Wired: `deposit_paid`, `balance_due`, `contact_added` (commit eab986c).
Remaining: `enquiry_received`, `invoice_rejected`.

⚠ **Pieter action required:** Apply migration 0020 (see above).

---

## Pieter actions still open

1. **Push `main`** — `git push origin main` (1 commit ahead, ENV-RETROFIT infra config)
2. **Worker local `.dev.vars`** — copy `.dev.vars.example`, fill in from `supabase start` + Yoco test keys
3. **Site local `.env.local`** — copy `site/.env.local.example`, fill in from `supabase start`
4. **Migration 0020** — `ALTER TYPE notification_type ADD VALUE` (see TASK-E above)
5. **Migration 0018** — apply `supabase/migrations/0018_public_read_policies.sql`
6. **CF Pages env vars** — add `SUPABASE_URL` + `SUPABASE_ANON_KEY` as CF Pages build env vars
7. **`SUPABASE_JWT_SECRET`** — `wrangler secret put SUPABASE_JWT_SECRET` → from Supabase → Settings → API → JWT Secret
8. **Staging Worker secrets** — `wrangler secret put <NAME> --env staging` for all secrets (test values)
9. **UptimeRobot** — free monitor on `https://lustiqueco.co.za`
10. **CF Pages notifications** — email on deploy failures
11. **Artist headshots** — Elria, Jana, Janeke, Marize, Maroné, Monique, René, Samantha
12. **Brevo newsletter list ID** — create list → share numeric ID

---

## Current state (as-built, 2026-06-26)

**Promotion flow:** `feature/* → dev (CF Pages preview + staging Worker) → PR → main (prod)`

### Branch state
- `main` — 1 commit ahead of `origin/main` (ENV-RETROFIT, push pending)
- `origin/dev` — ✅ created, matches local `main` (has ENV-RETROFIT)

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
- Review email cron: fully operational ✅

### Supabase migrations applied (0001–0021)
- ⚠ 0018: public read policies — **NOT YET APPLIED**
- ⚠ 0020: notification_type enum values — **NOT YET APPLIED**

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
- `worker/src/booking/invoice.ts` — public invoice page (Wave-style ✅)
- `worker/src/lib/email.ts` — email shell + all helpers
- `site/src/scripts/estimator.ts` — live estimator
- `site/public/_headers` — CSP
- `shared/pricing/` — pricing logic (single source of truth)

## ⇄ Umbrella  (project ↔ Studio Manager · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** ENV-RETROFIT complete for Lustique (#1). `dev` branch live. TASK-D (Yoco) unblocked once Pieter sets up local `.dev.vars` + `supabase start`.
**⬇ From umbrella:** *(clear)*
