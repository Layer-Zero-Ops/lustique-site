# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Booking flow build · **Updated:** 2026-06-23

## ▶ NEXT (Sonnet, fresh session — BUILD)

**Model:** Sonnet · **Lane:** Build · **Branch:** `main`

**Mission:** Build the direct deposit-invoice flow. Execute the plan task-by-task (TDD).

- **Plan (ordered task list):** `docs/superpowers/plans/2026-06-23-booking-flow-direct-invoice-plan.md`
- **Spec (source of truth, every "why"):** `docs/superpowers/specs/2026-06-23-booking-flow-direct-invoice.md`

**One-line summary:** rebrand the existing "quote" flow as a **deposit invoice** — button
becomes "Send Deposit Invoice", bride gets ONE "Secure your date" link, picks **25% or 50%**
(rand amounts shown) → Yoco. **No migration, no new enum, no webhook/query changes** — only
labels, copy, the email template, and `reject.ts` → 410 stub. `forms.ts` send-quote is OUT
OF SCOPE (it's the enquiry composer).

**Pre-flight (non-blocking):** ask Pieter for `SELECT status, COUNT(*) FROM bookings GROUP BY
status` — informational only; the change is back-compat.

---

## 🔵 PLAN SET — Opus decision (2026-06-23, booking flow)

**Chosen: Option A (reframe), reusing the existing `quote_sent` / `accepted` states.**

Pieter confirmed the **bride still picks her deposit** (sees 25% & 50% in rands, ticks one →
that amount feeds the Yoco link). A payment link needs a fixed amount, so the choice page
*must* survive — and that page already does `quote_sent → accepted → Yoco webhook →
deposit_paid`. The state machine Pieter described **already exists**; it was only mis-named
"quote". So we rebrand the label, not the plumbing: no `invoice_sent` enum (it would churn 50
refs across 12 files for an enum string the bride never sees), no migration, no webhook change.
Full rationale + file-by-file list in the spec.

---

### TASK 1 — Scrap Sanity + UI polish ✅ DONE (2026-06-23, commits `dd43743`–`e94d744`)

All Sanity code replaced with Supabase REST queries. Dashboard polished. Thank-you page redesigned.

**Pieter actions still required before production works:**
1. Apply migration 0018 (`supabase/migrations/0018_public_read_policies.sql`) — public read for `artists` + `portfolio_images`
2. Add `SUPABASE_URL` + `SUPABASE_ANON_KEY` as CF Pages env vars
3. Run `npm install` in `site/` to prune Sanity
4. Delete stray `astro-portabletext-0.13.0.tgz` from repo root
5. **Quote page "Secure your date" still showing on live site** — code is already removed (commit `6d7db05`), but CF Pages deployment may be stale. Hard-refresh Safari (Cmd+Shift+R) or retrigger CF Pages deploy.

---

## ▶ TASK 2 — Booking Flow Simplification (Opus to plan, Sonnet to build)

### The business reality (Pieter, 2026-06-23)

> "The estimator doubles as the quote. When a client submits the booking form, they've already seen what it costs. If Lustique is available for their date, they receive an invoice (Yoco payment link) to secure the booking. There is no separate quote step."

### Current state machine (as built)

```
requested
  → [Zandeline clicks "Send Quote" in admin]
  → quote_sent   (bride gets email with "Accept" + "Reject" token links + printable invoice link)
  → accepted     (bride clicks Accept → redirected to Yoco checkout)
  → deposit_paid (Yoco webhook fires)
  → settled      (Zandeline clicks "Mark Balance Paid")

  OR: quote_sent → rejected (bride clicks Reject)
```

### Intended state machine

```
requested
  → [Zandeline reviews in admin — confirms available]
  → [Zandeline sends Yoco payment link directly]
  → deposit_paid
  → settled
```

### Key codebase facts (read before planning)

**DB schema** (`supabase/migrations/0001_booking_core.sql` + `0006_capacity_and_status.sql`):
```sql
-- Original enum:
create type booking_status as enum (
  'requested', 'confirmed', 'deposit_paid', 'settled', 'declined', 'cancelled', 'expired'
);
-- Added in 0006:
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'quote_sent';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'accepted';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'invoice_expired';
```

**Key files:**
- `worker/src/booking/admin-actions.ts` — `handleAdminSendQuote()` (lines 148–240): signs accept/reject/invoice tokens, transitions `requested → quote_sent`, sends two emails (bride + Zandeline).
- `worker/src/booking/accept.ts` — handles `GET /api/booking/accept?token=` → redirects to Yoco checkout
- `worker/src/booking/reject.ts` — handles `GET /api/booking/reject?token=` → marks `rejected`, sends email
- `worker/src/booking/yoco.ts` — Yoco payment link generation
- `worker/src/booking/token.ts` — `signActionToken` / `verifyActionToken` (HMAC-SHA256, action-scoped)
- `worker/src/booking/dashboard.ts` — admin booking detail UI (renders "Send Quote" button)
- `worker/src/booking/forms.ts` — Forms tab "Send Quote" button → `/api/admin/forms/:id/send-quote`
- `worker/src/booking/invoice.ts` — `GET /api/booking/invoice?token=` — printable invoice page
- `worker/src/booking/quotes.ts` — Quotes tab pipeline (shows `requested` + `quote_sent`)
- `worker/src/booking/db.ts` — `transitionRequestedBooking()` — the DB update that guards transitions

**The Manual Quote Composer** (`/api/admin/quotes/new`) is a separate flow for CRM enquiries (not bookings). It sends a free-form email to a lead — this is UNRELATED to booking status and must remain unchanged.

### What Opus must decide

**The core question:** What does Zandeline actually do after reviewing a booking to say "yes, I'm available, here's your payment link"?

**Option A — Minimal (repurpose "Send Quote" → "Send Invoice"):**
- Rename the admin button and action to "Send Deposit Invoice"
- Skip accept/reject token links in the email
- Include the Yoco payment link directly (pre-generate it at send time)
- Transition: `requested → invoice_sent` (new enum value) → Yoco webhook → `deposit_paid`
- Add DB migration: `ALTER TYPE booking_status ADD VALUE 'invoice_sent'`
- The old `quote_sent` / `accepted` / `rejected` values become dead (data compat — existing rows stay valid, new bookings never hit them)
- `accept.ts` and `reject.ts` become orphaned routes (can be kept as 410 stubs or removed)

**Option B — Additive (keep "Send Quote" for custom pricing, add new path for standard):**
- Keep existing Send Quote flow as-is for non-standard jobs
- Add a "Send Deposit Invoice" button that skips the quote step
- Two paths: quote → accept → deposit | or direct → deposit
- More UI complexity; more code; but preserves backward compat with any existing `quote_sent` bookings

**Option C — Yoco-first (Pieter generates the Yoco link manually, pastes it into an email):**
- No code change to the booking flow
- Build a "Generate Yoco Link" helper in the admin that produces a shareable URL
- Zandeline copies it into a manual email or WhatsApp message
- Simplest for code, but worst UX for Zandeline

### Constraints Opus must respect

1. **Postgres enum values can only be added, never removed** — any existing values (`quote_sent`, `accepted`, `rejected`) stay in the schema forever. Plan accordingly.
2. **Token security** — if the new flow still uses a Yoco link, verify whether it should be time-limited and whether the booking ID should be embedded.
3. **The `accept.ts` / `reject.ts` routes must either be kept (even as 410 stubs) or gracefully handle tokens that were issued before the change.** There may be zero live bookings in `quote_sent` state right now — check via: `SELECT status, COUNT(*) FROM bookings GROUP BY status` (ask Pieter to run this if needed).
4. **Yoco link expiry** — Yoco payment links expire. The admin needs to know if a link has expired so they can regenerate it.
5. **No new npm packages** in worker (uses wrangler, native fetch only).
6. **Sonnet builds in one session** — the plan must be granular enough that each file change is unambiguous.

### What the Opus output must include

1. **Chosen option** + one-paragraph rationale (why this option, what it gains, what it gives up)
2. **New state machine diagram** (text is fine: `requested → invoice_sent → deposit_paid → settled`)
3. **DB migration** — exact SQL for new enum value(s) if needed
4. **Email template spec** — what the new "deposit invoice" email shows (Yoco link CTA, amount, date, cancellation note)
5. **Admin UI changes** — which buttons change, what the booking detail page looks like in each status
6. **File-by-file change list** for Sonnet (file path, what changes, what stays)
7. **Build sequence** — ordered task list for Sonnet so nothing breaks mid-build
8. **Test strategy** — which existing tests break, what new tests are needed

---

### TASK 3 — Newsletter lead magnet (Sonnet build, after booking flow)

The Guides page "Send it to me" button is a dead link (`<a href="#">`). Brevo supports contact lists — we already have the API key.

**What needs to happen:**
1. **Pieter:** Create a contact list in Brevo (Contacts → Lists → New list, name "Lustique Newsletter"). Copy the list ID (a number, e.g. `3`).
2. **Sonnet builds:** `worker/src/booking/newsletter.ts` — `POST /api/newsletter` endpoint that calls `POST https://api.brevo.com/v3/contacts` with `{ email, listIds: [LIST_ID] }`. Add route in `index.ts`. Add `BREVO_NEWSLETTER_LIST_ID` secret to wrangler + CF.
3. **Sonnet updates:** `site/src/pages/guides.astro` — wire the form with a `fetch('/api/newsletter', ...)` call. Show success/error inline.

**No new npm packages. No Turnstile needed (low-value form — rate-limit by IP in worker if wanted).**

---

### TASK 4 — Pieter actions still open

1. **Brevo newsletter list ID** — create list, share ID → enables Task 3
2. **Real artist emails** — collect from Zandeline, update `artists` table (currently `firstname@lustiqueco.co.za`)
3. **GA4 Measurement ID** — swap `G-XXXXXXXXXX` in `site/src/data/site.ts`
4. **CF Email Routing** — `info@lustiqueco.co.za` forward → upgrade to "Send to Worker" once Email Inbox is built
5. **iCal subscriptions** — share `https://lustiqueco.co.za/api/calendar.ics?key=<ICAL_KEY>` with Zandeline + artists
6. **E2E smoke test** — submit a test booking on the live site, trace through to admin dashboard
7. **DB status check** — run `SELECT status, COUNT(*) FROM bookings GROUP BY status` in Supabase SQL editor. Share with Opus — it needs to know if any live bookings are in `quote_sent` state.

---

## Current state (as-built, 2026-06-23)

### Worker (lustique-form-handler) — latest commits on `main`
- All booking flows live ✅
- Admin dashboard: Bookings / Clients / Content / Admin nav ✅
- Calendar with occasion badges, slot editor ✅
- Quotes tab: `requested` + `quote_sent` pipeline ✅
- Manual Quote Composer: `/api/admin/quotes/new` ✅
- Forms unified inbox + Send Quote flow ✅
- Contacts: read + Add individual / CSV import ✅
- Enquiries CRM: list + detail + status update ✅
- Portfolio: gallery + artist filter + image ordering ✅
- Blog: CRUD (create, edit, draft/publish) ✅
- Calendar feed: `/api/calendar.ics?key=ICAL_KEY` ✅

### Supabase migrations applied (0001–0017)
- 0016: `blog_posts` ✅
- 0017: `portfolio_images` ✅
- ⚠ 0018: public read policies — **NOT YET APPLIED**

### Site (Cloudflare Pages — auto-deploys from `main`)
- Public site live at `lustiqueco.co.za` ✅
- Sanity scrapped — Supabase queries across all dynamic pages ✅
- ⚠ Pages show real data only after migration 0018 + CF Pages env vars are set

### Known backlog (not blocking go-live)
- **Email Inbox** — CF Email Routing + `email` event handler + `/api/admin/email` tab
- **Testimonials** — no table; index.astro is static placeholder
- **Brevo custom SMTP** — auth emails still from `noreply@mail.app.supabase.io`

---

## Key files
- `PLAN.md` · `PRICING.md` · `BRAND.md` · `ARCHITECTURE.md`
- `docs/superpowers/specs/` — booking core spec, replan spec
- `docs/RUNBOOK-go-live.md`

## ⇄ Umbrella
**⬆ To umbrella — 🟢 SHIPPED: Booking flow design locked (Opus, 2026-06-23)**
Booking-flow decision made: Option A reframe (deposit invoice, reuse `quote_sent`/`accepted`,
no migration). Spec + Sonnet plan written under `docs/superpowers/`. ▶ NEXT: Sonnet builds it.
