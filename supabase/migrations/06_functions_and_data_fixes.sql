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
  )
  SELECT 
    l.match_id,
    l.home_team,
    l.away_team,
    jsonb_object_agg(
      l.market_key,
      jsonb_build_object(
        'code', l.market_code,
        'namePl', l.market_name_pl,
        'viewType', l.view_type,
        'category', l.category,
        'paramValue', l.param_value,
        'bookmakerOdds', (
          SELECT jsonb_object_agg(
            sub.bookmaker,
            jsonb_build_object(
              'selections', sub.selections,
              'eventUrl', sub.event_url,
              'scrapedAt', sub.scraped_at
            )
          )
          FROM latest sub
          WHERE sub.match_id = l.match_id AND sub.market_key = l.market_key
        )
      )
    ) AS markets,
    MAX(l.scraped_at) AS last_updated
  FROM latest l
  GROUP BY l.match_id, l.home_team, l.away_team;
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
