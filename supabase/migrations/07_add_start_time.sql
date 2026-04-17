-- Add start_time column to odds table
-- Stores match kickoff time from bookmaker data (ISO 8601 / TIMESTAMPTZ)
ALTER TABLE odds ADD COLUMN start_time TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION get_matches_with_odds(p_league_slug TEXT)
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
    ORDER BY o.match_id, o.bookmaker, o.market_key, o.scraped_at DESC
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
      l.start_time,
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
    MAX(m.start_time) AS start_time,
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
  GROUP BY m.match_id, m.home_team, m.away_team;
END;
$$ LANGUAGE plpgsql STABLE;
