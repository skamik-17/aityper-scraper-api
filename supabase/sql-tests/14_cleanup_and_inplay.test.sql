-- Migration 14, retention and in-play: cleanup_odds and the kickoff rule in save_odds_snapshot.
\set ON_ERROR_STOP 1

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, selections, display_order)
VALUES (999142, 'SQLTEST_14B', 'Test', 'Test', 'Test', 'Test', 'BINARY_BUTTONS', 'WYNIK_MECZU', ARRAY['YES', 'NO'], 1)
ON CONFLICT DO NOTHING;

-- Seeded directly: the RPC rejects started matches.
-- M1 kicked off 4 h ago (2 bookmakers x 3 keys), M2 2 h ago, M3 unseen for 25 h (4 keys), M4 fresh.
INSERT INTO matches (match_id, league_slug, home_team, away_team, start_time) VALUES
  ('premier-league:m1:x', 'premier-league', 'm1', 'x', now() - interval '4 hours'),
  ('premier-league:m2:x', 'premier-league', 'm2', 'x', now() - interval '2 hours'),
  ('premier-league:m3:x', 'premier-league', 'm3', 'x', now() + interval '2 days'),
  ('premier-league:m4:x', 'premier-league', 'm4', 'x', now() + interval '2 days');
INSERT INTO odds_snapshot (match_id, bookmaker, league_slug, last_seen_at, last_changed_at, row_count) VALUES
  ('premier-league:m1:x', 'sts', 'premier-league', now(), now(), 3),
  ('premier-league:m1:x', 'fortuna', 'premier-league', now(), now(), 3),
  ('premier-league:m2:x', 'sts', 'premier-league', now(), now(), 1),
  ('premier-league:m3:x', 'sts', 'premier-league', now() - interval '25 hours', now() - interval '25 hours', 4),
  ('premier-league:m4:x', 'sts', 'premier-league', now(), now(), 1);
INSERT INTO odds_current (match_id, bookmaker, market_key, market_type_id, selections, content_hash)
SELECT s.match_id, s.bookmaker, 'K' || g, 999142, '[]', '\x00'
FROM odds_snapshot s, LATERAL generate_series(1, s.row_count) g;
INSERT INTO odds_history (match_id, bookmaker, market_key, valid_from, market_type_id, selections)
VALUES ('premier-league:m1:x', 'sts', 'K1', now() - interval '1 day', 999142, '[]'),
       ('premier-league:m1:x', 'sts', 'K2', now() - interval '1 day', 999142, '[]');
INSERT INTO scraper_runs (bookmaker, league_slug, started_at) VALUES
  ('sts', 'premier-league', now() - interval '31 days'),
  ('sts', 'premier-league', now() - interval '29 days');

CREATE TEMP TABLE res (step text PRIMARY KEY, r jsonb);
INSERT INTO res SELECT 'cleanup', cleanup_odds();

DO $$
BEGIN
  ASSERT (SELECT r FROM res WHERE step = 'cleanup') = '{"current":10,"matches":1,"snapshots":1,"history":0}'::jsonb,
    'cleanup_odds: ' || (SELECT r FROM res WHERE step = 'cleanup');
  ASSERT NOT EXISTS (SELECT 1 FROM matches WHERE match_id IN ('premier-league:m1:x', 'premier-league:m3:x')), 'M1/M3 match kept';
  ASSERT NOT EXISTS (SELECT 1 FROM odds_snapshot WHERE match_id IN ('premier-league:m1:x', 'premier-league:m3:x')), 'M1/M3 snapshot kept';
  ASSERT NOT EXISTS (SELECT 1 FROM odds_current WHERE match_id IN ('premier-league:m1:x', 'premier-league:m3:x')), 'M1/M3 quotes kept';
  ASSERT (SELECT count(*) FROM matches WHERE match_id IN ('premier-league:m2:x', 'premier-league:m4:x')) = 2, 'M2/M4 removed';
  ASSERT (SELECT count(*) FROM odds_current WHERE match_id IN ('premier-league:m2:x', 'premier-league:m4:x')) = 2, 'M2/M4 quotes removed';
  ASSERT (SELECT count(*) FROM odds_history WHERE match_id = 'premier-league:m1:x') = 2, 'history was touched';
  ASSERT (SELECT count(*) FROM scraper_runs) = 2, 'cleanup_odds touched scraper_runs (B11 is done in TS)';
  ASSERT to_regprocedure('cleanup_odds(interval,interval,interval)') IS NOT NULL, 'cleanup_odds signature';
  ASSERT NOT has_function_privilege('anon', 'cleanup_odds(interval,interval,interval)', 'EXECUTE'), 'anon can clean up';
  ASSERT has_function_privilege('service_role', 'cleanup_odds(interval,interval,interval)', 'EXECUTE'), 'service_role cannot clean up';
END $$;

-- In-play rule. P1 kicked off 1 h ago: a write with the same kickoff is rejected.
INSERT INTO matches (match_id, league_slug, home_team, away_team, start_time)
VALUES ('premier-league:p1:x', 'premier-league', 'p1', 'x', now() - interval '1 hour'),
       ('premier-league:p2:x', 'premier-league', 'p2', 'x', now() - interval '1 hour');
INSERT INTO odds_snapshot (match_id, bookmaker, league_slug, last_seen_at, last_changed_at, row_count, start_time)
VALUES ('premier-league:p1:x', 'sts', 'premier-league', '2026-11-07 10:00+00', '2026-11-07 10:00+00', 1, now() - interval '1 hour'),
       ('premier-league:p2:x', 'sts', 'premier-league', '2026-11-07 10:00+00', '2026-11-07 10:00+00', 1, now() - interval '1 hour');

INSERT INTO res SELECT 'started', save_odds_snapshot('11111111-1111-1111-1111-111111111111', 'sts',
  jsonb_build_object('match_id', 'premier-league:p1:x', 'league_slug', 'premier-league', 'home_team', 'p1', 'away_team', 'x',
                     'event_url', 'u', 'start_time', (SELECT start_time FROM matches WHERE match_id = 'premier-league:p1:x')),
  '[{"market_key":"K1","market_type_id":999142,"selections":[]}]');
-- P2 postponed: the incoming kickoff is later than now
INSERT INTO res SELECT 'postponed', save_odds_snapshot('11111111-1111-1111-1111-111111111111', 'sts',
  jsonb_build_object('match_id', 'premier-league:p2:x', 'league_slug', 'premier-league', 'home_team', 'p2', 'away_team', 'x',
                     'event_url', 'u', 'start_time', now() + interval '1 hour'),
  '[{"market_key":"K1","market_type_id":999142,"selections":[]}]');
-- No kickoff anywhere: accepted
INSERT INTO res SELECT 'nokickoff', save_odds_snapshot('11111111-1111-1111-1111-111111111111', 'sts',
  '{"match_id":"premier-league:p3:x","league_slug":"premier-league","home_team":"p3","away_team":"x","event_url":"u","start_time":null}',
  '[{"market_key":"K1","market_type_id":999142,"selections":[]}]');

DO $$
DECLARE started jsonb := (SELECT r FROM res WHERE step = 'started');
        postponed jsonb := (SELECT r FROM res WHERE step = 'postponed');
        nokickoff jsonb := (SELECT r FROM res WHERE step = 'nokickoff');
BEGIN
  ASSERT started->>'rejected' = 'kickoff_passed', 'started: ' || started::text;
  ASSERT (started->>'received', started->>'inserted') = ('1', '0'), 'started counts: ' || started::text;
  ASSERT (SELECT last_seen_at FROM odds_snapshot WHERE match_id = 'premier-league:p1:x') = '2026-11-07 10:00+00', 'started moved last_seen_at';
  ASSERT NOT EXISTS (SELECT 1 FROM odds_history WHERE match_id = 'premier-league:p1:x'), 'started wrote history';
  ASSERT NOT EXISTS (SELECT 1 FROM odds_current WHERE match_id = 'premier-league:p1:x'), 'started wrote quotes';
  ASSERT NOT postponed ? 'rejected', 'postponed: ' || postponed::text;
  ASSERT (SELECT start_time > now() FROM matches WHERE match_id = 'premier-league:p2:x'), 'postponed kickoff did not follow the bookmaker';
  ASSERT NOT nokickoff ? 'rejected', 'no kickoff: ' || nokickoff::text;
  ASSERT (SELECT row_count FROM odds_snapshot WHERE match_id = 'premier-league:p3:x') = 1, 'no kickoff not written';
END $$;
