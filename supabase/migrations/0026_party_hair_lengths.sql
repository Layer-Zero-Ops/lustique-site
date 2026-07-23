-- Per-sub-party hair lengths for the bridal party.
-- The booking form now captures hair length per group (bridesmaids / mothers /
-- other guests) so Zandeline's dashboard can report lengths grouped by sub-party
-- instead of one merged bucket. Flower girls already carry fg_hair_len.
-- Nullable: enquiries converted from email text won't have these until edited.
alter table bookings
  add column if not exists bm_hair_len hair_length,
  add column if not exists mom_hair_len hair_length,
  add column if not exists guest_hair_len hair_length;

-- hair_length is the existing enum used by bride_hair_len / fg_hair_len.
-- If the type is missing for some reason, create it (idempotent):
do $$
begin
  if not exists (select 1 from pg_type where typname = 'hair_length') then
    create type hair_length as enum ('short', 'medium', 'long', 'xlong');
  end if;
end $$;
