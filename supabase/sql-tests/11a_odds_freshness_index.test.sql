-- Migration 11a: the freshness index serves getLastScrapeTime's
-- "latest scraped_at per (league, bookmaker)" query.
\set ON_ERROR_STOP 1

-- market_types is empty after the migrations (05 is a no-op; the backend syncs the catalog at boot).
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, selections, display_order)
VALUES (999001, 'SQLTEST_11A', 'Test', 'Test', 'Test', 'Test', 'BINARY_BUTTONS', 'WYNIK_MECZU', ARRAY['YES', 'NO'], 1)
ON CONFLICT DO NOTHING;

INSERT INTO odds (match_id, league_slug, home_team, away_team, bookmaker, market_type_id, market_key, selections, scraped_at)
SELECT 'premier-league:h' || (g % 50) || ':a', 'premier-league', 'H', 'A', bm, 999001, 'K' || g,
       '[]'::jsonb, now() - (g || ' minutes')::interval
FROM unnest(ARRAY['sts','fortuna','betclic','superbet','lvbet','fuksiarz','betfan','totalbet','forbet','etoto',
                  'betters','lebull','betcris','pzbuk']) AS bm,
     generate_series(1, 2000) AS g;

ANALYZE odds;

DO $$
DECLARE
  def text;
  plan json;
BEGIN
  ASSERT to_regclass('idx_odds_league_bm_scraped') IS NOT NULL, 'idx_odds_league_bm_scraped is missing';
  def := pg_get_indexdef('idx_odds_league_bm_scraped'::regclass);
  ASSERT def LIKE '%(league_slug, bookmaker, scraped_at DESC)%', 'unexpected index definition: ' || def;

  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT scraped_at FROM odds WHERE league_slug = ''premier-league'' '
       || 'AND bookmaker = ''lebull'' ORDER BY scraped_at DESC LIMIT 1' INTO plan;
  ASSERT plan::text LIKE '%"Index Name": "idx_odds_league_bm_scraped"%', 'freshness query does not use the index: ' || plan::text;
END $$;
