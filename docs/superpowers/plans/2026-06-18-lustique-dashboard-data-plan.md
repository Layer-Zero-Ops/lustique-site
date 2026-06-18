# Lustique Re-Plan — Dashboard, CRM, Analytics, Data & ML

**Status:** PLAN · Opus planning · 2026-06-18
**Covers:** deliverable 2 (dashboard + real-time + analytics), deliverable 4 (CRM incl. IMAP), deliverable 5 (analytics system), deliverable 6 (ML) · corrections #2, #7, #8, #9-surface, #11, #12, #13, #14, #17, #18-funnel.
**Reads with:** the core spec (`specs/2026-06-18-lustique-replan-spec.md`) and the build sequence (`plans/2026-06-18-lustique-replan-build-sequence.md`).

> **The single biggest sequencing fact:** everything in this doc assumes Zandeline is *logged in*. Corrections #2/#8 (dashboard review + real-time notifications) and the CRM/analytics views pull **roadmap Phase 2 (Admin Dashboard) forward into the booking core** and make **roadmap Phase 1 (Supabase Auth magic-link + read-only RLS spine) a hard prerequisite** — where the original spec deliberately deferred auth. The corrected *booking core* (spec doc) ships first on the existing signed-token email-link mechanism, **without** auth; this dashboard/data layer comes after the Phase-1 spine. See the build sequence for the wave breakdown.

**Preserved guardrails (every item below honours them):** Worker stays sole writer (service-role bypasses RLS; new RLS is **read-only** for `authenticated`); money only through `@lustique/pricing`; R2 + `audit_log` on every state change; comms = Lustique brand voice; client-owned Supabase, `af-south-1` preferred.

---

## A. Zandeline's Dashboard (deliverable 2 · #2, #9-surface, #11)

### A.0 Core decision — do NOT extend the token-link `review.ts`; build behind Phase-1 auth
The current approve flow is a stateless, single-use email-link page that edits **one number** ("Final total"). #2 ("she opens her dashboard, not a one-time email link") + #9 (bride reject loop) + #11 (editable templates) cannot live on a stateless link. **Build the dashboard behind Supabase Auth magic-link (`profiles.role='admin'`)** and re-home review/approve into authenticated `/api/admin/*` endpoints. `review.ts`'s token page stays as a **no-session fallback** until the dashboard is proven, then retires alongside legacy `/confirm`.

> **✅ Decision #2 = INTERIM (Pieter, 2026-06-18):** Zandeline gets #2's *per-line editing* on the **extended token-link review page in Wave A** (token-gated, ships in days), so the corrected flow doesn't wait the ~10–14 build-days for auth + the dashboard. The `quote_revisions` table + server-side recompute + the line-item editor + extended Approve & Send are built once in Wave A; **Wave B re-homes the same editing logic behind the logged-in dashboard** (the "her dashboard, not a link" experience #2 describes) — only the auth wrapper changes (review-token → admin session), the editing core and money paths are reused (re-tested through the session). The `/api/admin/quote/*` endpoints in §A.2 are the Wave-B re-home of the Wave-A token-gated editor.

### A.1 Information architecture — 7 views (left rail, "what's waiting on her" first)

| # | View | Purpose | Primary data |
|---|------|---------|--------------|
| 1 | **Inbox / Requests** (home) | Pipeline board `requested → quote_sent → accepted → deposit_paid → settled`; `requested`+`quote_sent` columns = waiting on her. Each card: bride, date, town, party size, **capacity-conflict flag** (#1), rejection badge, **repeat-bride badge** (CRM). Realtime new-request highlight (#8). | `bookings`, `countBookingsOnDate`, `rejections`, `contacts` |
| 2 | **Request detail + Invoice editor** | The heart (#2). Booking facts + the **proposed invoice** with editable line items (label/qty/unit/amount, add/remove). Live deposit+balance recompute. Audit trail, payment rows, rejection-feedback panel. Approve & Send / Decline / Save draft. | `bookings`, `quote_lines`, `quote_revisions`, `payments`, `audit_log`, `rejections` |
| 3 | **Sent quotes** | Approved-emailed, not yet accepted/paid; quote age, accept/reject state, resend, nudge/expire (#18 drop-off). | `bookings (quote_sent)`, `quote_revisions` |
| 4 | **Payments** | Deposits + balances, Yoco vs EFT, paid/pending/**failed** (closes the #6 silent-failure visibility gap). Mark-EFT-received actions re-homed here. | `payments` |
| 5 | **Rejections** | Every bride reject + reason + free-text, grouped (price/date/other); "Re-quote" → reopens editor. | `rejections` ⋈ `bookings` |
| 6 | **Calendar** | Month view coloured by **load vs capacity** (#1, reuses `countBookingsOnDate`). Capacity/slots management re-homed off `ADMIN_SECRET` onto the admin role. | `bookings`, `date_capacity` |
| 7 | **Templates** | Edit the editable emails (full-pay check-in #11 + invoice-sent / accept-receipt / reject-ack / nudges). Subject + body, `{{token}}` palette, live preview, send-test-to-self. | `message_templates` |

### A.2 Proposed-invoice editing — data model + endpoints (#2)
What already exists: `request.ts` recomputes server-authoritatively and persists `result.lines` as `bookings.quote_lines` (jsonb) — **the proposed invoice already exists at request time.** Gap = per-line editing UI + write-back + audit history.

```sql
-- richer line shape stored in bookings.quote_lines (keeps invoice.ts/emails unchanged):
--   { id, label, qty, unit_cents, amount_cents, kind:'service'|'travel'|'discount'|'custom', source:'estimator'|'manual' }
CREATE TABLE quote_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  rev int NOT NULL,                       -- 1 = original estimator-generated
  lines jsonb NOT NULL,
  total_cents int NOT NULL,               -- server-recomputed, never trusted from client
  deposit_pct int, deposit_net_cents int, balance_net_cents int,
  edited_by uuid REFERENCES profiles(id), -- null = system (rev 1)
  note text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, rev)
);
ALTER TABLE quote_revisions ENABLE ROW LEVEL SECURITY;  -- deny-all; admin read policy; service-role writes
```
`rev 1` written at request time. Endpoints (admin-only, `current_role()='admin'`):
- `GET /api/admin/bookings?status=` · `GET /api/admin/booking/:id`
- `PATCH /api/admin/quote/:id` — save lines; Worker **recomputes** every `amount_cents = qty*unit_cents` and `total = Σ amounts` (never trusts client total), re-runs `splitDeposit`, writes a `quote_revisions` row + updates `bookings`, `writeAudit('quote.edited')`. Status unchanged (editing ≠ approval).
- `POST /api/admin/quote/:id/approve` — T1 `requested→quote_sent`; mint bride **accept**+**reject** tokens; send invoice email w/ both buttons; fire-and-forget Wave invoice; `writeAudit('quote.approved')`.
- `POST /api/admin/quote/:id/decline` (admin decline, distinct from bride reject) · `POST /api/admin/quote/:id/requote` (clone latest rev into editable draft after a bride reject).

**Money invariant:** recompute uses `@lustique/pricing` only; the deposit-selection page (spec §4.2) charges the **net** slice — Lustique absorbs the Yoco fee (locked, spec §4.1), so no gross-up. Line edits never bypass `splitDeposit`.

### A.3 Reject + re-quote loop (#9)
```sql
CREATE TABLE rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  quote_rev int,
  reason text NOT NULL CHECK (reason IN ('price','date','other')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz, resolution text   -- 'requoted' | 'closed' | null
);
ALTER TABLE rejections ENABLE ROW LEVEL SECURITY;
```
Flow: bride invoice email → **Accept** / **Reject** (signed `accept`/`reject` tokens; GET render-only, POST mutates). Reject → hosted reason form (radio price/date/other + free-text) → `POST /api/booking/reject` → insert `rejections` → T4 `quote_sent→rejected` → friendly ack (editable template) → Zandeline notification (#8) + badge in Inbox + Rejections view. Re-quote → editor reopens, Save bumps `rev`, Approve → T5 `rejected→quote_sent` with fresh tokens; prior rejection resolved. **Yes, Zandeline can re-quote** — reject feedback is structured data (feeds #12 "price is the recurring objection").

### A.4 Editable templates (#11) — `message_templates`, not hardcoded, not `business_settings`
```sql
CREATE TABLE message_templates (
  key text PRIMARY KEY,            -- 'full_pay_checkin'|'invoice_sent'|'accept_receipt'|'reject_ack'|'nudge_1'|'nudge_2'|'invoice_closing'|'balance_reminder'
  name text NOT NULL, subject text NOT NULL, body_html text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  send_offset_days int,            -- 14 for the check-in (null = event-driven)
  updated_by uuid REFERENCES profiles(id), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
```
Seed with current copy (behaviour unchanged day one). Worker renders by reading the row + substituting `{{tokens}}`; **if a row is missing/`enabled=false`, fall back to a seeded in-code default** so a bad edit can never break sending. **Full-pay check-in (#11):** `fullPayCheckInSweep` selects `settled` + `deposit_pct=100` + 14 days out + `checkin_sent_at IS NULL`, renders `full_pay_checkin`, stamps. Zandeline edits the wording in the Templates view; the cron reads the DB row at send time — no wording in Worker code. Edit UX: subject + body editor + `{{token}}` palette + **live preview** + **send-test-to-me** (Brevo); `PATCH /api/admin/template/:key`, `writeAudit('template.edited')`; helper text reminds her the voice is "The Lustique team."

### A.5 Real-time notifications (#8) — Supabase Realtime over a persistent table
**Recommendation: Supabase Realtime (Postgres Changes) subscribed from the dashboard client, backed by a `notifications` table the Worker writes to — with a 60s polling heartbeat as a safety net.** It is the only option satisfying all five constraints at once: persistence is free (rows ARE the store; the channel only carries *new* rows — "she must not miss something offline" is solved by the table existing, not the transport); deep-link is a column; zero extra cost on free tier; it rides the Phase-1 auth/RLS spine (Realtime enforces the same RLS as PostgREST); and it never makes the Worker hold a socket (the Worker just does one extra fire-and-forget INSERT at the same seams as `writeAudit`).
- **SSE is eliminated** on a hard constraint (CF Workers can't hold cheap long-lived connections). **Polling** is the correct *fallback* (same table-as-truth, one-function swap) — switch if Realtime proves flaky on her network or hits free-tier connection limits.

```sql
CREATE TYPE notification_type AS ENUM
  ('booking_requested','deposit_paid','payment_failed','balance_paid','invoice_rejected','invoice_expired');
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient text NOT NULL DEFAULT 'admin',   -- 'admin' now; profiles.id/role after Phase 1 (text = forward-compatible)
  type notification_type NOT NULL,
  title text NOT NULL,                        -- pre-rendered headline (row is self-describing)
  body text, link text NOT NULL,              -- relative dashboard path (e.g. /admin/bookings/<id>)
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, -- amount, reject_reason, same_date_count, ...
  read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recipient_unread_idx ON notifications (recipient, created_at DESC) WHERE read_at IS NULL;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
```
Emit via a `worker/src/booking/notify.ts` `insertNotification()` helper (sibling to `audit.ts`), fire-and-forget **after a successful `transitionBooking`** (0-row race → skip; idempotency inherited, not re-invented). Seams: `request.ts` (new-row only — reuse the `:218` dedupe guard; conflict rides in `payload`), `yoco.ts` (deposit + new failed branch), `confirm.ts` mark-paid, `balance.ts` settled, new reject handler, expiry/failure crons. UX: mount loads the persisted backlog (`order=created_at.desc&limit=50` — *this* is the persistence guarantee); Realtime prepends new rows + bumps badge + soft toast (quiet-luxury, respects `prefers-reduced-motion`); click deep-links + marks read. Conflict/payment-failed rows carry the burgundy accent.
**Auth ride:** v1 (no auth) — anon-read policy `using (recipient='admin')` (safe: rows carry only a first name + relative link; dashboard sits behind `ADMIN_SECRET`); mark-read routes through a tiny `ADMIN_SECRET`-gated Worker shim. Phase 1 — swap the read policy to `authenticated` + admin role (Realtime auto-enforces it, **zero client change**), mark-read becomes a direct authenticated PATCH (delete the shim). Worker stays sole inserter. Per-artist feeds come free later via the `recipient` column (AP-4).
> **Decision (Pieter):** is v1 anon-read on `notifications` acceptable, or route reads through the Worker too? (See build sequence.) Notifications are a dashboard feature — can ship pre-auth with anon-read, or defer to the Phase-1 wave.

### A.6 Roadmap fit
This **is** roadmap Phase 2, fused into the booking core by #2/#8/#11, hard-depending on Phase 1 (Supabase Auth magic-link, `profiles`, read-only RLS, Brevo SMTP for magic links — retires the shared `ADMIN_SECRET`). New RLS (`quote_revisions`, `rejections`, `message_templates`, `notifications`, `contacts`) is **read-only for `authenticated`**; Worker keeps writing as service-role — no existing route/test changes. Each policy ships with a positive + negative test (the POPIA tripwire: an artist/bride session must read **none** of `rejections`/`payments`). Re-homed money paths get **re-tested through the session entry point** (reuse hides re-verification).

---

## B. CRM + IMAP (deliverable 4 · #7, #13)

**Sequence (honest):** core re-plan → Phase 1 → Phase 2 dashboard → **CRM (build first, lower risk, high value)** → **IMAP (last, optional, highest POPIA risk — re-justify against actual need).**

### B.1 CRM contacts model
Today bride identity is denormalized onto every `bookings` row; a repeat bride = duplicate rows with no link.
```sql
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL, email text NOT NULL, phone text,
  notes text, tags text[] NOT NULL DEFAULT '{}', source text,
  lifecycle text NOT NULL DEFAULT 'lead' CHECK (lifecycle IN ('lead','enquiry','booked','past-client','archived')),
  first_seen_at timestamptz NOT NULL DEFAULT now(), last_booking_at timestamptz,
  origin text NOT NULL DEFAULT 'booking' CHECK (origin IN ('booking','enquiry','import','manual')),
  consent_at timestamptz, marketing_opt_in boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX contacts_email_uniq ON contacts (lower(email));
CREATE INDEX contacts_tags_idx ON contacts USING gin (tags);
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;  -- deny-all; Worker sole writer; admin read policy

ALTER TABLE bookings ADD COLUMN contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;
```
Decisions: **`lower(email)` is the natural key** (phone too unreliable in SA); **`tags text[]`** (GIN) over a join table (YAGNI at this volume); **single `notes` field** now, promote to a dated `contact_notes` table only if she asks (do **not** abuse `audit_log` for human notes); `lifecycle` (coarse funnel) is distinct from per-event `bookings.status`. **Keep `bride_*` on the booking row** as an immutable snapshot (POPIA record-of-processing + invoices must not change if the contact later edits their name); `on delete set null` so deleting a contact never deletes financial history.

**Auto-contact** (#7 "future brides become contacts automatically"): add `upsertContactFromBooking()` in `db.ts`, called fire-and-forget after a *successful non-duplicate* `insertBooking` (reuse the `request.ts:218` dedupe guard). PostgREST upsert `on_conflict=email, resolution=merge-duplicates` — **omit `notes`/`tags`** from the payload so merge never clobbers Zandeline's curated fields; then PATCH `bookings.contact_id`. **Enquiries:** `/api/enquiry` writes nothing today and has **no consent capture** — only create enquiry-contacts *after* a consent checkbox is added to the `/quote` enquiry form (POPIA). Until then, contacts come only from bookings (which capture `consent_at`).

### B.2 Import — one-time (re-runnable) CSV, NOT ongoing Sheets sync
Recommendation: `POST /api/admin/contacts/import` (admin-session gated — file uploads in a query string are unacceptable; **not** the URL-token `ADMIN_SECRET`). Upload CSV → column-map + dedupe preview (new vs email-match) → confirm → batched upsert as `origin:'import'`, `lifecycle:'past-client'|'lead'`. Idempotent (merge on email) so messy-first/clean-reimport is safe. **Why one-time over sync:** at go-live the platform becomes system-of-record (future brides auto-flow in) — a bidirectional Sheets sync creates dual-writer conflicts (dashboard note vs Sheet cell), needs the Sheets API + an always-on poller the Worker can't host, and muddies the POPIA record-of-processing. Offer a manual "re-import CSV" button for the 90% of "sync" value at 5% of cost.

### B.3 CRM views (in the Phase-2 console)
Contacts list (search/filter by lifecycle/tag/source) → contact detail drawer (editable fields; **booking history** via the `contact_id` FK = "past bookings"; notes; source/first-seen/consent provenance block; later: email threads + payment ledger). Repeat-bride badge on the pipeline board (reads `contacts.last_booking_at`/count — near-zero cost, high value). Optional manual contact create (`origin:'manual'`) for phone/DM enquiries. Lean — a solo-operator CRM, not Salesforce.

### B.4 IMAP / email integration (#13) — Gmail API, NOT raw IMAP; scheduled Supabase Edge Function
The constraint is decisive: a CF Worker cannot hold a long-lived IMAP connection. The inbox is `info@lustiqueco.co.za` on **Google Workspace** — which changes the recommendation:
- **Gmail API via OAuth** (refresh token, revocable, scoped — no stored password) with **incremental `history.list`+`historyId` sync** (fetch only changes), running in a **scheduled Supabase Edge Function** (`email-sync`, poll every ~5–15 min via Supabase cron). Gmail API is HTTP request/response → fits serverless perfectly; raw IMAP's only advantage (IDLE push) is the thing the stack can't host anyway, so IMAP buys nothing and would force a new always-on VPS nobody wants to own.
- **Sending replies:** Gmail API `send` (threads correctly into her real Sent folder). Brevo stays the transactional rail; Gmail API is only for human replies as the team.
- **Match** From/To against `contacts.email`/`bookings.bride_email` → surface in dashboard.

```sql
-- migration only if IMAP ships:
CREATE TABLE email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_thread_id text NOT NULL UNIQUE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  subject text, last_message_at timestamptz,
  snippet text,                 -- short preview ONLY, never full body
  participants text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_sync_state ( id int PRIMARY KEY DEFAULT 1 CHECK (id=1), last_history_id text, last_synced_at timestamptz );
```
**POPIA (the high-risk piece):** store **thread metadata + a short snippet only, and deep-link to Gmail** for full content (`https://mail.google.com/mail/u/0/#all/<threadId>`) — the platform never becomes a second copy of her inbox (the single most important decision here). Gmail scope `readonly` (+`send` only when replies are built); refresh token in Supabase Vault, never a table; retention sweep (purge threads for `settled`/`declined` bookings after N months); `af-south-1`; audit every sync. If full in-platform reply threads are ever required, the POPIA burden rises sharply — re-justify then.

---

## C. Analytics system + Data-collection strategy (deliverables 5 · #12, #17)

**Architecture — three layers, derived-views-first (no event duplication where SQL suffices):**

- **Layer 1 — derived SQL views** over existing `bookings`/`payments`/`audit_log`. Most of #12 is a `GROUP BY`, computed on read, zero new write path, always consistent with source. Recommended views:
  - **View A — conversion funnel:** counts/ratios across `requested → quote_sent → accepted → deposit_paid → settled` vs terminal `rejected`/`declined`/`invoice_expired`, by month. (#12 conversion, #18 drop-off.)
  - **View B — revenue:** `deposit_paid`/`settled` totals by month/quarter, average booking value, deposit-tier (25/50/100) breakdown, Yoco-vs-EFT split. (#12 revenue/AOV/deposit-choice.)
  - **View C — date-demand heatmap:** requests + paid bookings per wedding-date/month/season, plus declined/at-capacity counts. (#12 popular dates; #17 peak-surcharge/capacity input.)
  - **View D — lead temperature** (heuristic, §D): per live booking, a `CASE`-based warm/cool tag from date-set / party-size / estimate-total / source / time-since-request.
- **Layer 2 — new columns** (carry intent onto the row, queried by Layer 1): `source` + `utm_*` (close the #17 attribution gap — see below), `decline_reason`, `rejections.reason`/`detail`, capacity fields, `invoice_expired_at`, time-stamps already added in the spec. Additive, RLS untouched.
- **Layer 3 — one thin consent-gated firehose** for the *pre-row anonymous* funnel only (page/estimator behaviour that never becomes a booking): **Cloudflare Web Analytics** (cookieless RUM, no banner needed — traffic + Core Web Vitals from day one) **+** a `POST /api/track` → `funnel_events` table (consent-gated; estimator-step reached, service added/removed, proceed-to-book clicked), with a **nightly rollup** in the existing cron so the raw table stays small. Only build Layer 3 once Layers 1–2 are live and a specific funnel question needs pre-row data.

### #17 data-collection table (every point tied to a revenue lever)

| Data point | What's collected | Where stored | Dashboard surface | Action enabled |
|---|---|---|---|---|
| Enquiry→booking funnel | state timestamps per booking | Layer-2 cols → View A | Funnel view + drop-off step | Find the biggest conversion leak; target nudges |
| Estimator usage | services selected/removed, proceed clicks | Layer-3 `funnel_events` (consent-gated) | Estimator-insights panel | Package design, pricing, upsell curation |
| Date-demand heatmap | request + paid + declined per date/month | View C | Calendar heatmap | Peak surcharge (rule), capacity planning |
| Deposit-tier selection | `deposit_pct` chosen | `bookings` → View B | Revenue view | Cash-flow planning |
| Rejection reasons | reason + free-text | `rejections` | Rejections view (grouped) | Re-quote; product feedback ("price" recurring) |
| Source attribution | `source`/`utm_*` | Layer-2 cols → View A/B | Source-conversion panel | Spend where it converts |
| Repeat clients / referrals | `contact_id` link + count | `contacts` | Repeat-bride badge | Loyalty / referral programs |
| Time-to-decision | `requested_at → accepted_at/paid_at` | derived | Funnel/lead views | Tune nudge timing by season/source |
| Artist allocation | `booking_artists` (Phase 4) | join table | Artist-load view | Balance utilisation |

**#17 attribution gap (close in Wave A):** the `source` field exists on `/quote` and flows in the **enquiry** path, but `booking-request.ts` does **not** serialise `source` into sessionStorage and `book-page.ts` never POSTs it — so a bride who goes `/quote → Proceed to book` submits with **no source attached**. Fix: carry `source` (+ any `utm_*`) through sessionStorage → `book-page.ts` POST → `request.ts` persist.

**Dashboard:** an Analytics tab reads the views via the Worker behind the Phase-1 admin session (depends on auth, like everything here). Numbers Zandeline sees: conversion %, revenue by month/quarter, AOV, deposit-tier mix, popular dates heatmap, rejection-reason breakdown, source-conversion, no-show/declined rates.

---

## D. ML recommendation (deliverable 6 · #14)

**Headline: build essentially no ML now. SQL + transparent heuristics capture ~90% of the value at ~5% of the cost.** A single business at launch volume (tens-to-low-hundreds of bookings/yr) lacks the data density to train or validate a model — and won't for years. ML is a "revisit at scale" decision, not a launch feature; the data layer (§C) is its prerequisite — build that and let it accumulate.

| Use-case | Verdict | Why / alternative |
|---|---|---|
| Lead scoring | **SKIP → heuristic** | A 5-line `CASE` (date set, party size, estimate built, source=referral, time-to-decision) ranks leads transparently today; she trusts a rule she can read, not a black box on 80 rows. → View D. |
| Pricing optimisation | **HARD NO** | Violates the locked "deterministic component sum, firm From-R, no dynamic pricing." The only lever is a **rule-based peak-date surcharge** the heatmap reveals — a config flag, not a model. |
| Demand forecasting | **DEFER** | Seasonality is eye-readable from View C after one full year; a model on <2 seasons overfits. Revisit after 2–3 years; a seasonal average likely suffices. |
| Churn / drop-off prediction | **DEFER → heuristic now (highest value)** | #18: the real "churn" is pre-payment drop-off = a conversion problem. A **timed nudge rule** (spec §5: +3d/+7d/close) recovers revenue now; a classifier adds nothing a deadline rule doesn't catch. |
| Upsell recommendations | **SKIP → rule** | "Brides who added X added Y" needs volume Lustique won't have; instead hand-curate 2–3 gentle, brand-voiced suggestions from estimator-usage data. |

**Minimal-viable first step (explicitly not ML):** the **lead-temperature view (D) + the nudge sequence** (already in spec §5, reusing the #11 editable-template mechanism). It pays off immediately *and* accumulates the labelled outcomes (tag vs converted) a future model would need. The only honest ML on-ramp — *if*, after 2–3 years, the heuristic visibly mis-ranks — is an offline-trained logistic-regression lead score run as a scoring function, **never inside the money path**. Future decision, not a launch one.
