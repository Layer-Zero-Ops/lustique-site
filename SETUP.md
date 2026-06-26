# Lustique — Local Dev Bring-Up

**Day-to-day reference for spinning up the full local stack.**
Branch model: `feature/* → dev (staging) → PR → main (prod)`. Work on feature branches; never commit app code directly to `main`.

## Prerequisites
- Node LTS (`node -v` ≥ 20) + npm
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`supabase --version`)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (`wrangler --version`)
- Docker running (required by `supabase start`)

## 1. Start the local Supabase instance

```bash
# From project root — starts local Postgres + auth + storage + APIs
supabase start

# Output includes:
#   API URL: http://localhost:54321
#   anon key: eyJ…
#   service_role key: eyJ…
#   JWT secret: super-secret-jwt-token-with-at-least-32-characters-long
```

Apply any pending migrations (first time and after pulling new ones):
```bash
supabase db push          # or: supabase migration up
```

## 2. Configure worker secrets

```bash
cd worker
cp .dev.vars.example .dev.vars
# Edit .dev.vars — paste the supabase start output values, Yoco test key, etc.
```

Key values for `.dev.vars`:
| Key | Value |
|---|---|
| `SUPABASE_URL` | `http://localhost:54321` |
| `SUPABASE_SERVICE_KEY` | service_role key from `supabase start` |
| `SUPABASE_JWT_SECRET` | JWT secret from `supabase start` |
| `YOCO_SECRET_KEY` | `sk_test_*` key from Yoco test dashboard |
| `TURNSTILE_SECRET` | `1x0000000000000000000000000000000AA` (always-pass) |

## 3. Start the Worker (local API)

```bash
cd worker
wrangler dev
# Listens on http://localhost:8787 — proxies /api/* requests
```

## 4. Configure site env (first time only)

```bash
cd site
cp .env.local.example .env.local
# Edit .env.local — paste supabase start anon key + URL
```

## 5. Start the Astro dev server

```bash
cd site
npm run dev
# Listens on http://localhost:4321
```

The Astro dev server talks to the Worker at `localhost:8787` for API calls and to the local Supabase at `localhost:54321` for public data queries.

## Staging deployment (smoke test before prod)

```bash
# Deploy staging Worker (uses [env.staging] in wrangler.toml)
cd worker
wrangler deploy --env staging

# Staging Worker URL: staging.lustiqueco.co.za/api/*
# Staging site: auto-built by CF Pages on every push to `dev` branch
# Staging secrets: must be pre-loaded — wrangler secret put <NAME> --env staging
```

## Supabase staging schema (hosted staging — Rung 2)

The hosted staging Worker needs a staging DB. Use the `lustique_staging` schema inside the same Supabase project (free, no 2nd project needed):

```sql
-- Run once in Supabase SQL editor to create the staging schema
CREATE SCHEMA IF NOT EXISTS lustique_staging;
-- Then apply all migrations with search_path set to lustique_staging.
-- See: supabase/migrations/ — run them in order against lustique_staging.
```

> For local dev (TASK-D, payment flows): `supabase start` gives you a fully isolated local DB. The `lustique_staging` schema is only needed for the hosted staging environment.

---

# Lustique Cosmetology — Phase 1 Setup Runbook (historical)

**Status:** Ready to execute
**Last updated:** 2026-06-01
**Who does what:** **Pieter** does account creation + anything needing a credit card or a password (marked 🧍). **Claude** does config files, the Worker, the Sheet structure, and can pair on the technical bits (marked 🤖). Steps with both = we do it together.

> **Golden rule for this whole phase: do not cancel the GoDaddy email plan until the new mailbox has sent *and* received cleanly for 48 hours.** Email is the business's lifeline — we move it with a belt and braces.

---

## Order of operations (why this sequence)

```
1. Cloudflare DNS migration   ← move DNS first, preserving ALL existing records (mail keeps working)
2. Holding page              ← put a simple "coming soon" up (site is currently 404)
3. Google Workspace          ← create, verify domain (TXT now lives in Cloudflare)
4. Email migration           ← copy old mail in via IMAP, THEN cut MX over to Google
5. Brevo                     ← authenticate sending (merge SPF with Google!)
6. Analytics                 ← GA4 + Cloudflare Web Analytics
7. CRM (Google Sheet)        ← build sheet + service account for the Worker
8. Dev plumbing              ← repo, Node, wrangler, API tokens
```

Each phase below is independently checkpointed. Don't start the next until the current one verifies.

---

## Phase 1 — Move DNS to Cloudflare 🧍🤖

**Goal:** Cloudflare runs DNS; GoDaddy stays the registrar only. No mail or site disruption.

**Time:** ~30 min work + up to 24h propagation (usually <1h).

- [ ] 🧍 Create a free Cloudflare account at dash.cloudflare.com
- [ ] 🧍 **Add a site** → enter `lustiqueco.co.za` → choose the **Free** plan
- [ ] 🤖 Cloudflare auto-scans and imports existing GoDaddy DNS records. **We review the imported list together** against what's currently at GoDaddy. **Critical:** confirm these are all present and correct before continuing:
  - [ ] Current **MX records** (the existing GoDaddy email routing) — must carry over exactly, or mail breaks
  - [ ] Any **A / CNAME** records (website, `www`, subdomains)
  - [ ] Any existing **TXT** (SPF, verification) records
  - [ ] **Manually add anything Cloudflare missed** before the nameserver switch
- [ ] 🧍 In GoDaddy: change the domain's **nameservers** to the two Cloudflare gave you (e.g. `xxx.ns.cloudflare.com`)
- [ ] ⏳ Wait for Cloudflare to show the domain as **Active** (email arrives when ready)
- [ ] ✅ **Checkpoint:** send a test email to `info@lustiqueco.co.za` from a personal account → it should still arrive (proves MX survived the move). Existing site (if any) still resolves.

> **Set SSL/TLS mode to "Full (strict)"** in Cloudflare once Pages is connected (Phase 8). For now, leave defaults.

---

## Phase 2 — Holding page 🤖

**Goal:** the domain shows something gracious instead of a 404 while we build.

**Time:** ~20 min.

- [ ] 🤖 I'll ship a single elegant "Something beautiful is coming" page (on-brand: ivory, Cormorant, the logo) to a Cloudflare Pages project
- [ ] 🤖 Point the apex domain + `www` at it
- [ ] ✅ **Checkpoint:** visiting lustiqueco.co.za shows the holding page over HTTPS

> This also proves the Pages + DNS + SSL path end-to-end *before* we depend on it for the real site.

---

## Phase 3 — Google Workspace 🧍

**Goal:** branded mailboxes on `lustiqueco.co.za`, ready to receive migrated mail.

**Time:** ~30 min. **Cost:** Business Starter ≈ $6/user/mo (needs a card).

- [ ] 🧍 Sign up at workspace.google.com → **Business Starter**
- [ ] 🧍 Use `lustiqueco.co.za` as the domain
- [ ] 🧍 Google gives a **TXT verification record** → 🤖 we add it in **Cloudflare DNS** → 🧍 click Verify
- [ ] 🧍 Create the mailbox(es):
  - [ ] `info@lustiqueco.co.za` (primary — replaces the existing one)
  - [ ] *(optional)* `zandeline@`, `bookings@`, `team@` — decide if wanted
- [ ] ⛔ **Do NOT change MX records yet.** Mail still flows to GoDaddy at this point. We migrate data first.
- [ ] ✅ **Checkpoint:** you can log into mail.google.com as `info@lustiqueco.co.za` (empty inbox for now)

---

## Phase 4 — Email migration (the careful one) 🧍🤖

**Goal:** old mail copied into Workspace, then live mail cut over to Google with no gap.

**Time:** migration runs hours-to-a-day in the background; cutover ~30 min + 48h watch.

### 4A — Copy existing mail in (no disruption)
- [ ] 🧍 Gather the GoDaddy IMAP details: server (e.g. `imap.secureserver.net` or `mail.lustiqueco.co.za`), port **993 / SSL**, username `info@lustiqueco.co.za`, the mailbox password
- [ ] 🧍 Workspace Admin → **Data → Data migration** → source **IMAP** → enter the GoDaddy details → start
- [ ] ⏳ Let it finish (large/old inboxes take a while). This only *copies* — live mail is untouched.
- [ ] ✅ **Checkpoint:** folders, sent items, and attachments all present in the new mailbox

### 4B — Cut MX over to Google 🤖

> **Live-state check (2026-06-04, via `dig`):** DNS is at **GoDaddy** (`ns55/56.domaincontrol.com`). Current MX = `0 smtp.secureserver.net`, `10 mailstore1.secureserver.net`. Current SPF = `include:secureserver.net -all`. ⚠️ **A DMARC `p=quarantine` is ALREADY live** (`rua=…@onsecureserver.net`) — so the moment `info@` sends via Google it will be quarantined unless Google SPF+DKIM align. Relax DMARC to `p=none` during cutover, then re-tighten. IMAP source for 4A = `imap.secureserver.net:993` (SSL).

- [ ] 🤖 In DNS (GoDaddy now, or Cloudflare if moved first), **replace** the secureserver.net MX records with Google's **single current record** (Google retired the old 5-record `ASPMX…` set):
  - `1 smtp.google.com`  *(some panels want a trailing dot: `smtp.google.com.`)*
- [ ] 🤖 Change SPF (TXT, root) from the secureserver value to: `v=spf1 include:_spf.google.com ~all`  *(we'll extend this for Brevo in Phase 5 — do not create a second SPF record later)*
- [ ] 🤖 **Relax the existing DMARC** during cutover: edit `_dmarc` to `v=DMARC1; p=none; rua=mailto:info@lustiqueco.co.za` (re-tighten to `p=quarantine` after 48h clean)
- [ ] 🧍🤖 Enable **DKIM** in Workspace admin (Gmail → Authenticate email) → it generates a `google._domainkey` TXT → 🤖 add it in DNS → click **Start authentication**

### 4C — Verify, then decommission
- [ ] ✅ Inbound test: have a friend email `info@` → arrives in **Google**
- [ ] ✅ Outbound test: send from `info@` to an external address → arrives with **no "via gmail" warning** (proves DKIM)
- [ ] ✅ Run clean for **48 hours**
- [ ] 🧍 **Only now:** cancel the GoDaddy email subscription (keep the domain registration with GoDaddy)

---

## Phase 5 — Brevo (email marketing) 🧍🤖

**Goal:** Brevo can send on behalf of the domain without landing in spam.

**Time:** ~30 min + DNS propagation.

- [ ] 🧍 Create a free Brevo account (300 sends/day free tier)
- [ ] 🧍 Add and verify the sender domain `lustiqueco.co.za`
- [ ] 🤖 Add Brevo's **DKIM** + tracking records in Cloudflare DNS (Brevo provides them)
- [ ] 🤖 **Merge SPF — do not add a second SPF record.** Edit the existing one to:
  `v=spf1 include:_spf.google.com include:spf.brevo.com ~all`
- [ ] ✅ **Checkpoint:** Brevo shows the domain as authenticated (green); send a Brevo test → lands in inbox, not spam
- [ ] 🤖 *(build phase)* I'll wire the three flows from PLAN.md §9 (lead nurture, booked bride, past bride) once content is ready

---

## Phase 6 — Analytics 🧍🤖

**Time:** ~20 min.

- [ ] 🧍 Create a **GA4** property → grab the Measurement ID (`G-XXXXXXX`)
- [ ] 🤖 I'll install GA4 + the custom events (estimator funnel, downloads, WhatsApp clicks) during the build
- [ ] 🤖 Enable **Cloudflare Web Analytics** (free, cookieless) on the Pages project — complements GA4 for privacy-blocking visitors
- [ ] ✅ **Checkpoint:** GA4 realtime shows your own visit to the holding page

---

## Phase 7 — CRM (Google Sheet + service account) 🧍🤖

**Goal:** the Sheet that the quote form writes into automatically.

**Time:** ~45 min.

- [ ] 🤖 I'll create the Sheet with the exact tabs + columns from PLAN.md §8 (`Leads`, `Bookings`, `Artists`, `Email templates`, `Analytics`)
- [ ] 🧍 Create a free **Google Cloud project** → enable the **Sheets API**
- [ ] 🧍🤖 Create a **service account** → download its JSON key (this is the credential the Worker uses to write rows)
- [ ] 🧍 **Share the Sheet** with the service account's email address (Editor)
- [ ] 🔒 The JSON key goes into Cloudflare Worker **secrets** — never into the repo or any file we commit
- [ ] ✅ **Checkpoint:** I run a one-line test write from the Worker → a row appears in `Leads`

---

## Phase 8 — Dev plumbing 🧍🤖

**Goal:** the repo + tools so I can build and you can review/deploy.

**Time:** ~30 min.

- [ ] 🧍 Confirm installed locally: **Node LTS** (`node -v` ≥ 20), **git**
- [ ] 🧍 Create a **GitHub repo** (private) — enables Cloudflare Pages CI + per-PR previews so you review live URLs
- [ ] 🤖 I scaffold the Astro project + Worker into `Lustique/site` and `Lustique/worker` per PLAN.md §10
- [ ] 🧍 Create a **Cloudflare API token** (Pages + Workers scope) for deploys
- [ ] 🤖 Connect the GitHub repo to Cloudflare Pages (auto-deploy on push, preview per branch)
- [ ] ✅ **Checkpoint:** a test commit triggers a Cloudflare preview deploy you can open

---

## What unblocks the build after this

Once Phases 1–8 verify, the only remaining inputs for the **build** are content, not plumbing:

- **Pieter:** the Wix content export (existing copy + the live form's field list + any stored testimonials/images)
- **Zandeline:** hero tagline · logo call · photography (curate vs. shoot) · the 8 new-service prices · the travel mechanic · the 9 artist bios · video testimonials (within a month) · Pinterest boards

The build (Astro site, estimator, quote form, Worker, Brevo flows) can start in parallel with content arriving — copy and components don't need the Wix export; only the *migration* of existing copy does.

---

## Costs incurred in this phase

| Item | When | Cost |
|---|---|---|
| Cloudflare (DNS, Pages, Workers, Analytics) | now | Free |
| Google Workspace Business Starter | Phase 3 | ≈ $6/user/mo |
| Brevo | Phase 5 | Free tier |
| GA4 | Phase 6 | Free |
| Google Cloud (Sheets API, service account) | Phase 7 | Free (well within limits) |
| GitHub | Phase 8 | Free (private repos) |
| **New recurring total** | | **≈ $6/mo** (one Workspace seat) |

Everything else is free tier. This *replaces* Wix Premium + Wix email, so the net monthly cost goes **down**.
