-- Wave A: quote revision history + structured rejection records

CREATE TABLE IF NOT EXISTS quote_revisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  old_total_cents int NOT NULL,
  new_total_cents int NOT NULL,
  revised_by  text NOT NULL DEFAULT 'admin',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rejections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  rejected_by text NOT NULL CHECK (rejected_by IN ('admin', 'bride')),
  reason_code text,
  reason_text text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
