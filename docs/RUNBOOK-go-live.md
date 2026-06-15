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
- [ ] **EFT details** — get bank name, account holder, account no., branch code from Zandeline. You'll enter these into the `business_settings` table (step 4b below), not as Worker secrets.
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

> **5 secrets are pre-staged in the CF account Secrets Store** (visible in CF dashboard → Workers &
> Pages → your account → Secrets Store). Run `wrangler secret put` for each — the values are
> already in the Store; you're just binding them to this Worker:
> `BREVO_API_KEY` · `SUPABASE_URL` · `SUPABASE_SERVICE_KEY` · `TURNSTILE_SECRET` · `SIGNING_SECRET`
>
> `SIGNING_SECRET` was generated with `openssl rand -hex 32`. If you need a new one: run that
> command, copy the output, and paste it when `wrangler secret put SIGNING_SECRET` prompts you.
> `NOTIFY_EMAIL` is **not** pre-staged — enter it manually (e.g. `info@lustiqueco.co.za`).
> Note: `SANITY_API_KEY` is in the Store but the Worker never reads it — skip it.

- [ ] One-time bucket: `cd worker && npx wrangler r2 bucket create lustique-audit`.
- [ ] Set the 6 secrets with `wrangler secret put`: `BREVO_API_KEY`, `NOTIFY_EMAIL`,
      `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SIGNING_SECRET`, `TURNSTILE_SECRET`.
      (Skip `YOCO_*` until S4-v2. EFT bank details go in the database — see step 4b.)
- [ ] Confirm `ALLOWED_ORIGIN = "https://lustiqueco.co.za"` in `[vars]`.

## 4b. Seed EFT bank details
- [ ] Open the Supabase dashboard → Table Editor → `business_settings`.
- [ ] Update the 4 `PLACEHOLDER` rows with Zandeline's real bank details:
      `eft_bank_name` · `eft_account_holder` · `eft_account_number` · `eft_branch_code`.
      (Leave `eft_reference_prefix = LUSTIQUE` as-is.)

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
