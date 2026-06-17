-- S6: Blocked dates for availability checking
-- Admin marks dates as unavailable; Worker checks on booking request

CREATE TABLE IF NOT EXISTS blocked_dates (
  date        DATE        PRIMARY KEY,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE blocked_dates ENABLE ROW LEVEL SECURITY;

-- Service role only — availability is checked server-side
CREATE POLICY "service_all" ON blocked_dates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
