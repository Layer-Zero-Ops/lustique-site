# SESSION_HANDOFF — Lustique

**Lane:** 🔵 PLAN SET (Opus → Sonnet) · **Phase:** Wave D+E building · **Updated:** 2026-06-23 (D2 replaced by iCal; enquiry CRM + notifications built; all deployed)

## ▶ NEXT (Sonnet, Build lane) — 🔵 PLAN SET

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` · **Repo:** `github.com/Layer-Zero-Ops/lustique-site` (private)

**Status:** Wave D complete (D2 replaced with iCal feed). Wave E (enquiry CRM + notification bell) built and deployed. Migrations 0013–0015 applied to live DB. Worker deployed (`a82f841b`). ICAL_KEY set as Worker secret.

**▶ NEXT — do in order:**

**1. E2E smoke test (most important — validate everything is live):**
- `lustiqueco.co.za/quote` → fill form → submit
  - Check: `/api/admin/enquiries` has the new lead
  - Check: admin notification bell shows 1 unread within 60s
- Admin login: `lustiqueco.co.za/api/admin/login` → `info@lustiqueco.co.za` / `Lustique2024`
  - Check: dashboard inbox loads
  - Check: "Enquiries" link appears in sidebar nav
- Submit a booking via `/book` → check Supabase `bookings` table has a `requested` row
- Open a `quote_sent` booking in dashboard → confirm artist assign widget appears
- iCal: open `https://lustiqueco.co.za/api/calendar.ics?key=<ICAL_KEY>` in browser → should download a `.ics` file (key is in CF Worker secrets)

**2. iCal subscriptions (Pieter action — one-time):**
- Share subscribe URL with Zandeline + all 9 artists:
  `https://lustiqueco.co.za/api/calendar.ics?key=<ICAL_KEY>` (retrieve key: CF dashboard → Workers → lustique-form-handler → Settings → Variables & Secrets → ICAL_KEY)
- Each person: Google Calendar → **+** next to "Other calendars" → **From URL** → paste → Add calendar

**3. D1 Sanity CMS Task 7 (Pieter must seed content first):**
- Pieter seeds Sanity: 9 team members, 3 blog posts (copy from old `.astro` files), 3 testimonials, site settings
- Tell Sonnet to delete 3 old `blog-*.astro` pages + verify `npx astro build` → `dist/blog/` contains 3 HTML files
- Full list: D1 plan §Pieter (P1–P13)

**4. Collect real artist emails from Zandeline:**
- Replace placeholder `firstname@lustiqueco.co.za` emails in `artists` table
- Run SQL: `UPDATE artists SET email = '<real>' WHERE name = '<name>';` per artist

**5. Yoco portal — confirm online fee rate:**
- Yoco Business Portal → Settings → Pricing → Online Payments → record rate → update `YOCO_FEE_PCT` in `wrangler.toml` + `PRICING.md §9`

---

### Pieter actions still open (carry forward)
1. **E2E smoke test** — see ▶ NEXT above
2. **iCal subscriptions** — share URL with Zandeline + 9 artists (see above)
3. **Migration 0012** — confirm applied: Supabase Dashboard → Database → Migrations (review_email sweep)
4. **Yoco online checkout rate** — verify in portal; update `YOCO_FEE_PCT`
5. **GA4 Measurement ID** — swap `G-XXXXXXXXXX` in `site/src/data/site.ts` once Google Workspace + GA4 live
6. **D1 Sanity CMS** — seed content (see step 3 above); then tell Sonnet to delete old blog pages
7. **Artist emails** — collect real emails from Zandeline; update `artists` table

### Known open (not blocking go-live)
- **Brevo custom SMTP** — still not connecting. Admin magic link comes from `noreply@mail.app.supabase.io`. Functional, not branded. Revisit separately.
- **Admin email template** — Lustique-branded template designed but can't apply without working custom SMTP.

---

### Recently closed (2026-06-23 — this session)
- ✅ **iCal feed (D2 replacement) DONE ✅ 2026-06-23 (Sonnet)** — `b18a931`. `GET /api/calendar.ics?key=<ICAL_KEY>` — RFC 5545 feed of all active bookings. All-day VEVENT per booking (bride name, reference, venue, town, party size). Key auth (401 on wrong/missing key). 12h cache-control + REFRESH-INTERVAL. No Google Cloud needed. 16 TDD tests. Replaces D2 service-account plan entirely — no migration 0014-calendar needed, no `google_event_id` column.
- ✅ **Enquiry CRM (Wave E) DONE ✅ 2026-06-23 (Sonnet)** — `f81dcab`. Migration 0015: `enquiry_received` notification type; `status/notes/contacted_at` on `enquiries`. `GET /api/admin/enquiries` list view (status filter tabs). `GET /api/admin/enquiries/:id` detail view (all fields + occasion rows + message + CRM form). `POST /api/admin/enquiries/:id` PRG update (status/notes; auto-sets `contacted_at` on first transition from 'new'; rejects invalid status). `adminShell` exported; "Enquiries" added to admin nav. `insertNotification` in db.ts — rings bell within 60s of every enquiry submit, Brevo-independent. 14 TDD tests → 404 passing.
- ✅ **Enquiry persistence (migration 0014) DONE ✅ 2026-06-23 (Sonnet)** — `b18a931`. `enquiries` table stores every `/api/enquiry` submit before email delivery. `persistEnquiry` now returns `{id}` for notification linking.
- ✅ **Test fixes DONE ✅ 2026-06-23 (Sonnet)** — `9a0963b`. Fixed 3 failing tests left out of sync with production bug fixes: `countBookingsOnDate` mocks updated to use `Content-Range` header (not JSON body); `handleAdminAuthCallback` no-params test updated to expect 200 HTML (Flow 3 JS extractor).
- ✅ **Migrations 0013–0015 applied to live DB ✅ 2026-06-23** — applied via Supabase SQL Editor (Supabase CLI not available on this machine).
- ✅ **Worker deployed ✅ 2026-06-23** — version `a82f841b`. All Wave D+E code live.
- ✅ **ICAL_KEY secret set ✅ 2026-06-23** — stored in CF Worker secrets (not committed)

### Recently closed (2026-06-22 — previous session)
- ✅ **Production bug fixes · Error 1101 resolved — 2026-06-22 (Sonnet)** — `e908a45`. Two Worker runtime crashes fixed and deployed.
- ✅ **Wave D5 · Dashboard action handlers — CODE COMPLETE** — `1805bd3`. 4 JWT-gated POST handlers (send quote, decline, mark deposit paid, mark balance paid).
- ✅ **Wave D4 · Artist allocation — CODE COMPLETE** — `d0c8ecc`→`27cfed5`. Migration `0013_artists.sql`, artist assign/remove handlers, dashboard widget.
- ✅ **Wave D3 · Rate limiting — DONE** — `a2ff98f`–`bbdeb06`. 5 `[[ratelimits]]` bindings.
- ✅ **Wave D1 · Sanity CMS — CODE COMPLETE** — `9dc2bb8`→`d274492`. Tasks 1–6 + 8 built. Pending Task 7 (Pieter seeds content).

---

## The re-plan (read in this order)
- **Spec:** `docs/superpowers/specs/2026-06-18-lustique-replan-spec.md`
- **Dashboard/data plan:** `docs/superpowers/plans/2026-06-18-lustique-dashboard-data-plan.md`
- **SEO/security/infra plan:** `docs/superpowers/plans/2026-06-18-lustique-seo-security-infra-plan.md`
- **Build sequence (master):** `docs/superpowers/plans/2026-06-18-lustique-replan-build-sequence.md`

## 🟦 Decisions
1. **Yoco fee model — ✅ RESOLVED:** Lustique absorbs the fee.
2. **Review step — ✅ RESOLVED:** Interim token-link review in Wave A.
3. **D2 Google Calendar — ✅ RESOLVED 2026-06-23:** iCal feed replaces service-account approach entirely.

## Current state (as-built)
- `lustiqueco.co.za` **live** via CF Workers Assets ✅
- Worker `lustique-form-handler` deployed (`a82f841b`) ✅
- Supabase migrations 0001–0015 applied ✅
- 404 tests passing ✅
- iCal feed live at `/api/calendar.ics?key=<ICAL_KEY>` ✅
- Enquiry CRM live at `/api/admin/enquiries` ✅

## CI / Deploy state
- **GitHub:** `Layer-Zero-Ops/lustique-site` · 3 commits pushed 2026-06-23 ✅
- **CF Pages:** auto-deploys from `main` ✅
- **Worker:** version `a82f841b` deployed ✅

## Pointers
- Go-live RUNBOOK: `docs/RUNBOOK-go-live.md`
- Key docs: `PLAN.md` · `PRICING.md` · `BRAND.md` · `ARCHITECTURE.md`
- iCal key: stored in CF Worker secrets → ICAL_KEY (retrieve from CF dashboard if needed)

## ⇄ Umbrella
**⬆ To umbrella — 🟢 SHIPPED: Wave D+E complete (Sonnet, 2026-06-23)**
iCal feed replaces D2 Google Calendar (no Google Cloud needed). Enquiry CRM built: lead persistence + notification bell + admin list/detail/edit views. Migrations 0013–0015 applied live. Worker deployed. E2E smoke test still pending Pieter.
