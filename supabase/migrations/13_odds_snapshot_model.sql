-- 13: additive odds snapshot model (plan 09 Phase B). Nothing existing is changed: table odds,
-- latest_odds and every reader keep working. Tables, the write RPC, a comparison view pair,
-- the model comparison and the backfill from the legacy table.

-- One row per fixture. Replaces home_team/away_team/league_slug/start_time
-- repeated on every odds row, and the full-league MAX(start_time) scan in
-- get_matches_with_odds (60 of its 76 ms today).
CREATE TABLE matches (
  match_id     text PRIMARY KEY,                 -- "<league>:<home norm>:<away norm>", same as today
  league_slug  text NOT NULL,
  home_team    text NOT NULL,
  away_team    text NOT NULL,
  start_time   timestamptz,                      -- MAX over bookmakers that report it
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matches_not_degenerate CHECK (home_team <> away_team)
) WITH (fillfactor = 80);
CREATE INDEX matches_league_start ON matches (league_slug, start_time);

-- One row per (match, bookmaker): the freshness and prune-guard unit.
-- About 20 matches x 14 bookmakers = 280 rows per league; rewritten every run
-- (HOT: no indexed column changes), so the run's freshness costs 280 tiny
-- updates instead of rewriting 64k odds rows.
CREATE TABLE odds_snapshot (
  match_id      text NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  bookmaker     text NOT NULL,
  league_slug   text NOT NULL,
  event_url     text,
  start_time    timestamptz,                     -- as reported by this bookmaker
  last_run_id   uuid,                            -- = scraper_runs.run_id (migration 11)
  last_seen_at  timestamptz NOT NULL,            -- last successful confirmation of this snapshot
  last_changed_at timestamptz NOT NULL,
  row_count     integer NOT NULL,
  status        text NOT NULL DEFAULT 'ok',      -- 'ok' | 'degenerate' (prune skipped)
  degenerate_since timestamptz,
  PRIMARY KEY (match_id, bookmaker)
) WITH (fillfactor = 70);
CREATE INDEX odds_snapshot_league_bm_seen ON odds_snapshot (league_slug, bookmaker, last_seen_at DESC);

-- Current quote per (match, bookmaker, market_key). Updated in place ONLY when
-- the content changes (98-99 % of rows are identical between consecutive scrapes).
CREATE TABLE odds_current (
  id              bigint GENERATED ALWAYS AS IDENTITY,   -- keeps latest_odds.id in the contract
  match_id        text NOT NULL,
  bookmaker       text NOT NULL,
  market_key      text NOT NULL,
  market_type_id  integer NOT NULL REFERENCES market_types(id),
  param_value     text,
  custom_name     text,
  raw_market_name text,
  selections      jsonb NOT NULL,
  content_hash    bytea NOT NULL,                        -- md5 of the stored payload
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  changed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, bookmaker, market_key),
  FOREIGN KEY (match_id, bookmaker) REFERENCES odds_snapshot(match_id, bookmaker) ON DELETE CASCADE
) WITH (fillfactor = 80);
-- List endpoint filters MATCH_WINNER across a league; keep exactly one secondary index.
CREATE INDEX odds_current_market_key ON odds_current (market_key, match_id);

-- Append-only change log for the +EV / value model. One row per content change,
-- plus a tombstone when a market disappears. Never touched by the 03:00 cleanup.
CREATE TABLE odds_history (
  match_id        text NOT NULL,
  bookmaker       text NOT NULL,
  market_key      text NOT NULL,
  valid_from      timestamptz NOT NULL,
  market_type_id  integer NOT NULL,
  param_value     text,
  selections      jsonb,                                 -- NULL = removed (tombstone)
  content_hash    bytea,
  run_id          uuid,
  PRIMARY KEY (match_id, bookmaker, market_key, valid_from)
);
-- Optional later: PARTITION BY RANGE (valid_from) monthly, so retention = DROP PARTITION.

-- Payload helper: the same hash expression everywhere.
CREATE OR REPLACE FUNCTION odds_content_hash(
  p_market_type_id integer, p_param_value text, p_custom_name text,
  p_raw_market_name text, p_selections jsonb)
RETURNS bytea LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT decode(md5(jsonb_build_array(p_market_type_id, p_param_value, p_custom_name,
                                      p_raw_market_name, p_selections)::text), 'hex')
$$;

-- -----------------------------------------------------------------------------
-- The write RPC: one call per (match, bookmaker), one transaction.
-- p_match: {"match_id","league_slug","home_team","away_team","event_url","start_time"}
-- p_rows : [{"market_key","market_type_id","param_value","custom_name",
--            "raw_market_name","selections"}, ...]   (no per-row match header)
-- The degenerate-write guard applies only with p_guard = true (owner B13: off by default).
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
BEGIN
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

-- -----------------------------------------------------------------------------
-- latest_odds_v2: today's latest_odds columns over the new model, then changed_at and
-- snapshot_status. Migration 14 makes this body latest_odds itself.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW latest_odds_v2 AS
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

-- latest_odds_legacy: today's latest_odds body (03_odds_schema_views.sql), so the
-- comparison keeps reading table odds after migration 14 switches latest_odds.
CREATE OR REPLACE VIEW latest_odds_legacy AS
SELECT
  o.id,
  o.match_id,
  o.league_slug,
  o.home_team,
  o.away_team,
  o.bookmaker,
  o.event_url,
  o.market_type_id,
  o.market_key,
  o.param_value,
  o.custom_name,
  o.raw_market_name,
  o.selections,
  o.scraped_at,
  mt.code AS market_code,
  COALESCE(o.custom_name, mt.name_pl) AS market_name_pl,
  COALESCE(o.custom_name, mt.name_en) AS market_name_en,
  mt.view_type,
  mt.category,
  mt.has_parameter,
  mt.selections AS expected_selections
FROM (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY match_id, bookmaker, market_key
      ORDER BY scraped_at DESC
    ) AS rn
  FROM odds
) o
JOIN market_types mt ON o.market_type_id = mt.id
WHERE o.rn = 1;

-- -----------------------------------------------------------------------------
-- compare_odds_models: the pairs one run wrote to the model, compared key by key with
-- the legacy table. scraped_at and id are not compared.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compare_odds_models(p_run_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET work_mem = '16MB' AS $$
  WITH p AS (
    SELECT match_id, bookmaker FROM odds_snapshot WHERE last_run_id = p_run_id
  ), l AS (
    -- The match_id array filter passes below the legacy window
    SELECT o.* FROM latest_odds_legacy o JOIN p USING (match_id, bookmaker)
    WHERE o.match_id = ANY (ARRAY(SELECT DISTINCT match_id FROM p))
  ), m AS (
    SELECT v.* FROM latest_odds_v2 v JOIN p USING (match_id, bookmaker)
    WHERE v.match_id = ANY (ARRAY(SELECT DISTINCT match_id FROM p))
  ), j AS (
    SELECT match_id, bookmaker, market_key, l.id IS NOT NULL AS in_legacy, m.id IS NOT NULL AS in_model,
           CASE
             WHEN l.id IS NULL THEN 'only_model'
             WHEN m.id IS NULL THEN 'only_legacy'
             WHEN (l.market_type_id, l.param_value, l.custom_name, l.raw_market_name, l.selections, l.event_url,
                   l.home_team, l.away_team, l.league_slug)
                  IS DISTINCT FROM
                  (m.market_type_id, m.param_value, m.custom_name, m.raw_market_name, m.selections, m.event_url,
                   m.home_team, m.away_team, m.league_slug)
               THEN 'differing'
           END AS kind
    FROM l FULL JOIN m USING (match_id, bookmaker, market_key)
  )
  SELECT jsonb_build_object(
    'run_id', p_run_id,
    'pairs', (SELECT count(*) FROM p),
    'legacy_rows', (SELECT count(*) FROM j WHERE in_legacy),
    'model_rows', (SELECT count(*) FROM j WHERE in_model),
    'only_legacy', (SELECT count(*) FROM j WHERE kind = 'only_legacy'),
    'only_model', (SELECT count(*) FROM j WHERE kind = 'only_model'),
    'differing', (SELECT count(*) FROM j WHERE kind = 'differing'),
    'samples', COALESCE((SELECT jsonb_agg(jsonb_build_object('match_id', s.match_id, 'bookmaker', s.bookmaker,
                                                             'market_key', s.market_key, 'kind', s.kind))
                         FROM (SELECT * FROM j WHERE kind IS NOT NULL
                               ORDER BY kind, match_id, bookmaker, market_key LIMIT 20) s), '[]'::jsonb)
  )
$$;

-- -----------------------------------------------------------------------------
-- backfill_odds_snapshot_model: the legacy table's latest snapshot per key. Idempotent
-- (ON CONFLICT DO NOTHING); history starts empty because cleanup and prune already
-- destroyed it. Ghost matches (home_team = away_team) are skipped: matches forbids them.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION backfill_odds_snapshot_model()
RETURNS jsonb LANGUAGE plpgsql SET work_mem = '64MB' AS $$
DECLARE
  v_matches   integer;
  v_snapshots integer;
  v_current   integer;
BEGIN
  INSERT INTO matches (match_id, league_slug, home_team, away_team, start_time, first_seen_at, updated_at)
  SELECT DISTINCT ON (o.match_id) o.match_id, o.league_slug, o.home_team, o.away_team, o.max_start,
         o.scraped_at, o.scraped_at
  FROM (SELECT match_id, league_slug, home_team, away_team, scraped_at,
               max(start_time) OVER (PARTITION BY match_id) AS max_start
        FROM odds WHERE home_team <> away_team) o
  ORDER BY o.match_id, o.scraped_at DESC
  ON CONFLICT (match_id) DO NOTHING;
  GET DIAGNOSTICS v_matches = ROW_COUNT;

  INSERT INTO odds_snapshot (match_id, bookmaker, league_slug, event_url, start_time, last_run_id,
                             last_seen_at, last_changed_at, row_count, status)
  SELECT a.match_id, a.bookmaker, n.league_slug, n.event_url, a.max_start, NULL, a.max_seen, a.max_seen, a.keys, 'ok'
  FROM (SELECT match_id, bookmaker, max(start_time) AS max_start, max(scraped_at) AS max_seen,
               count(DISTINCT market_key)::int AS keys
        FROM odds GROUP BY match_id, bookmaker) a
  JOIN (SELECT DISTINCT ON (match_id, bookmaker) match_id, bookmaker, league_slug, event_url
        FROM odds ORDER BY match_id, bookmaker, scraped_at DESC) n
    ON n.match_id = a.match_id AND n.bookmaker = a.bookmaker
  JOIN matches m ON m.match_id = a.match_id
  ON CONFLICT (match_id, bookmaker) DO NOTHING;
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;

  INSERT INTO odds_current (match_id, bookmaker, market_key, market_type_id, param_value, custom_name,
                            raw_market_name, selections, content_hash, first_seen_at, changed_at)
  SELECT DISTINCT ON (o.match_id, o.bookmaker, o.market_key) o.match_id, o.bookmaker, o.market_key,
         o.market_type_id, o.param_value, o.custom_name, o.raw_market_name, o.selections,
         odds_content_hash(o.market_type_id, o.param_value, o.custom_name, o.raw_market_name, o.selections),
         o.scraped_at, o.scraped_at
  FROM odds o
  JOIN odds_snapshot s ON s.match_id = o.match_id AND s.bookmaker = o.bookmaker
  ORDER BY o.match_id, o.bookmaker, o.market_key, o.scraped_at DESC
  ON CONFLICT (match_id, bookmaker, market_key) DO NOTHING;
  GET DIAGNOSTICS v_current = ROW_COUNT;

  RETURN jsonb_build_object('matches', v_matches, 'snapshots', v_snapshots, 'current', v_current);
END;
$$;

SELECT backfill_odds_snapshot_model();

REVOKE ALL ON FUNCTION save_odds_snapshot(uuid, text, jsonb, jsonb, numeric, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_odds_snapshot(uuid, text, jsonb, jsonb, numeric, integer, boolean) TO service_role;
REVOKE ALL ON FUNCTION backfill_odds_snapshot_model() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION backfill_odds_snapshot_model() TO service_role;
REVOKE ALL ON FUNCTION compare_odds_models(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION compare_odds_models(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
