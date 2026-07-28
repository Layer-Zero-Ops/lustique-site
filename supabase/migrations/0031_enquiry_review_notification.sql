-- Phase 6 — fail-safe enquiry handling (prevents silent lead loss).
-- Adds a notification type so a saved-but-captcha-failed enquiry is surfaced
-- to Zandeline for manual review instead of being discarded.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'notification_type' and e.enumlabel = 'enquiry_review'
  ) then
    ALTER TYPE notification_type ADD VALUE 'enquiry_review';
  end if;
end $$;
