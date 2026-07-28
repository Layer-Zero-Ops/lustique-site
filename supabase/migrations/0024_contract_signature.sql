-- Contract e-signature capture (click-to-sign, ECT Act ordinary electronic signature).
-- Gated behind business_settings.contract_enabled ('true'/'false') so it can be wired up
-- and tested without affecting live bookings until Zandeline's contract text is approved.
alter table bookings
  add column if not exists contract_signed_at timestamptz,
  add column if not exists contract_signer_name text,
  add column if not exists contract_ip text,
  add column if not exists contract_user_agent text,
  add column if not exists contract_content_hash text,
  add column if not exists contract_version text;

-- Enable contract e-signature in the live booking flow.
update business_settings
   set value = 'true'
 where key = 'contract_enabled';
