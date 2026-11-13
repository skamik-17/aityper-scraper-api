-- 14: read switch (plan 09 Task 7) and retention / in-play rules (Task 8).
-- Applied by the owner in one inter-run window, then ODDS_WRITE_MODEL=switched.
-- Rollback: supabase/rollback/14_odds_read_switch.down.sql (table odds keeps being written for 7 days).
--
-- Apply only after the Task 6 dual-write gate has passed (compare-odds-models exit 0 on >= 24
-- consecutive cycles over >= 24 h), together with ODDS_WRITE_MODEL=switched.

-- -----------------------------------------------------------------------------
-- Switch: latest_odds over the snapshot model, in place. The body duplicates latest_odds_v2
-- (not SELECT * FROM latest_odds_v2) so migration 15 can drop v2. Same 21 columns in the same
-- order, plus changed_at and snapshot_status. market_comparison, matches_with_odds,
-- get_match_market_rows and get_best_odds follow latest_odds unchanged.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW latest_odds AS
SELECT c.id, c.match_id, m.league_slug, m.home_team, m.away_team, c.bookmaker,
       s.event_url, c.market_type_id, c.market_key, c.param_value, c.custom_name,
       c.raw_market_name, c.selections, s.last_seen_at AS scraped_at,
       mt.code AS market_code,
       COALESCE(c.custom_name, mt.name_pl) AS market_name_pl,
       COALESCE(c.custom_name, mt.name_en) AS market_name_en,
       mt.view_type, mt.category, mt.has_parameter, mt.selections AS expected_selections,
       c.changed_at, s.status AS snapshot_status
FROM odds_current c
JOIN odds_snapshot s USING (match_id, bookmaker)
JOIN matches m USING (match_id)
JOIN market_types mt ON mt.id = c.market_type_id;

-- get_matches_with_odds: same signature and output. latest = odds_current (already one row
-- per key), start_time = matches.start_time (index matches_league_start), no DISTINCT ON;
-- paramValue = min(param_value), deterministic (today an arbitrary bookmaker's row).
CREATE OR REPLACE FUNCTION get_matches_with_odds(p_league_slug text, p_market_keys text[] DEFAULT NULL)
RETURNS TABLE (match_id text, home_team text, away_team text, start_time timestamptz,
               markets jsonb, last_updated timestamptz)
LANGUAGE sql STABLE SET work_mem = '16MB' AS $$
  WITH ms AS (
    SELECT m.match_id, m.home_team, m.away_team, m.start_time
    FROM matches m
    WHERE m.league_slug = p_league_slug
      AND (m.start_time IS NULL OR m.start_time > now())
  ), l AS (
    SELECT c.match_id, c.market_key, c.bookmaker, c.param_value, c.selections,
           s.event_url, s.last_seen_at, mt.code, mt.name_pl, mt.view_type, mt.category
    FROM ms
    JOIN odds_current c ON c.match_id = ms.match_id
    JOIN odds_snapshot s ON s.match_id = c.match_id AND s.bookmaker = c.bookmaker
    JOIN market_types mt ON mt.id = c.market_type_id
    WHERE p_market_keys IS NULL OR c.market_key = ANY (p_market_keys)
  ), per_market AS (
    SELECT l.match_id, l.market_key,
           jsonb_build_object(
             'code', min(l.code), 'namePl', min(l.name_pl), 'viewType', min(l.view_type::text),
             'category', min(l.category::text), 'paramValue', min(l.param_value),
             'bookmakerOdds', jsonb_object_agg(l.bookmaker, jsonb_build_object(
                'selections', l.selections, 'eventUrl', l.event_url, 'scrapedAt', l.last_seen_at))
           ) AS market,
           max(l.last_seen_at) AS last_seen
    FROM l GROUP BY l.match_id, l.market_key
  )
  SELECT ms.match_id, ms.home_team, ms.away_team, ms.start_time,
         jsonb_object_agg(pm.market_key, pm.market), max(pm.last_seen)
  FROM ms JOIN per_market pm ON pm.match_id = ms.match_id
  GROUP BY ms.match_id, ms.home_team, ms.away_team, ms.start_time
$$;

-- -----------------------------------------------------------------------------
-- Retention (plan 09 Task 8): current quotes go 3 h after kickoff, a snapshot unseen for 24 h
-- goes, odds_history is kept unless p_history_keep is passed (the code never passes it).
-- scraper_runs is not a SQL concern here: the TS retention seam deletes it after 30 days (B11).
-- `current` counts odds rows (odds_current), deleted before the cascading deletes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_odds(
  p_kickoff_grace interval DEFAULT '3 hours',
  p_unseen        interval DEFAULT '24 hours',
  p_history_keep  interval DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_current   integer := 0;
  v_n         integer;
  v_matches   integer;
  v_snapshots integer;
  v_hist      integer := 0;
BEGIN
  DELETE FROM odds_current c USING matches m
   WHERE c.match_id = m.match_id AND m.start_time < now() - p_kickoff_grace;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_current := v_current + v_n;
  DELETE FROM odds_current c USING odds_snapshot s
   WHERE c.match_id = s.match_id AND c.bookmaker = s.bookmaker AND s.last_seen_at < now() - p_unseen;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_current := v_current + v_n;

  DELETE FROM matches WHERE start_time < now() - p_kickoff_grace;            -- cascades
  GET DIAGNOSTICS v_matches = ROW_COUNT;
  DELETE FROM odds_snapshot WHERE last_seen_at < now() - p_unseen;           -- cascades
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;
  -- Orphans left by the unseen rule (not counted)
  DELETE FROM matches m WHERE NOT EXISTS (SELECT 1 FROM odds_snapshot s WHERE s.match_id = m.match_id);
  IF p_history_keep IS NOT NULL THEN
    DELETE FROM odds_history WHERE valid_from < now() - p_history_keep;
    GET DIAGNOSTICS v_hist = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('current', v_current, 'matches', v_matches, 'snapshots', v_snapshots, 'history', v_hist);
END $$;

REVOKE ALL ON FUNCTION cleanup_odds(interval, interval, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_odds(interval, interval, interval) TO service_role;

-- -----------------------------------------------------------------------------
-- In-play rule (plan 09 Task 8): save_odds_snapshot rejects a write for a match whose
-- kickoff has passed; the rest of the body is migration 13's.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_odds_snapshot(
  p_run_id     uuid,
  p_bookmaker  text,
  p_match      jsonb,
  p_rows       jsonb,
  p_min_ratio  numeric DEFAULT 0.10,   -- OQ13: < 10 % of the previous snapshot = degenerate
  p_min_prev   integer DEFAULT 20,     -- only guard snapshots that were big enough to matter
  p_guard      boolean DEFAULT false   -- owner B13: the guard is off unless the caller asks
) RETURNS jsonb
LANGUAGE plpgsql
SET work_mem = '16MB'
AS $$
DECLARE
  v_now        timestamptz := clock_timestamp();
  v_match_id   text := p_match->>'match_id';
  v_prev_count integer;
  v_new_count  integer;
  v_degenerate boolean;
  v_inserted   integer := 0;
  v_updated    integer := 0;
  v_removed    integer := 0;
  v_start      timestamptz;
BEGIN
  -- 0. In-play rule: a match whose kickoff (the stored one or the incoming one, whichever is
  --    later; GREATEST ignores NULLs) has passed takes no write. A postponement reports a
  --    later kickoff and is accepted; no kickoff anywhere is accepted.
  v_start := GREATEST((SELECT start_time FROM matches WHERE match_id = v_match_id),
                      (p_match->>'start_time')::timestamptz);
  IF v_start <= v_now THEN
    RETURN jsonb_build_object('received', jsonb_array_length(p_rows), 'inserted', 0, 'updated', 0,
                              'unchanged', 0, 'removed', 0, 'prune_skipped', false,
                              'previous_rows', NULL, 'rejected', 'kickoff_passed');
  END IF;

  -- 1. Fixture row, insert-if-missing; the kickoff is recomputed after step 4.
  INSERT INTO matches (match_id, league_slug, home_team, away_team, start_time)
  VALUES (v_match_id, p_match->>'league_slug', p_match->>'home_team', p_match->>'away_team',
          (p_match->>'start_time')::timestamptz)
  ON CONFLICT (match_id) DO NOTHING;

  -- 2. Incoming rows, hashed once.
  -- Explicit columns (LIKE odds_current would copy the NOT NULL identity id).
  CREATE TEMP TABLE IF NOT EXISTS _incoming (
    match_id text, bookmaker text, market_key text, market_type_id integer, param_value text,
    custom_name text, raw_market_name text, selections jsonb, content_hash bytea,
    changed_at timestamptz, PRIMARY KEY (market_key)   -- duplicate keys = caller bug, fail loudly
  ) ON COMMIT DROP;
  TRUNCATE _incoming;
  INSERT INTO _incoming (match_id, bookmaker, market_key, market_type_id, param_value,
                         custom_name, raw_market_name, selections, content_hash, changed_at)
  SELECT v_match_id, p_bookmaker, r.market_key, r.market_type_id, r.param_value,
         r.custom_name, r.raw_market_name, r.selections,
         odds_content_hash(r.market_type_id, r.param_value, r.custom_name, r.raw_market_name, r.selections),
         v_now
  FROM jsonb_to_recordset(p_rows) AS r(market_key text, market_type_id integer, param_value text,
                                       custom_name text, raw_market_name text, selections jsonb);
  GET DIAGNOSTICS v_new_count = ROW_COUNT;

  -- 3. Prune guard (OQ13): a run that returns a fraction of the previous snapshot
  --    must not delete the good snapshot. Only with p_guard (owner B13).
  SELECT row_count INTO v_prev_count FROM odds_snapshot
   WHERE match_id = v_match_id AND bookmaker = p_bookmaker;
  v_degenerate := p_guard AND COALESCE(v_prev_count IS NOT NULL AND v_prev_count >= p_min_prev
                                       AND v_new_count < v_prev_count * p_min_ratio, false);

  -- 4. Snapshot row first (FK target). Degenerate: keep last_seen_at, flag it.
  INSERT INTO odds_snapshot AS s (match_id, bookmaker, league_slug, event_url, start_time,
                                  last_run_id, last_seen_at, last_changed_at, row_count, status)
  VALUES (v_match_id, p_bookmaker, p_match->>'league_slug', p_match->>'event_url',
          (p_match->>'start_time')::timestamptz, p_run_id, v_now, v_now, v_new_count, 'ok')
  ON CONFLICT (match_id, bookmaker) DO UPDATE SET
    event_url    = EXCLUDED.event_url,
    start_time   = COALESCE(EXCLUDED.start_time, s.start_time),
    last_run_id  = EXCLUDED.last_run_id,
    last_seen_at = CASE WHEN v_degenerate THEN s.last_seen_at ELSE EXCLUDED.last_seen_at END,
    row_count    = CASE WHEN v_degenerate THEN s.row_count ELSE EXCLUDED.row_count END,
    status       = CASE WHEN v_degenerate THEN 'degenerate' ELSE 'ok' END,
    degenerate_since = CASE WHEN v_degenerate THEN COALESCE(s.degenerate_since, v_now) ELSE NULL END;

  -- 4b. Kickoff = max over the bookmakers' current reports (migration 10's semantics),
  --     so it can also move earlier.
  UPDATE matches m SET start_time = x.st, updated_at = v_now
    FROM (SELECT max(start_time) AS st FROM odds_snapshot WHERE match_id = v_match_id) x
   WHERE m.match_id = v_match_id AND m.start_time IS DISTINCT FROM x.st;

  -- 5. History: only rows whose content changed (or are new).
  INSERT INTO odds_history (match_id, bookmaker, market_key, valid_from, market_type_id,
                            param_value, selections, content_hash, run_id)
  SELECT i.match_id, i.bookmaker, i.market_key, v_now, i.market_type_id, i.param_value,
         i.selections, i.content_hash, p_run_id
  FROM _incoming i
  LEFT JOIN odds_current c USING (match_id, bookmaker, market_key)
  WHERE c.content_hash IS DISTINCT FROM i.content_hash;

  -- 6. Upsert ONLY changed/new rows. Unchanged rows are never touched (no tuple
  --    lock, no WAL, no dead tuple). Same predicate as step 5.
  WITH changed AS (
    SELECT i.* FROM _incoming i
    LEFT JOIN odds_current c USING (match_id, bookmaker, market_key)
    WHERE c.content_hash IS DISTINCT FROM i.content_hash
  ), up AS (
    INSERT INTO odds_current AS c (match_id, bookmaker, market_key, market_type_id, param_value,
                                   custom_name, raw_market_name, selections, content_hash, changed_at)
    SELECT match_id, bookmaker, market_key, market_type_id, param_value,
           custom_name, raw_market_name, selections, content_hash, changed_at FROM changed
    ON CONFLICT (match_id, bookmaker, market_key) DO UPDATE SET
      market_type_id = EXCLUDED.market_type_id, param_value = EXCLUDED.param_value,
      custom_name = EXCLUDED.custom_name, raw_market_name = EXCLUDED.raw_market_name,
      selections = EXCLUDED.selections, content_hash = EXCLUDED.content_hash,
      changed_at = EXCLUDED.changed_at
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
    INTO v_inserted, v_updated FROM up;

  -- 7. Prune markets this bookmaker no longer offers (same transaction, one
  --    statement, skipped when degenerate). Tombstones go to history.
  IF NOT v_degenerate THEN
    WITH gone AS (
      DELETE FROM odds_current c
       WHERE c.match_id = v_match_id AND c.bookmaker = p_bookmaker
         AND NOT EXISTS (SELECT 1 FROM _incoming i WHERE i.market_key = c.market_key)
      RETURNING c.match_id, c.bookmaker, c.market_key, c.market_type_id, c.param_value
    )
    INSERT INTO odds_history (match_id, bookmaker, market_key, valid_from, market_type_id,
                              param_value, selections, content_hash, run_id)
    SELECT match_id, bookmaker, market_key, v_now, market_type_id, param_value, NULL, NULL, p_run_id
    FROM gone;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'received', v_new_count, 'inserted', v_inserted, 'updated', v_updated,
    'unchanged', v_new_count - v_inserted - v_updated, 'removed', v_removed,
    'prune_skipped', v_degenerate, 'previous_rows', v_prev_count);
END;
$$;

REVOKE ALL ON FUNCTION save_odds_snapshot(uuid, text, jsonb, jsonb, numeric, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_odds_snapshot(uuid, text, jsonb, jsonb, numeric, integer, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
