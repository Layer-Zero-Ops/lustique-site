-- supabase/migrations/0013_artists.sql
-- Wave D4: dedicated artists table; seed 9 Lustique artists; re-point booking_artists FK.
-- Does NOT touch auth.users.

-- ── 1. Create artists table ───────────────────────────────────────────────────
CREATE TABLE artists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text,
  phone       text,
  specialisms text[] DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE artists ENABLE ROW LEVEL SECURITY;

-- Admin can read; service-role writes (bypasses RLS).
CREATE POLICY artists_admin_read ON artists
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- ── 2. Seed 9 Lustique artists ────────────────────────────────────────────────
-- Fixed UUIDs for reproducibility; emails are placeholders (update via Pieter action).
INSERT INTO artists (id, name, email, specialisms) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Zandeline', 'zandeline@lustiqueco.co.za', ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000002', 'Monique',   'monique@lustiqueco.co.za',   ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000003', 'Marize',    'marize@lustiqueco.co.za',    ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000004', 'Jana',      'jana@lustiqueco.co.za',      ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000005', 'Janeke',    'janeke@lustiqueco.co.za',    ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000006', 'Elria',     'elria@lustiqueco.co.za',     ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000007', 'Maroné',    'marone@lustiqueco.co.za',    ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000008', 'René',      'rene@lustiqueco.co.za',      ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000009', 'Samantha',  'samantha@lustiqueco.co.za',  ARRAY['bridal-hair','bridal-makeup']);

-- ── 3. Re-point booking_artists.artist_id FK → artists(id) ───────────────────
-- Safe: booking_artists has no rows (confirmed from schema recon).
ALTER TABLE booking_artists DROP CONSTRAINT IF EXISTS booking_artists_artist_id_fkey;
ALTER TABLE booking_artists
  ADD CONSTRAINT booking_artists_artist_id_fkey
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE;
