-- Migration 16: odds_snapshot detail state (last_detail_at, listing_fingerprint) and
-- record_incremental_pass (stamp fetched events, confirm unchanged ones).
\set ON_ERROR_STOP 1

-- far: kickoff in 100 h (6 h cap), near: in 30 h (2 h cap), deg: a degenerate snapshot.
INSERT INTO matches (match_id, league_slug, home_team, away_team, start_time) VALUES
  ('premier-league:far:x', 'premier-league', 'far', 'x', now() + interval '100 hours'),
  ('premier-league:near:x', 'premier-league', 'near', 'x', now() + interval '30 hours'),
  ('premier-league:deg:x', 'premier-league', 'deg', 'x', now() + interval '30 hours');
INSERT INTO odds_snapshot (match_id, bookmaker, league_slug, start_time, last_run_id, last_seen_at, last_changed_at, row_count, status) VALUES
  ('premier-league:far:x', 'forbet', 'premier-league', now() + interval '100 hours', '11111111-1111-1111-1111-111111111111', now(), now(), 300, 'ok'),
  ('premier-league:near:x', 'forbet', 'premier-league', now() + interval '30 hours', '11111111-1111-1111-1111-111111111111', now(), now(), 200, 'ok'),
  ('premier-league:deg:x', 'forbet', 'premier-league', now() + interval '30 hours', '11111111-1111-1111-1111-111111111111', now(), now(), 50, 'degenerate');

CREATE TEMP TABLE res (step text PRIMARY KEY, r jsonb);
CREATE FUNCTION pg_temp.keys(VARIADIC kv text[]) RETURNS jsonb LANGUAGE sql AS $$
  -- pairs: match name, fingerprint ('' = null)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('match_id', 'premier-league:' || kv[i] || ':x',
                                               'fingerprint', NULLIF(kv[i + 1], '')) ORDER BY i), '[]'::jsonb)
  FROM generate_series(1, array_length(kv, 1), 2) i
$$;

-- 1. Stamp all three under the run that wrote them: only the two 'ok' rows.
INSERT INTO res SELECT 's1', record_incremental_pass('11111111-1111-1111-1111-111111111111', 'forbet',
  pg_temp.keys('far', 'aaaa', 'near', 'bbbb', 'deg', 'cccc'), '[]'::jsonb);
DO $$
BEGIN
  ASSERT (SELECT (r->>'stamped', r->>'confirmed', r->>'not_confirmed') = ('2', '0', '0') FROM res WHERE step = 's1'),
    's1: ' || (SELECT r FROM res WHERE step = 's1');
  ASSERT (SELECT count(*) FROM odds_snapshot WHERE bookmaker = 'forbet' AND last_detail_at = last_seen_at
            AND match_id IN ('premier-league:far:x', 'premier-league:near:x')) = 2, 's1: last_detail_at';
  ASSERT (SELECT listing_fingerprint FROM odds_snapshot WHERE match_id = 'premier-league:far:x') = 'aaaa', 's1: fingerprint';
  ASSERT (SELECT last_detail_at IS NULL AND listing_fingerprint IS NULL FROM odds_snapshot
           WHERE match_id = 'premier-league:deg:x'), 's1: degenerate row stamped';
END $$;

-- 2. Another run did not write these snapshots: nothing to stamp.
INSERT INTO res SELECT 's2', record_incremental_pass('22222222-2222-2222-2222-222222222222', 'forbet',
  pg_temp.keys('far', 'aaaa', 'near', 'bbbb'), '[]'::jsonb);
DO $$
BEGIN
  ASSERT (SELECT r->>'stamped' FROM res WHERE step = 's2') = '0', 's2: ' || (SELECT r FROM res WHERE step = 's2');
END $$;

-- 3. Confirm: same fingerprint and fresh detail confirm; a changed fingerprint and a degenerate row do not.
INSERT INTO res SELECT 's3', record_incremental_pass('33333333-3333-3333-3333-333333333333', 'forbet',
  '[]'::jsonb, pg_temp.keys('far', 'aaaa', 'near', 'bbbb', 'near', 'XXXX', 'deg', 'cccc'));
DO $$
BEGIN
  ASSERT (SELECT (r->>'confirmed', r->>'not_confirmed', r->>'confirmed_rows') = ('2', '2', '500') FROM res WHERE step = 's3'),
    's3: ' || (SELECT r FROM res WHERE step = 's3');
  ASSERT (SELECT count(*) FROM odds_snapshot WHERE bookmaker = 'forbet' AND last_run_id = '33333333-3333-3333-3333-333333333333'
            AND last_seen_at > last_detail_at) = 2, 's3: confirmed rows';
  ASSERT (SELECT last_run_id FROM odds_snapshot WHERE match_id = 'premier-league:deg:x') = '11111111-1111-1111-1111-111111111111',
    's3: degenerate row confirmed';
END $$;

-- 4. Caps: far may be 6 h old, near only 2 h.
UPDATE odds_snapshot SET last_detail_at = now() - interval '5 hours 59 minutes' WHERE match_id = 'premier-league:far:x';
UPDATE odds_snapshot SET last_detail_at = now() - interval '2 hours 1 minute' WHERE match_id = 'premier-league:near:x';
INSERT INTO res SELECT 's4', record_incremental_pass('44444444-4444-4444-4444-444444444444', 'forbet',
  '[]'::jsonb, pg_temp.keys('far', 'aaaa', 'near', 'bbbb'));
DO $$
BEGIN
  ASSERT (SELECT (r->>'confirmed', r->>'not_confirmed', r->>'confirmed_rows') = ('1', '1', '300') FROM res WHERE step = 's4'),
    's4: ' || (SELECT r FROM res WHERE step = 's4');
END $$;

-- 5. A started event is never confirmed, however fresh its detail.
UPDATE odds_snapshot SET start_time = now() - interval '1 minute', last_detail_at = now() WHERE match_id = 'premier-league:near:x';
INSERT INTO res SELECT 's5', record_incremental_pass('55555555-5555-5555-5555-555555555555', 'forbet',
  '[]'::jsonb, pg_temp.keys('near', 'bbbb'));
DO $$
BEGIN
  ASSERT (SELECT r->>'confirmed' FROM res WHERE step = 's5') = '0', 's5: ' || (SELECT r FROM res WHERE step = 's5');
END $$;

-- 6. No fingerprint on either side still confirms.
UPDATE odds_snapshot SET listing_fingerprint = NULL, last_detail_at = now() WHERE match_id = 'premier-league:far:x';
INSERT INTO res SELECT 's6', record_incremental_pass('66666666-6666-6666-6666-666666666666', 'forbet',
  '[]'::jsonb, pg_temp.keys('far', ''));
DO $$
BEGIN
  ASSERT (SELECT r->>'confirmed' FROM res WHERE step = 's6') = '1', 's6: ' || (SELECT r FROM res WHERE step = 's6');
END $$;

-- 7. Only the service role may call it.
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'record_incremental_pass(uuid,text,jsonb,jsonb,interval,interval)', 'EXECUTE'),
    'anon may execute record_incremental_pass';
  ASSERT has_function_privilege('service_role', 'record_incremental_pass(uuid,text,jsonb,jsonb,interval,interval)', 'EXECUTE'),
    'service_role may not execute record_incremental_pass';
END $$;
