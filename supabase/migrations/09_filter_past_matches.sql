-- Filter out matches that have already kicked off from get_matches_with_odds.
-- Previously every match ever scraped for a league stayed in the API response,
-- so the frontend listed finished games weeks after they were played.
-- Also compute match-level start_time as MAX over ALL latest rows (bookmakers
-- differ in whether they report kickoff time), instead of relying on the
-- arbitrary row picked per market.

DROP FUNCTION IF EXISTS get_matches_with_odds(TEXT);

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
  match_start AS (
    SELECT
      l.match_id,
      MAX(l.start_time) AS start_time
    FROM latest l
    GROUP BY l.match_id
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
