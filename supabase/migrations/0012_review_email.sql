-- 0012: Google review email sweep support
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_email_sent_at timestamptz;

INSERT INTO business_settings (key, value)
VALUES ('google_review_url', 'https://www.google.com/search?q=lustique+cosmetology&ie=UTF-8#lrd=0x1e9560efd1f08d6b:0x7bbbb7e19521ed0,3')
ON CONFLICT (key) DO NOTHING;
