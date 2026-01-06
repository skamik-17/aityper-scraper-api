-- Migration: Fix views after adding normalization columns
-- Date: 2026-01-06
-- Purpose: Recreate views with new columns (market_key, param_value, normalized_group)

-- ============================================
-- Drop existing views to allow recreation with new columns
-- CASCADE drops dependent views (latest_markets_by_type)
-- ============================================
DROP VIEW IF EXISTS market_comparison CASCADE;
DROP VIEW IF EXISTS latest_markets CASCADE;

-- ============================================
-- Recreate latest_markets view with new columns
-- ============================================
CREATE VIEW latest_markets AS
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY match_id, bookmaker, name
      ORDER BY scraped_at DESC
    ) as rn
  FROM scraped_markets
  WHERE scraped_at > NOW() - INTERVAL '2 hours'
)
SELECT id, match_id, league_slug, home_team, away_team, home_team_normalized, away_team_normalized,
       bookmaker, group_id, external_id, name, normalized_type, market_key, param_value,
       normalized_group, selections, event_url, scraped_at
FROM ranked WHERE rn = 1;

-- ============================================
-- Create market_comparison view
-- Groups same markets from different bookmakers together
-- ============================================
CREATE VIEW market_comparison AS
SELECT
  match_id,
  league_slug,
  home_team,
  away_team,
  market_key,
  normalized_type,
  normalized_group,
  param_value,
  bookmaker,
  name as market_name,
  selections,
  event_url,
  scraped_at
FROM latest_markets
WHERE market_key IS NOT NULL
ORDER BY match_id, market_key, bookmaker;

-- ============================================
-- Recreate latest_markets_by_type view (was dropped by CASCADE)
-- ============================================
CREATE VIEW latest_markets_by_type AS
SELECT
  match_id,
  league_slug,
  home_team,
  away_team,
  bookmaker,
  normalized_type,
  market_key,
  param_value,
  normalized_group,
  name,
  selections,
  event_url,
  scraped_at
FROM latest_markets
ORDER BY match_id, bookmaker, normalized_type, name;

-- ============================================
-- Add comments
-- ============================================
COMMENT ON VIEW latest_markets IS 'Returns only the most recent markets per match/bookmaker/market (last 2 hours)';
COMMENT ON VIEW latest_markets_by_type IS 'Returns latest markets grouped by normalized type';
COMMENT ON VIEW market_comparison IS 'Cross-bookmaker market comparison view grouped by market_key';
