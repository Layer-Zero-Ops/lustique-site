# Runbook — Operations Hygiene (monitoring + backups)

Two of the five "lower-tier" oversights need *your* action (external services /
credentials the agent can't provision from this sandbox). The other three were
checked and are **not** problems:
- #2 (404 dead link) — `quote.html` exists; the 404 CTA works.
- #4 (favicon/webmanifest) — `site.webmanifest` is present and valid; icons match brand.
- #1 (observability) — DONE in code (see `worker/src/lib/observe.ts`): every response
  carries `X-Request-Id`; unexpected errors report to Sentry when `SENTRY_DSN` is set
  (`wrangler secret put SENTRY_DSN`). Verified: 496 tests pass, dry-run clean.

The two real gaps below are copy-paste runbooks. Do them when convenient — they are
defensive, not blocking.

────────────────────────────────────────────────────────────
#3 — UPTIME / SYNTHETIC MONITORING
────────────────────────────────────────────────────────────
Goal: know within 5 minutes if `lustiqueco.co.za` or the booking API goes down,
instead of hearing it from a bride.

Option A (zero-cost, 1 cron job) — free uptime ping:
  1. Sign up at https://uptimerobot.com (free tier: 50 monitors, 5-min interval).
  2. Add an HTTP monitor:
       Name: Lustique site
       URL:  https://lustiqueco.co.za/
       Interval: 5 min
  3. Add a second monitor hitting the live API health check:
       Name: Lustique Worker /api/health
       URL:  https://<worker-domain>/api/health   (the form-handler Worker URL)
       Expected status: 200 (note: returns 503 if Supabase is unreachable — alert on 503 too)
  4. Add a third "keyword" monitor on the booking flow:
       URL:  https://lustiqueco.co.za/quote
       Alert if keyword "Request to Book" is NOT present (catches a broken build).
  5. Wire alerts to the Telegram/email you actually read.

Option B (DIY, no third party) — a Cloudflare Cron Trigger that pings and logs:
  Add to worker/src/index.ts `scheduled()`:
    await fetch("https://lustiqueco.co.za/api/health").then(r =>
      writeAudit(env, { bookingId: null, eventType: "monitor.site", payload: { ok: r.ok, status: r.status } }));
  Then watch `clio_activity` for `monitor.site` rows going `ok:false`.
  (This needs a deploy — do it after the GitHub write-access blocker is resolved.)

Verify: after setup, manually stop the Worker (or edit DNS) in staging and confirm
you get the alert within one interval. Never test this on production.

────────────────────────────────────────────────────────────
#5 — SUPABASE BACKUP / RESTORE DRILL
────────────────────────────────────────────────────────────
Risk: the only DDL path is the Supabase SQL Editor (live /sql is IP-blocked from
the agent). A bad manual edit could corrupt bride data with no verified rollback.

Daily automated backups are ON by default in Supabase (Dashboard → Database →
Backups → Scheduled). This runbook adds a *tested restore*, which Supabase does
NOT do for you.

Step 1 — confirm backups exist:
  Supabase dashboard → Project `ywoovdpnphcogwgoqhst` → Database → Backups.
  You should see daily snapshots retained for ~7 days (Free) / 30 days (Pro).

Step 2 — do a RESTORE DRILL into a throwaway project (never restore over live):
  1. Create a new temporary Supabase project (free).
  2. Database → Backups → point-in-time / latest → "Restore to a new database"
     OR download the SQL dump and run it against the temp project:
       # on a machine with psql + the temp project's connection string:
       psql "$TEMP_DB_URL" -f lustique_dump_$(date +%F).sql
  3. Run the smoke query from docs/SQL-PACK-clio-and-realtime.md (clio_activity,
     enquiries, bookings) to confirm rows restored.
  4. Delete the temp project.

Step 3 — document the restore owner:
  Write the restore steps + who holds the Supabase owner credentials into
  SESSION_HANDOFF.md so a 3am incident isn't the first time anyone tries a restore.

Verify: the drill is only "done" when Step 2 successfully restores real rows into
the temp project. Until then, you have backups but no proven recovery.

────────────────────────────────────────────────────────────
WHY THESE ARE HONEST "YOUR ACTION" ITEMS
────────────────────────────────────────────────────────────
- Monitoring needs a third-party account or a deploy (blocked on GitHub write access).
- Supabase restore needs the owner's Supabase credentials + a temp project — the
  agent has read-only /sql and must not hold backup keys.
Neither can be "completed" by the agent without crossing the security boundary.
They are documented here so they don't get lost, and so the first incident isn't
the first drill.
