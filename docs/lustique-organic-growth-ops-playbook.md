# Lustique — Organic Growth Ops Playbook

Every task on this page is manual/operational — none of it is code, and none of it is blocked on a build. This is the companion to [`docs/superpowers/specs/2026-07-09-lustique-organic-growth-program-spec.md`](superpowers/specs/2026-07-09-lustique-organic-growth-program-spec.md), which covers the code side of the same five channels. Owner column is a suggestion (Zandeline for anything client-facing/brand-voice, Pieter for anything account/API-key admin) — adjust as makes sense.

## 1. Unblock already-built code (do first — ~30 min, highest leverage)

- [ ] **Create a real GA4 property** and paste its Measurement ID into `site/src/data/site.ts` (`GA_MEASUREMENT_ID`, currently the placeholder `G-XXXXXXXXXX`). *(Pieter)*
- [ ] **Verify the site in Google Search Console** (domain or URL-prefix property for `lustiqueco.co.za`). *(Pieter)*
- [ ] **Set up Google Places API access** so real Google reviews start showing on the homepage automatically (code already ships this, it's just missing keys):
  - [ ] Create/use a Google Cloud project with billing attached (Places API (New) usage rides the standing $200/month Maps Platform credit — check current pricing at mapsplatform.google.com/pricing before assuming a number).
  - [ ] Enable "Places API (New)", create an API key, restrict it to that API only.
  - [ ] Find Lustique's Place ID via Google's [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id).
  - [ ] Add `GOOGLE_PLACES_API_KEY` and `GOOGLE_PLACE_ID` to the Cloudflare Pages build environment variables. Next deploy shows real reviews — no further action needed.
  *(Pieter)*

## 2. Google Business Profile (channel 1 & 2 — highest single lever for local search)

- [ ] Confirm the GBP listing is claimed and verified. It already has real reviews (confirmed live 2026-07-09), so this may already be done — just confirm ownership access.
- [ ] Category = **Make-up Artist** (primary) + **Hair Salon** (secondary).
- [ ] NAP exactly matches the site: `242 Frangipani Street, La Montagne, Pretoria, 0184` / `+27 67 925 3894`.
- [ ] Upload a large, regularly-refreshed photo set (portfolio looks, team, workspace) — photo volume/recency is a ranking factor.
- [ ] Enable messaging/booking link → point at `lustiqueco.co.za/quote.html`.
- [ ] Set service area to Gauteng, Limpopo, Mpumalanga, North West (matches the site's existing schema claim).
- [ ] **Ongoing:** post a weekly GBP update (an offer, a recent wedding, a seasonal look). Active profiles outrank dormant ones with identical review counts.
- [ ] **Ongoing:** respond to every review within 48h (owner responses are a ranking factor, not just courtesy).
*(Zandeline, with Pieter for the initial technical setup)*

## 3. Citations — NAP consistency across the web

- [ ] Audit existing listings first — any old/incorrect NAP (wrong address, old phone number) on an existing listing actively hurts more than having no listing at all.
- [ ] Get listed (or corrected) on: local SA wedding vendor directories (Confetti, WeddingWire ZA-equivalents), Bing Places, Apple Maps/Business Connect, Facebook/Instagram business info, Yellow Pages ZA.
*(Zandeline)*

## 4. Backlinks

- [ ] Reach out to wedding vendor directories for do-follow listings.
- [ ] Reciprocal links with local photographers/venues/planners (this overlaps directly with Part F's referral partnerships below — do these together).
- [ ] Pitch guest content / feature placement to SA bridal blogs/publications.
- [ ] Local business association / chamber of commerce listing.
*(Zandeline, content pitches can be drafted with Claude's help on request)*

## 5. Vendor/venue referral partnerships (channel 4 — pairs with Part F of the growth-program spec)

Once the code side ships (referral link tracking + the "Vendors we recommend" page):

- [ ] Pick 5–10 venues to approach first — start with venues already in `site/src/data/sa-wedding-venues.json` that Lustique has actually worked weddings at (real relationship > cold outreach).
- [ ] Simple pitch: "we list you, you list us" — offer a `?ref=<slug>` link for their site/socials, and ask if they'll list Lustique on their own preferred-vendors page.
- [ ] Track which partners actually send bookings once referral attribution is live (visible in the admin enquiry list) — double down on whichever 2–3 partners produce real leads rather than spreading thin across all of them.
*(Zandeline for the relationship/outreach, Pieter can prep the tracking links once the code ships)*

## 6. Organic social (channel 5 — unpaid Instagram/Facebook)

This is a genuinely different motion from paid Meta ads — no ad spend, no algorithm cap risk, just consistent posting of real work.

- [ ] Set a realistic posting cadence (e.g. 2–3x/week) — consistency matters more than volume.
- [ ] Content mix: real bridal looks (with couple's permission), before/after, behind-the-scenes at trials, team spotlights, seasonal trend posts (ties into the existing blog content — repurpose, don't duplicate effort).
- [ ] Use consistent hashtags/location tags (Pretoria, Gauteng wedding hashtags) — unpaid discovery on Instagram still rewards this.
- [ ] Cross-post blog content (`blog-2026-trends`, etc.) as social snippets instead of writing new copy from scratch.
*(Zandeline — this is brand-voice-sensitive, keep it hands-on rather than automated)*

---

**Review cadence:** revisit this playbook monthly — check off what's actually happened, and once channels 1–2 show measurable traction (GA4/GSC data flowing), reassess whether the SEO spec's "Part D" monitoring loop (a scheduled report on search performance) is worth building. That was explicitly deferred until there's real data to justify it.
