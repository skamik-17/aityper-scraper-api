-- 11a: freshness index for getLastScrapeTime (observability Task 5, README §5.1). No BEGIN/COMMIT:
-- CREATE INDEX CONCURRENTLY cannot run in a transaction; apply-migrations.sh pipes the file to psql without -1.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_odds_league_bm_scraped ON odds (league_slug, bookmaker, scraped_at DESC);
