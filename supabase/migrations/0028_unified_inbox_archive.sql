-- Phase 1 — soft-archive columns so Zandeline can clean up the unified inbox
-- without deleting data. Archived rows are hidden from the inbox and KPIs.
-- Run in the Supabase SQL Editor (client IP is blocked from /sql).

alter table enquiries
  add column if not exists archived_at timestamptz;

alter table bookings
  add column if not exists archived_at timestamptz;

-- Indexes to keep the inbox query (archived_at=is.null) fast as volume grows.
create index if not exists enquiries_archived_idx on enquiries (archived_at);
create index if not exists bookings_archived_idx on bookings (archived_at);
