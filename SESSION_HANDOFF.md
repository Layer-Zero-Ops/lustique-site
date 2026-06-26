# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** TASK-D ✅ → TASK-E next · **Updated:** 2026-06-26

---

## ▶ NEXT (Sonnet, fresh session — BUILD)

**Model:** Sonnet · **Lane:** Build · **Branch:** `dev` (always feature branches off `dev`)

### Pieter — merge TASK-D first

1. **Review PR #1** → [feat(task-d): inline deposit selection modal on invoice page](https://github.com/Layer-Zero-Ops/lustique-site/pull/1)  
   Branch: `feature/task-d-yoco-deposit` → base: `dev`
2. **Merge to `dev`** — triggers CF Pages preview + staging Worker deploy
3. **Test end-to-end:** open an invoice link for a `quote_sent` booking → click "Pay Deposit" → choose % → Yoco test checkout (requires `worker/.dev.vars` with `YOCO_SECRET_KEY=sk_test_*` + `supabase start`)

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

1. **Review + merge PR #1** — TASK-D deposit modal (`feature/task-d-yoco-deposit → dev`)
2. **Worker local `.dev.vars`** — copy `.dev.vars.example`, fill in `YOCO_SECRET_KEY=sk_test_*` + Supabase keys from `supabase start`
3. **Site local `.env.local`** — copy `site/.env.local.example`, fill in from `supabase start`
4. **Migration 0020** — `ALTER TYPE notification_type ADD VALUE` (blocks TASK-E)
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
- `main` — production, live at lustiqueco.co.za
- `origin/dev` — staging, ENV-RETROFIT applied
- `feature/task-d-yoco-deposit` — TASK-D, awaiting PR merge to dev

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
- `worker/src/booking/invoice.ts` — public invoice page + deposit modal (TASK-D)
- `worker/src/lib/email.ts` — email shell + all helpers
- `site/src/scripts/estimator.ts` — live estimator
- `site/public/_headers` — CSP
- `shared/pricing/` — pricing logic (single source of truth)

## ⇄ Umbrella  (project ↔ Studio Manager · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** TASK-D complete — PR #1 awaiting review. TASK-E unblocked once Pieter applies migration 0020.
**⬇ From umbrella:** *(clear)*
