-- Migration 12, get_match_market_rows: one json value per match, text-identical to
-- json_agg over market_comparison ORDER BY category, market_key.
-- Two bookmakers, two categories, two scrapes of one key.
\set ON_ERROR_STOP 1

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, selections, display_order)
VALUES (999121, 'SQLTEST_12A', 'Wynik', 'Result', 'Test', 'Test', 'BINARY_BUTTONS', 'WYNIK_MECZU', ARRAY['YES', 'NO'], 1),
       (999122, 'SQLTEST_12B', 'Gole', 'Goals', 'Test', 'Test', 'BINARY_BUTTONS', 'GOLE', ARRAY['OVER', 'UNDER'], 2)
ON CONFLICT DO NOTHING;

INSERT INTO odds (match_id, league_slug, home_team, away_team, bookmaker, event_url, market_type_id, market_key, param_value,
                  raw_market_name, selections, scraped_at)
VALUES
  ('premier-league:a:b', 'premier-league', 'A', 'B', 'sts',     'https://sts.test/1',     999121, 'R',        NULL,  '1X2',     '[{"name":"1","odds":2.1}]', '2026-11-07 10:00+00'),
  ('premier-league:a:b', 'premier-league', 'A', 'B', 'sts',     'https://sts.test/1',     999121, 'R',        NULL,  '1X2',     '[{"name":"1","odds":2.2}]', '2026-11-07 11:00+00'),
  ('premier-league:a:b', 'premier-league', 'A', 'B', 'fortuna', 'https://fortuna.test/1', 999121, 'R',        NULL,  '1X2',     '[{"name":"1","odds":2.0}]', '2026-11-07 11:00+00'),
  ('premier-league:a:b', 'premier-league', 'A', 'B', 'fortuna', 'https://fortuna.test/1', 999122, 'G:2.5',    '2.5', 'Gole',    '[{"name":"+","odds":1.9}]', '2026-11-07 11:00+00'),
  ('premier-league:a:b', 'premier-league', 'A', 'B', 'sts',     'https://sts.test/1',     999122, 'G:1.5',    '1.5', 'Gole',    '[{"name":"+","odds":1.3}]', '2026-11-07 11:00+00'),
  ('premier-league:c:d', 'premier-league', 'C', 'D', 'sts',     'https://sts.test/2',     999121, 'R',        NULL,  '1X2',     '[{"name":"1","odds":3.0}]', '2026-11-07 11:00+00');

DO $$
DECLARE
  got text := get_match_market_rows('premier-league:a:b')::text;
  want text := (SELECT json_agg(x)::text
                FROM (SELECT * FROM market_comparison WHERE match_id = 'premier-league:a:b' ORDER BY category, market_key) x);
BEGIN
  ASSERT got = want, 'get_match_market_rows differs from market_comparison: ' || got || ' <> ' || want;
  ASSERT json_array_length(got::json) = 4, 'expected 4 latest rows, got ' || got;
  ASSERT get_match_market_rows('nope')::text = '[]', 'unknown match is not []';
END $$;
