CREATE TABLE scraper_runs (
  id BIGSERIAL PRIMARY KEY,
  bookmaker TEXT NOT NULL,
  league_slug TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  matches_found INTEGER DEFAULT 0,
  markets_saved INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER
);

CREATE INDEX idx_scraper_runs_bookmaker ON scraper_runs(bookmaker);
CREATE INDEX idx_scraper_runs_league ON scraper_runs(league_slug);
CREATE INDEX idx_scraper_runs_started ON scraper_runs(started_at DESC);
CREATE INDEX idx_scraper_runs_status ON scraper_runs(status);
