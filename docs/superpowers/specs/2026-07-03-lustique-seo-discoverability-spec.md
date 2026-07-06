# Lustique — SEO & Discoverability Spec

Goal: rank in the top Google results (organic + Maps/local pack) for bridal makeup artist / bridal hairstylist searches in Pretoria and greater Gauteng.

Two things decide that ranking, and the site currently only covers one of them:
- **On-site technical SEO** — can Google crawl, index, and understand the site. Foundation is already strong (see Part A).
- **Off-site local SEO** — Google Business Profile, citations, reviews, backlinks. This is what actually wins the Maps 3-pack for "bridal makeup artist near me" queries, and **none of it exists yet**. For a local service business this typically outweighs on-page work 2:1.

Both parts are required. Part A alone will not produce a top listing.

---

## Part A — On-site technical SEO (audit findings)

Full audit: agent `searchfit-seo:seo-auditor`, 2026-07-03. Overall score 78/100 — mature foundation (shared `BaseLayout.astro` SEO template, correct `astro.config.mjs` site URL, LocalBusiness JSON-LD with full NAP, single-H1 discipline, zero client JS islands, optimized font loading, strong color contrast). Gaps below are specific, not structural.

### Critical (fix first)
1. **Sitemap `lastmod` is one hardcoded constant** (`site/src/pages/sitemap.xml.ts:13`, `STATIC_LASTMOD = "2026-06-21"`) applied to every page regardless of actual change date. Drop it or generate per-page.
2. **Blog posts emit no `BlogPosting` JSON-LD** (`site/src/pages/blog/[slug].astro`). Add via the existing `jsonld` prop on `BaseLayout` (same pattern as `services.astro`).
3. **Every page shares one OG/Twitter image** (`OG_IMG` in `site/src/data/site.ts:2`, used by all pages via `BaseLayout.astro:34,39`). Add an `ogImage` prop to `BaseLayout`, pass post/page-specific images from `blog/[slug].astro` and `portfolio.astro`.
4. **Portfolio gallery images all share identical alt text** (`portfolio.astro:99`). Needs an `alt_text`/`caption` column on the Supabase `portfolio_images` table so each image gets `"{look type} bridal makeup by {artist} — Lustique Co., Pretoria"` — this is the single highest-value Google Images fix for bridal-specific search.

### Warnings
5. Booking-flow confirmation pages (`thank-you.astro`, `booking-confirmed.astro`, `booking-declined.astro`, `booking-received.astro`) are indexable but shouldn't be — add `robots="noindex"` (pattern already used correctly on `your-quote.astro`, `invoice.astro`).
6. No `Review`/`AggregateRating` schema despite real testimonials rendering on the homepage (`index.astro:13,123-135`). Add to `SITE_JSONLD` in `site/src/data/site.ts` — this is what enables star ratings in search snippets and feeds local-pack trust signals.
7. Images are JPG/PNG only, no WebP/AVIF, no `<picture>`/srcset (`Photo.astro:14-22`). Move to `astro:assets`' `<Image>` component — matters more than usual here since brides browse portfolios on mobile data.
8. Portfolio gallery is fetched 100% client-side (`portfolio.astro:56-57`) instead of server-side like `team.astro` already does correctly — delays indexing of the gallery's actual image content.
9. `team.astro` / `portfolio.astro` titles and H1s don't include "Pretoria" while homepage/services do — add for consistency.

### Opportunities
- GA4 measurement ID is still a placeholder (`site/src/data/site.ts:39`) — wire to a real property before launch.
- No Google Search Console verification meta tag anywhere — add once GSC property exists.
- No service-area landing pages for Limpopo/Mpumalanga/North West, which the `areaServed` schema already claims — the claim currently outpaces on-page content. Low priority unless growth outside Pretoria matters commercially.

### Passing — no action needed
`robots.txt`, `astro.config.mjs site:`, canonical URLs, single-H1 discipline, NAP consistency across Footer/contact/terms/privacy/JSON-LD, existing LocalBusiness/BeautySalon + Service + FAQPage schema, font-loading strategy, image lazy-loading/width/height, color contrast (7.79:1 body text — brand's muted palette does not hurt accessibility).

**Effort estimate for Part A: 1–2 focused build sessions.** Items 2–4 and 6 are the highest-leverage; do those first.

---

## Part B — Off-site local SEO (the part that isn't built yet)

This is what determines whether Lustique shows up in the Google Maps 3-pack and top organic results for "bridal makeup artist Pretoria" / "bridal hairstylist near me" — the actual queries brides run. None of this lives in the codebase; it's business/operations setup, but it's a hard requirement for the stated goal.

### B1. Google Business Profile (highest single lever)
- Claim/verify a GBP listing if not already done, category = **Make-up Artist** (primary) + **Hair Salon** (secondary), exact NAP match to the site (`242 Frangipani Street, La Montagne, Pretoria, 0184` / `+27 67 925 3894`).
- Upload a large, regularly-refreshed photo set (portfolio looks, team, workspace) — GBP photo volume/recency is a ranking factor.
- Enable messaging/booking link → point at the site's booking flow.
- Post weekly GBP updates (offers, recent weddings, seasonal looks) — active profiles outrank dormant ones with identical review counts.
- Set service area to match the `areaServed` schema already in the code (Gauteng, Limpopo, Mpumalanga, North West).

### B2. Reviews
- Systematic post-wedding review request (email/WhatsApp) funneling brides to the GBP listing — review count + recency + response rate are top-3 local ranking factors.
- Owner responses to every review within 48h.
- Once GBP reviews exist in volume, mirror a curated subset into the `Review`/`AggregateRating` schema from Part A item 6 — schema alone with zero real GBP reviews looks manipulative to Google; the two need to move together.

### B3. Citations (NAP consistency across the web)
- Get Lustique listed with identical NAP on: local wedding directories (e.g. local South African wedding vendor sites — Confetti, WeddingWire ZA equivalents), Bing Places, Apple Maps/Business Connect, Facebook/Instagram business info, Yellow Pages ZA.
- Any existing listing with mismatched name/address/phone actively hurts — audit for old/incorrect citations first.

### B4. Backlinks
- Wedding vendor directories (do-follow where possible).
- Local wedding photographers/venues/planners — a link-exchange or "vendors we recommend" placement is standard and effective in the wedding industry.
- Guest content or feature placement on SA bridal blogs/publications.
- Local business associations / chamber of commerce listing.

### B5. Content targeting local + long-tail intent
- The blog already exists (`blog-2026-trends` etc.) — keep publishing toward long-tail bridal queries ("how much does bridal makeup cost in Pretoria", "bridal hair trial checklist") once Part A item 2 (BlogPosting schema) ships, so posts are eligible for rich results.
- Location-modified service copy already present on homepage/services; consider whether dedicated location pages (Part A opportunity) are worth it once B1–B4 are running — off-site signals typically need to exist before extra pages compound them.

---

## Priority order (combined)

1. Ship Part A criticals (2–4, 6) — 1 session.
2. Set up/verify Google Business Profile (B1) — no code, business task, can start in parallel today.
3. Start the review-request funnel (B2) — no code, ongoing.
4. Audit + fix existing citations (B3) — one-time cleanup.
5. Ship Part A warnings (5, 7, 8, 9).
6. Backlink outreach (B4) — ongoing.
7. Reassess service-area pages once B1–B4 show traction.

Ranking top-3 for "bridal makeup artist Pretoria" is realistically a 3–6 month effort once B1–B3 are live — the code fixes alone will not get there without the off-site work.

---

## Part C — Build log (2026-07-03)

### Shipped
- **Sitemap honesty**: removed the fake single `STATIC_LASTMOD` constant. Static pages now emit no `<lastmod>`; blog posts (once the CMS has real ones) get their genuine `updated_at`. ([sitemap.xml.ts](../../../site/src/pages/sitemap.xml.ts))
- **`BlogPosting` JSON-LD** on all three live Journal posts — `blog-choosing-artist.astro`, `blog-bridal-trial.astro`, `blog-2026-trends.astro` — plus `BreadcrumbList`. No fabricated `datePublished` (see "Deliberately not done" below).
- **Per-page `ogImage`**: `BaseLayout.astro` now accepts an `ogImage` prop; blog posts pass their Supabase `cover_url` (falling back to the brand share image if none is set).
- **Booking-flow confirmation pages noindexed**: `thank-you`, `booking-confirmed`, `booking-declined`, `booking-received` now send `robots="noindex"`.
- **Local-keyword consistency**: `team.astro` and `portfolio.astro` titles/descriptions now include "Pretoria," matching the homepage/services pattern.
- **Portfolio alt text** now differentiates by artist name (`"Bridal hair and makeup by {artist} — Lustique Co., Pretoria"`) instead of one identical string for every image — done in the existing client-side fetch, no schema change needed.
- **Images converted to WebP/AVIF via `astro:assets`**: moved the 9 actually-used local images (`hero`, `res`, `s1–s3`, `t1–t4`) from `public/assets/` into `src/assets/` and imported them properly; `Photo.astro` and the homepage hero now render through Astro's `<Image>` component with `formats={["avif","webp"]}`, responsive `widths`, and hashed URLs. Verified in dev — images now serve as `f=webp` through Astro's `/_image` pipeline. (Supabase-hosted images — team photos, portfolio gallery — are untouched; seebelow.)

### Fixed along the way (not in the original audit — found while implementing)
- **Live 301-to-404 bug**: `public/_redirects` was already 301-redirecting `/blog-choosing-artist.html` etc. to `/blog/choosing-artist.html`, but the `blog_posts` Supabase table is currently **empty** — those target pages don't exist. Any real traffic or backlink hitting the old URLs was being redirected into a dead page. Removed the three redirect lines (commented, with a note on when to safely re-add them) so the three real, live posts keep serving at their current URLs. Also added those three URLs to the sitemap — they'd been silently excluded.

### Deliberately NOT done (and why)
- **`Review`/`AggregateRating` schema on the homepage testimonials** — audit flagged this as a quick win; on closer look it's a trap. The testimonials are anonymised ("A Lustique Bride") and self-hosted, with no independent verification. Google's structured-data guidelines explicitly prohibit self-serving review markup, and violating it risks a **manual action that suppresses rich results sitewide** — a much worse outcome than the missing stars. Real star ratings in the Maps/local pack come from the Google Business Profile's actual reviews (Part B2), independent of any on-site schema. Don't add this until testimonials carry a real, named, ideally third-party-linked source.
- **Per-image alt-text captions in the database** — the clean long-term fix is an `alt_text`/`caption` column on `portfolio_images` with an admin field to fill it per photo. Didn't add it today because a column nobody can fill from the admin UI yet is a half-shipped feature; the artist-name-based alt text shipped today is a real improvement without that dependency. Worth a proper follow-up once there's appetite for an admin-panel change.
- **Fabricated `datePublished` on the 3 legacy blog posts** — no real publish date is tracked anywhere in the codebase for these. Rather than invent one, the `BlogPosting` schema omits date fields entirely (not required for eligibility, just recommended).
- **Optimizing Supabase-hosted images (team photos, portfolio gallery)** — `astro:assets` can optimize remote images too, but only by fetching them at build time, which would couple every build to Supabase's availability and add real build-time latency as the portfolio grows. Worth it later via a dedicated image CDN/transform step, not as part of this pass.
- **`astro check`** — blocked by the project convention that `npm install` only runs in Pieter's terminal (this sandbox has no network for installs, and `@astrojs/check`/`typescript` weren't already present). Verified instead by running the dev server and confirming every touched page renders without new errors.

---

## Part D — "Can the site adapt itself?" — critique and a scoped answer

**The honest answer: not fully autonomously, and you don't want it fully autonomous.** Here's why, and what's actually buildable.

What "find where the traffic is and position itself" would require, broken into pieces:
1. **A data feed on real search behavior** — Google Search Console (which queries people actually type, what you rank for today) and GA4 (what happens once they land). **Neither is wired up yet** — `GA_MEASUREMENT_ID` in `site.ts` is still a placeholder, and there's no Search Console verification anywhere in the codebase. This is the actual blocker: there is currently no data source for the site to learn from. Nothing downstream of this works without it.
2. **A way to detect a gap or opportunity** — e.g. "we get impressions for 'bridal hair Centurion' but no clicks," or "a competitor page outranks us for 'bridal makeup Waterkloof.'" This is analysis, and it's very buildable — a scheduled agent run that pulls GSC data + a fresh SEO audit and diffs against last time.
3. **A way to act on it** — this is where "fully autonomous" becomes a bad idea, not just a hard one. Auto-publishing new landing pages, rewriting titles, or generating blog content and pushing it live *without a human in the loop* risks: content that doesn't sound like Zandeline's brand voice, keyword-stuffed pages that read as spam to both readers and Google's helpful-content systems, and schema/claims (like the review example above) that could trigger a manual action — with nobody noticing until rankings drop. Real "self-driving SEO" products (the SearchFit.ai pitch at the end of every audit) still put a human review step before publish, for exactly this reason.

**What I'd actually recommend building**, in order:
1. **Wire up the missing data feeds first** — real GA4 property + Search Console verification. Nothing else in this section works without this, and it's mostly account setup (client-owned, per this project's conventions), not code.
2. **A scheduled monitoring loop** (weekly or biweekly cron agent): pull Search Console performance data + rerun the SEO audit, diff against the prior run, and produce a short report — "these queries are gaining impressions but not clicks," "these pages dropped in average position," "here's a content gap vs. what people are searching." This is a real, buildable "the site finds where the traffic is" — as *reporting*, not silent action.
3. **Human-reviewed content drafts, not auto-publish**: when the monitor spots a gap (e.g. a recurring query with no matching page), it drafts a blog post or service-area page and opens it for review — it does not go live on its own. Given the "quiet luxury" brand voice, an auto-generated page publishing unreviewed is a real brand risk, not just an SEO one.
4. **Only after 1–3 are running and trusted**: consider narrow, low-risk automations — e.g. auto-updating a page's `lastmod` when its content actually changes, or flagging (not fixing) newly-broken internal links.

This is a genuine architecture decision — it needs new integrations (GSC API auth, a scheduled task, a review/approval step) and ongoing token/API cost, not a code tweak. Recommend deciding the scope (just the monitoring report, or also draft-generation) before building it, rather than building the whole thing speculatively.

**Decision (2026-07-03): holding off entirely.** Get GA4/Search Console wired up first; revisit automation once there's real traffic data to justify it.

---

## Part E — Real Google reviews (2026-07-03)

Lustique already has a live Google Business Profile with real reviews — this directly resolves the concern in Part C ("don't fabricate review schema from anonymous testimonials"): a real, independently-verifiable third-party source now exists.

**Shipped:**
- [`src/lib/googleReviews.ts`](../../../site/src/lib/googleReviews.ts) — fetches from the Places API (New) `Place Details` endpoint (`rating`, `userRatingCount`, `reviews` fields) **at build time only** (called from `index.astro`'s frontmatter, never client-side), so request volume tracks deploys, not visitors. Returns `null` on any failure or missing config — never breaks the build.
- `index.astro` now prefers real Google reviews for the homepage testimonial slider (with `"{name} — Google review"` attribution) and the star display, falling back to the existing static `TESTIMONIALS` when reviews aren't configured or the fetch fails. Verified in dev: fallback path renders correctly with zero console/server errors.
- `BaseLayout.astro` gained a `businessJsonLdExtra` prop that merges into the *same* `LocalBusiness` JSON-LD node (not a competing second one) — `index.astro` uses it to attach a real `aggregateRating`/`review` block **only when live Google data is present**, sourced directly from what the API returns (no fabricated counts or ratings).
- Documented the required env vars (`GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID`) in `.env.local.example` with setup notes.

**Not yet done — needs Zandeline/client action, not code:**
- Create/use a Google Cloud project with billing attached (Places API (New) usage rides the standing $200/month Maps Platform credit; check current per-request pricing at mapsplatform.google.com/pricing before assuming a number).
- Enable "Places API (New)", create an API key, restrict it to that API only.
- Find Lustique Co.'s Place ID via Google's [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id).
- Add `GOOGLE_PLACES_API_KEY` and `GOOGLE_PLACE_ID` to the Cloudflare Pages build environment variables (same place the Supabase/HERE keys already live).
- Once added, the next deploy will show real Google reviews and the real aggregate rating — no further code changes needed.

**Deliberately scoped narrow:** used the Places API (New), not the Business Profile API — the latter needs OAuth as the verified owner plus Google's API-access approval process, which is real overhead for a "just display reviews" use case. Places API only returns up to 5 of Google's "most relevant" reviews (not the full list), but the `rating`/`userRatingCount` it returns are the true, whole-profile figures — which is exactly what the schema needs to be honest.

