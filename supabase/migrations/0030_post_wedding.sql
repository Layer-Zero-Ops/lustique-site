-- Phase 3 (Pillar 1 — close post-wedding gap).
-- Capture review + referral as first-class stages of the journey so the
-- booking lifecycle covers enquiry -> payment -> REVIEW -> REFERRAL -> past-client.
-- Extends notification_type for the two new automated touches.

alter table bookings
  add column if not exists review_requested_at timestamptz;
alter table bookings
  add column if not exists referral_captured_at timestamptz;
alter table bookings
  add column if not exists review_url text;

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'review_requested';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'referral_captured';

create index if not exists bookings_review_idx on bookings (review_requested_at);
