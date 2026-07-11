-- 0025: track which vendor/venue partner referral link (?ref=<slug>) sent a lead,
-- so Zandeline can see which partnerships actually produce bookings.
alter table enquiries
  add column if not exists referral_source text;
