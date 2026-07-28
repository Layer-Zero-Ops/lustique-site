-- Phase 7 — dashboard hygiene: soft-delete + Aria tidy worker.
-- Adds deleted_at (soft-delete) so Zandeline can permanently clear old submissions
-- from the dashboard without destroying the underlying row (recoverable via SQL).
-- All admin list/notification queries filter deleted_at = null.

alter table enquiries
  add column if not exists deleted_at timestamptz;

alter table bookings
  add column if not exists deleted_at timestamptz;

create index if not exists enquiries_deleted_idx on enquiries (deleted_at);
create index if not exists bookings_deleted_idx on bookings (deleted_at);
