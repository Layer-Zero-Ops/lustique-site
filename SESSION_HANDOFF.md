# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Worker live, smoke 3/3 — DNS cutover remaining · **Updated:** 2026-06-16 (Sonnet)

## ▶ NEXT

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` · **Repo:** `github.com/Layer-Zero-Ops/lustique-site` (private)

---

### Step 1 — Apply Supabase migrations (Pieter, ~5 min)

Paste and run each file in order in Supabase → SQL editor:
1. `supabase/migrations/0001_booking_core.sql`
2. `supabase/migrations/0002_business_settings.sql`

Then seed the 4 PLACEHOLDER rows in `business_settings` with real EFT bank details (Supabase → Table Editor → `business_settings`).

---

### Step 2 — DNS cutover (Pieter, ~10 min)

The domain `lustiqueco.co.za` is currently live on Wix. This step replaces it with the Astro site on CF Pages.

1. CF Pages → your Lustique project → **Custom domains** → Add `lustiqueco.co.za`
   - CF will prompt to update DNS automatically — accept it
   - This replaces the Wix A record with a CF Pages CNAME
2. Also add `www.lustiqueco.co.za` as a custom domain (CF Pages handles the redirect)
3. DNS propagation: up to 24h but usually < 5 min via Cloudflare

**Note:** once DNS cuts over, the Worker route `lustiqueco.co.za/api/*` becomes live. The Wix site goes offline immediately.

---

### Step 3 — Turnstile site key (Pieter tells Sonnet)

After DNS is live, tell Sonnet the full Turnstile site key (CF dashboard → Turnstile → `lustiqueco.co.za` widget → Site Key, starts `0x4AAAAA...`). Sonnet updates `site/src/data/site.ts` and commits.

---

### Step 4 — Brevo sender verification (Pieter)

Brevo → Settings → Senders → Add `hello@lustiqueco.co.za` and verify. Required before any booking emails can send.

---

### Step 5 — Post-cutover smoke (Sonnet)

Once DNS is live and Turnstile key is in, Sonnet runs the smoke test against `https://lustiqueco.co.za/api` to confirm end-to-end on the live domain.

---

## CI / deploy state

- **GitHub repo:** `https://github.com/Layer-Zero-Ops/lustique-site` (private)
- **GitHub Actions:** `.github/workflows/deploy-worker.yml` — Node 22, wrangler v4, triggers on push to `worker/**` / `shared/**` / workflow file + `workflow_dispatch`
- **Worker:** `lustique-form-handler` deployed ✅ — 6 secrets set directly on Worker via CF dashboard (source of truth: CF Secrets Store `ff54a0a001304d07beaa3c45d205cb52`)
- **Smoke test:** 3/3 passed against workers.dev URL (`82fa6b0`)
- **CF Pages:** connected to GitHub repo. Build: `npm run build` → `site/dist`. Custom domain NOT yet set.
- **CF Secrets Store binding:** blocked on undocumented per-secret scope grants (code 10021) — reverted to direct Worker secrets. Log in Umbrella for studio-infra work.

## 🛑 Launch — account-gated
Authoritative procedure: **`docs/RUNBOOK-go-live.md`**

## State (done-ledger)

- **Smoke test 3/3 ✅ 2026-06-16** — `82fa6b0`. Full booking flow confirmed live on workers.dev.
- **Worker deployed ✅ 2026-06-16** — wrangler v4, Node 22, R2 bound, 6 secrets set, cron wired.
- **GitHub CI ✅ 2026-06-15** — repo under `Layer-Zero-Ops`, `main` pushed, Actions wired.
- **DECISION 1+2 ✅ 2026-06-15** — `061c616`. `business_settings` + `getEftSettings()`. 89 tests pass.
- **S1–S5 + launch-readiness ✅** — 89 tests, smoke suite, `docs/RUNBOOK-go-live.md`. Bundle 54.66 KiB.
- **Integrate + prune ✅ 2026-06-14** — `main` only, single working tree.

## Booking build sequence
S1 ✅ → S2 ✅ → S3 ✅ → S4 ✅ → S5 ✅ → Launch-readiness ✅ → Integrate+prune ✅ → DECISION 1+2 ✅ → GitHub CI ✅ → Worker deployed ✅ → Smoke 3/3 ✅ → **Migrations → DNS cutover → Turnstile key → go-live**

## Pointers
- Go-live RUNBOOK: `docs/RUNBOOK-go-live.md`
- Workflow file: `.github/workflows/deploy-worker.yml`
- Migrations: `supabase/migrations/0001_booking_core.sql` · `supabase/migrations/0002_business_settings.sql`
- Smoke command: `SMOKE_BASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... SIGNING_SECRET=... SMOKE_BRIDE_EMAIL=... npx vitest run src/booking/smoke.test.ts` (from `worker/`)
- Key docs: `PLAN.md` · `BRAND.md` · `ARCHITECTURE.md` · `STANDARDS.md` · `SECURITY.md`

## ⇄ Umbrella
**⬆ To umbrella / Pieter:** 🟢 FYI — Worker live, smoke 3/3 passed (`82fa6b0`). Remaining: Supabase migrations, DNS cutover, Turnstile key, Brevo sender verify.

**⬆ To umbrella — ⚪ DECISION: Studio-wide secrets architecture**

Pieter proposed a two-tier secrets architecture for Layer Zero Studios. Investigate and design a proper implementation:

**The pattern:**
- Each client's secrets live in their own Supabase Vault (`vault.secrets`)
- LZ Studios Supabase acts as a directory layer — holds only connection keys per client (`LUSTIQUE_SUPABASE_URL`, `LUSTIQUE_SUPABASE_SERVICE_KEY`, etc.)
- Claude connects to LZ Supabase MCP → reads client connection key → queries that client's Vault for whatever it needs
- CF Secrets Store retains only irreducible bootstrap secrets (the two keys a Worker needs to connect to Supabase in the first place)

**Questions to resolve:**
1. **LZ Supabase as directory** — plain table vs `vault.secrets`? RLS model? Who can read what?
2. **Crown jewel risk** — the LZ Supabase service key unlocks all client vaults. What's the security model and rotation process?
3. **Claude MCP access** — does the Supabase MCP support switching between projects in one session, or does it need one connection per project? How does Claude authenticate to a second Supabase project mid-session?
4. **Secret rotation UX** — when a client rotates a key (e.g. Brevo), what's the exact update flow? One change in their Vault, does the Worker pick it up automatically or need a redeploy?
5. **Scale test** — does this hold at 10 clients? What's the naming convention for the directory layer?
6. **Audit trail** — Supabase Vault doesn't log reads natively. Is that acceptable, or do we need a wrapper?

**Output wanted from Studio Manager:** a short spec (fits in a PLAN section) with the chosen implementation, naming convention, setup steps, and any tooling changes needed. Then Sonnet builds it on the LZ project before rolling out to Lustique.

**⬇ From umbrella:** *(cleared)*
