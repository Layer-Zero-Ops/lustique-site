# Lustique — Marketing Email System + Transactional Sign-off Fix

## Context

The booking flow already sends ~15 transactional email types (quote ready, request received, booking confirmed, balance due, all settled, invoice, review request, payment failed, admin notifications, etc.) through a shared design system: `emailShell()` in `worker/src/lib/email.ts`, matching the site's brand (Georgia serif headings, mocha/blush palette, ivory background).

What's missing is **marketing/promotional email** — the newsletter code (`worker/src/booking/newsletter.ts`) only captures signups into a Brevo contact list; there's no way to actually compose and send a campaign. This spec covers building that, plus a small fix to the existing shell.

## 1. Fix: sign-off mismatch on existing transactional emails

`BRAND.md` (locked voice decisions, 1 June 2026) mandates the sign-off **"Blessings, The Lustique Cosmetology Team"** on nurture emails. The current `emailShell()` footer signs off with plain "Lustique Co." instead. One-line fix in `worker/src/lib/email.ts`, applies to every transactional email at once since they all share the shell.

## 2. Audience

Two selectable targets when composing a campaign, both **Brevo-list-based** — never a raw per-contact loop, so Brevo's unsubscribe/suppression handling covers compliance without us re-implementing it:

- **Newsletter list** (`BREVO_NEWSLETTER_LIST_ID`, already exists) — explicit opt-in, usable freely.
- **Past clients list** (new) — relies on POPIA's existing-customer exemption (s69(3)): marketing similar services to past customers is allowed without fresh consent, provided every send carries a working unsubscribe option. Needs:
  - A new Brevo list (create once, store its ID as a Worker secret `BREVO_PAST_CLIENTS_LIST_ID`).
  - A one-time backfill: push every `settled`-status booking's bride email to this list.
  - An ongoing sync: when a booking transitions to `settled` (in `balance.ts`/`confirm.ts`, wherever that transition's other side effects already fire), also upsert the bride into this list.
  - An idempotent, re-runnable **admin action** ("Sync past clients to Brevo") rather than a one-shot migration script — safer to re-run any time than trust a single migration execution.

**Explicitly excluded:** raw enquiry leads (people who enquired but never booked). POPIA's exemption covers existing *customers*, not leads — marketing to them without consent is a real compliance risk for a low-value audience. Follow-up (separate, smaller task, not built here): add a "keep me updated with offers" checkbox to the quote/enquiry form so future leads can opt into the newsletter list legitimately.

## 3. Sending mechanism

Brevo's **Campaign API** (`POST /v3/emailCampaigns`), targeting a `listId`, not the transactional API (`sendEmail()` in `email.ts`) the rest of the site uses. The Campaign API auto-inserts the required unsubscribe footer and respects Brevo's own suppression list — the transactional API does neither, so using it for bulk marketing sends would mean rebuilding that compliance machinery ourselves. Two API calls in sequence: create the campaign (draft), then send it immediately (no scheduling UI in v1 — Zandeline reviews and hits send when ready).

## 4. Composer: one flexible preset

Rather than several fixed "shapes" (seasonal offer / referral / win-back as separate layouts), ship **one** branded preset built from the existing `email.ts` components (`ep`, `emailBtn`, `emailNote`, `emailTable`-style block):

- Headline (text)
- 1–3 body paragraphs (text)
- Optional highlight/promo box (reuses the table-row visual style already used for pricing breakdowns)
- One CTA button (label + href)
- Optional hero image (URL)
- **Optional promo reference**: if the admin selects one of the `PROMO_PRESETS` (from `shared/pricing`), its `terms` string is automatically appended as small-print at the bottom of the email (via `emailNote`), the same way admin Promotions cards now show it — so every promo-referencing send carries its own boundary language without Zandeline having to remember to type it.

Copy changes per send; layout and brand styling never do. More layout "shapes" can be added later if a real need shows up (YAGNI for v1).

## 5. New pieces

- `worker/src/lib/marketingEmail.ts` — the preset HTML builder function, e.g. `marketingEmailHtml({ headline, paragraphs, highlight?, cta, heroImage?, promoId? })`, mirroring the style/escaping conventions of `email.ts`.
- `worker/src/booking/marketing.ts` — new admin route (`/api/admin/marketing`):
  - `GET` — form: audience picker (newsletter / past-clients), preset fields, an optional promo-preset dropdown (populated from `PROMO_PRESETS`), and a simple HTML preview of the rendered email before sending.
  - `POST` — validates input, builds HTML via `marketingEmailHtml()`, calls Brevo's Campaign API against the selected list, writes an audit-log entry (`writeAudit`, matching the pattern in `review-email.ts`/other modules) and an admin notification, then redirects with a confirmation banner.
- "Marketing" nav tab in `adminShell`, next to "Promotions" (`dashboard.ts`'s nav list).
- "Sync past clients to Brevo" admin action — idempotent upsert of all `settled` bookings' bride emails into the past-clients Brevo list; also wired into the `settled` status transition going forward.

## 6. Error handling

This is an interactive admin action, not a background cron sweep — a Brevo API failure (campaign creation or send) must surface as a visible error banner in the dashboard, never a silent no-op. No partial-success ambiguity: either the campaign was created and sent, or the admin sees exactly why not.

## 7. Testing

- `marketingEmail.test.ts` — unit tests on the HTML builder: escaping of admin-entered text, correct structure with/without optional fields (highlight box, hero image, promo terms footnote), matching the style of `review-email.test.ts`.
- `marketing.test.ts` — route-handler tests mocking the Brevo fetch calls for: successful campaign creation+send, Brevo API failure (error surfaced, not swallowed), audience-list resolution (newsletter vs past-clients), and auth/session guard (mirrors `balance.test.ts`'s mocking pattern).
- Past-clients sync: unit test for the idempotent upsert (same booking synced twice doesn't duplicate the Brevo contact — Brevo's `updateEnabled: true` contact upsert, same pattern already used in `newsletter.ts`).

## Out of scope for this pass

- Scheduling/recurring sends (holding off on automation entirely per the earlier SEO-automation decision — this is a manual, admin-triggered action only).
- Rich-text/free-form composition (explicitly rejected in favour of the fixed preset, to keep every send on-brand).
- Enquiry-lead audience targeting (needs a consent mechanism that doesn't exist yet — separate follow-up task).
- Fixing `dashboard.ts`'s disconnected manual-quote-composer travel price tiers (found during the promo T&Cs work, flagged separately — a business pricing decision, not a copy sync).
