# Lustique — Go-Live Runbook (EFT launch)

The single source for taking Lustique live. Supersedes the old baton Launch summary
and the S4 plan's Phase C. 🛑 = account-gated (Pieter/Zandeline); everything else is
Sonnet-runnable once unblocked. Do the account prerequisites first.

## 1. Account prerequisites (🛑 — parallelizable, any order)
- [ ] **Supabase** — create the client-owned project (region `af-south-1`), invite
      `hello@layerzerostudios.com` as Administrator. Apply the migration by pasting
      `supabase/migrations/0001_booking_core.sql` into the Supabase **SQL editor** and
      running it (no CLI config exists). Capture the project URL + the **service-role** key.
- [ ] **Turnstile** — create a widget for `lustiqueco.co.za`; note the **site key** + **secret**.
- [ ] **Brevo** — verify `info@lustiqueco.co.za` as a sender; capture the **API key**.
- [ ] **EFT details** — bank, account name, account no., branch code from Zandeline.
- [ ] **Cloudflare** — add `lustiqueco.co.za` (Free plan) so the zone exists.

## 2. Rehearse the smoke walk (as soon as Supabase exists — before full deploy)
- [ ] Put the secrets in `worker/.dev.vars` (git-ignored). Run the worker locally:
      `cd worker && npx wrangler dev` (serves `http://localhost:8787`).
- [ ] In another shell, run the walk against local:
      `SMOKE_BASE_URL=http://localhost:8787 SUPABASE_URL=… SUPABASE_SERVICE_KEY=… SIGNING_SECRET=… SMOKE_BRIDE_EMAIL=you@example.com npm run smoke`
- [ ] Expect 3 green steps (`confirmed`, `deposit_paid`, `settled`). This proves the
      script itself before launch day. (Gated on Supabase only — not on deploy.)

## 3. 🔐 Security gate — HARD BLOCKER before any origin push
- [ ] Rotate the exposed **Sanity Viewer token** (it is committed; the first push publishes it).
- [ ] Secret-scan the working tree — confirm no live keys are committed.
- [ ] Only now is `main` safe to push (step 6 connects GitHub to Pages).

## 4. Worker config + secrets
- [ ] One-time bucket: `cd worker && npx wrangler r2 bucket create lustique-audit`.
- [ ] Set the 10 secrets with `wrangler secret put`: `BREVO_API_KEY`, `NOTIFY_EMAIL`,
      `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SIGNING_SECRET` (random 32-byte hex),
      `TURNSTILE_SECRET`, `EFT_BANK`, `EFT_ACCOUNT_NAME`, `EFT_ACCOUNT_NO`, `EFT_BRANCH_CODE`.
      (Skip `YOCO_*` until S4-v2.)
- [ ] Confirm `ALLOWED_ORIGIN = "https://lustiqueco.co.za"` in `[vars]`.

## 5. Front-end config
- [ ] Replace the Turnstile placeholder `1x00000000000000000000AA` in
      `site/src/data/site.ts` with the real **site key**; commit.

## 6. Deploy
- [ ] Worker: `cd worker && npx wrangler deploy` (binds `lustiqueco.co.za/api/*` once the zone is active).
- [ ] Site: push `main` to origin (first publish — gated by step 3), then connect the
      GitHub repo to **Cloudflare Pages** (build `npm run build` in `site/`, output `dist/`);
      bind the apex + `www` custom domains.

## 7. DNS cutover (🛑 Pieter)
- [ ] Point `lustiqueco.co.za` nameservers GoDaddy → Cloudflare (registrar stays GoDaddy).
- [ ] Preserve the existing GoDaddy/Workspace **MX + SPF** records.
- [ ] Set SSL/TLS to **Full (strict)** once Pages is bound.

## 8. Verify go-live
- [ ] **Manual (intake):** submit one real request on the live form → bride gets
      "request received"; Zandeline gets the confirm link. (Proves intake + Turnstile —
      the part the script can't.)
- [ ] **Scripted (transition chain):** run `npm run smoke` with `SMOKE_BASE_URL` = the
      deployed worker origin. Expect 3 green steps. **Note:** this emails one clearly-marked
      "SMOKE TEST" admin notification to the live `NOTIFY_EMAIL` (Zandeline) — warn her.
- [ ] **Cron:** confirm the daily trigger is registered (Cloudflare dashboard /
      `wrangler deployments`). Optional: exercise `balanceSweep` locally once via
      `wrangler dev --test-scheduled`.

## 9. Post-launch (deferred)
- [ ] Cloudflare WAF: rate-limit `POST /api/booking/request` → 5 req/IP/hour.
