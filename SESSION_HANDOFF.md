# SESSION_HANDOFF — Lustique

**Lane:** 🔵 Plan (Opus) → ready to hand to 🟢 Build (Sonnet) · **Phase:** Re-plan COMPLETE — booking flow + dashboard + Yoco + CRM + analytics + ML + SEO/security planned · **Updated:** 2026-06-18 (Opus handoff)

## 🔵 PLAN SET — switch to Sonnet (`/model sonnet`) to build, then `next`

The full re-plan is committed (4 docs below). The build lane starts at **Wave 0** — a critical, no-dependency Yoco hotfix.

## ▶ NEXT (Sonnet, Build lane)

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` · **Repo:** `github.com/Layer-Zero-Ops/lustique-site` (private)

**▶ NEXT task:** Read `docs/superpowers/plans/2026-06-18-lustique-replan-build-sequence.md` (the master sequence), then build **🔴 Wave 0 — the CRITICAL Yoco webhook hotfix**, TDD-first. It has no dependencies and no open decisions, and it unblocks real payments.

> **Why Wave 0 is critical (verified against Yoco's live docs):** the deployed webhook listens only for `checkout.succeeded`, but Yoco emits **`payment.succeeded`** — so **no real bride's payment ever auto-confirms** (the booking never advances to `deposit_paid`). The HMAC signature scheme is also wrong (uses `x-yoco-signature`+hex; Yoco uses Standard Webhooks: `webhook-signature`, base64 HMAC over `id.timestamp.body`, 3-min tolerance). (Fee handling: Lustique **absorbs** the fee — locked — so charging the net amount is correct; the only fee fix is removing the misleading "incl. card fee" copy from the site display.) The "smoke-tested 3/3" loop passed only because it POSTs a synthetic `checkout.succeeded` to the handler — it never exercised a real Yoco event. **Full detail + the fix:** spec §0.

After Wave 0: the **Wave-S launch-gating security subset** (headers, TLS, rate limits, `/api/health`, enquiry Turnstile, consent-gated GA4, Supabase Pro), then **Wave A** (corrected booking core on token-links). Only Decision #2 (review interim vs dashboard-first) gates Wave A's review changes — Decision #1 (fee model) is resolved.

## 🟦 Decisions (none block Wave 0)
See build-sequence doc §Decisions for all 7 with recommendations.
1. **Yoco fee model — ✅ RESOLVED 2026-06-18: Lustique ABSORBS the fee.** Bride pays exactly the quoted amount; no fee added; no gross-up in the live path; `business_settings.fee_model='absorb'`. (Still pending, non-blocking: verify the real Yoco rate from the portal — now only for margin reporting, not for charging.)
2. **Review step (gates Wave A)** — ship #2's per-line editing on the **interim token-link review page now** (*recommended* — corrected flow live in days), or wait for the Wave-B dashboard (~2 weeks)?

---

## The re-plan (read in this order)
- **Spec:** `docs/superpowers/specs/2026-06-18-lustique-replan-spec.md` — corrected flow + state machine, capacity soft-block (#1), payment-gating (#4), **Yoco v2 incl. the 🔴 critical bug + fees (#19) + deposit selection (#3) + failure→EFT (#6) + balance link (#5)**, churn vocab (#18), brand voice (#10). Supersedes the 2026-06-05 booking-core spec.
- **Dashboard/data plan:** `docs/superpowers/plans/2026-06-18-lustique-dashboard-data-plan.md` — dashboard review/edit/approve + reject loop + editable templates (#2/#9/#11), real-time notifications (#8), CRM + IMAP (#7/#13), analytics + data strategy (#12/#17), ML verdict (#14 → defer).
- **SEO/security/infra plan:** `docs/superpowers/plans/2026-06-18-lustique-seo-security-infra-plan.md` — #16 + cookie consent + monitoring + backups.
- **Build sequence (master):** `docs/superpowers/plans/2026-06-18-lustique-replan-build-sequence.md` — waves, migrations, effort, the 7 decisions, ▶ NEXT.

### Key planner calls (reconciling the design fan-out)
- **Status vocabulary:** add `quote_sent`/`accepted`/`rejected`/`invoice_expired`; wire dormant `cancelled`; retire `confirmed`/`expired`. **Payment failure stays on the `payments` row** (not a booking status) — keeps the lifecycle linear, retries don't bounce it.
- **Sequencing:** the corrected booking core is **dashboard-agnostic** → ships first on token-links (no auth). The dashboard (#2/#8) + CRM/analytics pull roadmap **Phase 2 forward** and make **Phase 1 auth a prerequisite** — the single biggest sequencing shift vs the original "no-auth v1" spec.
- **Notifications:** Supabase Realtime over a persistent `notifications` table (+ 60s polling heartbeat); SSE rejected (Workers can't hold sockets).
- **CRM import:** one-time re-runnable CSV, not a Sheets sync. **IMAP:** Gmail API in a scheduled Supabase Edge Function (not raw IMAP), metadata+snippet+deep-link only (POPIA), optional/last.
- **ML:** none now — SQL + transparent heuristics; revisit behind the data layer in years.

---

## Current state (as-built, pre-re-plan)
- `lustiqueco.co.za` **live** via CF Workers Assets ✅ · Worker `lustique-form-handler` deployed ✅
- Full booking→payment loop built S1–S9, **152 tests** ✅ — **BUT the Yoco webhook is broken against real events (Wave 0 fixes it)**
- 9 non-Wave Worker secrets bound ✅ · Wave keys pending
- Supabase migrations 0001–0004 applied ✅ · Brevo sender verified ✅ · Turnstile live ✅

## CI / Deploy state
- **GitHub:** `Layer-Zero-Ops/lustique-site` · Site live ✅ · Worker deployed (6+ secrets, R2, cron `0 6 * * *`) ✅
- **Supabase:** 0001–0004 applied · bank details seeded (placeholders — Zandeline fills before live)

## State (done-ledger)
- **Booking re-plan PLANNED ✅ 2026-06-18 (Opus)** — 4 docs (spec + dashboard/data + SEO/security + build-sequence) from a 14-agent code map + design fan-out. **Verified the live Yoco webhook is broken** (wrong event name + signature scheme) against Yoco docs → Wave 0 hotfix is the new ▶ NEXT. All 19 Jun-18 corrections folded into the spec/plans. Old 2026-06-05 booking-core spec superseded.
- **Live domain smoke 3/3 ✅ 2026-06-18** — `4331191`. (Note: smoke used a synthetic `checkout.succeeded`; did NOT exercise a real Yoco event — see Wave 0.)
- **S9 Invoice system ✅ 2026-06-17** — `86db29c`. Branded printable invoice, 2-year signed token. 152 tests.
- **S8 Wave integration ✅ 2026-06-17** — `67de542`. Wave GraphQL client; blocked-dates admin; migration `0004`.
- **S7b /book page ✅ 2026-06-17** — `e833b65`. sessionStorage handoff.
- **S7 Yoco payment links ✅ 2026-06-17** — `9b5a7f9`. (Webhook event/signature defects found in re-plan — Wave 0.)
- **S6b review page ✅** `7c99b26` · **S6 availability gate ✅** `089fe4f` · **Site live ✅** 2026-06-17 · **S1–S5 ✅** 89 tests + RUNBOOK.

## Pointers
- Go-live RUNBOOK: `docs/RUNBOOK-go-live.md` · Workflow: `.github/workflows/deploy-worker.yml` · Migrations: `supabase/migrations/`
- Key docs: `PLAN.md` (stale on payments/travel/CRM — see spec §8) · `PRICING.md` (money authority) · `BRAND.md` · `ARCHITECTURE.md`
- Agency-platform roadmap: `docs/ROADMAP-agency-platform.md` (the re-plan pulls Phase 2 forward; Phase 1 auth becomes a prerequisite)

## ⇄ Umbrella

**⬆ To umbrella — 🟢 SHIPPED: Booking re-plan delivered (Opus, 2026-06-18)**
Full re-plan of booking flow + dashboard + Yoco + CRM + analytics + ML + SEO/security, from a 14-agent fan-out. **Surfaced a live payment bug** (Yoco webhook never fires on real events) — Wave 0 hotfix queued as build ▶ NEXT. The re-plan confirms the agency-platform roadmap's Phase-1-auth-then-Phase-2-dashboard sequence is now a hard dependency of the corrected booking core (corrections #2/#8 pull Phase 2 forward). 7 decisions await Pieter (build-sequence doc §Decisions); none block the Wave 0 hotfix.

**⬆ To umbrella — ⚪ DECISION: Studio-wide secrets architecture** — two-tier pattern (client secrets in client Supabase vault, LZ as directory). Logged. Defer to post-launch.

**⬇ From umbrella (2026-06-18):** 🟢 SHIPPED (roadmap + Phase 0) folded into umbrella done-ledger; umbrella project state = Phase 1 as ▶ NEXT. No new requests from umbrella.
