-- Wave A: new booking statuses, capacity soft-block, timeline columns

-- 1. Extend the booking_status enum
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'quote_sent';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'accepted';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'invoice_expired';

-- 2. blocked_dates: slots for capacity control (0 = hard-blocked, N = soft cap N concurrent bookings)
ALTER TABLE blocked_dates ADD COLUMN IF NOT EXISTS slots int NOT NULL DEFAULT 0;

-- 3. bookings: new Wave A timeline + soft-block columns
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS availability_conflict boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quote_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS decline_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text;

-- 4. deposit_pct: deposit % now chosen by the bride at accept time, not at request time
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_deposit_pct_check;
ALTER TABLE bookings ALTER COLUMN deposit_pct DROP NOT NULL;

-- 5. business_settings: quote accept TTL (days bride has to accept before invoice_expired sweep)
INSERT INTO business_settings (key, value) VALUES ('quote_accept_ttl_days', '7')
ON CONFLICT (key) DO NOTHING;
