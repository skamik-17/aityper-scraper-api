-- Migration: Add normalization fields to scraped_markets
-- Date: 2026-01-06
-- Purpose: Enable cross-bookmaker market comparison via marketKey

-- ============================================
-- Add normalization columns to scraped_markets
-- ============================================

-- market_key: Unique identifier for comparing same market across bookmakers
-- Format: "TYPE" or "TYPE:PARAM" (e.g., "TOTAL_GOALS:2.5", "MATCH_WINNER")
ALTER TABLE scraped_markets
ADD COLUMN IF NOT EXISTS market_key TEXT;

-- param_value: Extracted parameter for parameterized markets
-- e.g., "2.5" for Over/Under 2.5, "-1.5" for Asian Handicap -1.5
ALTER TABLE scraped_markets
ADD COLUMN IF NOT EXISTS param_value TEXT;

-- normalized_group: UI grouping (MAIN, GOALS, HANDICAP, HALF_TIME, SCORE, OTHER)
ALTER TABLE scraped_markets
ADD COLUMN IF NOT EXISTS normalized_group TEXT DEFAULT 'OTHER';

-- ============================================
-- Update indexes for efficient querying
-- ============================================

-- Index on market_key for cross-bookmaker comparison
CREATE INDEX IF NOT EXISTS idx_markets_market_key ON scraped_markets(market_key);

-- Composite index for comparison queries
CREATE INDEX IF NOT EXISTS idx_markets_match_key ON scraped_markets(match_id, market_key);

-- Index on normalized_group for UI filtering
CREATE INDEX IF NOT EXISTS idx_markets_normalized_group ON scraped_markets(normalized_group);

-- ============================================
-- Update latest_markets view to include new fields
-- ============================================
CREATE OR REPLACE VIEW latest_markets AS
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
-- New view: Cross-bookmaker market comparison
-- Groups same markets from different bookmakers together
-- ============================================
CREATE OR REPLACE VIEW market_comparison AS
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
-- Helper function: Get comparable markets for a match
-- Returns markets grouped by market_key for comparison
-- ============================================
CREATE OR REPLACE FUNCTION get_comparable_markets(
  p_match_id TEXT,
  p_market_key TEXT DEFAULT NULL
) RETURNS TABLE (
  market_key TEXT,
  normalized_type TEXT,
  normalized_group TEXT,
  param_value TEXT,
  bookmaker TEXT,
  market_name TEXT,
  selections JSONB,
  event_url TEXT,
  scraped_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.market_key,
    m.normalized_type,
    m.normalized_group,
    m.param_value,
    m.bookmaker,
    m.name as market_name,
    m.selections,
    m.event_url,
    m.scraped_at
  FROM latest_markets m
  WHERE m.match_id = p_match_id
    AND m.market_key IS NOT NULL
    AND (p_market_key IS NULL OR m.market_key = p_market_key)
  ORDER BY m.normalized_group, m.market_key, m.bookmaker;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Helper function: Get best odds for each selection
-- Returns the best odds per market_key across all bookmakers
-- ============================================
CREATE OR REPLACE FUNCTION get_best_odds_by_market(
  p_match_id TEXT
) RETURNS TABLE (
  market_key TEXT,
  normalized_type TEXT,
  normalized_group TEXT,
  selection_name TEXT,
  best_odds NUMERIC,
  best_bookmaker TEXT,
  bookmaker_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH expanded AS (
    SELECT
      m.market_key,
      m.normalized_type,
      m.normalized_group,
      m.bookmaker,
      sel->>'name' as selection_name,
      sel->>'normalizedName' as normalized_selection,
      (sel->>'odds')::NUMERIC as odds
    FROM latest_markets m,
    LATERAL jsonb_array_elements(m.selections) as sel
    WHERE m.match_id = p_match_id
      AND m.market_key IS NOT NULL
  ),
  ranked AS (
    SELECT
      e.market_key,
      e.normalized_type,
      e.normalized_group,
      COALESCE(e.normalized_selection, e.selection_name) as selection_name,
      e.odds,
      e.bookmaker,
      ROW_NUMBER() OVER (
        PARTITION BY e.market_key, COALESCE(e.normalized_selection, e.selection_name)
        ORDER BY e.odds DESC
      ) as rn,
      COUNT(*) OVER (
        PARTITION BY e.market_key, COALESCE(e.normalized_selection, e.selection_name)
      ) as total_bookmakers
    FROM expanded e
  )
  SELECT
    r.market_key,
    r.normalized_type,
    r.normalized_group,
    r.selection_name,
    r.odds as best_odds,
    r.bookmaker as best_bookmaker,
    r.total_bookmakers as bookmaker_count
  FROM ranked r
  WHERE r.rn = 1
  ORDER BY r.normalized_group, r.market_key, r.selection_name;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Comments
-- ============================================
COMMENT ON COLUMN scraped_markets.market_key IS 'Unique market identifier for comparison: TYPE or TYPE:PARAM (e.g., TOTAL_GOALS:2.5)';
COMMENT ON COLUMN scraped_markets.param_value IS 'Extracted parameter value (e.g., 2.5 for Over/Under, -1.5 for handicap)';
COMMENT ON COLUMN scraped_markets.normalized_group IS 'UI grouping: MAIN, GOALS, HANDICAP, HALF_TIME, SCORE, OTHER';
COMMENT ON VIEW market_comparison IS 'Cross-bookmaker market comparison view grouped by market_key';
COMMENT ON FUNCTION get_comparable_markets IS 'Get markets for comparison, optionally filtered by market_key';
COMMENT ON FUNCTION get_best_odds_by_market IS 'Get best odds per selection for each market across all bookmakers';
