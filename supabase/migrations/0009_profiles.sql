-- Wave C Phase 1: Admin identity spine
-- profiles links to Supabase Auth (auth.users); booking_artists is for future artist allocation.
-- RLS on ALL new tables: deny-all by default; service-role writes; admin-read via policy.

-- 1. Profiles — one row per Supabase Auth user; role controls dashboard access.
CREATE TABLE IF NOT EXISTS profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'artist' CHECK (role IN ('admin', 'artist')),
  full_name   text,
  email       text UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
-- Admin can read all profiles; no write (service-role handles it)
CREATE POLICY profiles_admin_read ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- 2. Booking-artists — tracks which artist(s) work each booking (Phase 4; table created now for schema stability).
CREATE TABLE IF NOT EXISTS booking_artists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  artist_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lead        boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, artist_id)
);
ALTER TABLE booking_artists ENABLE ROW LEVEL SECURITY;
-- Admin can read all; service-role writes
CREATE POLICY booking_artists_admin_read ON booking_artists
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- 3. Existing tables: add read-only policies for authenticated admin
-- (quote_revisions and rejections were created in 0008 without RLS policies)
DO $$ BEGIN
  CREATE POLICY quote_revisions_admin_read ON quote_revisions
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY rejections_admin_read ON rejections
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
