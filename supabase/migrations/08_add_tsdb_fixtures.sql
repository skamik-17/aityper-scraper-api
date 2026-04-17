-- TheSportsDB fixtures cache
-- Syncs TSDB fixture data to Supabase so frontend is never rate-limited by TSDB.
-- Populated by a scheduled job in the backend.

CREATE TABLE IF NOT EXISTS tsdb_fixtures (
  id TEXT PRIMARY KEY,
  league_slug TEXT NOT NULL,
  home_team_id TEXT NOT NULL,
  home_team_name TEXT NOT NULL,
  home_team_badge TEXT,
  away_team_id TEXT NOT NULL,
  away_team_name TEXT NOT NULL,
  away_team_badge TEXT,
  kickoff_time TIMESTAMPTZ NOT NULL,
  venue TEXT,
  round INTEGER,
  status TEXT NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  half_time_score TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tsdb_fixtures_league ON tsdb_fixtures (league_slug);
CREATE INDEX IF NOT EXISTS idx_tsdb_fixtures_kickoff ON tsdb_fixtures (kickoff_time);
CREATE INDEX IF NOT EXISTS idx_tsdb_fixtures_league_kickoff ON tsdb_fixtures (league_slug, kickoff_time);
