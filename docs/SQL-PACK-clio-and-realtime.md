# SQL Pack — Clio feed + Realtime (run in Supabase SQL Editor)

**Why this exists:** the dashboard work (commit `384d081`, branch `feature/clio-webhooks`)
is code-complete and green (490 tests pass + `wrangler deploy --dry-run` clean), but two
pieces need SQL that the agent can't run (live `/sql` is IP-blocked). Apply these in the
**Lustique Supabase project SQL editor** (https://supabase.com/dashboard → project
`ywoovdpnphcogwgoqhst` → SQL Editor → New query → paste → Run).

Run them in order. Both are idempotent — safe to re-run.

---

## 1) Create the `clio_activity` table (migration 0026)

This is the live feed the Clio tab (`/api/admin/clio`) and the M5 badge
(`/api/admin/clio-activity`) read. Without it those two endpoints return empty.

```sql
-- 0026: Clio activity feed (event-driven AI assistant).
-- Worker POSTs business events to the Clio receiver AND persists a copy here so the
-- admin "Clio" tab can render a "recent activity" feed. See worker/src/booking/clio.ts.

create table if not exists clio_activity (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  event_type   text not null,
  title        text not null,
  body         text,
  link         text,
  audience     text not null default 'zandeline'
                 check (audience in ('zandeline', 'pieter', 'both')),
  payload      jsonb
);

create index if not exists clio_activity_created_at_idx
  on clio_activity (created_at desc);
```

**Verify after run:**
```sql
select count(*) from clio_activity;  -- 0 is fine; table now exists
```

---

## 2) Add `clio_activity` to the Realtime publication (M5 upgrade)

The dashboard currently polls `/api/admin/clio-activity` every 15s (plan A.5 heartbeat
fallback). Wiring Realtime here lets you later drop the poll and push instantly. The
publication is named `supabase_realtime` (see migration 0010).

```sql
alter publication supabase_realtime add table if not exists clio_activity;
```

**Verify after run:**
```sql
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename = 'clio_activity';  -- should return 1 row
```

> Note: the Realtime *client* upgrade (subscribing in the dashboard's bell script) is a
> follow-up code change — not required for the current 15s-poll to work. Apply step 2 now
> so the table is publication-ready; the client swap can come later without downtime.

---

## 3) Residual — M3 client hand-off (NOT SQL; needs a code edit)

The worker now **accepts and persists** `referralSource` / `utmSource` on
`/api/booking/request` (request.ts). The site already sends it on the enquiry path
(`site/src/scripts/enquiry.ts` → `referralSource: readReferralSource()`), but the
**booking** submit (generated into `site/public` by the build, not in tracked source) does
not yet include it. When the build is unblocked, add to the booking-request fetch body:

```js
referralSource: readReferralSource(),   // import from "./referral"
utmSource: new URLSearchParams(location.search).get("utm_source") ?? undefined,
```

This is best-effort only — sessionStorage is unavailable in private-browsing edge cases,
and the worker falls back to `null` gracefully.

---

## Deploy path (after SQL is applied)

```
git push origin feature/clio-webhooks        # currently local-only (push was 403)
  → open PR feature/clio-webhooks → dev
  → merge to dev (staging auto-deploy)
  → Pieter reviews staging → merge dev → main (prod auto-deploy)
```

Do NOT commit these SQL changes to `main` directly — they're schema, applied via SQL editor.
The branch workflow is mandatory: `feature/* → dev → (PR review) → main`.
