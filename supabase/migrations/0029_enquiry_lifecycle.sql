-- Phase 2 (Pillar 2 unification) — give every enquiry a single lifecycle state
-- machine so enquiry -> booking is ONE tracked lead (kills orphan submissions).
-- Mirrors contacts.lifecycle. Non-destructive: adds nullable columns + index.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'enquiry_lifecycle'
  ) then
    create type enquiry_lifecycle as enum
      ('new', 'contacted', 'quoted', 'booked', 'declined', 'archived');
  end if;
end $$;

alter table enquiries
  add column if not exists lifecycle enquiry_lifecycle not null default 'new';

alter table enquiries
  add column if not exists lifecycle_at timestamptz not null default now();

alter table enquiries
  add column if not exists matched_at timestamptz;

-- Backfill: any enquiry already linked to a booking is 'booked'.
update enquiries
  set lifecycle = 'booked', lifecycle_at = updated_at
  where booking_id is not null and lifecycle = 'new';

create index if not exists enquiries_lifecycle_idx on enquiries (lifecycle);
