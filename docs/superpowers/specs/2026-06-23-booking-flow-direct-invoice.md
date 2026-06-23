# Spec — Booking Flow Simplification (Direct Deposit Invoice)

**Status:** LOCKED · **Author:** Opus (Plan lane) · **Date:** 2026-06-23
**Builds:** Sonnet, one session · **Branch:** `main`
**Supersedes the "quote" framing** in the as-built booking flow. Replaces SESSION_HANDOFF Task 2.

---

## 1. Business intent (Pieter, 2026-06-23)

> "The estimator doubles as the quote. When a client submits the booking form, they've
> already seen what it costs. If Lustique is available for their date, they receive an
> invoice (Yoco payment link) to secure the booking. **There is no separate quote step.**"

And, on the deposit (Pieter, 2026-06-23):

> "We add an indication of how much 25% and 50% would be respectively and the bride then
> chooses which one by ticking next to her choice, which will then feed into Yoco to add
> the correct amount to the link."

So: the bride sees the cost up front (estimator), submits the booking, Zandeline confirms
availability and sends **one deposit invoice**. The bride lands on a page showing her
**25% and 50% amounts in rands**, ticks one, and pays via Yoco. No "accept/reject quote".

---

## 2. Chosen option + rationale

**Option A — reframe "Send Quote" → "Send Deposit Invoice", *reusing the existing
`quote_sent` / `accepted` enum states* (no migration).**

Why this and not the handoff's "add `invoice_sent` enum / drop the accept page" variant:

- Pieter wants the **bride to choose her deposit %**. A Yoco checkout needs a fixed amount,
  so the amount cannot be baked into the email — it is only known once she ticks 25% or 50%.
  That **forces a bride-facing choice page to survive**. The existing page (`accept.ts`)
  already does exactly this: render amounts → bride picks → create Yoco checkout → redirect.
- That page transitions `quote_sent → accepted`. The Yoco webhook already transitions
  `accepted → deposit_paid`. **The state machine Pieter described already exists** — it was
  only ever mis-*named* "quote". We rebrand the label, not the plumbing.
- `quote_sent` is referenced **50× across 12 files**; `accepted` widely too. Renaming to
  `invoice_sent` is large, error-prone churn on a live system for a cosmetic enum-string
  change **the bride never sees** (admin badges are rendered from a label map, not the raw
  enum). Not worth the risk.

**What we gain:** the business goal (no separate quote step; one link to secure; bride picks
deposit) with near-zero structural change — no migration, no query changes, no webhook
changes, no expiry-sweep changes.

**What we give up:** the audit log / raw DB keeps the internal string `quote_sent` for the
"deposit-invoice-sent" state. This is documented here and invisible in the admin UI. A future
clean-rename to `invoice_sent` remains possible but is explicitly *not* done now.

---

## 3. State machine

**Unchanged structurally. Only labels + the bride's email/landing copy change.**

```
requested
  → [Zandeline reviews → "Send Deposit Invoice"]      requested → quote_sent
        · emails bride ONE CTA: "Secure your date"     (label shown: "Invoice sent")
        · emails Zandeline a copy/notice
  → [Bride opens link → picks 25% or 50% → Yoco]      quote_sent → accepted
        · Yoco checkout created for chosen amount       (label shown: "Awaiting deposit")
        · pending payment row inserted
  → [Yoco webhook payment.created]                     accepted → deposit_paid   (UNCHANGED)
  → [Zandeline "Mark EFT Balance Paid"]               deposit_paid → settled    (UNCHANGED)

  Admin off-ramp (unchanged):   requested → declined  ("Decline Booking")
  Bride no longer rejects via link. (reject route → 410 stub)
  Abandoned invoice (unchanged): quote_sent older than N days → invoice_expired (cron sweep)
  Abandoned at Yoco (unchanged): pending payment > 24h → EFT-fallback email (cron sweep)
```

**Label map (presentation only — applies wherever a status badge/word is shown to admin):**

| enum value      | admin label shown   |
|-----------------|---------------------|
| `requested`     | New request         |
| `quote_sent`    | **Invoice sent**    |
| `accepted`      | **Awaiting deposit**|
| `deposit_paid`  | Deposit paid        |
| `settled`       | Settled             |
| `declined`      | Declined            |
| `invoice_expired` | Invoice expired   |

---

## 4. DB migration

**None.** No enum values added or removed. The `quote_sent_at` timestamp column is reused as
the "invoice sent at" timestamp (documented; column not renamed).

---

## 5. Deposit options — 25% and 50% only

PRICING.md §5 (locked): **50% to secure** is standard; **25% now** is the flexible concession.
Pay-in-full (100%) is **not** in PRICING and Pieter named only 25%/50%.

- **Remove the 100% "Pay in full" option** from the bride's choice page.
- Validation accepts only `[25, 50]`.
- To re-add 100% later: restore the radio + add `100` to the allow-list (one line each).

The page shows, per option, the **rand amount** and the **remaining balance**, e.g.:
- ☐ 25% deposit — R 2 500 · *Balance of R 7 500 payable closer to your day*
- ☐ 50% deposit — R 5 000 · *Balance of R 5 000 payable closer to your day*

---

## 6. Email spec — "Secure your date" (replaces the quote email)

`admin-actions.ts → quoteEmailHtml` becomes `depositInvoiceEmailHtml(b, secureUrl, invoiceUrl)`.

- **Subject:** `Secure your date — {wedding_date} · Lustique Co.`
- **Heading:** `You're all set to secure your date, {first}.`
- **Body:** "We've reviewed your request and we're delighted to hold **{date}** for you.
  Choose your deposit on the next step to lock it in." + summary table:
  Date · Bridal party ({party_size} looks) · **Total {total}** · Reference.
- **Primary CTA:** `Secure your date →` → `secureUrl`
  (the existing "accept" token URL, `/api/booking/accept?token=…`, purpose unchanged).
- **Secondary link:** `View & print your quote` → `invoiceUrl` (unchanged invoice token).
- **REMOVE:** the "I'd like to decline this booking" reject link.
- **Footer:** `This link is valid for 14 days. Questions? info@lustiqueco.co.za`
  (TTL bumped 7→14 days — see §8; no quote-validity pressure in this model.)

**Zandeline copy email** (same handler): change subject/body wording from "Quote sent"
to "Deposit invoice sent". Keep the invoice link.

---

## 7. Admin UI changes (`dashboard.ts`, presentation only)

1. **Booking detail, `requested` actions block:** button `Send Quote →` →
   **`Send Deposit Invoice →`**; confirm-dialog text: "Send the deposit invoice to {name}?
   This emails her a link to choose her deposit and secure the date."
   (Keep the green styling; keep the "Decline Booking" button unchanged.)
2. **Status badges:** render via the §3 label map. Add/relabel CSS classes so `quote_sent`
   reads "Invoice sent" and `accepted` reads "Awaiting deposit". Do **not** change the enum
   values in any query.
3. **Quotes pipeline / tab:** relabel the heading and nav word "Quotes" → **"Invoices"**;
   relabel the per-row "Quote sent" pill → "Invoice sent". Queries
   (`status=in.(requested,quote_sent)`, etc.) **unchanged**.
4. **Timeline rows:** "Quote sent" → "Invoice sent"; "Accepted" → "Deposit chosen".

No status-query, no `ACTIVE_STATUSES`, no `ARTIST_ASSIGNABLE_STATUSES`, no `editableStatuses`
changes — those keep using `quote_sent`/`accepted` as today.

---

## 8. Bride-facing page changes (`accept.ts`)

Keep the route (`/api/booking/accept`) and the `quote_sent → accepted` transition. Change:

1. **Copy:** title "Confirm your booking ✨" → "Secure your date"; remove "quote" wording;
   intro: "Choose your deposit to secure **{date}**." Keep the brand styling.
2. **Options:** 25% and 50% only (remove 100% radio). Show rand amount + remaining balance.
3. **POST validation:** `[25, 50]` (was `[25, 50, 100]`).
4. **Token TTL:** the *send* handler signs the accept + invoice tokens; bump the accept-link
   TTL constant `QUOTE_TTL_MS` from 7 → **14 days** (rename to `INVOICE_TTL_MS` is optional).
   Note: the expiry **cron sweep** (`invoiceExpirySweep`, 7-day `quote_sent` cutoff) is left
   as-is for now — it independently frees abandoned dates; tightening it to match 14 days is
   an optional follow-up, not required.
5. **Zandeline notify copy** (in `handleAccept`): "Bride accepted the quote" → "Bride chose
   her deposit — awaiting payment".

---

## 9. Reject route (`reject.ts`) → 410 stub

The bride no longer declines via a link. **Keep the routes registered** (old emailed tokens
may still exist) but make `renderRejectPage` (GET) and `handleReject` (POST) return a polite
**HTTP 410** page: "This link is no longer in use — if you'd like to make a change, email
info@lustiqueco.co.za." Delete the transition/notify logic. Keep `pageShell` for the stub.

(The structured `rejections` table + admin "Decline Booking" path remain fully intact.)

---

## 10. File-by-file change list

| File | Change | Risk |
|---|---|---|
| `worker/src/booking/admin-actions.ts` | Rewrite `quoteEmailHtml` → deposit-invoice email (§6); drop reject token (keep accept + invoice tokens); bump TTL 7→14d; update Zandeline copy email subject/body. Transition stays `requested → quote_sent`. Optional: rename `handleAdminSendQuote` → `handleAdminSendDepositInvoice`. | Med |
| `worker/src/booking/accept.ts` | Copy → "Secure your date"; 25/50 only (remove 100); validation `[25,50]`; notify copy "chose her deposit". Keep transition + Yoco. | Med |
| `worker/src/booking/reject.ts` | Convert GET+POST to 410 stub (§9). | Low |
| `worker/src/booking/dashboard.ts` | Button label + confirm copy; badge label map (§3); "Quotes"→"Invoices" headings/nav/pills; timeline labels. **No query changes.** | Med |
| `worker/src/index.ts` | Only if the handler/route is renamed (optional): update import + route match `/send-quote` → `/send-invoice` + the dashboard form `action`. Else **no change**. | Low |
| `worker/src/booking/forms.ts` | **OUT OF SCOPE** — enquiry composer, not booking flow. Leave as-is. (Optional later: relabel its button "Send Quote" → "Email Lead" to avoid admin confusion — not part of this build.) | — |
| `worker/src/booking/yoco.ts` | **No change** (webhook already `accepted → deposit_paid`). | — |
| `worker/src/booking/review.ts` | **No change** (expiry sweep keeps freeing `quote_sent`). | — |
| `supabase/migrations/` | **No migration.** | — |

---

## 11. Build sequence (for Sonnet)

1. **Pre-flight:** confirm no live bookings would be surprised — ask Pieter for
   `SELECT status, COUNT(*) FROM bookings GROUP BY status` (SESSION_HANDOFF Task 4 #7).
   The change is back-compat regardless (old `quote_sent`/`accepted` rows keep working;
   old reject links 410 gracefully), so this is informational, not blocking.
2. **TDD throughout** (booking logic = money truth). Update the failing test first, watch it
   fail for the right reason, then change source. Order:
   a. `reject.ts` → 410 stub (+ update `reject.test.ts`). Smallest, isolated.
   b. `accept.ts` → copy + 25/50 only + validation (+ update `accept.test.ts`).
   c. `admin-actions.ts` → new email + drop reject token + TTL (+ update `admin-actions.test.ts`).
   d. `dashboard.ts` → labels/badges/headings (+ update dashboard test label assertions).
   e. (Optional) handler/route rename — do **last**, only if time; touches `index.ts` + form action.
3. **Full worker test suite green** (`npm test` in `worker/`).
4. Commit. Update SESSION_HANDOFF (mark Task 2 done; surface Task 3 newsletter as next).

---

## 12. Test strategy

**Will break (must update):**
- `admin-actions.test.ts` — asserts accept **and reject** links in the quote email →
  update to assert the single "Secure your date" CTA + invoice link, and **no** reject link.
- `accept.test.ts` — asserts 25/50/**100** options → update to 25/50; assert 100 rejected.
- `reject.test.ts` — asserts `quote_sent → rejected` transition + email → update to assert
  **410** for GET and POST, and that **no** transition/email occurs.
- `dashboard*.test.ts` — any assertion on the literal "Send Quote" / "Quote sent" strings →
  update to "Send Deposit Invoice" / "Invoice sent".

**New tests:**
- `reject.test.ts`: 410 status + body for a still-valid token (no side effects).
- `accept.test.ts`: posting `depositPct=100` is rejected (400).
- `admin-actions.test.ts`: deposit-invoice email contains the secure URL + invoice URL and
  does **not** contain `/api/booking/reject`.

**Must stay green untouched:** `yoco.test.ts` (webhook path unchanged), `review.test.ts`
(sweep unchanged), `balance.test.ts`, `confirm.test.ts`.

---

## 13. Constraints honoured

1. Postgres enum values never removed — we add none and remove none. ✓
2. Token security — secure link reuses the existing HMAC `accept`-purpose token (booking-id
   embedded, time-limited; TTL 14d). Invoice token unchanged. ✓
3. `accept.ts`/`reject.ts` gracefully handle pre-change tokens — accept still works; reject
   returns 410 instead of acting. ✓
4. Yoco link expiry — the Yoco checkout is created **fresh** when the bride picks (never
   stale at creation); abandonment is covered by the existing 24h pending sweep. The emailed
   link is to *our* page (our 14d token), not a raw Yoco URL. ✓
5. No new npm packages. ✓
6. Granular file-by-file plan for a one-session Sonnet build. ✓
