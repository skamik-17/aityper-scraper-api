-- Migration 14, switch: latest_odds and get_matches_with_odds over the snapshot model, in place.
\set ON_ERROR_STOP 1

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, selections, display_order)
VALUES (999141, 'SQLTEST_14', 'Test', 'Test', 'Test', 'Test', 'BINARY_BUTTONS', 'WYNIK_MECZU', ARRAY['YES', 'NO'], 1)
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  ASSERT (SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'latest_odds')
       = ARRAY['id','match_id','league_slug','home_team','away_team','bookmaker','event_url','market_type_id','market_key','param_value',
               'custom_name','raw_market_name','selections','scraped_at','market_code','market_name_pl','market_name_en','view_type',
               'category','has_parameter','expected_selections','changed_at','snapshot_status'],
    'latest_odds columns: ' || (SELECT string_agg(column_name::text, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'latest_odds');
END $$;

-- Two bookmakers on one match through the write RPC
SELECT save_odds_snapshot('11111111-1111-1111-1111-111111111111', b.bm,
  '{"match_id":"premier-league:a:b","league_slug":"premier-league","home_team":"a","away_team":"b","event_url":"u","start_time":"2030-01-01T15:00:00Z"}',
  jsonb_build_array(
    jsonb_build_object('market_key', 'MATCH_WINNER', 'market_type_id', 999141, 'selections', '[{"name":"1","odds":2.0}]'::jsonb),
    jsonb_build_object('market_key', 'TOTAL_GOALS', 'market_type_id', 999141, 'param_value', b.line, 'selections', '[{"name":"+","odds":1.9}]'::jsonb)))
FROM (VALUES ('sts', '3.5'), ('fortuna', '2.5')) b(bm, line) \g /dev/null

-- A started match and one without a kickoff, written straight into the tables
INSERT INTO matches (match_id, league_slug, home_team, away_team, start_time)
VALUES ('premier-league:p:q', 'premier-league', 'p', 'q', now() - interval '1 hour'),
       ('premier-league:n:o', 'premier-league', 'n', 'o', NULL);
INSERT INTO odds_snapshot (match_id, bookmaker, league_slug, event_url, last_seen_at, last_changed_at, row_count)
VALUES ('premier-league:p:q', 'sts', 'premier-league', 'u', now(), now(), 1),
       ('premier-league:n:o', 'sts', 'premier-league', 'u', now(), now(), 1);
INSERT INTO odds_current (match_id, bookmaker, market_key, market_type_id, selections, content_hash)
VALUES ('premier-league:p:q', 'sts', 'MATCH_WINNER', 999141, '[]', '\x00'),
       ('premier-league:n:o', 'sts', 'MATCH_WINNER', 999141, '[]', '\x00');

DO $$
DECLARE all_keys jsonb := (SELECT jsonb_object_agg(match_id, markets) FROM get_matches_with_odds('premier-league'));
        mw jsonb := (SELECT jsonb_object_agg(match_id, markets) FROM get_matches_with_odds('premier-league', ARRAY['MATCH_WINNER']));
BEGIN
  ASSERT (SELECT count(*) FROM market_comparison WHERE match_id = 'premier-league:a:b')
       = (SELECT count(*) FROM odds_current WHERE match_id = 'premier-league:a:b'), 'market_comparison does not follow odds_current';
  ASSERT (SELECT count(*) FROM market_comparison WHERE match_id = 'premier-league:a:b') = 4, 'expected 4 rows for a:b';
  ASSERT NOT all_keys ? 'premier-league:p:q', 'a started match is listed';
  ASSERT all_keys ? 'premier-league:n:o', 'a match without kickoff is missing';
  ASSERT all_keys->'premier-league:a:b'->'TOTAL_GOALS'->>'paramValue' = '2.5', 'paramValue is not the min: ' || (all_keys->'premier-league:a:b')::text;
  ASSERT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(mw->'premier-league:a:b') k) = ARRAY['MATCH_WINNER'], 'market key filter: ' || mw::text;
  ASSERT jsonb_typeof(all_keys->'premier-league:a:b'->'MATCH_WINNER'->'bookmakerOdds'->'sts') = 'object', 'bookmakerOdds missing';
END $$;
