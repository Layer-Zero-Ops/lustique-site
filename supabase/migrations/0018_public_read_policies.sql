-- 0018: Public read policies for site build-time queries.
-- artists: public can read active artists (for team + portfolio filter tabs).
-- portfolio_images: public can read all rows (for gallery + ordering).

CREATE POLICY artists_public_read ON artists
  FOR SELECT USING (active = true);

CREATE POLICY portfolio_images_public_read ON portfolio_images
  FOR SELECT USING (true);
