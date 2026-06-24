# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Invoice & UX overhaul · **Updated:** 2026-06-24

---

## ▶ NEXT (Sonnet, fresh session — BUILD)

**Model:** Sonnet · **Lane:** Build · **Branch:** `main`

**▶ NEXT: TASK-D remainder — Yoco "Pay Now" deposit selection (after EFT confirmed working end-to-end).**

TASK-D/reject ✅ done (commit d91756e) — invoice decline flow live on invoice page.

---

## ✅ BUG-1 — DONE (commit d6958c8)

**What broke:** When Zandeline clicks "Generate Invoice" on a Forms enquiry, a booking is created with `quote_lines` populated from `enquiry.details`. The booking invoice renderer (`worker/src/booking/dashboard.ts`) expects `quote_lines` as `{label: string, amount: number}` pairs (cents), but enquiry `details` are stored as `{label: string, value: string}` string pairs. Result: every line shows "R NaN" in the invoice view.

**Screenshot evidence:** Booking `LUS-2026-A94320` for Zandeline Kemp — all SERVICE rows show "R NaN".

**Fix approach:** In `handleAdminGenerateInvoice` (in `worker/src/booking/enquiries.ts`), set `quote_lines: []` (empty array) instead of `e.details`. The invoice total (`total_cents`) is correctly set from `parseTotalCents(e.estimate)`. The proper line-item structure will come from the new estimation breakdown work below (TASK-A). Once TASK-A is done, quote_lines from the estimator will have the right `{label, amount}` shape. For now: empty lines, correct total.

**Files to touch:**
- `worker/src/booking/enquiries.ts` — `handleAdminGenerateInvoice`: change `quote_lines: Array.isArray(e.details) ? e.details : []` → `quote_lines: []`

---

## ✅ TASK-A — DONE (commit d6958c8)
Pricing engine emits separate "X Makeup × N" / "X Hair Styling × N" lines. enquiry.ts computes and stores them as kind="service" entries in enquiry.details at submit time.

## ✅ TASK-B — DONE (commit d6958c8)
Admin enquiry detail splits details into info rows + styled Quote Breakdown table. Backward-compat: old enquiries without kind="service" entries still render as flat key-value.

---

## 🟠 TASK-A — Granular quote breakdown (site estimator) [archived detail]

### What Pieter said
"On the estimation/quote breakdown, I don't want you to list 'Bridesmaid look x2'. I want a more detailed breakdown like: 'Bridesmaid Makeup x2', 'Bridesmaid Hair Styling x2', 'Mother Makeup x1', 'Mother Hair Styling x1', 'Guest Makeup x2', 'Guest Hair Styling x2' etc."

### Screenshot context
Screenshot 4 (08:26) shows the current quote form output on the website:
- Bride (medium) ← combined look
- Bridesmaids ×2 ← combined look
- Mother ×1 ← combined look
- Guest ×2 ← combined look
- Flower girl (under 12) ×2 ← combined look
- Additional artist ×1
- Promo discount
- Estimated total: from R 9 270

The desired output splits each "look" into its makeup and hair lines separately.

### What needs to change

**Where the quote breakdown is generated:** `site/src/scripts/enquiry.ts` (the estimator/quote form script). The pricing logic in `shared/pricing/` drives the calculation — read it before editing to understand how party roles and service types are structured.

**Rule:** For each party member type (Bride, Bridesmaid, Mother, Guest, Flower girl), if hair styling is included → emit a separate "X Hair Styling ×N" line; if makeup is included → emit a separate "X Makeup ×N" line. Never combine into "X look ×N".

**Quote lines output shape (for both the website display AND what gets POSTed to `enquiry.details`):**
```ts
{ label: "Bridesmaid Makeup", quantity: 2, unit_cents: 85000, line_cents: 170000 }
{ label: "Bridesmaid Hair Styling", quantity: 2, unit_cents: 95000, line_cents: 190000 }
// etc.
```

When these are stored in `enquiry.details`, save them as `{label: string, value: string}` for backward compat (the value being formatted as "R X,XXX").

When the `Generate Invoice` flow is later updated (see TASK-C), these granular line items get converted to proper `{label, amount}` booking `quote_lines`.

---

## 🟠 TASK-B — Forms detail page: granular breakdown from submitted data

### What Pieter said
"On the submitted form, the one that both Zandeline sees and is used to generate an invoice, I want a similar kind of breakdown on this page, using the data submitted by the customer."

### What needs to change

**File:** `worker/src/booking/enquiries.ts` — `handleAdminEnquiryDetail`

The form detail page currently renders `e.details` as a flat list of `{label, value}` pairs in a simple table. Once TASK-A produces granular line items (Bridesmaid Makeup ×2, Bridesmaid Hair Styling ×2, etc.), those line items will arrive as structured `enquiry.details` entries.

The enquiry detail page must render them in a **styled line-item table** (not a flat key-value dump):

| Service | Qty | Unit Price | Line Total |
|---------|-----|-----------|-----------|
| Bridesmaid Makeup | 2 | R 850 | R 1 700 |
| Bridesmaid Hair Styling | 2 | R 950 | R 1 900 |
| ... | | | |
| **Estimated Total** | | | **R 9 270** |

Non-pricing fields (event date, venue, province, occasion, bride name, heard via, etc.) stay as a separate info section above the line-item table.

---

## 🟠 TASK-C — Invoice page: mimic Zandeline's Wave invoice layout

### What Pieter said
"On the invoice page, once the system has generated one. It has to mimic the look and layout of her current invoice."

### Screenshot context
Screenshot 3 (08:23) shows Zandeline's existing Wave invoice. Key layout elements:
- **Header:** Lustique Cosmetology logo top-left, "INVOICE" label top-right
- **Meta block:** Invoice #, Date, Due date (right-aligned)
- **From/To block:** Lustique Cosmetology details | Client name + contact
- **Line items table:** Description | Qty | Unit Price | Amount
  - Example: "Hair Styling Wedding Package: The Bride + 5" | 1 | R 6 000 | R 6 000
  - Example: "Bridal Trial/Preview Appointment" | 1 | R 1 200 | R 1 200
- **Subtotal / Total** (right-aligned)
- **T&Cs section** (below totals): payment terms, what's included, booking fee note, travel/accommodation policy
- **Banking details** (for EFT): bank name, account holder, account number, branch code, reference (booking ref)
- **Footer:** "Thank you for your business" or similar

### What needs to change

**File:** `worker/src/booking/invoice.ts` — the public-facing invoice page (`GET /api/booking/invoice?token=`)

Rebuild the HTML to match the Wave layout above. Use Lustique's brand colours (burgundy / rose / cream). The T&Cs and EFT banking details must appear on every invoice.

**EFT details to embed (get from Zandeline / confirm with Pieter before committing values — use placeholders until confirmed):**
```
Bank: [Bank Name]
Account Holder: Lustique Cosmetology
Account Number: [XXXX]
Branch Code: [XXXX]
Reference: [booking reference, e.g. LUS-2026-A94320]
```

**Pieter action required:** Confirm/supply EFT banking details for the invoice template.

Also update `worker/src/booking/dashboard.ts` — the admin booking detail invoice preview should use the same layout (or link to the public invoice page).

---

## 🟠 TASK-D — Yoco "Pay Now" button on invoice (LATER — after EFT confirmed working)

### What Pieter said
"Once we're confident that the Yoco payment process works correctly, we can then add a dedicated 'Pay Now' button to the invoice."

### Spec

**Trigger:** Customer clicks "Pay Now" on invoice page.

**Popup:** Deposit selection modal — three options:
- 25% of invoice total (R X,XXX)
- 50% of invoice total (R X,XXX)
- 100% of invoice total (R X,XXX)

**T&Cs note:** As per booking terms — reference the PRICING.md deposit policy.

**Also in popup:** "Reject" button → triggers rejection flow (see below).

**On "Proceed":** Selected amount → Yoco payment link generated → link presented to customer in the popup (or redirect to Yoco checkout page).

**Rejection flow ("Reject" button):**
- Customer clicks "Reject"
- Modal asks: "Please let us know why you're declining this invoice" (text area)
- Customer clicks "Submit"
- System: marks booking status → `rejected`; sends Zandeline a notification (dashboard + email); stores rejection reason on booking record

### Booking record changes needed for this task
- `bookings` table: add `rejection_reason text` column (new migration)
- `bookings` table: `deposit_pct` gets set when customer selects 25/50/100

### Payment outcome handling
- **Success:** Yoco webhook fires → booking moves to `deposit_paid` → customer becomes a "Client" in CRM pipeline → event date saved/confirmed in platform calendar → Zandeline gets dashboard notification
- **Failed/pending:** Payment link stored in Payments tab with outcome tracking

### Payments tab record per Yoco link
Store in a `payment_links` or `payments` table (new migration when implementing):
- `booking_id`
- `amount_cents`
- `deposit_pct_selected` (25/50/100)
- `yoco_checkout_id`
- `yoco_payment_url`
- `status` (pending/succeeded/failed)
- `created_at`

**NOTE: Do not implement TASK-D until Pieter confirms EFT flow is working end-to-end.**

---

## 🟠 TASK-E — Dashboard notifications (when anything requires Zandeline's attention)

Notification triggers that must appear in the dashboard bell (already has a bell icon — fix was applied for overflow clipping):
1. New form submission (enquiry received)
2. Invoice rejected by customer (+ rejection reason)
3. Payment received (deposit_paid webhook)
4. Balance due (approaching event date, balance not settled)
5. New contact/lead added

**Current state:** Notification bell exists in dashboard UI. The dropdown was fixed in the previous session to use `position:fixed` + `getBoundingClientRect()` so it isn't clipped by the sidebar overflow. The notification count/data backend needs to be wired up to these events.

---

## 🟠 TASK-F — Navigation cleanup (site + dashboard)

### What Pieter said
"I want you to clean up the website and dashboard's native navigation flows and pathways so that it works logically."

### Dashboard navigation audit needed

Read `worker/src/booking/dashboard.ts` in full and map every nav item, tab, and route. Things to check:
- Are all nav items working and pointing to real routes?
- Is there dead nav (pointing to 404 or placeholder pages)?
- Do tab flows make logical sense for Zandeline's workflow?
- Is the CRM pipeline (Forms → Enquiries → Clients) intuitive?

**Known issue from earlier session:** "Forms" tab shows submitted quote forms. "Invoices" tab shows bookings. These may need relabelling or merging for clarity.

### Site navigation audit needed

Read `site/src/` pages and layouts. Things to check:
- Is there dead navigation (e.g. links to `/book.html` which was deleted)?
- Does the quote form flow logically to a thank-you state?
- Are all public-facing pages reachable from the nav?
- Any orphaned pages or broken internal links?

**Known:** `book.astro` was deleted in the previous session. Ensure no nav links still point to `/book.html`.

---

## 🟠 TASK-G — Dashboard favicon: Lustique logo

### What Pieter said
"Please change the favicon of the dashboard to also be the logo of Lustique."

**What needs to change:** The admin dashboard (served from the Worker, not the Astro site) renders its own HTML shell in `worker/src/booking/dashboard.ts`. Find the `<head>` section and add/replace the `<link rel="favicon">` tag to point to the Lustique logo.

The logo is likely in `site/public/` — check for `favicon.ico`, `logo.svg`, or `logo.png`. The Worker can serve the logo from R2, or reference the public site URL directly (e.g. `https://lustiqueco.co.za/favicon.ico`).

**Check:** What does `site/public/` contain for logo/favicon assets?

---

## Previously completed this session (2026-06-24)

- ✅ TASK-D/reject: Invoice decline flow — "Decline this invoice" button on invoice page, POST /api/booking/invoice/reject, admin bell + email — commit d91756e
- ✅ TASK-E: Notification bell wired to real events (deposit_paid, balance_due, contact_added) + emoji icons in dropdown — commit eab986c
  - ⚠ PIETER: Apply migration 0020 in Supabase SQL editor (`ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'balance_due'; ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'contact_added';`)

- ✅ TASK-C: Wave-style invoice layout (logo, from/to, T&Cs, banking, footer) + `parseServiceLines()` populates `quote_lines` on Generate Invoice — `62c9eef`
- ✅ BUG-1: "R NaN" fix — `quote_lines: []` in `handleAdminGenerateInvoice`
- ✅ TASK-A: Granular quote breakdown — pricing engine emits separate makeup/hair lines; site estimator and enquiry.details now granular
- ✅ TASK-B: Admin enquiry detail — styled Quote Breakdown table from kind="service" entries
- ✅ Notification bubble overflow fix (`position:fixed` + `getBoundingClientRect()`) — `worker/src/booking/dashboard.ts`
- ✅ Quote form occasion options reduced to 2 (Wedding + Matric farewell) — `site/src/scripts/enquiry.ts`
- ✅ `book.astro`, `book-page.ts`, `booking-request.ts` deleted (orphaned "Secure your date" page)
- ✅ Migration 0019: `enquiries.booking_id` FK column — applied to Supabase
- ✅ "Generate Invoice" feature: button in Forms list + enquiry detail → creates booking from enquiry, links via `booking_id`, transitions enquiry to "converted"
- ✅ "View Invoice →" / "Generate Invoice" conditional rendering in Forms list and enquiry detail

---

## Pieter actions still open (from previous sessions)

1. **Brevo newsletter list ID** — create list in Brevo → share numeric ID → enables Task 3 (newsletter)
2. **Migration 0018** — apply `supabase/migrations/0018_public_read_policies.sql` (public read for `artists` + `portfolio_images`)
3. **CF Pages env vars** — add `SUPABASE_URL` + `SUPABASE_ANON_KEY` as Cloudflare Pages build env vars
4. **`npm install` in `site/`** — to prune Sanity from node_modules
5. **Delete `astro-portabletext-0.13.0.tgz`** from repo root
6. **Hard-refresh Safari** on quote page (Cmd+Shift+R) to clear stale "Secure your date" cache
7. ~~**EFT banking details**~~ ✅ — supplied; run `UPDATE business_settings SET value = 'Lustique Cosmetology' WHERE key = 'eft_account_holder'` in Supabase SQL editor if you want the full legal name (currently "Lustique Co." in the seed)

---

## Build order for next session

```
✅ BUG-1  → Fixed
✅ TASK-A → Done
✅ TASK-B → Done
✅ TASK-C → Invoice page layout (Wave-style) + quote_lines from enquiry service lines — commit 62c9eef
✅ TASK-G → Dashboard favicon — commit 72d13b7
✅ TASK-F → Nav audit + label cleanup (Pending/Confirmed tabs, Create Invoice, Total col) — commit 72d13b7
✅ TASK-E → Notification triggers — commit eab986c
TASK-D → Yoco "Pay Now" button (LAST — after EFT confirmed working)
```

---

## Current state (as-built, 2026-06-24)

### Worker (`lustique-form-handler`) — on `main`
- Booking flow end-to-end ✅
- Admin dashboard: Bookings / Clients / Content / Admin nav ✅
- Calendar with occasion badges, slot editor ✅
- Forms tab: enquiry list + detail + "Generate Invoice" button ✅
- Enquiries CRM: list + detail + status + "View Invoice →" when booking linked ✅
- Contacts: read + Add individual / CSV import ✅
- Portfolio: gallery + artist filter + image ordering ✅
- Blog: CRUD ✅
- Calendar feed: `/api/calendar.ics?key=ICAL_KEY` ✅

### Supabase migrations applied (0001–0019)
- 0019: `enquiries.booking_id` FK ✅ (applied 2026-06-24)
- ⚠ 0018: public read policies — **NOT YET APPLIED**

### Site (Cloudflare Pages — auto-deploys from `main`)
- Public site live at `lustiqueco.co.za` ✅
- ⚠ Pages show real data only after migration 0018 + CF Pages env vars are set

---

## Key files
- `PLAN.md` · `PRICING.md` · `BRAND.md` · `ARCHITECTURE.md`
- `worker/src/booking/dashboard.ts` — admin UI shell + booking detail
- `worker/src/booking/enquiries.ts` — Forms/enquiry handlers including Generate Invoice
- `worker/src/booking/invoice.ts` — public invoice page (needs Wave-style rebuild — TASK-C)
- `worker/src/booking/db.ts` — DB helpers
- `worker/src/index.ts` — route dispatch
- `site/src/scripts/enquiry.ts` — quote estimator (needs granular breakdown — TASK-A)
- `shared/pricing/` — pricing logic (read before touching estimator)

## ⇄ Umbrella
*(clear — reconciled 2026-06-24)*
