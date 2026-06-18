# Lustique Booking Re-Plan — Corrected Core Spec

**Status:** SPEC · Opus planning · 2026-06-18
**Supersedes:** large parts of `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md` (see "Conflicts resolved" below)
**Authority:** Pieter's 2026-06-18 corrections (`SESSION_HANDOFF.md` §§1–19) win over the as-built S6–S9 flow.
**Companion docs:** `plans/2026-06-18-lustique-dashboard-data-plan.md`, `plans/2026-06-18-lustique-seo-security-infra-plan.md`, `plans/2026-06-18-lustique-replan-build-sequence.md` (the master sequence + decisions for Pieter — read that one to execute).

This spec covers the corrected **booking flow + state machine** (deliverable 1), the full **Yoco integration v2** (deliverable 3), **Yoco fees** (#19), **churn vocabulary** (#18), and the **brand-voice** audit (#10). Dashboard/CRM/analytics/ML/SEO live in the companion plans.

---

## 0. 🔴 CRITICAL — the live payment webhook is broken (do this first, Wave 0)

Verified against Yoco's live developer docs (2026-06-18), three load-bearing defects exist in the *currently deployed* `worker/src/booking/yoco.ts`:

| ID | Defect | Current code | Reality (verified) |
|----|--------|--------------|--------------------|
| **C-A** | Wrong event name | Handles only `checkout.succeeded` (`yoco.ts:105`); all else 200-noop | Yoco emits **`payment.succeeded`** and **`payment.failed`** (+ `refund.succeeded`). The current handler **never fires on a real payment** → bookings never auto-advance to `deposit_paid`. |
| **C-B** | Wrong signature scheme | `"sha256=" + hex(HMAC(rawBody))` vs header `x-yoco-signature` (`yoco.ts:46`) | Yoco uses **Standard Webhooks**: header **`webhook-signature`** (`v1,<base64>`, strip the `v1,`), signed content **`${webhook-id}.${webhook-timestamp}.${rawBody}`**, **base64** HMAC-SHA256, **3-minute** timestamp tolerance. Secret is dispatched `whsec_`-prefixed (Standard-Webhooks convention — confirm key handling against the portal when registering). |
| **C-C** | Fee never grossed-up server-side | Worker passes the **net** deposit to Yoco (`review.ts:338`); `payable_cents` wrongly = `net_cents` (`review.ts:342-343`). `grossUp` runs only in site display (`book-page.ts:92`). | Lustique silently absorbs the card fee on every real transaction, contradicting both spec §8 and the site copy "incl. card fee". |

**Why the "smoke-tested 3/3" loop passed anyway:** the smoke test POSTs a synthetic `checkout.succeeded` to the handler — it validates the handler against its own wrong assumption, never against a real Yoco event. C-A/C-B mean no real bride's payment would confirm.

**Sources:** [Yoco — Verifying events (Standard Webhooks)](https://developer.yoco.com/online/api-reference/webhooks/verifying-events/) · [Yoco — Successful payment (`payment.succeeded`)](https://developer.yoco.com/online/api-reference/webhooks/events/successful-payment/) · [Yoco — Successful refund (`refund.succeeded`)](https://developer.yoco.com/online/api-reference/webhooks/events/successful-refund/)

**Gate before any live deposit:** capture one real Yoco test `payment.succeeded` AND one `payment.failed` against the deployed webhook; confirm signature passes and state advances/falls-back. Verify `YOCO_FEE_PCT` from the portal and record it + date in `PRICING.md`.

---

## 1. Status state machine (canonical — reconciled)

### 1.1 Vocabulary

The DB enum `booking_status` (`0001:5`) is `requested, confirmed, deposit_paid, settled, declined, cancelled, expired`. Postgres enums are **additive only** (you can `ALTER TYPE ... ADD VALUE` but not cheaply remove), so unused values stay physically present and harmless.

**Canonical set after the re-plan:**

| Status | Meaning | Date secured? | Change |
|--------|---------|:---:|--------|
| `requested` | Enquiry in Zandeline's queue | ❌ | keep |
| `quote_sent` | Zandeline approved + sent the invoice; bride must Accept/Reject | ❌ | **ADD** (was the first half of `confirmed`) |
| `accepted` | Bride hit Accept + chose deposit %; payment pending (Yoco or EFT) | ❌ | **ADD** (was the second half of `confirmed`) |
| `rejected` | Bride hit Reject + gave a reason; in queue for re-quote or close | ❌ | **ADD** |
| `deposit_paid` | Deposit cleared — **★ DATE SECURED ★**; balance outstanding | ✅ | keep |
| `settled` | Fully paid (balance cleared, or 100% upfront) | ✅ | keep |
| `declined` | Zandeline declined the request | — | keep (+ `decline_reason`) |
| `cancelled` | Post-payment cancellation (rare) | — | **WIRE** the dormant value (#18) |
| `invoice_expired` | Quote/pay link sent, bride silent after the nudge sequence | — | **ADD** (replaces the never-set `expired`) |

**Retired (remain in enum, never written by new code):** `confirmed` (split into `quote_sent`+`accepted`), `expired` (replaced by `invoice_expired`).

### 1.2 Decision: payment failure is NOT a booking status

The booking-flow designer proposed a `payment_failed` booking status; the Yoco designer argued against it. **Resolution (planner's call): failure lives on the `payments` row, not the booking.** A failed/abandoned card attempt does not change the fact that the bride has *accepted* and a payment is *outstanding* — the booking stays `accepted`; the `payments` row carries `status='failed'` (+ `failed_at`, `failure_notified_at`). This keeps the booking lifecycle linear, lets her retry without the booking bouncing states, and matches the existing two-vocabulary design (`bookings.status` enum vs `payments.status` text+CHECK, which already allows `failed`/`expired`). The `payment_failed` *notification/event* still exists; it just doesn't mutate `bookings.status`. This also honours #4 structurally — failure can never advance state because it touches a different table.

### 1.3 Transition table (all via the existing guarded `transitionBooking(id, fromStatus, patch)` — `db.ts:196`, atomic compare-and-set, race-safe)

| # | From → To | Trigger | Endpoint | Side effects |
|---|-----------|---------|----------|--------------|
| T0 | (insert) → `requested` | Bride submits | `POST /api/booking/request` | row insert; **friendly ack** (no held-date language); Zandeline notification w/ capacity-conflict flag; auto-upsert CRM contact (see data plan) |
| T1 | `requested` → `quote_sent` | Zandeline approves + sends (after line-item QA) | review/approve endpoint | `quote_sent_at`; bride invoice email w/ **Accept**/**Reject** |
| T2 | `requested` → `declined` | Zandeline declines | review/decline endpoint | `declined_at`, `decline_reason`; gentle bride email |
| T3 | `quote_sent` → `accepted` | Bride clicks **Accept** + picks deposit % | `POST /api/booking/accept` | `accepted_at`, `deposit_pct`, recomputed `deposit_net_cents`/`balance_net_cents`; Yoco checkout + pending `payments` row; pay email |
| T4 | `quote_sent` → `rejected` | Bride clicks **Reject** + reason | `POST /api/booking/reject` | `rejected_at`; insert `rejections` row; Zandeline notification |
| T5 | `rejected` → `quote_sent` | Zandeline re-quotes | review/approve | new `quote_sent_at`; new Accept/Reject email; resolve prior rejection row |
| T6 | `rejected` → `declined` | Zandeline closes | review/decline | `declined_at` |
| T7 | `accepted` → `deposit_paid` | Yoco `payment.succeeded` (deposit) **OR** Zandeline marks EFT received | yoco-webhook **OR** `POST /api/booking/mark-paid` | `deposit_paid_at`; **"date secured 🎉"** email — the *only* "okay to proceed" (#4) |
| T8 | `deposit_paid` → `settled` | balance cleared (Yoco `payment.succeeded` kind=balance) **OR** EFT marked | yoco-webhook **OR** `mark-balance-paid` | `settled_at`; "fully paid 🎉" email |
| T9 | `quote_sent`/`accepted` → `invoice_expired` | bride silent; nudge sequence exhausted | cron `invoiceExpirySweep` | `invoice_expired_at`; "closing the file" email (#18c) |
| T10 | `deposit_paid`/`settled` → `cancelled` | Zandeline records a cancellation | `POST /api/booking/cancel` | `cancelled_at`, `cancel_reason`, `deposit_disposition`, `refund_cents`, `cancel_policy_applied` (#18b) |

**100%-upfront variant:** at T3 the bride picks 100% → `balance_net_cents = 0` (existing `splitDeposit`). On payment, the webhook lands her in `deposit_paid` then immediately `settled` (branch when `balance_net_cents == 0`). She skips the balance reminder and instead gets the warm 14-day check-in (#11, see data plan).

**Payment failure (no booking transition):** Yoco `payment.failed` (or 24h stale-pending poll) → mark the `payments` row `failed` → EFT-fallback email to bride + notify Zandeline (#6). Booking stays `accepted`. Bride can retry (new checkout, new pending row) or pay EFT (Zandeline marks paid → T7).

### 1.4 Schema additions

- **Enum:** `ALTER TYPE booking_status ADD VALUE 'quote_sent'|'accepted'|'rejected'|'invoice_expired'` (additive, safe).
- **`bookings` columns:** `availability_conflict text`, `quote_sent_at`, `accepted_at`, `rejected_at`, `payment_failed_at`(optional mirror), `decline_reason text`, `cancelled_at`, `cancel_reason text`, `deposit_disposition text`, `refund_cents int`, `cancel_policy_applied text`, `invoice_expired_at`, `nudge_1_sent_at`, `nudge_2_sent_at`, `invoice_closing_sent_at`, `checkin_sent_at`. **Make `deposit_pct` nullable** (or default) — it is now set at T3 (accept), not at request. (`confirmed_at`/`declined_at`/`deposit_paid_at`/`settled_at` already exist, `0001:35-38`.)
- **`payments` columns:** `failed_at timestamptz`, `failure_notified_at timestamptz`. (`status` CHECK already allows `failed`/`expired` — no change.)
- **`business_settings` keys:** `default_slots_per_day`, `nudge_1_days` (3), `nudge_2_days` (7), `close_days` (10), `cancellation_policy_text`, `fee_pct`, `fee_model`.

---

## 2. Capacity model — soft-block, multiple weddings/day (#1)

**Remove the 409 hard-block.** Today `handleBookingRequest` (`request.ts:158-164`) returns 409 if `isDateBlocked` (`db.ts:271`, existence-only check) is true. Replace with an **informational capacity check** — every request reaches Zandeline.

### 2.1 Schema (migration)
Repurpose `blocked_dates` → capacity (recommend renaming the table to `date_capacity` to kill the binary mental model):
```sql
ALTER TABLE blocked_dates
  ADD COLUMN IF NOT EXISTS slots INT NOT NULL DEFAULT 1 CHECK (slots >= 0);
-- row absent → use business_settings.default_slots_per_day
-- slots = 0   → date marked closed (still SOFT — request still reaches her, flagged)
-- slots = N   → N wedding slots that day
INSERT INTO business_settings (key, value) VALUES ('default_slots_per_day','1')
  ON CONFLICT (key) DO NOTHING;
```
Existing blocked dates migrate to `slots = 0`.

### 2.2 Helpers (`db.ts`)
- `getDateCapacity(env, date) → number` — per-date `slots` or the default.
- Update `countBookingsOnDate` (`db.ts:232`): exclusion filter becomes the **non-consuming** set `(declined, cancelled, invoice_expired, rejected)`; add a `paidOnly` mode counting only `(deposit_paid, settled)`.
- `getDateAvailability(env, date) → { capacity, paidBookings, liveBookings, isHardClosed, isAtCapacity }`.

### 2.3 The gate becomes informational
```
const avail = await getDateAvailability(env, weddingDate, fetchImpl);
const conflict =
  avail.isHardClosed ? "date_marked_closed" :
  avail.paidBookings >= avail.capacity ? "at_capacity" :
  avail.liveBookings >= avail.capacity ? "pending_demand_exceeds_slots" : null;
insertBooking({ ..., availability_conflict: conflict });  // never 409 on capacity
```
**Recommendation:** only `deposit_paid` + `settled` consume a *hard* slot; un-paid live states are warnings only (consistent with #4 — nothing is secured until payment). Zandeline's notification shows e.g. "⚠️ 3 June already has 2 paid weddings; capacity is 2 — you decide." The admin endpoint (`admin.ts:99`) becomes a capacity editor (`action=set_slots`); delete the "returns a 409" copy (`admin.ts:84`). A `409` is reserved only for a genuinely-impossible case if one is ever identified — none in the capacity dimension.

---

## 3. Payment-gating + brand voice (#4, #10)

**#4 — nothing secures the date until payment clears.** Structural rule: **only `deposit_paid` secures the date** (the ★ in §1.3). Every pre-`deposit_paid` comm says "we've received / we're holding nothing yet." Specific fixes:
- **Request ack email** (`request.ts:261`) — keep; it already ties securing to deposit. ✅
- **`/booking-received` page** (`site/.../booking-received.astro`) — currently says "your date is being held" → **VIOLATION**. Reword to a friendly ack that holds nothing.
- **Deposit/pay email** — "Pay to officially secure your date; your date won't be secured until we confirm receipt." (review.ts copy already compliant ✅ — port to the new accept-step email.)
- **Retire legacy `/api/booking/confirm`** (`confirm.ts`) — its weaker copy ("…& secure her date") and duplicate "date secured" template are a #4/#10 liability (emails audit). Consolidate the duplicate "date secured" email (`confirm.ts:269` vs `yoco.ts:166`).

**#10 — Lustique brand, not Zandeline.** Email audit result: **already passes** the literal check (no bride-facing email contains "Zandeline"; all sign "The Lustique Cosmetology Team"; sender "Lustique Co." everywhere). Remaining cleanups: (a) standardize the brand string — "Lustique Co." (sender/subjects) vs "The Lustique Cosmetology Team" (sign-off): keep both intentionally (display vs sign-off, per BRAND.md) but apply consistently; (b) all *new* emails (Accept/Reject, EFT-fallback, nudges, check-in, cancellation) must use the Lustique-team voice and the locked sign-off "Blessings, The Lustique Cosmetology Team"; (c) the editable templates (#11) carry helper text reminding Zandeline these speak as the team.

---

## 4. Yoco integration v2 (deliverable 3 · #3, #5, #6, #19)

### 4.1 Fee config (#19)
- The code constant is `YOCO_FEE_RATE = 0.029` (2.9%) at `shared/pricing/src/payments.ts:8` — **not** the "2.95%" in the correction note. Both are placeholders. **Verify the real online rate** from the Yoco Business Portal → Settings → Pricing (capture % and any per-txn component); record in `PRICING.md` with the date.
- Add **`YOCO_FEE_PCT`** as a Worker **`var`** (not secret — it's a public business number) in `worker/wrangler.toml [vars]` + `Env` (`index.ts:25`). Parse with a guard (`Number.isFinite && 0 ≤ f < 0.5`, else fall back to the package default + audit `config.fee-rate-invalid`). Set the `shared/pricing` constant to the same verified number so site display == server charge. Mirror to `business_settings.fee_pct` for display reads.
- **Fee model toggle** `business_settings.fee_model ∈ {on_top, absorb}`, default **`on_top`** (reversible without redeploy):
  - **Model A (on_top, recommended):** `gross = ceil(net / (1 − f))` → Yoco `amount = gross`; Lustique nets ~`net`. (Existing `grossUp`.)
  - **Model B (absorb):** Yoco `amount = net`; Lustique nets `floor(net × (1 − f))`.
- **Worked example, R8,000 @ f=3.5% (illustrative — re-derive at the verified rate):**

  | Deposit | net | A: bride pays `ceil(net/0.965)` | A: fee shown | B: bride pays | B: Lustique nets |
  |---|---|---|---|---|---|
  | 25% | R2,000.00 | **R2,072.54** | R72.54 | R2,000.00 | R1,930.00 |
  | 50% | R4,000.00 | **R4,145.08** | R145.08 | R4,000.00 | R3,860.00 |
  | 100% | R8,000.00 | **R8,290.16** | R290.16 | R8,000.00 | R7,720.00 |

  Useful invariant under both models: the chosen split never changes the bride's total or Lustique's fee cost (25%+balance == 100%).
- **Recommendation (planner): Model A, shown softly, with EFT offered as the zero-fee alternative on the same page.** Brand mandate is "whisper, don't shout," not "hide costs"; bridal margins are thin and the fee compounds at peak season; A matches existing code + spec + site copy (least churn). **DECISION FOR PIETER/ZANDELINE** — see build-sequence doc §Decisions. Default A regardless; flip via the toggle.

### 4.2 Deposit-selection page (#3, #4)
New **Worker-rendered** page (matches `renderReviewPage`/`renderInvoicePage` so money is server-authoritative): `GET /api/booking/accept?token=` (new action-token purpose **`accept`**, TTL = invoice validity ~30d, minted at T1 alongside a **`reject`** token). Renders 3 options, each via `splitDeposit(total,pct)` then `grossUp(net, feeRate)`:
```
○ Pay 25% now   R2,072.54  (deposit R2,000 + card processing R72.54)   Balance R6,000 — link 14 days before
● Pay 50% now   R4,145.08  (deposit R4,000 + card processing R145.08)  Balance R4,000 — link 14 days before   ← suggested
○ Pay in full   R8,290.16  (R8,000 + card processing R290.16)          Nothing more to pay
   Prefer EFT? Pay by bank transfer with no card fee — [details]
```
Headline number = exactly what Yoco will charge (no checkout surprise). Voice = Lustique team; "Your date is secured the moment your payment clears" (#4). `POST /api/booking/accept {token, depositPct}` → re-verify token, re-load booking, **recompute server-side**, persist deposit fields, T3, create Yoco checkout for the **grossed** amount, 303 → Yoco `redirectUrl`. Date is *not* locked here.

### 4.3 Checkout call changes
1. **Gross up server-side** (C-C): `amount = grossUp(net, feeRate)`; persist `net_cents = net`, `payable_cents = grossUp(...)` (fixes the `review.ts:342-343` bug).
2. **Move checkout creation** out of approval (`review.ts:337-347`) into `POST /api/booking/accept` — deposit % isn't known until the bride picks it.
3. **Idempotency key includes the %**: `${bookingId}-deposit-${depositPct}` (so re-picking a different % yields a correct new checkout; mark superseded pending rows `expired` so the webhook can't later mark a stale one paid).
4. Metadata: add `kind:"deposit"|"balance"` + `depositPct` so the webhook knows which slice. `cancelUrl` → new `/payment-cancelled` page (UX only, mutates nothing).

### 4.4 Webhook rewrite (C-A, C-B, #6)
- **Signature (C-B, blocking):** Standard Webhooks — read `webhook-id`/`webhook-timestamp`/`webhook-signature`; reject if `|now − ts| > 180s`; `signed = id.timestamp.rawBody`; `expected = base64(HMAC_SHA256(signed, key))`; strip `v1,` prefix, verify against any listed version; constant-time compare; 401 on mismatch. (Verify `whsec_` key handling when registering.)
- **Event routing (C-A):**
  ```
  payment.succeeded → handleSucceeded (branch on metadata.kind: deposit→T7, balance→T8)
  payment.failed    → handleFailed (the #6 path)
  refund.succeeded  → record only (future cancellation)
  default           → 200 no-op
  ```
  Wire the dead `findPaymentByYocoId` (`db.ts:112`) for second-axis idempotency (dedupe on `yoco_payment_id`).
- **Failed path (#6) — `handleFailed`:** find pending payment row; if none/already paid → 200; `markPaymentFailed` (`status='failed'`, `failed_at`, `raw`); **do NOT transition the booking** (stays `accepted`/`deposit_paid`); send bride EFT-fallback email (net amount — no card fee on EFT, reinforcing §4.2's EFT line — + bank details + reference + "try card again" link) and Zandeline notification (+ mark-paid link); stamp `failure_notified_at` (idempotent — skip emails if already failed); audit; return 200.
- **Defence-in-depth (#6, the explicit ask):** `payment.failed` webhook (primary, instant for declined cards) **+ a 24h stale-pending poll-sweep** in cron (`pendingPaymentSweep`: pending rows >24h → `GET https://payments.yoco.com/api/checkouts/{id}` for ground truth → same EFT fallback if terminal-failed; catches *abandoned* checkouts that fire no event) **+ a `/payment-cancelled` page** (UX, non-mutating). Both detectors funnel into one shared `sendEftFallback(booking, payment, kind)`.

### 4.5 Balance Yoco link (#5)
Today the balance reminder (`balance.ts:181`) is EFT-only. In `balanceSweep` (`balance.ts:203`, already finds the right bookings), for each due booking: `grossUp(balance_net_cents, feeRate)`; `createYocoCheckout(..., kind:"balance", key:${id}-balance)`; `insertPayment(kind:balance, pending)`; add a **"Pay balance now — R{payable}"** button to the reminder (EFT fallback beneath). `payment.succeeded` kind=balance → T8 + Wave `recordPayment` + "fully paid 🎉". If checkout creation fails → EFT-only fallback (like `review.ts:349`). Guard the stale-pending sweep to skip if booking already `settled`.

---

## 5. Automated sequences (cron, in existing `scheduled()` — `index.ts:245`)

All idempotent via stamp columns (the `balance_reminder_sent_at` pattern); offsets are `business_settings` keys so Zandeline tunes them without a deploy.

| Sequence | When | Auto / surfaced | Status change |
|---|---|---|---|
| Request ack (T0) | immediate | auto | — |
| Approve / decline / re-quote | Zandeline action | she authors | T1/T2/T5/T6 |
| "Date secured" | on deposit clear | auto | T7 |
| **Invoice nudge #1** | +3d silent (`quote_sent`/`accepted`) | auto | stamp `nudge_1_sent_at` |
| **Invoice nudge #2** | +7d silent | auto | stamp `nudge_2_sent_at` |
| **Closing the file** | +10d silent | auto, surfaced as closed-file card | T9 `invoice_expired` |
| Balance reminder | 14 **working** days out (`deposit_paid`) | auto | stamp `balance_reminder_sent_at` |
| **Full-pay check-in** | 14 days out (`settled`, `deposit_pct=100`) | auto, **template editable before send** | stamp `checkin_sent_at` |
| Payment-failed EFT fallback | on `payment.failed`/stale-poll | auto | none (payment row only) |

New crons: `invoiceExpirySweep`, `pendingPaymentSweep`, `fullPayCheckInSweep` (reads the editable template — see data plan). **Fix `workingDaysBefore`** (`util.ts:4`) to honour SA public holidays (currently Mon–Fri only).

---

## 6. Churn vocabulary (#18 — correct framing)

| Scenario | Representation | Why it's not "churn" |
|---|---|---|
| **(a) Pre-payment drop-off** (enquiry never books) | Funnel **drop-off metric** over `requested → quote_sent → accepted` vs terminal `invoice_expired`/`declined`/`rejected`. The real conversion risk. Attacked with the §5 nudge sequence + rejection-reason analysis. | No financial stake yet — funnel attrition, not retention. |
| **(b) Cancellation** (post-payment, rare) | Status `cancelled` (T10) + `cancel_reason`, `deposit_disposition ∈ {forfeited, partial_refund, full_refund}`, `refund_cents`, `cancel_policy_applied`. System **records**; the policy (PRICING.md tiers 50/60/75/100% by notice) is Zandeline's decision. | She has a wedding + money in. |
| **(c) No-show / ghost** (invoice sent, never responds) | Status `invoice_expired` after the 3→7→close sequence. | Never paid — abandoned invoice. |

Add `business_settings.cancellation_policy_text` so the cancellation email/invoice can quote the applied tier.

---

## 7. What changes vs the built flow (endpoint summary)

| Endpoint | Change |
|---|---|
| `POST /api/booking/request` (`request.ts:125`) | remove 409; `getDateAvailability` instead of `isDateBlocked`; persist `availability_conflict`; drop deposit-% (set at accept); reword ack; upsert CRM contact |
| review/approve (`review.ts:250`) | approve → `quote_sent` (not `confirmed`); invoice carries Accept/Reject; **no** deposit pick + **no** checkout here; decline writes `decline_reason` |
| **`POST /api/booking/accept`** | NEW — bride Accept + deposit %; `quote_sent→accepted`; creates checkout (grossed) |
| **`POST /api/booking/reject`** | NEW — bride Reject + reason; `quote_sent→rejected`; insert `rejections` |
| **`POST /api/booking/cancel`** | NEW (admin) — `deposit_paid|settled→cancelled` w/ disposition |
| `POST /api/booking/yoco-webhook` (`yoco.ts:88`) | **rewrite** — Standard-Webhooks sig (C-B), `payment.succeeded`/`payment.failed`/`refund.succeeded` (C-A), gross-up + `payable_cents` fix (C-C), `kind`-branched transitions, `findPaymentByYocoId` dedupe |
| `POST /api/booking/mark-paid` (`confirm.ts:291`) | from-state `accepted` (not `confirmed`) |
| `GET/POST /api/admin/blocked-dates` (`admin.ts:99`) | capacity editor (`set_slots`); delete the 409 copy |
| legacy `GET/POST /api/booking/confirm` (`confirm.ts`) | **retire** (superseded; #4/#10 liability) |
| **`GET /api/health`** | NEW (see SEO/security plan) |

Frontend: `/book` drops hardcoded `depositPct:50`; new bride **Accept/Reject** + **deposit-selection** + **reject-reason** + **payment-cancelled** pages; carry `source` through the booking path (#17 gap — see data plan); reword `/booking-received`.

---

## 8. Conflicts resolved (vs 2026-06-05 spec & legacy docs)

`C1` 409 hard-block → soft-block capacity. `C2` email-link confirm → dashboard review (see data plan). `C3` deposit-% at request → at bride-accept. `C4` approval ≠ secured → only `deposit_paid` secures. `C5` add bride reject-with-reason + re-quote. `C6` explicit Yoco failure → EFT. `C7` add full-pay check-in. `C8` `0.029` invalid → verify + configurable `YOCO_FEE_PCT` + model toggle. `C9` template voice audit. `C11` PLAN.md "no online payments v1" obsolete — Yoco is live. `C12` PLAN.md travel/address stale (PRICING.md wins: 30km / La Montagne). `C13` Google-Sheets CRM → in-platform CRM (data plan). Also fix `payable_cents` bug, retire legacy `/confirm`, fix `workingDaysBefore` holidays.

## 9. Tests (TDD, per project convention)
Parameterize `payments.test.ts:26` (`grossUp(500000,0.029)===514934` breaks at the real rate) on `feeRate`. Add: Worker checkout grosses up (the invisible C-C gap); Standard-Webhooks verify (valid/bad-sig/stale-ts/wrong-header); `payment.failed`→EFT fallback fires once + idempotent; balance card path `deposit_paid→settled`; Model-A split-invariance; stale-pending poll→fallback; capacity gate never 409s + conflict flag persists; each new transition T1–T10; nudge/check-in stamp idempotency.
