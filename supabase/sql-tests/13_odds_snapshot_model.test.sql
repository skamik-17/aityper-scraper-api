-- Migration 13: additive snapshot model (matches / odds_snapshot / odds_current / odds_history),
-- save_odds_snapshot, latest_odds_v2 / latest_odds_legacy, backfill and compare_odds_models.
\set ON_ERROR_STOP 1

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, selections, display_order)
VALUES (999131, 'SQLTEST_13', 'Test', 'Test', 'Test', 'Test', 'BINARY_BUTTONS', 'WYNIK_MECZU', ARRAY['YES', 'NO'], 1)
ON CONFLICT DO NOTHING;

-- n rows K1..Kn; k1_changed moves K1's price
CREATE FUNCTION pg_temp.rows(n int, k1_changed boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('market_key', 'K' || g, 'market_type_id', 999131,
           'selections', jsonb_build_array(jsonb_build_object('name', '1',
             'odds', CASE WHEN k1_changed AND g = 1 THEN 9.99 ELSE 1.5 + g / 100.0 END, 'normalizedName', 'HOME')))
           ORDER BY g), '[]'::jsonb)
  FROM generate_series(1, n) g
$$;
CREATE FUNCTION pg_temp.match(id text, st text DEFAULT '2030-01-01T15:00:00Z') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('match_id', id, 'league_slug', 'premier-league', 'home_team', split_part(id, ':', 2),
                            'away_team', split_part(id, ':', 3), 'event_url', 'u', 'start_time', st)
$$;

CREATE TEMP TABLE res (step text PRIMARY KEY, r jsonb);
CREATE TEMP TABLE seen (step text PRIMARY KEY, at timestamptz);

-- Smoke sequence, guard on
INSERT INTO res SELECT 'a1', save_odds_snapshot('11111111-1111-1111-1111-111111111111', 'fortuna', pg_temp.match('premier-league:arsenal:hull city'), pg_temp.rows(40), p_guard => true);
INSERT INTO res SELECT 'a2', save_odds_snapshot('22222222-2222-2222-2222-222222222222', 'fortuna', pg_temp.match('premier-league:arsenal:hull city'), pg_temp.rows(40), p_guard => true);
INSERT INTO res SELECT 'a3', save_odds_snapshot('33333333-3333-3333-3333-333333333333', 'fortuna', pg_temp.match('premier-league:arsenal:hull city'), pg_temp.rows(38, true), p_guard => true);
INSERT INTO seen SELECT 'a3', last_seen_at FROM odds_snapshot WHERE match_id = 'premier-league:arsenal:hull city' AND bookmaker = 'fortuna';
INSERT INTO res SELECT 'a4', save_odds_snapshot('44444444-4444-4444-4444-444444444444', 'fortuna', pg_temp.match('premier-league:arsenal:hull city'), pg_temp.rows(2), p_guard => true);

DO $$
DECLARE s odds_snapshot;
BEGIN
  ASSERT (SELECT r->>'inserted' FROM res WHERE step = 'a1') = '40', 'a1: ' || (SELECT r FROM res WHERE step = 'a1');
  ASSERT (SELECT r->>'unchanged' FROM res WHERE step = 'a2') = '40', 'a2: ' || (SELECT r FROM res WHERE step = 'a2');
  ASSERT (SELECT r->>'previous_rows' FROM res WHERE step = 'a2') = '40', 'a2 previous: ' || (SELECT r FROM res WHERE step = 'a2');
  ASSERT (SELECT (r->>'updated', r->>'removed', r->>'unchanged') = ('1', '2', '37') FROM res WHERE step = 'a3'), 'a3: ' || (SELECT r FROM res WHERE step = 'a3');
  ASSERT (SELECT (r->>'prune_skipped', r->>'removed') = ('true', '0') FROM res WHERE step = 'a4'), 'a4: ' || (SELECT r FROM res WHERE step = 'a4');
  SELECT * INTO s FROM odds_snapshot WHERE match_id = 'premier-league:arsenal:hull city' AND bookmaker = 'fortuna';
  ASSERT s.row_count = 38 AND s.status = 'degenerate' AND s.degenerate_since IS NOT NULL, 'a4 snapshot: ' || row_to_json(s)::text;
  ASSERT s.last_seen_at = (SELECT at FROM seen WHERE step = 'a3'), 'a4 moved last_seen_at';
  ASSERT (SELECT count(*) FROM odds_current WHERE match_id = 'premier-league:arsenal:hull city') = 38, 'a4 current rows';
  ASSERT (SELECT count(*) FILTER (WHERE selections IS NOT NULL) = 42 AND count(*) FILTER (WHERE selections IS NULL) = 2
          FROM odds_history WHERE match_id = 'premier-league:arsenal:hull city'), 'history counts';
END $$;

-- Recovery, guard on
INSERT INTO res SELECT 'a5', save_odds_snapshot('55555555-5555-5555-5555-555555555555', 'fortuna', pg_temp.match('premier-league:arsenal:hull city'), pg_temp.rows(38), p_guard => true);
DO $$
DECLARE s odds_snapshot;
BEGIN
  SELECT * INTO s FROM odds_snapshot WHERE match_id = 'premier-league:arsenal:hull city' AND bookmaker = 'fortuna';
  ASSERT s.status = 'ok' AND s.degenerate_since IS NULL, 'a5 recovery: ' || row_to_json(s)::text;
END $$;

-- Default, guard off: write 4 prunes as today
INSERT INTO res SELECT 'b1', save_odds_snapshot('11111111-1111-1111-1111-111111111111', 'fortuna', pg_temp.match('premier-league:chelsea:everton'), pg_temp.rows(40));
INSERT INTO res SELECT 'b2', save_odds_snapshot('22222222-2222-2222-2222-222222222222', 'fortuna', pg_temp.match('premier-league:chelsea:everton'), pg_temp.rows(40));
INSERT INTO res SELECT 'b3', save_odds_snapshot('33333333-3333-3333-3333-333333333333', 'fortuna', pg_temp.match('premier-league:chelsea:everton'), pg_temp.rows(38, true));
INSERT INTO seen SELECT 'b3', last_seen_at FROM odds_snapshot WHERE match_id = 'premier-league:chelsea:everton' AND bookmaker = 'fortuna';
INSERT INTO res SELECT 'b4', save_odds_snapshot('44444444-4444-4444-4444-444444444444', 'fortuna', pg_temp.match('premier-league:chelsea:everton'), pg_temp.rows(2));
DO $$
DECLARE s odds_snapshot;
BEGIN
  ASSERT (SELECT (r->>'prune_skipped', r->>'removed') = ('false', '36') FROM res WHERE step = 'b4'), 'b4: ' || (SELECT r FROM res WHERE step = 'b4');
  SELECT * INTO s FROM odds_snapshot WHERE match_id = 'premier-league:chelsea:everton' AND bookmaker = 'fortuna';
  ASSERT s.row_count = 2 AND s.status = 'ok' AND s.degenerate_since IS NULL, 'b4 snapshot: ' || row_to_json(s)::text;
  ASSERT s.last_seen_at > (SELECT at FROM seen WHERE step = 'b3'), 'b4 kept last_seen_at';
END $$;

-- Boundaries, guard on
INSERT INTO res SELECT 'c1', save_odds_snapshot('11111111-1111-1111-1111-111111111111', 'sts', pg_temp.match('premier-league:c:d'), pg_temp.rows(40), p_guard => true);
INSERT INTO res SELECT 'c2', save_odds_snapshot('22222222-2222-2222-2222-222222222222', 'sts', pg_temp.match('premier-league:c:d'), pg_temp.rows(4), p_guard => true);
INSERT INTO res SELECT 'd1', save_odds_snapshot('11111111-1111-1111-1111-111111111111', 'sts', pg_temp.match('premier-league:e:f'), pg_temp.rows(19), p_guard => true);
INSERT INTO res SELECT 'd2', save_odds_snapshot('22222222-2222-2222-2222-222222222222', 'sts', pg_temp.match('premier-league:e:f'), '[]'::jsonb, p_guard => true);
INSERT INTO res SELECT 'e1', save_odds_snapshot('11111111-1111-1111-1111-111111111111', 'sts', pg_temp.match('premier-league:g:h'), '[]'::jsonb, p_guard => true);
DO $$
BEGIN
  ASSERT (SELECT (r->>'prune_skipped', r->>'removed') = ('false', '36') FROM res WHERE step = 'c2'), 'c2 (exactly 10 %): ' || (SELECT r FROM res WHERE step = 'c2');
  ASSERT (SELECT (r->>'prune_skipped', r->>'removed') = ('false', '19') FROM res WHERE step = 'd2'), 'd2 (19 previous): ' || (SELECT r FROM res WHERE step = 'd2');
  ASSERT (SELECT row_count = 0 AND status = 'ok' FROM odds_snapshot WHERE match_id = 'premier-league:g:h'), 'e1 first empty write';
END $$;

-- Duplicate key in one payload fails loudly
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM save_odds_snapshot('11111111-1111-1111-1111-111111111111', 'sts', pg_temp.match('premier-league:dup:x'),
      '[{"market_key":"MATCH_WINNER","market_type_id":999131,"selections":[]},{"market_key":"MATCH_WINNER","market_type_id":999131,"selections":[]}]');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  ASSERT ok, 'duplicate market_key did not raise unique_violation';
END $$;

-- Kickoff = max over the bookmakers' current reports
SELECT save_odds_snapshot('11111111-1111-1111-1111-111111111111', 'sts', pg_temp.match('premier-league:k:l', '2030-01-01T15:00:00Z'), pg_temp.rows(1)) \g /dev/null
SELECT save_odds_snapshot('11111111-1111-1111-1111-111111111111', 'fortuna', pg_temp.match('premier-league:k:l', '2030-01-01T15:30:00Z'), pg_temp.rows(1)) \g /dev/null
DO $$
BEGIN
  ASSERT (SELECT start_time FROM matches WHERE match_id = 'premier-league:k:l') = '2030-01-01T15:30:00Z', 'kickoff is not the max';
END $$;
SELECT save_odds_snapshot('22222222-2222-2222-2222-222222222222', 'fortuna', pg_temp.match('premier-league:k:l', '2030-01-01T15:00:00Z'), pg_temp.rows(1)) \g /dev/null
DO $$
BEGIN
  ASSERT (SELECT start_time FROM matches WHERE match_id = 'premier-league:k:l') = '2030-01-01T15:00:00Z', 'kickoff did not move earlier';
END $$;

-- Backfill from the legacy table
INSERT INTO odds (match_id, league_slug, home_team, away_team, bookmaker, event_url, market_type_id, market_key, param_value,
                  raw_market_name, selections, scraped_at, start_time)
SELECT 'premier-league:bf1:x', 'premier-league', 'bf1', 'x', bm, 'https://' || bm || '.test/bf1', 999131, 'K' || g,
       CASE WHEN g = 2 THEN '2.5' END, 'raw ' || g,
       jsonb_build_array(jsonb_build_object('name', '1', 'odds', CASE WHEN ts.at = '2026-11-07 11:00+00' AND g = 1 THEN 3.3 ELSE 2.0 END)),
       ts.at, '2030-02-01T15:00:00Z'
FROM unnest(ARRAY['sts', 'fortuna']) bm, generate_series(1, 5) g,
     (VALUES ('2026-11-07 10:00+00'::timestamptz), ('2026-11-07 11:00+00'::timestamptz)) ts(at);
INSERT INTO odds (match_id, league_slug, home_team, away_team, bookmaker, event_url, market_type_id, market_key, selections, scraped_at)
SELECT 'premier-league:bf2:y', 'premier-league', 'bf2', 'y', 'fortuna', 'https://fortuna.test/bf2', 999131, 'K' || g,
       '[{"name":"1","odds":1.8}]'::jsonb, ts.at
FROM (VALUES ('2026-11-07 10:00+00'::timestamptz, 40), ('2026-11-07 11:00+00'::timestamptz, 2)) ts(at, n),
     LATERAL generate_series(1, ts.n) g;
INSERT INTO odds (match_id, league_slug, home_team, away_team, bookmaker, market_type_id, market_key, selections, scraped_at)
VALUES ('premier-league:gh:gh', 'premier-league', 'gh', 'gh', 'sts', 999131, 'K1', '[]'::jsonb, '2026-11-07 11:00+00');

INSERT INTO res SELECT 'bf1', backfill_odds_snapshot_model();
INSERT INTO res SELECT 'bf2', backfill_odds_snapshot_model();
DO $$
DECLARE diffs int;
BEGIN
  ASSERT (SELECT (r->>'matches', r->>'snapshots') = ('2', '3') FROM res WHERE step = 'bf1'), 'backfill 1: ' || (SELECT r FROM res WHERE step = 'bf1');
  ASSERT (SELECT r FROM res WHERE step = 'bf2') = '{"matches":0,"snapshots":0,"current":0}'::jsonb, 'backfill 2: ' || (SELECT r FROM res WHERE step = 'bf2');
  ASSERT NOT EXISTS (SELECT 1 FROM matches WHERE match_id = 'premier-league:gh:gh'), 'ghost match backfilled';
  SELECT count(*) INTO diffs
  FROM (SELECT * FROM latest_odds_legacy WHERE home_team <> away_team AND match_id IN ('premier-league:bf1:x', 'premier-league:bf2:y')) l
  FULL JOIN (SELECT * FROM latest_odds_v2 WHERE match_id IN ('premier-league:bf1:x', 'premier-league:bf2:y')) m
    USING (match_id, bookmaker, market_key)
  WHERE l.id IS NULL OR m.id IS NULL
     OR (l.market_type_id, l.param_value, l.custom_name, l.raw_market_name, l.selections, l.event_url, l.home_team, l.away_team, l.league_slug)
        IS DISTINCT FROM
        (m.market_type_id, m.param_value, m.custom_name, m.raw_market_name, m.selections, m.event_url, m.home_team, m.away_team, m.league_slug);
  ASSERT diffs = 0, 'backfill differs from legacy on ' || diffs || ' rows';
  ASSERT (SELECT row_count FROM odds_snapshot WHERE match_id = 'premier-league:bf2:y' AND bookmaker = 'fortuna') = 40, 'degenerate pair row_count';
  ASSERT (SELECT start_time FROM matches WHERE match_id = 'premier-league:bf1:x') = '2030-02-01T15:00:00Z', 'backfill kickoff';
END $$;

-- Compare: identical legacy and model writes, then one differing key
INSERT INTO odds (match_id, league_slug, home_team, away_team, bookmaker, event_url, market_type_id, market_key, param_value,
                  custom_name, raw_market_name, selections, scraped_at)
SELECT 'premier-league:cmp:z', 'premier-league', 'cmp', 'z', 'betclic', 'u', r.market_type_id, r.market_key, r.param_value,
       r.custom_name, r.raw_market_name, r.selections, now()
FROM jsonb_to_recordset(pg_temp.rows(5)) AS r(market_key text, market_type_id integer, param_value text, custom_name text,
                                              raw_market_name text, selections jsonb);
SELECT save_odds_snapshot('77777777-7777-7777-7777-777777777777', 'betclic', pg_temp.match('premier-league:cmp:z'), pg_temp.rows(5)) \g /dev/null
INSERT INTO res SELECT 'cmp1', compare_odds_models('77777777-7777-7777-7777-777777777777');
UPDATE odds_current SET selections = '[]' WHERE match_id = 'premier-league:cmp:z' AND market_key = 'K3';
INSERT INTO res SELECT 'cmp2', compare_odds_models('77777777-7777-7777-7777-777777777777');
DO $$
BEGIN
  ASSERT (SELECT (r->>'pairs', r->>'legacy_rows', r->>'model_rows', r->>'differing', r->>'only_legacy', r->>'only_model')
                 = ('1', '5', '5', '0', '0', '0') FROM res WHERE step = 'cmp1'), 'compare 1: ' || (SELECT r FROM res WHERE step = 'cmp1');
  ASSERT (SELECT (r->>'differing', r->'samples'->0->>'market_key', r->'samples'->0->>'kind') = ('1', 'K3', 'differing')
          FROM res WHERE step = 'cmp2'), 'compare 2: ' || (SELECT r FROM res WHERE step = 'cmp2');
END $$;

-- Privileges
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'save_odds_snapshot(uuid,text,jsonb,jsonb,numeric,integer,boolean)', 'EXECUTE'), 'anon can save';
  ASSERT NOT has_function_privilege('authenticated', 'save_odds_snapshot(uuid,text,jsonb,jsonb,numeric,integer,boolean)', 'EXECUTE'), 'authenticated can save';
  ASSERT has_function_privilege('service_role', 'save_odds_snapshot(uuid,text,jsonb,jsonb,numeric,integer,boolean)', 'EXECUTE'), 'service_role cannot save';
  ASSERT NOT has_function_privilege('anon', 'backfill_odds_snapshot_model()', 'EXECUTE'), 'anon can backfill';
  ASSERT has_function_privilege('service_role', 'backfill_odds_snapshot_model()', 'EXECUTE'), 'service_role cannot backfill';
END $$;
