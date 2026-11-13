-- 14: read switch (plan 09 Task 7) and retention / in-play rules (Task 8).
-- Applied by the owner in one inter-run window, then ODDS_WRITE_MODEL=switched.
-- Rollback: supabase/rollback/14_odds_read_switch.down.sql (table odds keeps being written for 7 days).
--
-- NOT COMPLETE YET: plan 09 Task 8 appends the retention and in-play sections. Apply only after
-- Task 8 has landed and the Task 6 dual-write gate has passed; until then this file stays unapplied.

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

NOTIFY pgrst, 'reload schema';
