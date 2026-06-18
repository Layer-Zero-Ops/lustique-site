-- Wave 0: payment failure tracking columns + fee config.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_notified_at TIMESTAMPTZ;

-- Fee model: Lustique absorbs the Yoco card fee (locked decision 2026-06-18).
-- fee_model 'absorb' = bride pays net; Lustique nets the remainder after Yoco deducts.
-- fee_pct   = Yoco's card rate — for margin/reporting only, NOT added to what the bride pays.
-- Verify the actual rate in the Yoco Business Portal and update fee_pct with the real number.
INSERT INTO business_settings (key, value) VALUES
  ('fee_model', 'absorb'),
  ('fee_pct',   '3.5')
ON CONFLICT (key) DO NOTHING;
