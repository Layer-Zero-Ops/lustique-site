# Lustique Re-Plan — Master Build Sequence & Decisions

**Status:** PLAN (master) · Opus planning · 2026-06-18 · **read this to execute.**
**Inputs:** `specs/2026-06-18-lustique-replan-spec.md` (core flow/state machine/Yoco/fees/churn/voice), `plans/2026-06-18-lustique-dashboard-data-plan.md` (dashboard/CRM/analytics/ML), `plans/2026-06-18-lustique-seo-security-infra-plan.md` (#16).
**Grounding:** built on a 14-agent code map of the live worker/DB/emails/frontend/pricing/infra + the Jun-18 corrections. The Yoco webhook defect (spec §0) was verified against Yoco's live docs.

## The one organising insight
The corrected **booking core** (state machine, capacity, payment-gating, Yoco fixes, nudges) is **dashboard-agnostic** — every transition is a Worker endpoint that works on the existing signed-token email-link mechanism *today* and behind a magic-link session *later*, without re-touching the transitions. But corrections #2/#8 (dashboard review + real-time) and the CRM/analytics views require Zandeline to be **logged in** → they pull roadmap **Phase 2 (Admin Dashboard)** forward and make **Phase 1 (Supabase Auth + RLS spine)** a hard prerequisite the original spec deferred. So the work splits into waves: the core corrects first (no auth), the platform layer follows (auth-gated).

---

## Waves (dependency-ordered; TDD throughout; Worker stays sole writer)

### 🔴 Wave 0 — CRITICAL Yoco hotfix (do FIRST; no dependencies; this is ▶ NEXT)
The deployed payment webhook would never confirm a real payment (spec §0, verified). Fix before anything else; it ships on the *current* flow.
1. `0005_payment_failure.sql` — `payments.failed_at`, `payments.failure_notified_at`.
2. Fee config (🔒 **absorb model locked** — Pieter 2026-06-18): `YOCO_FEE_PCT` Worker `var` + `business_settings.fee_pct`/`fee_model` (default `absorb`); **charge net to Yoco — no gross-up** (the bride pays the quoted amount; `payable_cents = net_cents` is already correct); **remove the "incl. card fee" gross-up from the site display** (`book-page.ts:92`). `YOCO_FEE_PCT` is now a margin/reporting figure only.
3. Webhook rewrite: Standard-Webhooks signature (C-B), `payment.succeeded`/`payment.failed`/`refund.succeeded` routing (C-A), `findPaymentByYocoId` dedupe, `kind`-branched transitions.
4. `sendEftFallback` helper + bride/Zandeline failure emails (#6); `pendingPaymentSweep` cron (24h stale-pending poll).
5. Tests: keep + parameterize `payments.test.ts:26` (`grossUp` is the dormant toggle path); add **checkout-charges-net** (`amount==net`), Standard-Webhooks verify (valid/bad/stale/wrong-header), `payment.failed`→fallback idempotent.
**Gate:** capture one real Yoco test `payment.succeeded` + one `payment.failed` against the deployed webhook; verify the real Yoco rate from the portal → record it + the **absorb model** in `PRICING.md` (for margin reporting, not for charging).
**Effort:** ~2–3 build-days. **Blocks live deposits until done.**

### Wave A — Corrected booking core on token-links (no auth)
Delivers most corrections without waiting for auth. Ships the corrected flow live.
- **Capacity / soft-block (#1):** `0006` — `date_capacity` (slots), `default_slots_per_day`; `getDateAvailability`; remove the 409; `availability_conflict`; admin capacity editor.
- **State machine (spec §1):** enum adds `quote_sent`/`accepted`/`rejected`/`invoice_expired`; wire `cancelled`; new status/reason/stamp columns; `deposit_pct` nullable.
- **Bride Accept/Reject + deposit-selection (#3, #9):** new `accept`/`reject` tokens; `GET/POST /api/booking/accept` (deposit-selection page — charges **net**, absorb model, no fee line); `POST /api/booking/reject` + reason form + `rejections` table; move checkout creation to accept.
- **Payment-gating + voice (#4, #10):** reword `/booking-received`; retire legacy `/confirm`; consolidate duplicate "date secured" email; brand-voice the new emails.
- **Balance Yoco link (#5):** add to `balanceSweep`.
- **Nudges + check-in + expiry (#5/#11/#18):** `invoiceExpirySweep`, `fullPayCheckInSweep`; fix `workingDaysBefore` SA holidays. (Check-in template is hardcoded-then-editable: ship a seeded default now; becomes dashboard-editable in Wave B.)
- **Attribution + analytics columns (#17/#12):** carry `source`/`utm_*` through the booking path; `decline_reason`; Layer-1 derived views (A–D).
- **`#2` per-line invoice editing — ✅ Decision #2 = INTERIM (Pieter, 2026-06-18):** extend the token-link review page to **per-line editing** now (not waiting for the dashboard). Build here: the `quote_revisions` table + server-side recompute (via `@lustique/pricing`) + the line-item editor UI + extended **Approve & Send**, all **token-gated** (the existing review-token mechanism). Wave B re-homes the *same* editing logic behind the admin session (`/api/admin/quote/:id`) — auth wrapper changes, editing core is reused, no rework.
**Effort:** ~6–9 build-days. **Output: the fully corrected booking flow live, on email-link mechanics — including per-line invoice editing.**

### Wave B — Auth + Dashboard (roadmap Phase 1 + Phase 2)
- **Phase 1 spine:** `0005_identity_and_allocation` (per roadmap — `profiles`, `booking_artists`, helpers), Supabase Auth magic-link, Brevo SMTP, **read-only** RLS families; retires `ADMIN_SECRET`. (~4–6 d)
- **Phase 2 dashboard:** the 7 views; **re-home the Wave-A per-line invoice editor behind the session** (#2 as specified — "her dashboard, not a link"; reuse the `quote_revisions` logic, swap token-gate → admin-session, re-test money paths); `message_templates` + Templates view (#11 fully editable); `notifications` + Supabase Realtime (#8); Rejections/Payments/Calendar/Analytics views. (~6–8 d)
**Effort:** ~10–14 build-days. Depends on Wave A. (All gating decisions resolved; Decisions #3/#5 are operational confirmations within this wave.)

### Wave C — CRM + IMAP (after dashboard)
- **CRM (#7):** `contacts` + `bookings.contact_id`; `upsertContactFromBooking`; CSV import (admin-session); CRM views + repeat-bride badge. (~3–4 d)
- **IMAP (#13, optional, re-justify):** Gmail API + OAuth incremental sync in a scheduled Supabase Edge Function; metadata+snippet+deep-link only (POPIA). (~4–6 d, **gated on Decision #6**)

### Wave D — Data Layer-3 + heuristics (incremental, alongside B/C)
Cloudflare Web Analytics + consent-gated `POST /api/track`→`funnel_events` + nightly rollup; lead-temperature view + nudge already shipped in Wave A. **No ML** (deliverable 6 verdict: defer behind the data layer).

### Wave S — SEO/Security/Infra (#16, parallelizable; several items launch-gating)
Mostly independent of the waves. **Launch-blocking subset** (do alongside Wave 0/A before live deposits): security headers, HSTS+Full-strict TLS, Supabase Pro, `/api/enquiry` Turnstile, admin+booking rate limits, `/api/health`+monitoring, consent-gated GA4. Fast-follow: Twitter meta, sitemap hygiene, CSP nonces, GBP seeding. (See SEO/security plan §8.)

---

## Migration sequence (recommended; Sonnet finalises numbers at build)
`0005_payment_failure` (Wave 0) → capacity/status `0006_capacity_and_status` (Wave A) → analytics/attribution `0007` (Wave A) → **`0008_quote_editing`** (`quote_revisions` + `rejections`, **Wave A** — needed for the interim per-line editor + bride reject loop, per Decision #2) → Phase-1 identity `0009_identity_and_allocation` (Wave B) → dashboard tables (`message_templates`/`notifications`) `0010` (Wave B) → CRM `0011` → email `0012`. Renumber coherently when building; the **dependency order is the contract**, not the digits. (`quote_revisions`/`rejections` moved earlier — into Wave A — because Decision #2 puts per-line editing on the token page now.)

## Estimated total
Wave 0: ~2–3 d · Wave A: ~6–9 d · Wave B: ~10–14 d · Wave C: ~7–10 d · Wave S launch subset: ~2–3 d (overlaps). Trust the sequenced total (~28–40 build-days for Waves 0–C single-lane), not the additive sum — auth is shared across the dashboard/CRM.

---

## 🟦 DECISIONS FOR PIETER (with recommendations)
Decisions #1 and #2 (the two that gated the early build) are **resolved**; #3–#7 are operational confirmations for later waves and don't block Wave 0/A.

1. **Yoco fee model (#19)** — ✅ **RESOLVED (Pieter, 2026-06-18): Lustique ABSORBS the fee (Model B).** The bride pays exactly the quoted amount; no fee added; no gross-up in the live path. Built as `business_settings.fee_model='absorb'` (toggle retained for reversibility). **Still pending (not blocking):** verify the real Yoco rate from the portal — now only for margin reporting (what Lustique pays), not for what the bride is charged.
2. **Review step: interim or dashboard-first?** — ✅ **RESOLVED (Pieter, 2026-06-18): INTERIM.** Ship #2's per-line editing on the **extended token-link review page now** (in Wave A, token-gated; corrected flow live in days). Wave B re-homes the *same* editing logic behind the logged-in dashboard ("her dashboard, not a link") — auth wrapper changes, editing core reused, no rework. `quote_revisions`/`rejections` move into the Wave-A migration accordingly.
3. **Migration test target** — the auth migration + enum additions touch the live `bookings` table. Test on a **Supabase branch/staging** first, or apply directly to prod (`af-south-1`)? *Recommend staging branch first.*
4. **Supabase Pro timing** — launch-gating before the first live deposit (backups; you own the billing as Responsible Party). Confirm the upgrade + region.
5. **`notifications` pre-auth read** — allow anon-read on the `notifications` table in v1 (dashboard sits behind `ADMIN_SECRET`; rows carry only a first name + relative link), or route reads through the Worker too? *Recommend anon-read v1* (tightens to `authenticated` in Phase 1, zero client change). Or defer notifications entirely into the Wave-B auth wave.
6. **IMAP (#13)** — build it, or defer/drop? *Recommend defer to optional Wave C and re-justify against real need* (high POPIA exposure; Gmail-API-in-an-edge-function is the only stack-fitting shape if you do build it).
7. **Enquiry-form consent** — to let `/api/enquiry` create CRM lead-contacts, the `/quote` enquiry form needs a consent checkbox (POPIA). Add it? *Recommend yes* (also unblocks enquiry-funnel analytics); until then contacts come only from bookings.

---

## ▶ NEXT (for the build lane / Sonnet)
**Wave 0 — the CRITICAL Yoco webhook hotfix** (spec §0). It has no dependencies and no open decisions, and it unblocks real payments. Build it TDD-first, then the Wave-S launch-gating security subset, then Wave A. **Both early-gating decisions are resolved** — #1 fee model = **absorb**, #2 review = **interim per-line editing on the token page** — so Wave A is fully unblocked. Decisions #3–#7 are operational confirmations for Wave B/C.

## Secrets still pending
Wave keys only (`WAVE_API_KEY`, `WAVE_BUSINESS_ID`, `WAVE_PRODUCT_ID`, `WAVE_BANK_ACCOUNT_ID`) — when Wave credentials arrive. New: `YOCO_FEE_PCT` is a **var**, not a secret. Supabase Auth (Wave B) needs Brevo SMTP wired for magic links.
