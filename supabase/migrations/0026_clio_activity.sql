-- 0026: Clio activity feed (event-driven AI assistant).
-- Worker POSTs business events to the Clio receiver AND persists a copy here so the
-- admin "Clio" tab can render a "recent activity" feed. See worker/src/booking/clio.ts.
-- Subscribes to the same event stream the dashboard bell already uses, but is an
-- append-only log (no RLS dependence for admin reads; admin auth is enforced elsewhere).

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

-- Admin (service role) read; the dashboard already uses the service key for reads.
-- No public/anon policy — this table is never queried client-side.
