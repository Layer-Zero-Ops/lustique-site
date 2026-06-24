-- 0019: Link enquiries to generated bookings (one-to-one, admin-initiated)
-- When Zandeline clicks "Generate Invoice" on an enquiry, the created booking_id
-- is stored here so the Forms view can show "View Invoice →" instead of "Generate".

ALTER TABLE enquiries
  ADD COLUMN booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;

CREATE INDEX enquiries_booking_id_idx ON enquiries (booking_id) WHERE booking_id IS NOT NULL;
