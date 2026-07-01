-- 0022_venue_match_log.sql
-- Anonymous telemetry for the quote-page venue matcher: records how each
-- venue lookup resolved so we can measure real-world first-time accuracy
-- instead of guessing from directory size. No PII — just what was typed
-- and how it resolved. Public (anon) can insert from the quote page;
-- only the Worker's service key can read (admin stats endpoint).

CREATE TABLE IF NOT EXISTS venue_match_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome      text NOT NULL,
  typed_text   text,
  matched_name text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_match_log_outcome_idx ON venue_match_log (outcome, created_at);

ALTER TABLE venue_match_log ENABLE ROW LEVEL SECURITY;

-- Anon can insert (fired from the public quote page) but never read or update.
CREATE POLICY venue_match_log_public_insert ON venue_match_log
  FOR INSERT WITH CHECK (true);
