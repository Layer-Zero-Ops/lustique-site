# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Yoco live on staging + production; contract e-sign built but gated off; GoDaddy→Workspace email migration in progress · **Updated:** 2026-07-03

---

## ▶ NEXT (fresh session — BUILD)

**Model:** Sonnet · **Branch:** `dev` (today's work committed here — see commit for full diff; deployed to both staging and production Workers)

### Immediate: finish the live Yoco payment test on production

Pieter was mid-way through a real R5 live Yoco charge to confirm the whole flow end-to-end on production. Status unknown at session close — pick up here:

1. Booking `35dd00cc-7481-47e3-a814-87d7925ac08e` (ref `LUS-2026-35DD00`) is the standing test booking — `total_cents` was set to `2000` (R20) so a 25% booking fee = R5, safely above Yoco's R2 minimum. Check its current status:
   ```sql
   select status, deposit_pct, total_cents from bookings where id = '35dd00cc-7481-47e3-a814-87d7925ac08e';
   select event_type, payload, created_at from audit_log where booking_id = '35dd00cc-7481-47e3-a814-87d7925ac08e' order by created_at desc limit 5;
   ```
2. If the last `invoice-pay.checkout-failed` audit event shows `Yoco 403: Forbidden` on **production** — that's a different, unresolved issue from the earlier staging 403 (which was a wrong secret *value* and is fixed). Production's `YOCO_SECRET_KEY` may not be a valid/permissioned live key, or the Yoco live account may need Checkouts API explicitly enabled. **Do not test the live key value via curl without Pieter's explicit go-ahead** — he declined that once already this session (real financial credential). Ask him directly, or have him check the Yoco Business Portal for the account's live-mode/API status.
3. If it succeeded: confirm `status = deposit_paid`, refund the R5 via the Yoco Business Portal (Payments → find transaction → Refund), and reset the booking back to a clean `quote_sent` + restore `total_cents` to its original `498000`-equivalent value if it's going to be reused for anything else (currently sits at `2000`/R20 from the test — restore before reusing for a real quote).

### If real Yoco testing is done: flip attention to the contract e-signature feature

Built this session but **deliberately inert** — `business_settings.contract_enabled = 'false'`. Do not flip to `'true'` until:
1. Zandeline has sent her actual contract text + comments (was "coming a bit later" as of this session — check with Pieter).
2. Pieter has reviewed/approved the placeholder wording in `worker/src/booking/contract.ts` (marked `CONTRACT_VERSION = "draft-v1-placeholder"`) against her real text, or replaced it outright.
3. Once approved: update `contractBodyText`/`contractBodyHtml` in `contract.ts` with final wording, bump `CONTRACT_VERSION`, then `update business_settings set value = 'true' where key = 'contract_enabled';` on the shared Supabase project (affects both staging and prod immediately — they share one Supabase instance).

### GoDaddy → Google Workspace email migration (in progress, paused mid-flow)

State as of session close:
- ✅ Google Workspace account created; domain `lustiqueco.co.za` verified (TXT record added in Cloudflare).
- ✅ Users created: `hello@lustiqueco.co.za` (Workspace admin/owner) and `info@lustiqueco.co.za` (the address hardcoded throughout the booking system's customer-facing emails — this is the one that matters operationally).
- ✅ Old GoDaddy mail successfully imported into the new `info@lustiqueco.co.za` Gmail mailbox via Admin console → **Data → Data import & export → Data import** (IMAP from `imap.secureserver.net`). Pieter confirmed the migrated inbox looks right.
- 🟡 **DKIM — in progress, not yet confirmed.** Path: **Menu → Apps → Google Workspace → Gmail → Authenticate email**, generate key, add `google._domainkey` TXT record to Cloudflare, then return and click Start/Activate. Last left waiting on Pieter to screenshot the generated DKIM values for confirmation before pasting into Cloudflare.
- ⬜ **MX cutover — not started, intentionally.** This is the one step with real live-mail-flow risk. Do it deliberately: quiet time, Pieter present and reachable, DNS already in Cloudflare (not GoDaddy — confirmed this session) so no registrar hoop-jumping needed.
  - New MX: delete the two GoDaddy records (`smtp.secureserver.net`, `mailstore1.secureserver.net`), add one: `1 SMTP.GOOGLE.COM`.
  - New SPF: current is `v=spf1 include:secureserver.net -all` → needs to become `v=spf1 include:_spf.google.com include:spf.sendinblue.com -all` (the Brevo include is needed because the booking system's transactional emails send via Brevo from `info@lustiqueco.co.za` — verify the exact Brevo SPF hostname in Brevo dashboard → Senders & IP → Authenticate, since it can drift).
  - Leave the `brevo-code:...` TXT record alone (unrelated domain-ownership check for Brevo).
- **Auth note:** `autom8iq@gmail.com`'s admin-dashboard password was reset this session (directly via SQL against `auth.users.encrypted_password` using pgcrypto's `crypt()`/`gen_salt('bf')` — no service-role/Admin API needed for this trick). Pieter has the new password. Magic-link login was failing due to Supabase's default email sender hitting `over_email_send_rate_limit` (a handful of emails/hour cap) — the real fix (custom SMTP via the existing Brevo account, credentials already in the Supabase vault as `BREVO_SMTP_SECRET`) was explained but **not yet configured** in Supabase Dashboard → Authentication → Emails → SMTP Settings. Worth doing — unblocks magic-link login for both Pieter and Zandeline going forward.

---

## ✅ Completed this session (2026-07-02/03) — Yoco fix, invoice/contract rebuild, legacy flow retirement, GoDaddy→Workspace migration (partial)

### Root-caused and fixed the original Yoco 403 (staging)
`YOCO_SECRET_KEY` on staging held a wrong/stale value. Verified the correct `YOCO_TEST_SECRET_KEY` from the Supabase vault directly against Yoco's API (got the expected `400` amount-too-low response, not `403`), then `wrangler secret put` with that value on staging. Fixed.

### Discovered and fixed a second, deeper bug: two parallel bride-facing payment flows
The invoice page (`invoice.ts`) had been getting rebuilt all session, but the **primary "Secure your date" button in both quote-sent emails** was actually pointing at `/api/booking/accept` — a completely separate, untouched Wave A page (`accept.ts`) with its own old single-button-then-EFT-fallback logic. Only a secondary "View & print your invoice" link went to the page being worked on. This caused repeated confusion where fixes to `invoice.ts` appeared to have no effect.
- **Fix:** `admin-actions.ts` (`depositInvoiceEmailHtml` / `handleAdminSendQuote`) and `review.ts` (the very-first "quote ready" email, sent when an enquiry is approved — the path every real bride goes through) now emit a single link to `/api/booking/invoice`, dropping the separate accept/reject tokens entirely.
- **`accept.ts` fully retired** — kept as a thin redirect shim only, so old emails/bookmarks/already-open tabs with a stale "accept" token don't dead-end. It now verifies the token and 302-redirects straight to the current invoice page; no booking mutation happens there anymore. (Was the exact cause of "I keep seeing the old EFT flow no matter what you fix" — a stale already-open tab kept resubmitting to the old page.)

### Invoice page (`invoice.ts`) rebuilt: Accept/Reject + booking-fee terminology + contract signature gate
- Terminology: "deposit" → "booking fee" throughout (T&Cs now cite whichever % the bride actually picks, not a fixed "30%").
- Two dedicated CTA buttons — **Accept** / **Reject** — replacing the old single button + small text link. Reject reuses the existing reason-capture modal; Accept opens the existing 25/50/100% picker.
- Contract signing (`contract.ts`, new file): typed full name + checkbox + link to a per-booking Client Agreement page (`/api/booking/contract?token=...`, reuses the invoice token). On submit, records `contract_signed_at`, `contract_signer_name`, `contract_ip`, `contract_user_agent`, a SHA-256 hash of the exact contract text shown, and a version string on the booking row — an ordinary electronic signature under SA's ECT Act, appropriate for a services contract like this (not a Schedule 2 document needing an advanced e-signature).
- **Gated behind `business_settings.contract_enabled` (currently `'false'`)** — migration `0024_contract_signature.sql` adds the columns + seeds the flag off. Zero effect on live bookings until Zandeline's real contract text arrives and Pieter flips it on. Placeholder wording in `contract.ts` is clearly marked provisional.
- Removed the duplicate "Resend Invoice" button from the admin dashboard for `quote_sent` bookings (was redundant with "Resend Deposit Invoice" — both pointed at the same page). Left in place for `accepted`/`deposit_paid`/`settled` statuses, where it's a genuinely different action (resend as a receipt/document).
- Dashboard bell notification added on card-payment failure (`yoco.ts`) — was email-only before.

### Fixed a real idempotency-key bug (would have bitten real brides, not just testing)
`invoice.ts`'s Yoco checkout creation used a fixed `Idempotency-Key` of `${booking.id}-deposit`. Any second checkout attempt for the same booking with a *different* amount (booking-fee change, retry after a failed payment, admin resetting a stuck booking) got rejected by Yoco with a `422` ("payload does not match the original request"). Fixed by generating a fresh `crypto.randomUUID()` per attempt.

### Deployed to both staging and production
- Staging: `lustique-form-handler-staging` — `workers_dev = true` added to `wrangler.toml` after a deploy briefly disabled the `*.workers.dev` fallback URL (Cloudflare error 1042) that was, at the time, the *only* reachable staging URL since `staging.lustiqueco.co.za` DNS didn't exist yet. **That DNS CNAME now exists** (added by Pieter/Zandeline mid-session) and correctly routes `/api/*` to the Worker — the bare root (`staging.lustiqueco.co.za/` with no path) 522s, which is expected, there's no site hosted there, only `/api/...`.
- Production: `lustique-form-handler` — deployed once Pieter confirmed on staging. All 443 tests passing at every deploy point.

### Auth
- Confirmed multi-admin concurrent dashboard use is safe — separate Supabase JWT sessions per login, and all booking-status writes use conditional `status=eq.<expected>` guards, not blind overwrites.
- Reset `autom8iq@gmail.com`'s password directly via SQL (`crypt()`/`gen_salt('bf')` against `auth.users`) when magic-link login wasn't arriving — root cause was Supabase's default email sender hitting its built-in rate limit, not a code bug. Real fix (custom SMTP via Brevo) identified but not yet configured — see ▶ NEXT.

### GoDaddy → Google Workspace email migration
See ▶ NEXT above — in progress, DNS is in Cloudflare (not GoDaddy), old mail already migrated successfully, DKIM in progress, MX cutover deliberately not yet done.

**Tests:** 443 passing (33 files) at final commit — `contract.ts`/`contract.test.ts` new; `accept.ts`/`accept.test.ts` rewritten; `invoice.test.ts`, `review.test.ts`, `admin-actions.test.ts` updated for the email-link consolidation.

---

## ✅ Completed prior sessions

<details>
<summary>2026-07-01 and earlier — promo library, venue directory, TASK-D, email redesign, etc. (click to expand)</summary>

### 2026-07-01 part 2 — promo library + FREE_KM + venue-search polish
- Free travel threshold raised 30km → 40km round trip (`FREE_KM` in `shared/pricing/src/constants.ts`).
- Venue-search dedup + keyboard navigation fixes.
- Promo engine rebuilt as a dashboard-configurable library (7 promo kinds, 10 curated presets, `worker/src/booking/promos.ts` admin tab, `GET /api/promo/active` public endpoint). Migration `0023_promo_library.sql` applied.
- 51 new tests, 498 passing total at the time.

### 2026-07-01 part 1 — venue directory + matching accuracy
- 226-venue directory (`site/src/data/sa-wedding-venues.json`), fuzzy matching (`venueMatch.ts`), live search-as-you-type, destination-wedding travel/accommodation estimates, venue-match telemetry (migration `0022_venue_match_log.sql`, applied).

### 2026-06-26 — TASK-D (Yoco deposit modal, original build), ENV-RETROFIT (dev branch + staging env), email visual redesign, contact page map, CF Pages deploy fix, Google review URL set.

</details>

---

## Pieter actions still open

1. **Live Yoco 403 on production** — needs his input on whether to test the live key value directly, or check via Yoco Business Portal (see ▶ NEXT).
2. **DKIM** — screenshot the generated Google values for confirmation, then add to Cloudflare.
3. **MX cutover** — schedule deliberately, not casually (see ▶ NEXT for exact record changes).
4. **Supabase custom SMTP (Brevo)** — fixes magic-link login rate-limiting for good. Dashboard → Authentication → Emails → SMTP Settings. Values in the ▶ NEXT section above from earlier in this session.
5. **Zandeline's contract text** — standing by; needed before `contract_enabled` can flip on.
6. **CF Pages env var** — `PUBLIC_HERE_API_KEY=-3XlCZXtw1RNbKmaw-F4w5nhn2TA8wuV3YCzjJsU_0Y` (Settings → Environment variables → Production); restrict key to `lustiqueco.co.za/*` in HERE dashboard.
7. **Migration 0020** — `ALTER TYPE notification_type ADD VALUE` for `enquiry_received`/`invoice_rejected` bell notifications (TASK-E, still blocked on this).
8. **Migration 0018** — `supabase/migrations/0018_public_read_policies.sql`, not yet applied.
9. **CF Pages env vars (Supabase)** — `SUPABASE_URL` + `SUPABASE_ANON_KEY` as Pages build env vars.
10. **UptimeRobot** monitor on `https://lustiqueco.co.za`.
11. **Artist headshots** — Elria, Jana, Janeke, Marize, Maroné, Monique, René, Samantha.
12. **Brevo newsletter list ID**.
13. **Restore test booking's `total_cents`** once the live Yoco test is fully done and the booking won't be reused (currently R20 for testing — see ▶ NEXT).

---

## Current state (as-built, 2026-07-03)

### Branch state
- `dev` — has everything through this session (Yoco fixes, invoice/contract rebuild, accept.ts retirement, idempotency fix), committed this session.
- `main` — check whether `dev` has been PR'd/merged since; production Worker has today's code **deployed directly** (not via a `main` merge — worth reconciling `main` with what's actually live via a PR at some point).
- Staging and production Workers both running today's code as of session close.

### Supabase migrations applied (0001–0024)
- ⚠ 0018: public read policies — still **NOT APPLIED**.
- ⚠ 0020: notification_type enum values — still **NOT APPLIED** (blocks TASK-E).
- ✅ 0022, 0023 — applied prior session.
- ✅ 0024: contract signature columns + `contract_enabled` flag (seeded `'false'`) — **applied this session**.

### Key files (new/changed this session)
- `worker/src/booking/invoice.ts` — Accept/Reject, booking-fee terminology, contract gate, fixed idempotency key.
- `worker/src/booking/contract.ts` — new; Client Agreement page + signature hashing.
- `worker/src/booking/accept.ts` — retired to a redirect-only shim.
- `worker/src/booking/admin-actions.ts`, `worker/src/booking/review.ts` — single invoice-link emails (dropped separate accept/reject tokens).
- `worker/src/booking/dashboard.ts` — removed duplicate resend button for `quote_sent`.
- `worker/src/booking/yoco.ts` — dashboard bell notification on payment failure.
- `worker/wrangler.toml` — `workers_dev = true` under `[env.staging]`.
- `supabase/migrations/0024_contract_signature.sql`.

## ⇄ Umbrella (project ↔ Studio Manager · see _ops/BRIDGE-PROTOCOL.md)
**⬆ To umbrella / Pieter:** Yoco payment flow now working on staging (was blocked on a wrong secret value + a stale parallel legacy page bypassing all fixes — both root-caused and fixed). Production deploy done; live payment test in progress at session close, status unconfirmed. Contract e-signature feature built but deliberately inert pending Zandeline's text. GoDaddy→Workspace email migration ~70% done (mail imported, DKIM pending, MX cutover intentionally deferred to a deliberate window).
**⬇ From umbrella:** (none new this session)
