-- Migration 12, prune_stale_odds: one batched prune per bookmaker save, guard off by default (owner B13).
-- Previous scrape at 10:00, new scrape at 11:00, bookmaker fortuna:
--   A a:b 40 -> 40, B c:d 40 -> 2, C e:f 5 -> 1 (previous < 20), D g:h 40 -> 4 (exactly 10 %), E i:j 40 -> 0;
--   plus one sts row on A at 10:00 that no fortuna prune may touch.
\set ON_ERROR_STOP 1

CREATE TEMP TABLE res (r jsonb);

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, selections, display_order)
VALUES (999012, 'SQLTEST_12', 'Test', 'Test', 'Test', 'Test', 'BINARY_BUTTONS', 'WYNIK_MECZU', ARRAY['YES', 'NO'], 1)
ON CONFLICT DO NOTHING;

CREATE FUNCTION pg_temp.seed() RETURNS void LANGUAGE sql AS $$
  DELETE FROM odds;
  INSERT INTO odds (match_id, league_slug, home_team, away_team, bookmaker, market_type_id, market_key, selections, scraped_at)
  SELECT 'premier-league:' || m.id, 'premier-league', 'H', 'A', 'fortuna', 999012, 'K' || g, '[]'::jsonb, ts
  FROM (VALUES ('a:b', 40, 40), ('c:d', 40, 2), ('e:f', 5, 1), ('g:h', 40, 4), ('i:j', 40, 0)) AS m(id, prev, cur),
       LATERAL (SELECT g, '2026-11-07 10:00+00'::timestamptz AS ts FROM generate_series(1, m.prev) g
                UNION ALL
                SELECT g, '2026-11-07 11:00+00'::timestamptz FROM generate_series(1, m.cur) g) rows;
  INSERT INTO odds (match_id, league_slug, home_team, away_team, bookmaker, market_type_id, market_key, selections, scraped_at)
  VALUES ('premier-league:a:b', 'premier-league', 'H', 'A', 'sts', 999012, 'K1', '[]'::jsonb, '2026-11-07 10:00+00');
$$;

-- Case 1, default (p_guard false, owner B13): everything is pruned as today
SELECT pg_temp.seed();
TRUNCATE res;
INSERT INTO res SELECT prune_stale_odds('fortuna', '2026-11-07 11:00+00',
  '{"premier-league:a:b":40,"premier-league:c:d":2,"premier-league:e:f":1,"premier-league:g:h":4,"premier-league:i:j":0}');
DO $$
DECLARE r jsonb := (SELECT res.r FROM res);
BEGIN
  ASSERT (r->>'deleted')::int = 165, 'case 1 deleted: ' || r::text;
  ASSERT r->>'pruned_matches' = '5', 'case 1 pruned_matches: ' || r::text;
  ASSERT r->'prune_skipped' = '[]'::jsonb, 'case 1 prune_skipped: ' || r::text;
  ASSERT (SELECT count(*) FROM odds WHERE bookmaker = 'fortuna' AND scraped_at < '2026-11-07 11:00+00') = 0, 'case 1 left old fortuna rows';
  ASSERT (SELECT count(*) FROM odds WHERE bookmaker = 'sts') = 1, 'case 1 touched the sts row';
END $$;

-- Case 2: guard on
SELECT pg_temp.seed();
TRUNCATE res;
INSERT INTO res SELECT prune_stale_odds('fortuna', '2026-11-07 11:00+00',
  '{"premier-league:a:b":40,"premier-league:c:d":2,"premier-league:e:f":1,"premier-league:g:h":4,"premier-league:i:j":0}',
  p_guard => true);
DO $$
DECLARE r jsonb := (SELECT res.r FROM res);
BEGIN
  ASSERT (r->>'deleted')::int = 85, 'case 2 deleted: ' || r::text;
  ASSERT r->>'pruned_matches' = '3', 'case 2 pruned_matches: ' || r::text;
  ASSERT r->'prune_skipped' = '[{"match_id":"premier-league:c:d","new_rows":2,"previous_rows":40},{"match_id":"premier-league:i:j","new_rows":0,"previous_rows":40}]'::jsonb,
    'case 2 prune_skipped: ' || r::text;
  ASSERT (SELECT count(*) FROM latest_odds WHERE match_id = 'premier-league:c:d') = 40, 'case 2: the guarded snapshot is not whole';
  ASSERT (SELECT count(*) FROM odds WHERE bookmaker = 'sts') = 1, 'case 2 touched the sts row';
END $$;

-- Case 3: a first write (no previous rows) is never guarded and deletes nothing
DELETE FROM odds;
TRUNCATE res;
INSERT INTO res SELECT prune_stale_odds('fortuna', '2026-11-07 11:00+00', '{"premier-league:x:y":1}', p_guard => true);
DO $$
DECLARE r jsonb := (SELECT res.r FROM res);
BEGIN
  ASSERT r = '{"deleted":0,"pruned_matches":1,"prune_skipped":[]}'::jsonb, 'case 3: ' || r::text;
END $$;

DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'prune_stale_odds(text,timestamptz,jsonb,numeric,integer,boolean)', 'EXECUTE'), 'anon can execute';
  ASSERT NOT has_function_privilege('authenticated', 'prune_stale_odds(text,timestamptz,jsonb,numeric,integer,boolean)', 'EXECUTE'), 'authenticated can execute';
  ASSERT has_function_privilege('service_role', 'prune_stale_odds(text,timestamptz,jsonb,numeric,integer,boolean)', 'EXECUTE'), 'service_role cannot execute';
END $$;
