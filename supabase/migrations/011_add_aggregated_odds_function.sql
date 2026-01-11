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
