-- 0017: portfolio_images — tracks Storage objects with custom sort positions per artist.
-- Auto-seeded on first listing after migration; positions updated via /api/admin/portfolio/reorder.

CREATE TABLE IF NOT EXISTS portfolio_images (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  artist_id    UUID REFERENCES artists(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  position     INTEGER NOT NULL DEFAULT 0,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portfolio_images_artist_position_idx ON portfolio_images (artist_id, position);
CREATE INDEX IF NOT EXISTS portfolio_images_storage_path_idx ON portfolio_images (storage_path);

ALTER TABLE portfolio_images ENABLE ROW LEVEL SECURITY;
