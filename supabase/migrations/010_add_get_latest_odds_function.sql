CREATE OR REPLACE FUNCTION get_latest_odds_by_league(p_league_slug TEXT)
RETURNS TABLE (
  id BIGINT,
  match_id TEXT,
  league_slug TEXT,
  home_team TEXT,
  away_team TEXT,
  bookmaker TEXT,
  event_url TEXT,
  market_type_id INTEGER,
  market_key TEXT,
  param_value TEXT,
  selections JSONB,
  scraped_at TIMESTAMPTZ,
  market_code TEXT,
  market_name_pl TEXT,
  market_name_en TEXT,
  view_type view_type,
  category market_category,
  has_parameter BOOLEAN,
  expected_selections TEXT[]
) AS $$
BEGIN
  RETURN QUERY
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
    mt.code,
    mt.name_pl,
    mt.name_en,
    mt.view_type,
    mt.category,
    mt.has_parameter,
    mt.selections
  FROM (
    SELECT DISTINCT ON (odds.match_id, odds.bookmaker, odds.market_key)
      odds.*
    FROM odds
    WHERE odds.league_slug = p_league_slug
    ORDER BY odds.match_id, odds.bookmaker, odds.market_key, odds.scraped_at DESC
  ) o
  JOIN market_types mt ON o.market_type_id = mt.id
  ORDER BY o.home_team, o.market_key;
END;
$$ LANGUAGE plpgsql STABLE;
