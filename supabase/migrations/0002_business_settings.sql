-- Business settings key-value store for runtime config (bank details, etc.)
-- Seeded with EFT placeholders; Zandeline fills in real values via Supabase dashboard
-- before accepting bookings. Service role bypasses RLS; no anon access.

CREATE TABLE business_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO business_settings (key, value) VALUES
  ('eft_bank_name',        'PLACEHOLDER'),
  ('eft_account_holder',   'PLACEHOLDER'),
  ('eft_account_number',   'PLACEHOLDER'),
  ('eft_branch_code',      'PLACEHOLDER'),
  ('eft_reference_prefix', 'LUSTIQUE');
