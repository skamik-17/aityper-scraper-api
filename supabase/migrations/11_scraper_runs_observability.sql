-- 11: scraper run observability. Additive and nullable: existing rows stay valid.
-- status written by the service from now on: success | partial | empty | scrape_failed | persist_failed
ALTER TABLE scraper_runs ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE scraper_runs ADD COLUMN IF NOT EXISTS markets_found INTEGER;
CREATE INDEX IF NOT EXISTS idx_scraper_runs_league_bm_started
  ON scraper_runs (league_slug, bookmaker, started_at DESC);
