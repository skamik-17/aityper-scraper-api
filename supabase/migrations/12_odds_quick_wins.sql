-- 12: odds quick wins on the current schema (plan 09 Phase A).

-- prune_stale_odds: one batched prune per bookmaker save, replacing one DELETE per match.
-- p_new_counts maps every match the save wrote to its row count: {"<match_id>": <rows written>, ...}.
-- Every listed match loses this bookmaker's rows older than p_scraped_at, in one statement.
-- The degenerate-write guard (previous >= p_min_prev AND new < previous * p_min_ratio keeps
-- the old snapshot) applies only with p_guard = true; it is off by default (owner B13).
CREATE OR REPLACE FUNCTION prune_stale_odds(
  p_bookmaker text,
  p_scraped_at timestamptz,
  p_new_counts jsonb,
  p_min_ratio numeric DEFAULT 0.10,
  p_min_prev integer DEFAULT 20,
  p_guard boolean DEFAULT false
) RETURNS jsonb
LANGUAGE sql
AS $$
  WITH n AS (
    SELECT key AS match_id, value::int AS new_rows
    FROM jsonb_each_text(p_new_counts)
  ),
  prev AS (
    SELECT o.match_id, count(DISTINCT o.market_key)::int AS previous_rows
    FROM odds o
    JOIN n ON n.match_id = o.match_id
    WHERE o.bookmaker = p_bookmaker AND o.scraped_at < p_scraped_at
    GROUP BY o.match_id
  ),
  g AS (
    SELECT n.match_id, n.new_rows, prev.previous_rows,
           p_guard AND COALESCE(prev.previous_rows >= p_min_prev AND n.new_rows < prev.previous_rows * p_min_ratio, false) AS skip
    FROM n
    LEFT JOIN prev ON prev.match_id = n.match_id
  ),
  d AS (
    DELETE FROM odds o
    USING g
    WHERE o.match_id = g.match_id
      AND NOT g.skip
      AND o.bookmaker = p_bookmaker
      AND o.scraped_at < p_scraped_at
    RETURNING 1
  )
  SELECT jsonb_build_object(
    'deleted', (SELECT count(*) FROM d),
    'pruned_matches', (SELECT count(*) FROM g WHERE NOT g.skip),
    'prune_skipped', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('match_id', g.match_id, 'new_rows', g.new_rows, 'previous_rows', g.previous_rows)
                        ORDER BY g.match_id)
       FROM g WHERE g.skip),
      '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION prune_stale_odds(text, timestamptz, jsonb, numeric, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION prune_stale_odds(text, timestamptz, jsonb, numeric, integer, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
