-- Let get_matches_with_odds() filter to a specific set of market_keys at the
-- SQL level, instead of always aggregating every market for every match and
-- discarding most of it in the application layer (see odds-service.ts's
-- onlyMarketKeys option, added alongside this migration). For a single
-- Premier League match that discarded work meant scanning/grouping/JSON-
-- building ~400 markets x ~14 bookmakers per match just to throw away
-- everything except MATCH_WINNER - most of the function's ~4s runtime for a
-- 10-match league was spent on rows the caller never looked at.
--
-- p_market_keys defaults to NULL (no filter, full behavior unchanged) so
-- every existing caller - including a bare `get_matches_with_odds(league)`
-- call - keeps working exactly as before.
--
-- match_start is deliberately computed from the FULL, unfiltered odds rows
-- for the league (cheap: match_id + start_time only, no market_types join),
-- not from the market_keys-filtered set. start_time is copied verbatim from
-- the scraper's FullMatchOffer onto every row a bookmaker writes for a
-- match, so it's identical across that bookmaker's own markets - but not
-- every bookmaker reports it, and computing MAX() only over (say)
-- MATCH_WINNER rows would silently produce a different, possibly-NULL
-- start_time whenever the bookmaker(s) that DO report it happen to have no
-- MATCH_WINNER row for that match. Getting "is this match still upcoming"
-- wrong is worse than the query being a bit slower, so this stays
-- unfiltered regardless of p_market_keys.

DROP FUNCTION IF EXISTS get_matches_with_odds(TEXT);

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
