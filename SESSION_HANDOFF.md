# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Site live — full booking→payment loop built, pending Wave credentials · **Updated:** 2026-06-17 (Sonnet, S8)

## ▶ NEXT

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` · **Repo:** `github.com/Layer-Zero-Ops/lustique-site` (private)

**Immediate unblock needed from Pieter:**
1. Apply `supabase/migrations/0004_wave_fields.sql` in Supabase dashboard SQL editor (adds Wave columns — 2 SQL statements)
2. Once Wave developer access is approved: add 4 Worker secrets via `wrangler secret put`: `WAVE_API_KEY`, `WAVE_BUSINESS_ID`, `WAVE_PRODUCT_ID`, `WAVE_BANK_ACCOUNT_ID`
3. Set `ADMIN_SECRET` via `wrangler secret put ADMIN_SECRET` — unlock `/api/admin/blocked-dates` admin page
4. **Get WAVE_PRODUCT_ID**: Zandeline must create a "Bridal services" product in Wave > Products & Services; copy its ID

**▶ NEXT task (once Wave is configured):** live domain smoke test on `lustiqueco.co.za` → end-to-end booking flow verification

---

### Current state

- `lustiqueco.co.za` is **live** serving the Astro site via CF Workers Assets ✅
- Worker (`lustique-form-handler`) deployed, smoke-tested 3/3 ✅
- **Full booking→payment loop is built** — S6 through S8 complete, 136 tests passing
- Wave integration is live-ready; all Wave calls gracefully skip if env vars absent

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

**⬆ To umbrella — 🟣 FABLE-REQUEST: Lustique Agency Platform roadmap**

Pieter wants a roadmap planned in parallel while Sonnet builds the booking→payment loop.

**Vision:** Full agency management platform for Lustique Co. (and reusable as a studio template for future clients).

**Scope to plan:**
- Artist portal — personal dashboard, assigned weddings schedule, bride comms, availability management
- Client portal — post-booking onboarding, invoice/payment history, direct comms with assigned artist + agency
- Admin dashboard (Zandeline) — central calendar, artist coordination, availability insights, all bookings
- Internal comms layer — agency ↔ artists ↔ clients (replaces ad-hoc WhatsApp/email)
- Central calendar — bookings + artist availability in one view

**Reusability question:** should this become a Layer Zero Studios white-label SaaS template (deployable per client), or stay Lustique-specific? Pieter wants to explore both.

**Foundation already exists:** Supabase schema (bookings, audit_log, business_settings), Worker API, signing tokens, R2 audit log. Build on top, don't replace.

**Output wanted:** a phased roadmap (what to build in what order, rough effort per phase) + architecture decisions (auth layer for portals, comms strategy, calendar solution). Save as `docs/ROADMAP-agency-platform.md` in the Lustique repo.

**⬆ To umbrella — ⚪ DECISION: Studio-wide secrets architecture**
Two-tier pattern (client secrets in client Supabase vault, LZ as directory). Already logged. Defer to post-launch.

**⬇ From umbrella:** ⚪ DECISION (secrets architecture) received + folded into umbrella planning agenda 2026-06-16.
