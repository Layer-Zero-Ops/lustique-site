# SESSION_HANDOFF — Lustique

**Lane:** 🔵 Plan (Opus) · **Phase:** Re-planning booking flow + dashboard — Pieter corrections received · **Updated:** 2026-06-18 (Opus handoff)

## ▶ NEXT

**Model:** Opus · **Lane:** Plan · **Branch:** `main` · **Repo:** `github.com/Layer-Zero-Ops/lustique-site` (private)

**Secrets still to set (via `wrangler secret put`):**
- `WAVE_API_KEY`, `WAVE_BUSINESS_ID`, `WAVE_PRODUCT_ID`, `WAVE_BANK_ACCOUNT_ID` — once Wave credentials arrive

**▶ NEXT task (Opus):** Full re-plan of the booking flow and Zandeline's dashboard. Pieter has corrected several fundamental assumptions. Read the "Pieter corrections" section below before planning anything. Produce: (1) corrected booking flow spec, (2) Zandeline dashboard plan, (3) full Yoco integration plan, (4) CRM plan. Then hand back to Sonnet to build.

---

## ⚠️ Pieter corrections — SUPERSEDES earlier flow assumptions

These are business-logic corrections from Pieter (2026-06-18) that change several built assumptions. Opus must design around these; Sonnet must not build the old flow.

### 1. Availability: soft-block, not hard-block
The current system sends a 409 if a date is blocked and stops the booking. **This is wrong.**
- Every request MUST reach Zandeline regardless of date availability.
- If the date has a conflict (blocked or at capacity), Zandeline is informed in her notification — she decides whether to proceed or decline.
- The 409 hard-block stays only for truly impossible cases (if Pieter confirms one exists).
- **Multiple weddings per day are allowed** — Lustique can serve multiple clients on the same day given artist availability. Zandeline sets how many slots a given day has (1, 2, 3…). This is a capacity model, not a binary blocked/available model.

### 2. Zandeline's review → invoice edit → approve flow
Current S6b review page shows booking details + editable total. **This must be rethought:**
- Zandeline receives notification of a new request.
- She opens her dashboard (not a one-time email link), sees the request.
- The system has already generated a **proposed invoice** from the form data — line items pre-populated from the estimator.
- She does a **quality check**: can edit any line item, quantities, amounts, add/remove lines.
- Only after she's satisfied does she click **"Approve & Send"** — which sends the invoice to the bride.
- The invoice IS the quote (the estimator doubles as the quoting tool) — accuracy is critical.

### 3. Bride's acceptance + deposit selection flow
Current flow: bride receives invoice with a fixed Yoco "Pay Now" button. **This is wrong.**
- Bride receives the invoice/quote.
- She clicks **"Accept"**.
- She is presented with **3 deposit options**: 25% / 50% / 100% — each showing the exact rand amount AND the card fee for that amount.
- She selects one → Yoco checkout fires with that exact amount.
- **Date is only locked/confirmed after a successful Yoco payment** — not on invoice approval.

### 4. Date booking is payment-gated
- "Request received" does NOT secure the date. Nothing secures the date until payment clears.
- The bride receives a friendly acknowledgement ("we've received your request, Zandeline will be in touch") — NOT an "okay to proceed."
- The **"okay to proceed"** comes only after: (a) date is available, (b) payment is successful.

### 5. Balance payment — 14 days out
- If the bride paid 25% or 50% deposit, 14 days before the wedding she receives a balance reminder.
- The reminder email includes a Yoco payment link for the **exact outstanding balance**.
- This is already partially built (balance cron exists) but the Yoco link for balance is not.

### 6. Yoco failure → EFT fallback (not silent)
- If a Yoco payment fails, it must NOT be silent.
- The system detects the failure and falls back to EFT instructions.
- The bride gets a clear "payment didn't go through — here's how to pay by EFT" email.
- Zandeline gets notified of the failed payment attempt.
- Plan the exact failure detection mechanism (Yoco webhook for failed? polling? timeout?).

### 7. CRM
- Zandeline needs a CRM inside the platform.
- She has an **existing CRM** (likely Google Sheets or similar) she wants to import.
- The CRM must support: client history, contact details, past bookings, notes.
- Plan: what data model, what import mechanism (CSV? Google Sheets sync?), what views.
- Future brides who book become CRM contacts automatically.

---

### Current state

- `lustiqueco.co.za` is **live** serving the Astro site via CF Workers Assets ✅
- Worker (`lustique-form-handler`) deployed, **smoke-tested 3/3 on live domain** ✅ (`4331191`)
- **Full booking→payment loop is built** — S6 through S9 complete, 152 tests passing
- Wave integration is live-ready; all Wave calls gracefully skip if env vars absent
- Worker secrets bound: all 9 non-Wave secrets ✅ (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SIGNING_SECRET`, `BREVO_API_KEY`, `NOTIFY_EMAIL`, `TURNSTILE_SECRET`, `YOCO_SECRET_KEY`, `YOCO_WEBHOOK_SECRET`, `ADMIN_SECRET`)
- Worker secrets pending: Wave keys only (when Wave credentials arrive)

---

### Agreed full booking→payment flow (build target)

```
Bride builds estimate on /quote
  → submits "Request to Book" form
  → System checks blocked_dates table (S6 ✅)
  → If unavailable: 409 with friendly message displayed on /quote
  → If available: "request received" email to bride
                + notification to Zandeline with link to REVIEW PAGE

Zandeline opens review page (S6b)
  → sees submitted form + proposed invoice side-by-side
  → can edit line items / amounts
  → clicks "Approve & Send"
  → Wave: create customer + invoice (S8)
  → Brevo: invoice email to bride with Yoco "Pay Now" link (S7)

Bride clicks Pay Now → Yoco checkout
  → Yoco webhook → Supabase: status = deposit_paid
  → Wave: record payment (S8)
  → Brevo: booking confirmation email + calendar hold to Zandeline

14 days before: balance reminder (already built)
Balance paid → same Yoco → webhook → Wave settled → final confirmation
```

---

### Build sequence (Sonnet executes in order)

| Phase | What | Status |
|---|---|---|
| **S6** | Blocked dates availability check | ✅ done — migration + Worker 409 + 90 tests |
| **S6b** | Zandeline review page | ✅ done — `/api/booking/review` + 11 tests, email CTA updated |
| **S7** | Yoco payment links + webhook handler | ✅ done — 108 tests, commit `9b5a7f9` |
| **S7b** | `/book` page redesign | ✅ done — `e833b65`, sessionStorage handoff, mobile-verified |
| **S8** | Wave API integration + blocked-dates admin | ✅ done — 136 tests, commit `67de542` |
| **S9** | In-house invoice system | ✅ done — 152 tests, commit `86db29c` |

---

### S8 — Wave API integration (start here)

**What:** After Zandeline approves a quote on the review page, create a Wave customer + invoice and record the deposit payment when Yoco webhook fires.

**Context:**
- Wave = accounting SaaS; Lustique uses it for invoicing + bookkeeping
- S6b review page calls approve → S7 creates Yoco checkout. S8 plugs in between/after to mirror state to Wave
- Need Wave API credentials in Worker secrets: `WAVE_API_KEY` (+ `WAVE_BUSINESS_ID`)

**Steps:**
1. Add Wave API client to `worker/src/lib/wave.ts` — `createCustomer`, `createInvoice`, `recordPayment`
2. On review approve (`POST /api/booking/review`): call Wave `createCustomer` + `createInvoice`, store `wave_invoice_id` on the booking
3. On Yoco deposit webhook: call Wave `recordPayment` against the invoice
4. On balance paid webhook: call Wave `recordPayment` (balance) → invoice settled
5. Add tests for Wave client + integration points

---

## CI / Deploy state

- **GitHub repo:** `Layer-Zero-Ops/lustique-site` · HEAD: `091e274`
- **Site:** `lustiqueco.co.za` live ✅ — CF Workers Assets, `wrangler.toml` at root
- **Worker:** `lustique-form-handler` deployed ✅ — 6 secrets, R2, cron
- **Smoke test:** 3/3 on workers.dev ✅ — live domain smoke test still pending
- **Supabase:** migrations applied ✅ · bank details seeded ✅
- **Brevo:** sender verified ✅
- **Turnstile:** live key set ✅

## State (done-ledger)

- **Live domain smoke 3/3 ✅ 2026-06-18** — `4331191`. Worker secrets bound. `npm run smoke` script fixed (vitest 2.x). All 3 transitions verified on `lustiqueco.co.za`: requested→confirmed→deposit_paid→settled. Emails sent via Brevo. Phase 0 gate cleared.
- **S9 Invoice system ✅ 2026-06-17** — `86db29c`. `GET /api/booking/invoice?token=<signed>` — Lustique-branded printable invoice, line items, deposit/balance split, live payment status badge, EFT bank details, print-to-PDF button. 2-year signed token, stateless, no new DB column. Invoice link added to bride deposit email + Zandeline admin email. Works with or without Wave. 152 tests (was 136).
- **S8 Wave integration ✅ 2026-06-17** — `67de542`. Wave GraphQL client (`worker/src/lib/wave.ts`): `createCustomer`, `createInvoice`, `recordPayment`. Wired into review (on approve), yoco webhook (deposit paid), balance (settled). All calls fire-and-forget; audit-logged on failure; skipped gracefully if env vars absent. Blocked-dates admin UI (`/api/admin/blocked-dates`) with WebCrypto timing-safe auth, list/add/remove. Migration `0004_wave_fields.sql` (needs manual apply). 136 tests (was 108). Secrets needed: `WAVE_API_KEY`, `WAVE_BUSINESS_ID`, `WAVE_PRODUCT_ID`, `WAVE_BANK_ACCOUNT_ID`, `ADMIN_SECRET`.
- **S7b /book page ✅ 2026-06-17** — `e833b65`. Standalone `/book` page with sessionStorage handoff from `/quote`. Estimate summary + deposit calc shown, all fields pre-filled, Turnstile + consent on the booking page. Falls back to "Build estimate first" if accessed directly. 108 worker tests still passing.
- **S7 Yoco payment links ✅ 2026-06-17** — `9b5a7f9`. `createYocoCheckout` on review approve → `insertPayment (pending)` → bride email with Yoco Pay Now + EFT fallback. Webhook `POST /api/booking/yoco-webhook`: HMAC-SHA256 sig verify → `markPaymentPaid` → `transitionBooking confirmed→deposit_paid` → bride 'date secured' email. Idempotent + race-safe. 108 tests (was 101).
- **S6b review page ✅ 2026-06-17** — `7c99b26`. `GET/POST /api/booking/review`: full quote breakdown, editable total, approve/decline. Override total → PATCH includes recalculated deposit+balance. Email CTA updated from `/confirm` to `/review`. Old `/confirm` kept for backwards compat. 11 new tests; 101 total.
- **S6 availability gate ✅ 2026-06-17** — `089fe4f`. `blocked_dates` migration (applied) + `isDateBlocked` in db.ts + 409 gate in request handler. 90 tests.
- **Site live ✅ 2026-06-17** — `lustiqueco.co.za` serving Astro via Workers Assets. DNS on CF, Worker route `/*` set.
- **UI: deposit % hidden, Zandeline → Lustique ✅ 2026-06-17** — `091e274`
- **Root wrangler.toml ✅ 2026-06-16** — `8c28525`. Workers Assets deployment wired.
- **Smoke test 3/3 ✅ 2026-06-16** — `82fa6b0`. Full booking flow confirmed on workers.dev.
- **Worker deployed ✅ 2026-06-16** — wrangler v4, Node 22, R2, 6 secrets, cron.
- **Turnstile key live ✅ 2026-06-16** — `ddda26b`.
- **Supabase ✅ 2026-06-16** — both migrations applied, bank details seeded.
- **GitHub CI ✅ 2026-06-15** — Actions wired.
- **S1–S5 + launch-readiness ✅** — 89 tests, smoke suite, RUNBOOK.

## Booking build sequence
S1–S5 ✅ → CI ✅ → Worker ✅ → Smoke 3/3 ✅ → Site live ✅ → **S6 (availability + review page) → S7 (Yoco) → S8 (Wave) → full loop live**

## Pointers
- Go-live RUNBOOK: `docs/RUNBOOK-go-live.md`
- Workflow: `.github/workflows/deploy-worker.yml`
- Migrations: `supabase/migrations/`
- Key docs: `PLAN.md` · `BRAND.md` · `ARCHITECTURE.md`

## ⇄ Umbrella

**⬆ To umbrella — 🟢 SHIPPED (was 🟣 FABLE-REQUEST): Agency Platform roadmap delivered**

Roadmap planned + written → [`docs/ROADMAP-agency-platform.md`](docs/ROADMAP-agency-platform.md) (Opus, 2026-06-17, via a 9-agent analysis fan-out). Covers all requested scope (admin/artist/client portals · internal comms · central calendar · white-label question) as a phased plan with effort + architecture decisions.

**4 locked calls:** (1) **Auth** = Supabase Auth passwordless **magic-link** for all three audiences — one spine: admin-by-role, artist-by-join, bride-by-verified-email; Worker stays sole writer (service-role bypasses RLS), new policies read-only. (2) **White-label** = Hybrid, **deferred** — ship single-tenant-per-deploy now, extract `@lz/booking-core` only at a real client #2; multi-tenant **cut** (POPIA collapse). (3) **Comms** = Hybrid `messages` thread + Brevo fan-out, concierge-not-chat. (4) **Calendar** = native-on-Supabase first, Google sync deferred.

**Pieter input (this session):** bride portal access = magic link authenticated by booking email, required to reach her mini-dashboard — locked as decision AP-1 (overrides the analysis's capability-URL-only lean).

**Sequence:** Phase 0 (go-live sign-off = the current ▶ NEXT smoke test) → 1 auth/RLS spine → 2 admin console → 3 bride portal (parallelizable) → 4 artist portal+allocation → 5 comms → 6 white-label (triggered). ~24–36 build-days Phases 1–5 + ~3–4 d artist onboarding.

**Open decisions for Pieter** (see roadmap §9): go-live gate · staging vs prod DB for the auth migration · one lane vs two · legacy-route fate · white-label trigger · AXIS stays out of the sequence.

> Build lane unaffected — Phase 0 of this roadmap **is** the current ▶ NEXT (live-domain smoke test). No change to the build baton.

**⬆ To umbrella — ⚪ DECISION: Studio-wide secrets architecture**
Two-tier pattern (client secrets in client Supabase vault, LZ as directory). Already logged. Defer to post-launch.

**⬇ From umbrella:** ⚪ DECISION (secrets architecture) received + folded into umbrella planning agenda 2026-06-16.
**⬇ From umbrella (2026-06-18):** 🟢 SHIPPED folded — roadmap + Phase 0 cleared logged in umbrella done-ledger. Umbrella project state updated to Phase 1 as ▶ NEXT. No new requests from umbrella.
