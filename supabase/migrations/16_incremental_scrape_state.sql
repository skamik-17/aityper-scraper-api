-- 16: detail state for incremental scraping (plan 10). Additive: two nullable columns on
-- odds_snapshot (migration 13) and one RPC. Nothing reads them until INCREMENTAL_BOOKMAKERS
-- is set, so the migration is safe to apply ahead of the code that uses it.
--
-- "Seen in a run" rule: an event counts as seen in a run iff save_odds_snapshot wrote it
-- non-degenerately in that run, or record_incremental_pass confirmed it (listed, not
-- started, status 'ok', same listing fingerprint, detail younger than the cap). Both set
-- last_seen_at = now and last_run_id = the run, so every rule keyed on those columns
-- (bookmaker freshness, the stale flag, the 24 h cleanup in cleanup_odds) treats a
-- confirmed event like a written one. An event that is not listed, has started, or whose
-- due detail failed is not confirmed, so it ages normally.
--
-- last_detail_at:      when the detail behind this snapshot was last fetched and saved
--                      (= last_seen_at of that save). NULL = never stamped = due.
-- listing_fingerprint: the listing-price digest at that fetch (NULL when the listing
--                      carries no prices).
-- No backfill: every snapshot starts as "never stamped" and is fetched on its first pass.

ALTER TABLE odds_snapshot
  ADD COLUMN IF NOT EXISTS last_detail_at timestamptz,
  ADD COLUMN IF NOT EXISTS listing_fingerprint text;

-- -----------------------------------------------------------------------------
-- record_incremental_pass: one call per (bookmaker, league) pass, after the saves.
-- p_fetched / p_confirmed: [{"match_id": text, "fingerprint": text|null}]
-- stamp:   rows the save RPC accepted in this run (last_run_id = p_run_id, status 'ok')
--          get last_detail_at = last_seen_at and the pass's fingerprint.
-- confirm: listed, unchanged, not started and recently fetched rows get
--          last_seen_at = now and last_run_id = p_run_id.
-- Returns {"stamped","confirmed","not_confirmed","confirmed_rows"}; confirmed_rows is the
-- sum of the confirmed snapshots' row_count (the rows those confirmations keep current).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_incremental_pass(
  p_run_id     uuid,
  p_bookmaker  text,
  p_fetched    jsonb,
  p_confirmed  jsonb,
  p_cap_near   interval DEFAULT '2 hours',   -- kickoff within 72 h or unknown
  p_cap_far    interval DEFAULT '6 hours'
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_now       timestamptz := clock_timestamp();
  v_fetched   jsonb := COALESCE(p_fetched, '[]'::jsonb);
  v_confirm   jsonb := COALESCE(p_confirmed, '[]'::jsonb);
  v_stamped   integer := 0;
  v_confirmed integer := 0;
  v_rows      bigint := 0;
BEGIN
  UPDATE odds_snapshot s
     SET last_detail_at = s.last_seen_at,
         listing_fingerprint = f.fingerprint
    FROM jsonb_to_recordset(v_fetched) AS f(match_id text, fingerprint text)
   WHERE s.match_id = f.match_id
     AND s.bookmaker = p_bookmaker
     AND s.last_run_id = p_run_id
     AND s.status = 'ok';
  GET DIAGNOSTICS v_stamped = ROW_COUNT;

  WITH confirmed AS (
    UPDATE odds_snapshot s
       SET last_seen_at = v_now,
           last_run_id = p_run_id
      FROM jsonb_to_recordset(v_confirm) AS f(match_id text, fingerprint text)
     WHERE s.match_id = f.match_id
       AND s.bookmaker = p_bookmaker
       AND s.status = 'ok'
       AND s.listing_fingerprint IS NOT DISTINCT FROM f.fingerprint
       AND s.last_detail_at > v_now - (CASE WHEN s.start_time > v_now + interval '72 hours'
                                            THEN p_cap_far ELSE p_cap_near END)
       AND (s.start_time IS NULL OR s.start_time > v_now)
    RETURNING s.row_count
  )
  SELECT count(*), COALESCE(sum(row_count), 0) INTO v_confirmed, v_rows FROM confirmed;

  RETURN jsonb_build_object(
    'stamped', v_stamped,
    'confirmed', v_confirmed,
    'not_confirmed', jsonb_array_length(v_confirm) - v_confirmed,
    'confirmed_rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION record_incremental_pass(uuid, text, jsonb, jsonb, interval, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_incremental_pass(uuid, text, jsonb, jsonb, interval, interval) TO service_role;

NOTIFY pgrst, 'reload schema';
