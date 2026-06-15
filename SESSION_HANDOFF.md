# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** CI wired — Worker deploy blocked on CF token fix · **Updated:** 2026-06-15 (Sonnet)

## ▶ NEXT

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` · **Repo:** `github.com/Layer-Zero-Ops/lustique-site` (private)

---

### Step 1 — Fix the CF API token (Pieter action, ~5 min)

GitHub Actions is wired and working. The deploy fails with `Authentication error [code: 10000]` because the current `CF_API_TOKEN` secret lacks `Workers Scripts: Edit` permission.

**Pieter: create a new token at this exact URL:**
`https://dash.cloudflare.com/d5ae10088a019ff6975fcbe128f8e0be/api-tokens`

Click **Create Token** → scroll down to **"Edit Cloudflare Workers"** template → Use template.

Settings to verify on the next screen:
- Permissions should show: `Account | Workers Scripts | Edit`
- Account Resources: `Hello@layerzerostudios.com's Account`
- Click Continue → Create Token → **copy the value**

Then go to:
`https://github.com/Layer-Zero-Ops/lustique-site/settings/secrets/actions`
→ click `CF_API_TOKEN` → **Update** → paste new value → Save.

Then tell Sonnet — it will trigger the deploy with `gh workflow run`.

---

### Step 2 — Once deploy succeeds, remaining go-live tasks

**Pieter actions still outstanding:**

| # | Action | Where |
|---|---|---|
| A | **Turnstile site key** → tell Sonnet the value → Sonnet updates `site/src/data/site.ts` and commits | CF dashboard → Turnstile → your `lustiqueco.co.za` widget → Site Key |
| B | **Brevo sender verify** `hello@lustiqueco.co.za` | Brevo → Settings → Senders → Add sender |
| C | **CF DNS check** — MX + SPF on `lustiqueco.co.za` zone | CF dashboard → `lustiqueco.co.za` → DNS tab |
| D | **Apply migrations** in Supabase SQL editor (paste + run each file in order) | Supabase dashboard → SQL editor |
| E | **Seed bank details** in `business_settings` table (4 PLACEHOLDER rows → real values) | Supabase → Table Editor → `business_settings` |
| F | **SIGNING_SECRET** — generate + add to Worker secrets | `openssl rand -hex 32` → CF dashboard → Worker → Settings → Variables & Secrets |
| G | **Remaining Worker secrets** — add in CF dashboard → Worker → Settings → Variables & Secrets: `BREVO_API_KEY`, `NOTIFY_EMAIL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `TURNSTILE_SECRET` (all values are in CF account Secrets Store — copy from there) |  |

**Sonnet actions (once Worker deploys + Pieter actions above are done):**
- Update Turnstile site key in `site/src/data/site.ts` (Pieter tells Sonnet the value)
- Run smoke test against deployed Worker (`SMOKE_BASE_URL=https://lustiqueco.co.za/api`)
- Connect CF Pages to GitHub repo if not already done (Pages → GitHub → `Layer-Zero-Ops/lustique-site`, build cmd `npm run build`, output `site/dist`)

---

## CI / deploy state

- **GitHub repo:** `https://github.com/Layer-Zero-Ops/lustique-site` (private, pushed `9546e96`)
- **GitHub Actions:** `.github/workflows/deploy-worker.yml` — triggers on push to `worker/**`, `shared/**`, or workflow file; also `workflow_dispatch` for manual triggers
- **Deploy error:** `Authentication error [code: 10000]` — CF_API_TOKEN needs "Edit Cloudflare Workers" template (see Step 1 above)
- **CF Pages:** connected to GitHub repo (Pieter confirmed). Build: `npm run build` → `site/dist`.

## 🛑 Launch — account-gated
Authoritative procedure: **`docs/RUNBOOK-go-live.md`**

## State (done-ledger)

- **GitHub CI ✅ 2026-06-15** — repo created under `Layer-Zero-Ops`, `main` pushed, GitHub Actions wired. Pending: correct CF API token (Step 1 above).
- **DECISION 1+2 ✅ 2026-06-15** — `061c616`. 6 Worker secrets via `wrangler secret put` (5 pre-staged in CF Secrets Store). `business_settings` table + `getEftSettings()` reads EFT from DB. 89 tests pass.
- **S1–S5 + launch-readiness ✅** — 89 tests, smoke test suite, `docs/RUNBOOK-go-live.md`. Bundle 54.66 KiB.
- **Integrate + prune ✅ 2026-06-14** — `main` only, single working tree.

## Booking build sequence
S1 ✅ → S2 ✅ → S3 ✅ → S4 ✅ → S5 ✅ → Launch-readiness ✅ → Integrate+prune ✅ → DECISION 1+2 ✅ → GitHub CI ✅ → **CF token fix → Worker deploy → go-live**

## Pointers
- Go-live RUNBOOK: `docs/RUNBOOK-go-live.md`
- Workflow file: `.github/workflows/deploy-worker.yml`
- Migrations: `supabase/migrations/0001_booking_core.sql` · `supabase/migrations/0002_business_settings.sql`
- Key docs: `PLAN.md` · `BRAND.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md`

## ⇄ Umbrella
**⬆ To umbrella / Pieter:** 🟢 FYI — GitHub CI wired (`9546e96`). Worker deploy failing on CF token permissions (fix in Step 1 above). CF Pages connected. Go-live checklist in ▶ NEXT above.
**⬇ From umbrella:** *(cleared)*
