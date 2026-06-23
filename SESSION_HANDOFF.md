# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Sanity scrap complete · **Updated:** 2026-06-23

## ▶ NEXT (Sonnet, fresh session)

**Model:** Sonnet · **Lane:** Build · **Branch:** `main`

**Start with:** `next` in the Lustique project folder.

---

### TASK 1 — Scrap Sanity + UI polish ✅ DONE (2026-06-23, commits `dd43743`–`e94d744`)

All Sanity code replaced with Supabase REST queries. Build clean (27 pages, 0 errors).

**What was done:**
- `site/src/lib/supabase.ts` — new thin REST client (native fetch, no new npm packages)
- `supabase/migrations/0018_public_read_policies.sql` — **Pieter must apply this** (public read for `artists` + `portfolio_images`)
- blog/team/portfolio/sitemap → Supabase queries; services/index → fully static
- `Photo.astro` simplified to `src`-only (local assets)
- All Sanity libs, queries, PortableText components deleted
- `@sanity/client`, `@sanity/image-url`, `astro-portabletext` removed from `package.json`
- Quote page: removed "Secure your date" section at bottom
- Dashboard nav: renamed "Enquiries" → "CRM"; Forms "CRM →" button → "View →"
- Website tab: replaced Sanity card with Blog + Portfolio quicklinks
- Thank-you page: redesigned with step cards + centred tiles, no emojis (`e94d744`)

**Pieter actions required before site pages work in production:**
1. Apply migration 0018: `supabase db push` or run SQL in Supabase dashboard
2. Add `SUPABASE_URL` + `SUPABASE_ANON_KEY` as CF Pages build env vars (Settings → Environment variables)
3. Run `npm install` in `site/` to prune Sanity from node_modules
4. Delete stray `astro-portabletext-0.13.0.tgz` from repo root (untracked)

---

### TASK 2 — Booking flow simplification review

**Pieter's clarification (2026-06-23):**
> The estimator doubles as the quote. When a client submits the booking form, they've already seen what it costs. If Lustique is available for their date, they receive an invoice (Yoco payment link) to secure the booking. There is no separate quote step.

**Current flow vs. intended flow:**

```
CURRENT:  requested → quote_sent (quote email + accept/reject links) → accepted → deposit_paid → settled
INTENDED: requested → Zandeline reviews → Yoco invoice sent → deposit_paid → settled
```

**What this means for the codebase:**
- The "Send Quote" button in the Forms tab / booking detail currently sends a branded quote email with `accept_url`/`reject_url` token links and moves status to `quote_sent`. This is the step to reconsider.
- The `quote_sent` + `accepted` statuses are intermediate states in the old flow. In the new flow these could be collapsed.
- **Option A (minimal change):** Repurpose "Send Quote" → "Confirm & Send Invoice" — skip the accept/reject links, send the Yoco deposit link directly, move to `deposit_paid` on payment.
- **Option B (bigger change):** Add a new "Send Yoco Deposit Link" button on the `requested` booking detail that directly triggers the Yoco checkout and sends the payment email. Rename `quote_sent` → `invoice_sent`.
- The **manual Quote Composer** (`/api/admin/quotes/new`) still makes sense for non-standard jobs (custom packages, editorial, matric farewells quoted manually).

**Recommended next step:** Discuss with Pieter which option to go with before changing the state machine. This is a one-way-door decision — database status values and email tokens are tightly coupled.

🟣 **This needs an Opus planning session before Sonnet builds it.**

---

### TASK 3 — Pieter actions still open

1. **Real artist emails** — collect from Zandeline, update `artists` table (currently placeholder `firstname@lustiqueco.co.za`)
2. **GA4 Measurement ID** — swap `G-XXXXXXXXXX` in `site/src/data/site.ts` once GA4 live
3. **CF Email Routing** — `info@lustiqueco.co.za` rule still points to Gmail forward. Can upgrade to "Send to Worker" once Email Inbox feature is built (see backlog).
4. **iCal subscriptions** — share `https://lustiqueco.co.za/api/calendar.ics?key=<ICAL_KEY>` with Zandeline + all 9 artists (key: CF dashboard → Workers → lustique-form-handler → Secrets → `ICAL_KEY`)
5. **E2E smoke test** — submit a test booking on the live site, trace through to the admin dashboard

---

## Current state (as-built, 2026-06-23)

### Worker (lustique-form-handler) — version `6d7db05` (deployed 2026-06-23)
- All booking flows live ✅
- Admin dashboard: Bookings / Clients / Content / Admin nav ✅
- Calendar with occasion badges (💍 wedding, 🎓 matric, ✂︎ trial), slot editor ✅
- Quotes tab: shows `requested` + `quote_sent` pipeline with status badges ✅
- Manual Quote Composer: `/api/admin/quotes/new` with Brevo email send ✅
- Forms unified inbox + Send Quote flow ✅
- Contacts: read view + Add individual / CSV bulk import ✅
- Enquiries CRM: list + detail + status update ✅
- Portfolio: Supabase Storage gallery, artist filter tabs, ↑/↓ image ordering (portfolio_images table) ✅
- Blog: CRUD (create, edit, draft/publish) ✅
- Website tab: placeholder with live site + Sanity links ✅
- Calendar feed: `/api/calendar.ics?key=ICAL_KEY` ✅

### Supabase migrations applied (0001–0017)
- 0016: `blog_posts` ✅ (applied by Pieter)
- 0017: `portfolio_images` ✅ (applied via MCP this session)

### Site (Cloudflare Pages — auto-deploys from `main`)
- Public site live at `lustiqueco.co.za` ✅
- Favicon: updated to logo.png ✅
- Sanity scrapped — all pages now use Supabase or static content ✅ (commit `dd43743`)
- ⚠ Pages will render with real data once migration 0018 is applied + CF Pages env vars are set

### Known backlog (not blocking go-live)
- **Email Inbox** — migration 0018, CF Email Routing "Send to Worker", `email` event handler, `/api/admin/email` tab. Parked until Sanity scrap + flow decision are done.
- **Testimonials** — no table yet; index.astro renders static/empty
- **Brevo custom SMTP** — not connecting; auth emails come from `noreply@mail.app.supabase.io`. Functional, not branded.

---

## Key files
- `PLAN.md` · `PRICING.md` · `BRAND.md` · `ARCHITECTURE.md`
- `docs/superpowers/specs/` — booking core spec, replan spec
- `docs/RUNBOOK-go-live.md`

## ⇄ Umbrella
**⬆ To umbrella — 🟢 SHIPPED: Dashboard polish wave complete (Sonnet, 2026-06-23)**
Nav restructure, quote composer, tabbed Quotes, portfolio image ordering, Add Contact, Quotes pipeline fix. Migration 0017 applied live. Worker `d39c267e` deployed. ▶ NEXT: scrap Sanity + booking flow decision (Opus).
