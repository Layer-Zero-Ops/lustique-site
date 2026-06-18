# Lustique Re-Plan — SEO, Security & Backend Infrastructure (#16)

**Status:** PLAN · Opus planning · 2026-06-18 · covers correction #16 + cookie consent + monitoring + backups.
**Deploy shape (dictates *where* each control lives):** two targets on one zone `lustiqueco.co.za` — `lustique-site` (Astro static via **Workers Assets**, route `/*`) and `lustique-form-handler` (Worker, route `/api/*`). **Classic Pages `_headers` is NOT honoured by Workers-Assets** — so the documented `_headers` plan can't be the mechanism (SECURITY.md doc-drift).

**Current state (audited):** security headers **all MISSING**; rate limiting **all MISSING**; Turnstile **booking-only** (absent on enquiry); SEO **strong** (canonical/OG/Org+Breadcrumb+FAQ+Service JSON-LD/sitemap/robots) with minor gaps; cookie banner **present but fires nothing** (privacy.astro over-claims GA); cron + R2 audit **present**; health-check **MISSING**.

---

## 1. Security headers — zone Transform Rule + Worker wrapper (layered)
**Decision: use both.** A zone **Transform Rule (Modify Response Header)** sets the universal baseline on every response (covers static assets *and* Worker output in one place, dashboard-set, no code); the **Worker wrapper** owns the stricter, page-specific CSP for its rendered HTML.

### 1a. Zone Transform Rule — apply to `http.host eq "lustiqueco.co.za"`, "set" these:
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https://lustiqueco.co.za; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://unpkg.com; connect-src 'self' https://photon.komoot.io https://router.project-osrm.org; frame-src https://challenges.cloudflare.com; upgrade-insecure-requests
```
**Each origin is verified against the codebase, not generic:** `challenges.cloudflare.com` = Turnstile (script+frame); `unpkg.com` = Leaflet on `/quote` (script+style); `photon.komoot.io`+`router.project-osrm.org` = the estimator's geocoder/OSRM `fetch` (connect-src only); `fonts.googleapis.com`/`fonts.gstatic.com` = Cormorant+Manrope. `'unsafe-inline'` is **currently required** (Astro inline `<style>`, `is:inline` `/site.js`); **hardening follow-up (not launch-blocking): per-build nonces/hashes** via an Astro CSP pass.

### 1b. GA4 future-proofing (one-line edit when analytics ships — §4)
Extend the same CSP: `script-src += https://www.googletagmanager.com`; `connect-src += https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com`; `img-src += https://www.google-analytics.com`. Document in SECURITY.md so the analytics build touches the rule.

### 1c. Worker response wrapper (`worker/src/index.ts`)
Add `securityHeaders({ html, noindex })` and apply to **every** response so `/api/*` is hardened even if the zone rule is removed. Fold `securityHeaders({html:false})` into `json()` (`index.ts:82`). Apply `{html:true}` to rendered pages (`renderReviewPage`, `renderInvoicePage`, confirm/mark-paid/balance pages) with a **stricter CSP** (these have inline script/style but load **no** third-party JS: `default-src 'self'; ... script-src 'self' 'unsafe-inline'; connect-src 'self'`). Apply `{html:true, noindex:true}` (adds `X-Robots-Tag: noindex, nofollow`) to **admin + all token-bearing pages** (review/invoice/mark-paid carry secrets in the query string — must never be indexed). **Yoco note:** `pay.yoco.com` is a top-level redirect, not embedded — it belongs in **neither** CSP.

---

## 2. SEO — surgical gaps (current state is strong)
| Item | Action |
|---|---|
| Twitter card | Add explicit `twitter:title`/`description`/`image` in `BaseLayout.astro` (only `twitter:card` exists today). |
| LocalBusiness schema | **Enrich** `SITE_JSONLD` (`site.ts`): `openingHoursSpecification`, `geo` (lat/lng for 242 Frangipani St, La Montagne), `hasMap` (GBP URL once created). |
| Sitemap hygiene | `sitemap.xml.ts`: **remove `404.html`**; add `<lastmod>`; **exclude** transactional/sample slugs (`book`, `your-quote`, `invoice`, `thank-you`, `booking-*`). |
| robots.txt | Add `Disallow: /api/` (admin/review/invoice token URLs live under `/api/`); keep `Sitemap:`. |
| `noindex` sample pages | `your-quote.astro` + `invoice.astro` are hardcoded "Anke" samples → `<meta robots noindex>` (pass a `robots` prop through `BaseLayout`); same for booking-status display pages. |
| hreflang (en-only) | Not required; optionally add self-referential `hreflang="en-za"` + `x-default`. |
| Core Web Vitals | Enable **Cloudflare Web Analytics** (cookieless RUM, no banner — field LCP/INP/CLS day one); Lighthouse-CI baseline on `/`,`/services`,`/quote` into `STANDARDS.md`; **lazy-load Leaflet** (`/quote`) on scroll + `preconnect` to `unpkg.com`/`photon.komoot.io`. |
| Local SEO / GBP | Off-repo data task: seed Google Business Profile with the **exact NAP** matching `SITE_JSONLD` (name, "242 Frangipani Street, La Montagne, Pretoria, 0184", phone), categories Make-up artist + Hair salon/Bridal, service areas = `areaServed`. NAP consistency is the biggest local signal. |

---

## 3. Rate limiting (CF WAF Rate Limiting Rules — all MISSING; key per client IP)
| Endpoint | Threshold | Window | Action | Rationale |
|---|---|---|---|---|
| `POST /api/booking/request` | 5 | 1 min | Managed Challenge→block | bride submits once; tolerate the one auto-retry |
| `POST /api/enquiry` | 8 | 1 min | Managed Challenge | **honeypot-only** surface (softest target) |
| `POST /api/booking/yoco-webhook` | 60 | 1 min | **Log only (never block)** | Yoco legitimately retries; signature is the gate; alert on spikes; allowlist Yoco IPs if published |
| `/api/admin/*` | 10 | 5 min | Block | shared secret in URL = primary brute-force defence until Phase-1 auth |
| review/confirm/mark-paid/invoice | 20 | 1 min | Managed Challenge | token-gated; caps token brute-forcing; tolerant of email-scanner prefetch |
| Whole-zone fallback | 200 | 1 min | Managed Challenge | DDoS smoothing for the static site |
If free-tier rule count is exhausted, prioritise: **admin → booking/request → enquiry → zone fallback** (webhook rule is monitoring-only, drop first).

---

## 4. POPIA cookie consent — consent-gated GA4
Banner exists but fires nothing; privacy.astro over-claims GA (real mismatch). Model: **nothing non-essential before explicit Accept.** Before consent: site + Turnstile (security, legitimate interest) + Cloudflare Web Analytics (cookieless, exempt) only. On **Accept**: set `lc_cookie=accepted`, **dynamically inject** GA4 `gtag.js` (must not exist in the DOM until consent) with `consent default denied` → `update analytics_storage:granted`. On **Decline**: inject nothing; if previously loaded, `update analytics_storage:denied`. Replace the dead block in `site/public/site.js` (`:27-38`) with the consent-gated loader (GA4 id at deploy). Companion fixes: footer **"Manage cookies"** link (withdrawal must be as easy as granting — clears `lc_cookie`, re-opens banner); fix `privacy.astro` (state GA4 is consent-gated, list `_ga`/`_ga_*`, retention, withdrawal); ship the §1b CSP edit **with** this or GA4 is blocked. The booking form's `consent_at` stamp (`0001:31`) is a **separate** lawful basis (data processing) and stays.

---

## 5. Health-check + monitoring (MISSING)
**`GET /api/health`** on the Worker (insert before the enquiry catch-all `index.ts:183`): liveness + a 2s-abort-bounded shallow DB ping (`business_settings?select=key&limit=1` — cheapest table, no PII), returns `{ok, service, db, ts}` 200/503, **no secrets/PII**, covered by `Disallow: /api/`. The daily cron `keepWarm()` already defeats the free-tier 7-day pause; `/api/health` is the *externally pollable* surface.
**Alerting (all free tier):** Cloudflare Health Checks on `/api/health` (expect 200 + `"ok":true`, 60s, 3-fail) **and** on `/` (distinguishes Worker vs assets); Cloudflare Notifications → `info@lustiqueco.co.za` (+ Pieter) for health-check status, Worker exception spikes, origin errors, rate-limit triggers; an external monitor (UptimeRobot/BetterStack free) polling `/api/health` every 5 min for independent alerting.

---

## 6. Backups — tier + responsibility
**Now:** Supabase **Free** (daily backups 7-day retention, **no PITR**, pauses after 7-day inactivity — defeated by keep-warm). R2 append-only audit log is the deliberate no-PITR net.
**Recommendation:** upgrade to **Supabase Pro (~$25/mo)** the moment real Yoco deposits flow — **launch-gating, not optional** (daily backups, 7-day retention by default; PITR is a $100/mo add-on, **not** needed at this data volume — R2 audit + Pro daily backups suffice). Provision `af-south-1` if offered (POPIA), else EU + §72 note. Belt-and-braces (free): weekly `pg_dump` of the 4 tables to R2/Drive.
**Responsibility (POPIA):** Supabase org is **client-owned** → **Zandeline owns the backup obligation + Pro billing**; **LZ configures + documents + confirms on the go-live checklist**. Add to SECURITY.md §8 + `CLIENT-DELIVERY-CHECKLIST.md`: "Supabase Pro active before first live deposit; region confirmed; R2 audit verified writing." Also: Sanity content export schedule, image originals backed up, GoDaddy auto-renew on, R2 lifecycle = retain indefinitely (it's the POPIA processing record — never auto-expire).

---

## 7. HTTPS / TLS + bot protection
**HTTPS auto** via CF Universal SSL (free, auto-renew). Verify at go-live: TLS mode **Full (strict)**; **Always Use HTTPS**; `www`↔apex redirect to canonical apex (BaseLayout uses bare apex). **HSTS:** ship `max-age` first; add `preload` + submit to the preload list **only** once cert + all subdomains are stable (`preload` is a near-irreversible one-way door).
**Bot protection:** **ADD Turnstile to `/api/enquiry`** — the highest-value gap (honeypot-only, sends 2 Brevo emails/hit against a 300/day free quota; a flood spams `info@` and burns quota). Add the widget to the `/quote` enquiry form + `verifyTurnstile()` in the handler (`index.ts:194`), mirroring booking. **Do NOT** put Turnstile on admin (rate-limit + Phase-1 auth instead) or on token-gated bride/operator links (would break the flow; HMAC token + single-use + TTL + rate-limit is correct).

---

## 8. Launch-gating vs fast-follow
**Launch-blocking (before live deposits):** the 🔴 Yoco webhook fix (spec §0 — *the* blocker); security headers (§1a+1c); HSTS + Full-strict TLS; **Supabase Pro** (§6); `/api/enquiry` Turnstile (§7); admin + booking rate limits (§3); `/api/health` + Health Check + Notifications (§5); consent-gated GA4 + privacy.astro fix (§4).
**Fast-follow:** Twitter meta + sitemap hygiene + sample-page `noindex` (§2); CSP nonce migration; GBP seeding (§2); weekly `pg_dump`.
**Doc reconciliation:** flip SECURITY.md §1/§8 `�ⁿ` items to reference the Transform Rule + `/api/health` + Supabase-Pro responsibility (drop the "Pages `_headers`" mechanism); fix the stale `worker/wrangler.toml` secret inventory (still labels Yoco "Future (S4-v2)" though code requires it).

**Files:** `worker/src/index.ts` (`securityHeaders`, `/api/health`), `worker/src/booking/{review,invoice,confirm,balance,admin}.ts` (apply wrapper), `site/src/layouts/BaseLayout.astro` (Twitter, `noindex` prop), `site/src/data/site.ts` (enrich JSON-LD, GA4 id), `site/public/site.js` (consent-gated GA4), `site/public/robots.txt` (`Disallow: /api/`), `site/src/pages/sitemap.xml.ts`, `site/src/pages/{your-quote,invoice}.astro`, `site/src/scripts/enquiry.ts` (+`/quote` Turnstile), `SECURITY.md`, `worker/wrangler.toml`. **Dashboard-only (no code):** zone Transform Rule, WAF rate-limit rules, Health Checks + Notifications, TLS Full-strict + HSTS-preload decision, Supabase Pro + region, GBP seeding.
