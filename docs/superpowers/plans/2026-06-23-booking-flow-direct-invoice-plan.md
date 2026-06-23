# Build Plan — Direct Deposit Invoice (Sonnet, one session)

**Spec (source of truth):** `docs/superpowers/specs/2026-06-23-booking-flow-direct-invoice.md`
**Branch:** `main` · **Method:** TDD (booking logic = money truth) · **No migration. No new packages.**

Goal: rebrand the "quote" booking flow as a **deposit invoice** — Zandeline clicks
**Send Deposit Invoice**, the bride gets ONE "Secure your date" link, picks **25% / 50% / 100%**
(rand amounts shown), and pays via Yoco. No bride-facing accept/reject. **State machine and
all status queries are unchanged** — only labels, copy, the email, and the reject route change.

> Read the spec fully first. Every "why" lives there. This is the ordered task list only.

---

## Task 0 — Pre-flight (informational, non-blocking)
- Ask Pieter to run `SELECT status, COUNT(*) FROM bookings GROUP BY status` (Supabase SQL).
  The change is back-compat either way; this just tells us if any bride is mid-flow.
- `cd worker && npm test` — confirm green baseline before touching anything.

## Task 1 — `reject.ts` → 410 stub  *(smallest, isolated; do first)*
- TDD: rewrite `reject.test.ts` to expect **410** for GET and POST with a still-valid token,
  and **no** DB transition / **no** email. Watch fail.
- Make `renderRejectPage` (GET) and `handleReject` (POST) return a 410 page via `pageShell`:
  "This link is no longer in use — to make a change, email info@lustiqueco.co.za."
  Delete the `quote_sent → rejected` transition, `insertRejection`, and notify logic.
  Keep the route registered in `index.ts` (no route change).
- Green.

## Task 2 — `accept.ts` → "Secure your date" (copy only)
- TDD: update `accept.test.ts` only where it asserts old "quote" copy → new "Secure your
  date" copy. **Options stay 25/50/100** — no option/validation changes. Watch fail.
- Change: page title/intro copy (spec §8); Zandeline notify copy → "chose her deposit —
  awaiting payment". **Keep** the 25/50/100 radios, `[25,50,100]` validation, the
  `quote_sent → accepted` transition, and the Yoco checkout — all unchanged.
- Green.

## Task 3 — `admin-actions.ts` → deposit-invoice email
- TDD: update `admin-actions.test.ts` — email contains the secure URL + invoice URL and does
  **NOT** contain `/api/booking/reject`. Watch fail.
- Change: replace `quoteEmailHtml` with the deposit-invoice email (spec §6); stop signing the
  reject token (keep accept + invoice tokens); bump `QUOTE_TTL_MS` 7→14 days; update the
  Zandeline copy-email subject/body wording ("Deposit invoice sent"). Transition stays
  `requested → quote_sent`.
- Green.

## Task 4 — `dashboard.ts` labels (presentation only)
- Button `Send Quote →` → **`Send Deposit Invoice →`** + new confirm-dialog copy (spec §7).
- Status badge **label map**: `quote_sent`→"Invoice sent", `accepted`→"Awaiting deposit"
  (relabel text/CSS classes; **do not** touch any `status=...` query string).
- "Quotes" heading/nav/pills → "Invoices"; timeline "Quote sent"→"Invoice sent",
  "Accepted"→"Deposit chosen".
- Update any dashboard test asserting the old literal strings.
- Green.

## Task 5 — (OPTIONAL, time-permitting) rename handler + route
- `handleAdminSendQuote` → `handleAdminSendDepositInvoice`; route
  `/api/admin/booking/:id/send-quote` → `/send-invoice` (update `index.ts` import + match +
  the dashboard form `action` + admin-actions test). Skip if short on time — labels already
  done; route names are internal.

## Task 6 — Verify + close
- `cd worker && npm test` — **all green** (spec §12: `yoco`, `review`, `balance`, `confirm`
  tests must stay green untouched).
- `cd worker && npx tsc --noEmit` (type check) if available.
- Commit (`feat(booking): reframe quote flow as direct deposit invoice`).
- Update `SESSION_HANDOFF.md`: mark Task 2 ✅; set ▶ NEXT to **Task 3 (newsletter lead
  magnet)** — needs Pieter's Brevo list ID first.

---

## Guardrails
- **Do NOT** add an `invoice_sent` enum value or migrate anything (spec §2, §4).
- **Do NOT** change `yoco.ts`, `review.ts`, or any `status=...` query (spec §7, §10).
- **Do NOT** touch `forms.ts` send-quote — it's the enquiry composer, out of scope (spec §10).
- Keep `accept.ts`'s `quote_sent → accepted` transition — it's the real "awaiting payment"
  state; the webhook depends on it.
