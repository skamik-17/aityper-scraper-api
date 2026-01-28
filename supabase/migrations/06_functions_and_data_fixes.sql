CREATE OR REPLACE FUNCTION get_best_odds(p_match_id TEXT, p_market_key TEXT)
RETURNS TABLE (
  selection_name TEXT,
  best_odds NUMERIC,
  bookmaker TEXT,
  all_odds JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH odds_expanded AS (
    SELECT 
      lo.bookmaker,
      sel->>'name' AS sel_name,
      sel->>'normalizedName' AS sel_normalized,
      (sel->>'odds')::NUMERIC AS odds_value
    FROM latest_odds lo,
    LATERAL jsonb_array_elements(lo.selections) AS sel
    WHERE lo.match_id = p_match_id AND lo.market_key = p_market_key
  ),
  best AS (
    SELECT 
      COALESCE(sel_normalized, sel_name) AS selection_name,
      MAX(odds_value) AS best_odds
    FROM odds_expanded
    GROUP BY COALESCE(sel_normalized, sel_name)
  )
  SELECT 
    b.selection_name,
    b.best_odds,
    (SELECT oe.bookmaker FROM odds_expanded oe 
     WHERE COALESCE(oe.sel_normalized, oe.sel_name) = b.selection_name 
     AND oe.odds_value = b.best_odds LIMIT 1) AS bookmaker,
    (SELECT jsonb_agg(jsonb_build_object('bookmaker', oe.bookmaker, 'odds', oe.odds_value))
     FROM odds_expanded oe 
     WHERE COALESCE(oe.sel_normalized, oe.sel_name) = b.selection_name) AS all_odds
  FROM best b;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_odds(hours_to_keep INTEGER DEFAULT 24)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM odds 
  WHERE scraped_at < NOW() - (hours_to_keep || ' hours')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

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

CREATE OR REPLACE FUNCTION get_matches_with_odds(p_league_slug TEXT)
RETURNS TABLE (
  match_id TEXT,
  home_team TEXT,
  away_team TEXT,
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
  -- Pre-aggregate bookmaker odds per market to avoid O(n²) correlated subquery
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
  -- Get distinct market metadata (one row per match+market)
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

UPDATE odds
SET selections = (
  SELECT jsonb_agg(
    CASE 
      WHEN elem->>'normalizedName' = '1' THEN 
        jsonb_set(elem, '{normalizedName}', '"HOME"')
      WHEN elem->>'normalizedName' = 'X' THEN 
        jsonb_set(elem, '{normalizedName}', '"DRAW"')
      WHEN elem->>'normalizedName' = '2' THEN 
        jsonb_set(elem, '{normalizedName}', '"AWAY"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements(selections) AS elem
)
WHERE market_type_id = 48
  AND EXISTS (
    SELECT 1 
    FROM jsonb_array_elements(selections) AS elem
    WHERE elem->>'normalizedName' IN ('1', 'X', '2')
  );
