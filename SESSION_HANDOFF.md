# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Post Wave D+E polish · **Updated:** 2026-06-23

## ▶ NEXT (Sonnet, fresh session)

**Model:** Sonnet · **Lane:** Build · **Branch:** `main`

**Start with:** `next` in the Lustique project folder.

---

### TASK 1 — Scrap Sanity (replace with Supabase queries)

Sanity was never seeded. Every page that queries Sanity currently renders empty. Replace all Sanity data sources with direct Supabase/Storage queries, then remove the packages.

**Files to replace (Sanity → Supabase):**

| Page | Current Sanity source | New Supabase source |
|---|---|---|
| `site/src/pages/blog.astro` | GROQ blog posts | `GET /rest/v1/blog_posts?published=eq.true&order=published_at.desc` |
| `site/src/pages/blog/[slug].astro` | GROQ blog post by slug | `GET /rest/v1/blog_posts?slug=eq.{slug}&published=eq.true` |
| `site/src/pages/team.astro` | GROQ team members | `GET /rest/v1/artists?active=eq.true&order=name.asc` |
| `site/src/pages/portfolio.astro` | GROQ portfolio images | Supabase Storage list + `portfolio_images` table for ordering |
| `site/src/pages/services.astro` | GROQ services | Static content (services don't change — hardcode or keep static) |
| `site/src/pages/index.astro` | GROQ testimonials | Static for now (no testimonials table yet) |
| `site/src/pages/sitemap.xml.ts` | GROQ for blog slugs | Supabase `blog_posts` query |

**Delete these files entirely:**
- `site/src/lib/sanity.ts`
- `site/src/lib/imageUrl.ts`
- `site/src/lib/sanity.test.ts`
- `site/src/queries/portfolio.ts`
- `site/src/queries/team.ts`
- `site/src/queries/services.ts`
- `site/src/components/Photo.astro` (replace with plain `<img>` tags)

**Remove from `site/package.json`:**
- `@sanity/client`
- `@sanity/image-url`

Check for any `astro-portabletext` usage too (`astro-portabletext-0.13.0.tgz` in root).

**Public blog body rendering:** `blog_posts.body` is stored as plain text (not portable text). Render as `<pre>` or markdown if the blog.ts admin form writes markdown; check what's in the DB first.

**`blog_posts` table schema (migration 0016):**
```
id, title, slug, excerpt, body (text), published (bool), published_at (timestamptz), created_at
```

**`artists` table schema (migration 0013):**
```
id, name, email, active (bool), created_at
```

**Portfolio public page:** Fetch from Supabase Storage `portfolio` bucket. Use `portfolio_images` table for ordering (`ORDER BY position ASC`). Filter by artist when `?artist=name` param. Public URL pattern: `${SUPABASE_URL}/storage/v1/object/public/portfolio/{storage_path}`.

After replacing all pages: run `npx astro build` in `site/` and confirm `dist/` builds cleanly. Then `npm remove @sanity/client @sanity/image-url` in `site/`.

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

### Worker (lustique-form-handler) — version `d39c267e`
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
- ⚠ All dynamic pages (blog, team, portfolio, services) currently render **empty** — they query Sanity which was never seeded. **TASK 1 above fixes this.**

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
