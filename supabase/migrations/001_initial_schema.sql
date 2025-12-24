-- Initial schema for AITyper odds scraping backend
-- Run this migration in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Table: scraped_odds
-- Stores odds scraped from bookmakers
-- ============================================
CREATE TABLE IF NOT EXISTS scraped_odds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Match identification
  league_slug TEXT NOT NULL DEFAULT 'ekstraklasa',
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_team_normalized TEXT NOT NULL,
  away_team_normalized TEXT NOT NULL,

  -- Bookmaker and odds
  bookmaker TEXT NOT NULL,
  home_odds DECIMAL(6,3) NOT NULL,
  draw_odds DECIMAL(6,3) NOT NULL,
  away_odds DECIMAL(6,3) NOT NULL,

  -- Tax promo status
  has_no_tax_promo BOOLEAN DEFAULT false,
  promo_details TEXT,

  -- Metadata
  event_name TEXT,
  event_url TEXT,

  -- Timestamps
  scraped_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate entries for same match/bookmaker/time
  UNIQUE(league_slug, home_team_normalized, away_team_normalized, bookmaker, scraped_at)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_scraped_odds_league ON scraped_odds(league_slug);
CREATE INDEX IF NOT EXISTS idx_scraped_odds_bookmaker ON scraped_odds(bookmaker);
CREATE INDEX IF NOT EXISTS idx_scraped_odds_scraped_at ON scraped_odds(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraped_odds_teams ON scraped_odds(home_team_normalized, away_team_normalized);

-- ============================================
-- Table: scraper_runs
-- Tracks each scraper execution
-- ============================================
CREATE TABLE IF NOT EXISTS scraper_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL,
  league_slug TEXT NOT NULL,
  bookmaker TEXT NOT NULL,
  status TEXT NOT NULL,
  matches_found INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for scraper runs
CREATE INDEX IF NOT EXISTS idx_scraper_runs_run_id ON scraper_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_scraper_runs_status ON scraper_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraper_runs_bookmaker ON scraper_runs(bookmaker, started_at DESC);

-- ============================================
-- View: latest_odds
-- Returns only the most recent odds for each match/bookmaker
-- ============================================
CREATE OR REPLACE VIEW latest_odds AS
WITH ranked_odds AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY league_slug, home_team_normalized, away_team_normalized, bookmaker
      ORDER BY scraped_at DESC
    ) as rn
  FROM scraped_odds
  WHERE scraped_at > NOW() - INTERVAL '1 hour'
)
SELECT
  id,
  league_slug,
  home_team,
  away_team,
  home_team_normalized,
  away_team_normalized,
  bookmaker,
  home_odds,
  draw_odds,
  away_odds,
  has_no_tax_promo,
  promo_details,
  event_name,
  event_url,
  scraped_at
FROM ranked_odds
WHERE rn = 1;

-- ============================================
-- Row Level Security (RLS)
-- ============================================
ALTER TABLE scraped_odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraper_runs ENABLE ROW LEVEL SECURITY;

-- Public can read odds
CREATE POLICY "Public read scraped_odds" ON scraped_odds
  FOR SELECT USING (true);

-- Service role has full access to scraped_odds
CREATE POLICY "Service role full access scraped_odds" ON scraped_odds
  FOR ALL USING (auth.role() = 'service_role');

-- Service role has full access to scraper_runs
CREATE POLICY "Service role full access scraper_runs" ON scraper_runs
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Cleanup function
-- Removes old data to prevent table bloat
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_old_odds() RETURNS void AS $$
BEGIN
  -- Delete odds older than 24 hours
  DELETE FROM scraped_odds WHERE scraped_at < NOW() - INTERVAL '24 hours';

  -- Delete scraper runs older than 7 days
  DELETE FROM scraper_runs WHERE started_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE scraped_odds IS 'Betting odds scraped from Polish bookmakers';
COMMENT ON TABLE scraper_runs IS 'Tracking log for scraper executions';
COMMENT ON VIEW latest_odds IS 'Most recent odds per match per bookmaker (last 1 hour)';
COMMENT ON FUNCTION cleanup_old_odds IS 'Removes stale odds (>24h) and old run logs (>7d)';
