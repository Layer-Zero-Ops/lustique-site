-- 0023_promo_library.sql
-- Seeds business_settings with today's promo as the default so behavior is
-- unchanged until Zandeline actively picks a different library/active promo
-- from the new admin Promotions tab.

INSERT INTO business_settings (key, value) VALUES
  ('promo_library', '["cheapest-look-free"]'),
  ('active_promo_id', 'cheapest-look-free')
ON CONFLICT (key) DO NOTHING;
