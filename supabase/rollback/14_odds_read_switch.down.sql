-- Rollback of 14_odds_read_switch.sql: latest_odds, its dependent views and
-- get_matches_with_odds read table odds again (03_odds_schema_views.sql and
-- 10_filter_market_keys.sql bodies). Then set ODDS_WRITE_MODEL=dual and restart.
-- Run: ./scripts/apply-migrations.sh supabase/rollback/14_odds_read_switch.down.sql
BEGIN;
DROP VIEW latest_odds CASCADE;

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
  o.custom_name,
  o.raw_market_name,
  o.selections,
  o.scraped_at,
  mt.code AS market_code,
  COALESCE(o.custom_name, mt.name_pl) AS market_name_pl,
  COALESCE(o.custom_name, mt.name_en) AS market_name_en,
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
  lo.raw_market_name,
  lo.bookmaker,
  lo.selections,
  lo.event_url,
  lo.scraped_at
FROM latest_odds lo
ORDER BY lo.match_id, lo.category, lo.market_key, lo.bookmaker;

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

CREATE OR REPLACE FUNCTION get_matches_with_odds(
  p_league_slug TEXT,
  p_market_keys TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  match_id TEXT,
  home_team TEXT,
  away_team TEXT,
  start_time TIMESTAMPTZ,
  markets JSONB,
  last_updated TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (o.match_id, o.bookmaker, o.market_key)
      o.match_id,
      o.home_team,
      o.away_team,
      o.start_time,
      o.bookmaker,
      o.market_key,
      o.param_value,
      o.selections,
      o.event_url,
      o.scraped_at,
      mt.code AS market_code,
      mt.name_pl AS market_name_pl,
      mt.view_type,
      mt.category
    FROM odds o
    JOIN market_types mt ON o.market_type_id = mt.id
    WHERE o.league_slug = p_league_slug
      -- Prune to the requested markets before any of the DISTINCT ON /
      -- GROUP BY / jsonb_object_agg work below runs, not after - this is
      -- the whole point of doing the filter in SQL instead of Node.
      AND (p_market_keys IS NULL OR o.market_key = ANY(p_market_keys))
    ORDER BY o.match_id, o.bookmaker, o.market_key, o.scraped_at DESC
  ),
  match_start AS (
    SELECT
      o.match_id,
      MAX(o.start_time) AS start_time
    FROM odds o
    WHERE o.league_slug = p_league_slug
    GROUP BY o.match_id
  ),
  bookmaker_agg AS (
    SELECT
      l.match_id,
      l.market_key,
      jsonb_object_agg(
        l.bookmaker,
        jsonb_build_object(
          'selections', l.selections,
          'eventUrl', l.event_url,
          'scrapedAt', l.scraped_at
        )
      ) AS bookmaker_odds
    FROM latest l
    GROUP BY l.match_id, l.market_key
  ),
  market_meta AS (
    SELECT DISTINCT ON (l.match_id, l.market_key)
      l.match_id,
      l.home_team,
      l.away_team,
      l.market_key,
      l.market_code,
      l.market_name_pl,
      l.view_type,
      l.category,
      l.param_value,
      l.scraped_at
    FROM latest l
  )
  SELECT
    m.match_id,
    m.home_team,
    m.away_team,
    ms.start_time,
    jsonb_object_agg(
      m.market_key,
      jsonb_build_object(
        'code', m.market_code,
        'namePl', m.market_name_pl,
        'viewType', m.view_type,
        'category', m.category,
        'paramValue', m.param_value,
        'bookmakerOdds', ba.bookmaker_odds
      )
    ) AS markets,
    MAX(m.scraped_at) AS last_updated
  FROM market_meta m
  JOIN bookmaker_agg ba ON ba.match_id = m.match_id AND ba.market_key = m.market_key
  JOIN match_start ms ON ms.match_id = m.match_id
  -- Keep only matches that have not kicked off yet. Matches with no known
  -- kickoff time are kept — lack of data is not evidence the match is over.
  WHERE ms.start_time IS NULL OR ms.start_time > NOW()
  GROUP BY m.match_id, m.home_team, m.away_team, ms.start_time;
END;
$$ LANGUAGE plpgsql STABLE;

COMMIT;
NOTIFY pgrst, 'reload schema';
