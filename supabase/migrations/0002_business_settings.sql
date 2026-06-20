-- Business settings key-value store for runtime config (bank details, etc.)
-- Seeded with live TymeBank details. Service role bypasses RLS; no anon access.

CREATE TABLE business_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO business_settings (key, value) VALUES
  ('eft_bank_name',        'TymeBank'),
  ('eft_account_holder',   'Lustique Co.'),
  ('eft_account_number',   '53000138448'),
  ('eft_branch_code',      '678910'),
  ('eft_reference_prefix', 'LUS');
