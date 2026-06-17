-- S8: Wave accounting integration
-- Stores Wave IDs on bookings + payments so we can reconcile in Wave.
-- All nullable — rows created before Wave is configured have no Wave IDs.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS wave_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS wave_invoice_id  TEXT;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS wave_payment_id TEXT;
