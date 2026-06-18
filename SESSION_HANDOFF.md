# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Site live — full booking→payment loop verified on production · **Updated:** 2026-06-18 (Sonnet, S10 smoke)

## ▶ NEXT

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` · **Repo:** `github.com/Layer-Zero-Ops/lustique-site` (private)

**Secrets still to set (via `wrangler secret put`):**
- `WAVE_API_KEY`, `WAVE_BUSINESS_ID`, `WAVE_PRODUCT_ID`, `WAVE_BANK_ACCOUNT_ID` — once Wave credentials arrive

**▶ NEXT task:** Agency Platform — Phase 0 gate is cleared. Advance to Phase 1: Supabase Auth magic-link spine + RLS updates. Read `docs/ROADMAP-agency-platform.md` §3 for the plan.

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
