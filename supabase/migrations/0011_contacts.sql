-- Wave C Phase 1: CRM contacts
-- contacts: one row per person (deduped by email); bookings.contact_id links to this.
-- bride_* columns on bookings remain as immutable snapshots for POPIA + invoice integrity.

CREATE TABLE IF NOT EXISTS contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text NOT NULL,
  email           text NOT NULL,
  phone           text,
  notes           text,
  tags            text[] NOT NULL DEFAULT '{}',
  source          text,
  lifecycle       text NOT NULL DEFAULT 'lead'
                  CHECK (lifecycle IN ('lead', 'enquiry', 'booked', 'past-client', 'archived')),
  origin          text NOT NULL DEFAULT 'booking'
                  CHECK (origin IN ('booking', 'enquiry', 'import', 'manual')),
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_booking_at timestamptz,
  consent_at      timestamptz,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_uniq ON contacts (lower(email));
CREATE INDEX IF NOT EXISTS contacts_tags_idx ON contacts USING gin (tags);
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_admin_read ON contacts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- Link bookings → contacts (nullable; on delete set null preserves financial history)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;
