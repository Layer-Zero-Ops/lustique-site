# SESSION_HANDOFF — Lustique

**Lane:** 🟢 Build (Sonnet) · **Phase:** Worker live, smoke 3/3 — CF Pages build blocked · **Updated:** 2026-06-16 (Sonnet)

## ▶ NEXT

**Model:** Sonnet · **Lane:** Build · **Branch:** `main` · **Repo:** `github.com/Layer-Zero-Ops/lustique-site` (private)

---

### Situation

Worker is fully deployed and smoke-tested (3/3). Everything is ready except the **Astro site (CF Pages)** is not serving — `lustiqueco.co.za` still resolves to Wix (`185.230.63.107`) and the Pages project serves "Hello world" instead of the built site.

Two issues to resolve (both Pieter actions):

---

### Step 1 — Fix CF Pages repo connection

There are two Lustique repos:
- ✅ **`Layer-Zero-Ops/lustique-site`** — correct (all code, most recent push 2026-06-16)
- ❌ **`Layer-Zero-Ops/lustique`** — old/abandoned (June 6th)

CF Pages is likely connected to the wrong repo (`Layer-Zero-Ops/lustique`), which is why it serves "Hello world".

**Action:** CF dashboard → Pages → `lustique-site` project → Settings → Builds & Deployments → verify GitHub repo is `Layer-Zero-Ops/lustique-site`. If it shows `Layer-Zero-Ops/lustique`, disconnect and reconnect to the correct repo.

**Build settings must be:**
- Build command: `npm run build`
- Build output directory: `site/dist`
- Root directory: *(blank)*

After fixing, trigger a new deployment (Deployments tab → **Retry deploy** or push a commit).

---

### Step 2 — DNS cutover (after Pages build succeeds)

`lustiqueco.co.za` still points to Wix. Once the Pages build shows green:

1. Note the Pages project URL (something like `lustique-site.pages.dev` shown at top of project page — NOT the `workers.dev` URL, NOT the Worker URL)
2. CF dashboard → `lustiqueco.co.za` DNS → **delete** the A record pointing to `185.230.63.107` (Wix)
3. **Delete** the CNAME `www → pointing.wixdns.net` (Wix www)
4. **Add record:** Type `CNAME` · Name `@` · Target: `<pages-project>.pages.dev` (no `https://`, no trailing slash) · Proxy: **ON** (orange cloud)
5. **Add record:** Type `CNAME` · Name `www` · Target: `<pages-project>.pages.dev` · Proxy: **ON**

DNS propagates in seconds once proxied through Cloudflare.

---

### Step 3 — Post-cutover smoke test (Sonnet action)

Once DNS resolves to CF Pages (`lustiqueco.co.za` serves the Astro site), tell Sonnet. Sonnet runs the smoke test against the live domain:

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
SMOKE_BASE_URL="https://lustiqueco.co.za" \
SUPABASE_URL="https://ywoovdpnphcogwgoqhst.supabase.co" \
SUPABASE_SERVICE_KEY="<service-role-key>" \
SIGNING_SECRET="<32-byte-hex>" \
SMOKE_BRIDE_EMAIL="test@lustiqueco.co.za" \
npx vitest run src/booking/smoke.test.ts
```

Note: `SMOKE_BASE_URL` = `https://lustiqueco.co.za` (no `/api` suffix — the test adds `/api/booking/...` paths itself).

---

## CI / Deploy state

- **GitHub repo:** `Layer-Zero-Ops/lustique-site` (private) · HEAD: `ddda26b`
- **Worker:** `lustique-form-handler` deployed ✅ — wrangler v4, Node 22, 6 secrets set via CF dashboard, R2 bound
- **Smoke test:** 3/3 passed against workers.dev (`82fa6b0`) — SIGNING_SECRET was live value
- **CF Pages:** connected to GitHub — build may be pointed at wrong repo (see Step 1)
- **DNS:** still resolves to Wix (`185.230.63.107`) — not yet cut over
- **Supabase:** all migrations applied ✅ · bank details seeded ✅
- **Brevo:** sender `hello@lustiqueco.co.za` verified ✅
- **Turnstile site key:** set in `site/src/data/site.ts` (`0x4AAAAAADklnz5LQDyAFEKV`) ✅

## State (done-ledger)

- **Smoke test 3/3 ✅ 2026-06-16** — `82fa6b0`. Full booking flow confirmed on workers.dev.
- **Worker deployed ✅ 2026-06-16** — wrangler v4, Node 22, R2, 6 secrets, cron.
- **Turnstile key live ✅ 2026-06-16** — `ddda26b`. Public key set in site.ts.
- **Supabase ✅ 2026-06-16** — both migrations applied, bank details seeded.
- **Brevo ✅ 2026-06-16** — sender verified.
- **GitHub CI ✅ 2026-06-15** — Actions wired, deploys on push to worker/shared.
- **S1–S5 + launch-readiness ✅** — 89 tests, smoke suite, RUNBOOK.

## Booking build sequence
S1–S5 ✅ → Launch-readiness ✅ → Integrate ✅ → DECISION 1+2 ✅ → CI ✅ → Worker ✅ → Smoke 3/3 ✅ → **CF Pages fix → DNS cutover → live smoke → go-live**

## Pointers
- Go-live RUNBOOK: `docs/RUNBOOK-go-live.md`
- Workflow: `.github/workflows/deploy-worker.yml`
- Migrations: `supabase/migrations/0001_booking_core.sql` · `supabase/migrations/0002_business_settings.sql`
- Key docs: `PLAN.md` · `BRAND.md` · `ARCHITECTURE.md`

## ⇄ Umbrella
**⬆ To umbrella / Pieter:** 🟢 FYI — Worker live, smoke 3/3. CF Pages blocked on wrong repo connection. DNS not yet cut over. Steps in ▶ NEXT above.

**⬆ To umbrella — ⚪ DECISION: Studio-wide secrets architecture**

Two-tier secrets pattern proposed:
- Each client's secrets → their own Supabase Vault
- LZ Studios Supabase → directory layer (holds connection keys per client)
- Claude → LZ MCP → reads client key → queries client Vault
- CF Secrets Store → only irreducible bootstrap secrets (2 per Worker)

Questions to resolve: LZ Supabase as plain table vs vault.secrets · crown jewel risk · Supabase MCP multi-project support · secret rotation UX · naming convention at scale · audit trail.

Output wanted: short spec → Sonnet builds on LZ project → rolls out to clients.

**⬇ From umbrella:** *(cleared)*
