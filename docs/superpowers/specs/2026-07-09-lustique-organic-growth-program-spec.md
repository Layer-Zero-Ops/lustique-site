# Lustique — Organic Growth Program (reduce Meta ad dependency)

## Context

Meta ads have become unreliable for Lustique: the platform's own delivery/algorithm changes have caused ad spend to blow past the configured daily cap mid-flight (one recent campaign: R100/day × 8 days = R800 max spend, fully consumed by day 4), with no support channel to dispute it. This spec scopes five parallel channels for bringing bookings in without depending on Meta paid ads as the primary lever. It does not propose stopping Meta ads — it proposes not being dependent on them as the *only* one.

Five channels, in priority order (fastest-to-compound first):

| # | Channel | Status before this spec | What's left |
|---|---|---|---|
| 1 | Google reviews / GBP trust signals | ~95% already built | 1 client action (~15 min), then it's live |
| 2 | On-site technical SEO | ~90% already built | 1 blocking client action (GA4/GSC), a few small code items |
| 3 | Marketing email system (re-engage past enquiries) | Fully spec'd + planned, 0% built | Execute the existing 48-step plan |
| 4 | Vendor/venue referral partnerships | 0% scoped | New spec (Part F below) + new plan |
| 5 | Organic social (unpaid) | 0% scoped | Operational only — no code surface |

Companion documents:
- [`2026-07-03-lustique-seo-discoverability-spec.md`](2026-07-03-lustique-seo-discoverability-spec.md) — channels 1 & 2, Parts A–E already shipped/scoped there. This spec doesn't repeat it, only tracks what's outstanding (Part G below).
- [`2026-07-03-lustique-marketing-email-design.md`](2026-07-03-lustique-marketing-email-design.md) + its [plan](../plans/2026-07-03-lustique-marketing-email-plan.md) — channel 3, fully scoped, zero code written yet.
- [`../lustique-organic-growth-ops-playbook.md`](../lustique-organic-growth-ops-playbook.md) — every manual/operational task across all 5 channels (GBP setup, GA4/GSC wiring, citations, backlinks, review-response cadence, social calendar, partner outreach), kept separate from code specs since none of it is a build task.

---

## Part F — Vendor/venue referral partnerships (new)

**Why this channel:** wedding bookings flow through a small, identifiable set of vendors a bride talks to before picking hair & makeup — her venue, photographer, and planner, mainly. A reciprocal "vendors we recommend" arrangement with venues already in Lustique's own directory (`site/src/data/sa-wedding-venues.json`, 317 entries) is a durable, zero-ad-spend channel: Meta can't switch it off, and it compounds as more partners come on board.

**Two pieces: a small code build, and an operational outreach motion (tracked in the ops playbook, not here).**

### F1. Referral attribution — capture which partner sent a lead

Nothing in the codebase currently captures *how* an enquiry arrived. The `bookings` table has unused `source`/`utm_source`/`utm_medium`/`utm_campaign` columns (`supabase/migrations/0007_attribution.sql`) that are never written to by any handler — dead columns. The `enquiries` table (the actual live intake path — see `0014_enquiries.sql`) has no attribution columns at all.

**Design:**
- Partners get a personalised link: `https://lustiqueco.co.za/quote?ref=<partner-slug>` (e.g. `?ref=avianto`, `?ref=redivory-estate`). No new infrastructure — just a query param on a link Zandeline hands out or a venue lists on their own "preferred vendors" page.
- `quote.astro`/a small inline script captures `ref` (and standard `utm_source`/`utm_medium`/`utm_campaign`, for when a channel *other* than a direct partner link — e.g. a future backlink or social post — wants tracking too) from `location.search` on page load, stores it in `sessionStorage` (survives the multi-step form, lost when the tab closes — no persistent tracking needed for this).
- `enquiry.ts`'s `collect()` reads it back out of `sessionStorage` and includes it in the POST body.
- New `enquiries` migration adds `referral_source text` (nullable) — one column, not four; `ref` and `utm_source` collapse into the same field since Lustique doesn't run multi-channel paid campaigns needing full UTM granularity. If that need appears later, it's an additive column, not a rework.
- Admin enquiry list/detail view shows the referral source when present, so Zandeline can see which partners are actually sending business — that's the whole point of tracking it.

### F2. "Vendors we recommend" page (reciprocity — give partners a reason to list back)

A partner is far more likely to recommend Lustique if Lustique visibly recommends them too. A simple static-content page:
- New page `site/src/pages/vendors.astro` — a curated, Zandeline-maintained list (start as a static array in `site/src/data/vendors.ts`, matching the existing `team.ts` pattern — no admin UI needed for v1, this is a handful of hand-picked partners, not hundreds) of venues/photographers/planners Lustique genuinely recommends, each with a name, one-line note, and outbound link.
- Linked from the footer and/or a "Vendors we love" nav item — low-effort, high-trust content that also gives Google another indexed page with outbound links to real local businesses (a minor SEO signal on top of the primary purpose).

**Explicitly out of scope for v1:** a self-serve partner portal, automated commission/kickback tracking, or anything resembling a paid-referral scheme — POPIA and plain reciprocity (mutual recommendation, no money changing hands) keep this simple and low-risk. If Zandeline wants a paid-referral structure later, that's a distinct, bigger scope (contracts, payouts) — not assumed here.

### Testing

- `referral.test.ts` (new, alongside existing `worker/src/booking/*.test.ts` patterns) — the enquiry handler stores `referral_source` when present in the POST body, stores `null` when absent, and never fails the whole enquiry if the field is malformed (truncate/sanitize, never 400 on this alone — a tracking field must never block a real lead).
- Existing `enquiries.test.ts`/`enquiries.ts` admin-list rendering — extend with a case asserting the referral source renders when set, and renders nothing (not a broken cell) when absent — mirrors the existing `town ? esc(town) : '<span>—</span>'` pattern already in `enquiries.ts:106`.

---

## Part G — Outstanding items from the existing SEO spec (tracking only, not re-scoping)

Everything below is already fully specified in [`2026-07-03-lustique-seo-discoverability-spec.md`](2026-07-03-lustique-seo-discoverability-spec.md) — this section just states current status so the program has one place to check progress.

**Blocking everything downstream (Part D of that spec):**
- GA4 real property + Google Search Console verification — `GA_MEASUREMENT_ID` in `site/src/data/site.ts:69` is still the literal placeholder `"G-XXXXXXXXXX"`. This is a client action (create the GA4 property, paste the real ID) — the code already reads whatever value is there, no further build needed once it exists.

**Reviews (channel 1) — code is done, one client action away from live:**
- `src/lib/googleReviews.ts` + the homepage's real-review display are built and deployed, but currently inactive: confirmed live (`curl` check, 2026-07-09) that the homepage still renders the static fallback testimonials, not real Google reviews — meaning `GOOGLE_PLACES_API_KEY`/`GOOGLE_PLACE_ID` aren't yet set as Cloudflare Pages build environment variables. Setup steps are already documented in `.env.local.example`. Once set, the next deploy shows real reviews automatically.
- The 48h post-wedding review-request email (`worker/src/booking/review-email.ts`) is live and already pointing at a real `business_settings.google_review_url` (confirmed set, 2026-07-09) — this part needs no further action at all.

**Remaining on-site warnings (from that spec's Part A, status unverified as of this program spec — verify before assuming shipped):**
- Item 8: portfolio gallery fetched client-side instead of server-side (delays indexing).

**Off-site (B1/B3/B4 from that spec)** — GBP claim/optimization, citation cleanup, backlink outreach — all pure operational tasks, tracked in the ops playbook, not here.

---

## Priority order across the whole program

1. **Client actions that unblock the most (do these first, ~30 min total, zero code):** set `GA_MEASUREMENT_ID`, set up Google Places API key + Place ID for review display. Both make already-shipped code start working immediately.
2. **Execute the marketing email plan** (channel 3) — biggest re-engagement lever sitting fully scoped and unbuilt.
3. **Build Part F (referral attribution + vendors page)** — smallest net-new build in this spec, unlocks channel 4.
4. **Operational motions** (ops playbook) — GBP optimization, citations audit, backlink outreach, partner outreach calls, organic social calendar. These run in parallel with the above and never block them.
5. **Verify/ship remaining SEO warning (item 8)** — small, not urgent.

None of this replaces Meta ads' *speed* — organic channels compound over 3–6 months, not days. The goal is reducing dependency, not eliminating paid acquisition as an option.
