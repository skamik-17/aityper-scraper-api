-- Runs after 14_odds_read_switch.test.sql and supabase/rollback/14_odds_read_switch.down.sql:
-- latest_odds reads table odds again, with today's 21 columns.
\set ON_ERROR_STOP 1

DO $$
DECLARE before bigint := (SELECT count(*) FROM latest_odds);
BEGIN
  ASSERT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'latest_odds') = 21, 'latest_odds does not have 21 columns';
  INSERT INTO odds (match_id, league_slug, home_team, away_team, bookmaker, market_type_id, market_key, selections)
  VALUES ('premier-league:r:s', 'premier-league', 'r', 's', 'sts', 999141, 'MATCH_WINNER', '[]');
  ASSERT (SELECT count(*) FROM latest_odds) = before + 1, 'latest_odds does not read table odds';
  ASSERT to_regclass('market_comparison') IS NOT NULL AND to_regclass('matches_with_odds') IS NOT NULL, 'dependent views missing';
  PERFORM * FROM get_matches_with_odds('premier-league');
  PERFORM * FROM get_matches_with_odds('premier-league', ARRAY['MATCH_WINNER']);
END $$;
