# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Site live — building to full booking→payment flow · **Updated:** 2026-06-17 (Sonnet)

## ▶ NEXT

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` · **Repo:** `github.com/Layer-Zero-Ops/lustique-site` (private)

---

### Current state

- `lustiqueco.co.za` is **live** serving the Astro site via CF Workers Assets ✅
- Worker (`lustique-form-handler`) deployed, smoke-tested 3/3 ✅
- Basic booking request → Zandeline confirm/decline → EFT mark-paid flow works ✅
- S6 availability gate ✅ — blocked_dates migration + `isDateBlocked` + 409 handler + tests
- **Missing to reach full booking→payment loop:** S6b (review page), S7 (Yoco), S8 (Wave), /book page

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
| **S7** | Yoco payment links + webhook handler | ▶ NEXT |
| **S7b** | `/book` page redesign | pending |
| **S8** | Wave API integration | pending |

---

### S7 — Yoco payment links (start here)

**What:** Replace the EFT deposit flow with a Yoco payment link. When Zandeline approves on the review page, instead of emailing EFT details, the Worker creates a Yoco payment link for the deposit amount and emails it to the bride. When the bride pays, Yoco fires a webhook → Worker updates status to `deposit_paid`.

**API:** Yoco Checkout API (not the old Yoco SDK). Secret key is `YOCO_SECRET_KEY` (already a Worker secret). Webhook secret is `YOCO_WEBHOOK_SECRET`.

**Steps:**
1. `POST https://payments.yoco.com/api/checkouts` — create checkout with `amount`, `currency: "ZAR"`, `successUrl`, `cancelUrl`, `metadata: { bookingId, reference }`
2. Store `yoco_checkout_id` on the booking row (migration needed: add `yoco_checkout_id TEXT`)
3. Webhook handler: `POST /api/booking/yoco-webhook` — verify signature, handle `checkout.succeeded` event → transition `confirmed → deposit_paid` → email bride confirmation
4. Update review page approve path: create Yoco link instead of emailing EFT details; email bride the Yoco checkout URL
5. Re-enable deposit % selector in the site (hidden in `091e274`)

**Note:** keep EFT path as fallback for clients who prefer bank transfer — discuss with Pieter before removing.

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
