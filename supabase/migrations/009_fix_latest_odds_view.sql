-- Fix latest_odds view: Replace DISTINCT ON with ROW_NUMBER()
-- DISTINCT ON has issues with WHERE clause pushdown in PostgreSQL,
-- causing some rows to be missing when filtering by league_slug.
-- ROW_NUMBER() in a subquery handles this correctly.

-- Drop dependent view first
DROP VIEW IF EXISTS market_comparison;
DROP VIEW IF EXISTS matches_with_odds;
DROP VIEW IF EXISTS latest_odds;

-- Recreate latest_odds using ROW_NUMBER() instead of DISTINCT ON
CREATE VIEW latest_odds AS
SELECT 
  o.id,
  o.match_id,
  o.league_slug,
  o.home_team,
  o.away_team,
  o.bookmaker,
  o.event_url,
  o.market_type_id,
  o.market_key,
  o.param_value,
  o.selections,
  o.scraped_at,
  mt.code AS market_code,
  mt.name_pl AS market_name_pl,
  mt.name_en AS market_name_en,
  mt.view_type,
  mt.category,
  mt.has_parameter,
  mt.selections AS expected_selections
FROM (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY match_id, bookmaker, market_key 
      ORDER BY scraped_at DESC
    ) AS rn
  FROM odds
) o
JOIN market_types mt ON o.market_type_id = mt.id
WHERE o.rn = 1;

-- Recreate market_comparison view
CREATE VIEW market_comparison AS
SELECT 
  lo.match_id,
  lo.league_slug,
  lo.home_team,
  lo.away_team,
  lo.market_key,
  lo.market_type_id,
  lo.market_code,
  lo.market_name_pl,
  lo.market_name_en,
  lo.view_type,
  lo.category,
  lo.param_value,
  lo.bookmaker,
  lo.selections,
  lo.event_url,
  lo.scraped_at
FROM latest_odds lo
ORDER BY lo.match_id, lo.category, lo.market_key, lo.bookmaker;

-- Recreate matches_with_odds view
CREATE VIEW matches_with_odds AS
SELECT 
  match_id,
  league_slug,
  home_team,
  away_team,
  COUNT(DISTINCT bookmaker) AS bookmaker_count,
  COUNT(DISTINCT market_key) AS market_count,
  MAX(scraped_at) AS last_updated,
  array_agg(DISTINCT bookmaker) AS bookmakers
FROM latest_odds
GROUP BY match_id, league_slug, home_team, away_team;
