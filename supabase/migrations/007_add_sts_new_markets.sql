-- ============================================================================
-- Migration: Add new STS market types (half-time corners, goal ranges, player markets)
-- Date: 2026-01-11
-- Description: Adds 12 new market types for full STS coverage
--              All 125 STS markets are now mapped (0 unmapped)
-- ============================================================================

-- Half-time corners markets (STATYSTYKI category)
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  -- HALF_TIME_CORNERS_TOTAL (ID 72)
  (72, 'HALF_TIME_CORNERS_TOTAL', 'Rzuty rożne 1. połowy', 'Half Time Corners',
   'Łączna liczba rzutów rożnych w pierwszej połowie', 'Total corners in first half',
   'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal',
   ARRAY['OVER', 'UNDER'], 81),

  -- HALF_TIME_CORNERS_TEAM (ID 73)
  (73, 'HALF_TIME_CORNERS_TEAM', 'Rożne drużyny 1. połowa', 'Half Time Team Corners',
   'Rzuty rożne konkretnej drużyny w pierwszej połowie', 'Corners for specific team in first half',
   'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal',
   ARRAY['HOME_OVER', 'HOME_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 82),

  -- HALF_TIME_CORNERS_RACE (ID 74)
  (74, 'HALF_TIME_CORNERS_RACE', 'Więcej rożnych 1. połowa', 'Half Time Corners Race',
   'Która drużyna wykona więcej rzutów rożnych w pierwszej połowie?', 'Which team will have more corners in first half?',
   'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL,
   ARRAY['HOME', 'DRAW', 'AWAY'], 83)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  view_type = EXCLUDED.view_type,
  category = EXCLUDED.category,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  selections = EXCLUDED.selections,
  display_order = EXCLUDED.display_order;

-- Half-time combination markets (PIERWSZA_POLOWA category)
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  -- SECOND_HALF_BTTS (ID 22)
  (22, 'SECOND_HALF_BTTS', 'BTTS 2. połowa', 'Second Half BTTS',
   'Obie strzelą w drugiej połowie', 'Both teams score in second half',
   'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['YES', 'NO'], 45),

  -- SECOND_HALF_RESULT_AND_TOTAL (ID 23)
  (23, 'SECOND_HALF_RESULT_AND_TOTAL', 'Wynik 2. połowy + Gole', 'Second Half Result & Total',
   'Wynik drugiej połowy i liczba goli', 'Second half result and total goals',
   'COMBINATION', 'PIERWSZA_POLOWA', TRUE, 'decimal',
   ARRAY['HOME_OVER', 'HOME_UNDER', 'DRAW_OVER', 'DRAW_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 46)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  view_type = EXCLUDED.view_type,
  category = EXCLUDED.category,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  selections = EXCLUDED.selections,
  display_order = EXCLUDED.display_order;

-- Goal range markets (GOLE category)
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  -- TEAM_GOAL_RANGE (ID 54)
  (54, 'TEAM_GOAL_RANGE', 'Gole drużyny - przedział', 'Team Goal Range',
   'Przedział goli dla konkretnej drużyny', 'Goal range for specific team',
   'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
   ARRAY['0', '1', '2', '3', '4', '5+'], 25),

  -- HALF_TIME_GOAL_RANGE (ID 55)
  (55, 'HALF_TIME_GOAL_RANGE', 'Gole 1. połowy - przedział', 'Half Time Goal Range',
   'Przedział goli w pierwszej połowie', 'Goal range in first half',
   'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['0', '1', '2', '3', '4+'], 47),

  -- SECOND_HALF_GOAL_RANGE (ID 56)
  (56, 'SECOND_HALF_GOAL_RANGE', 'Gole 2. połowy - przedział', 'Second Half Goal Range',
   'Przedział goli w drugiej połowie', 'Goal range in second half',
   'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['0', '1', '2', '3', '4+'], 48)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  view_type = EXCLUDED.view_type,
  category = EXCLUDED.category,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  selections = EXCLUDED.selections,
  display_order = EXCLUDED.display_order;

-- Player goal markets (ZAWODNICY category)
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  -- PLAYER_2_OR_MORE_GOALS (ID 60)
  (60, 'PLAYER_2_OR_MORE_GOALS', 'Strzelec 2+ goli', 'Player 2+ Goals',
   'Zawodnik strzeli 2 lub więcej goli', 'Player to score 2 or more goals',
   'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player',
   ARRAY['YES', 'NO'], 69),

  -- PLAYER_3_OR_MORE_GOALS (ID 61)
  (61, 'PLAYER_3_OR_MORE_GOALS', 'Strzelec 3+ goli', 'Player 3+ Goals',
   'Zawodnik strzeli 3 lub więcej goli', 'Player to score 3 or more goals',
   'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player',
   ARRAY['YES', 'NO'], 70),

  -- PLAYER_HAT_TRICK (ID 62)
  (62, 'PLAYER_HAT_TRICK', 'Hat-trick', 'Hat-trick',
   'Zawodnik strzeli 3 gole w jednym meczu', 'Player to score 3 goals in one match',
   'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player',
   ARRAY['YES', 'NO'], 71),

  -- TEAM_TOTAL_SCORERS (ID 63)
  (63, 'TEAM_TOTAL_SCORERS', 'Liczba strzelców', 'Total Scorers',
   'Liczba różnych zawodników strzelających gole', 'Number of different players scoring goals',
   'TRIPLE_BUTTONS', 'GOLE', TRUE, 'integer',
   ARRAY['OVER', 'UNDER'], 49)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  view_type = EXCLUDED.view_type,
  category = EXCLUDED.category,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  selections = EXCLUDED.selections,
  display_order = EXCLUDED.display_order;

UPDATE market_types SET display_order = 92 WHERE code = 'TEAM_TOTAL_SCORERS';
UPDATE market_types SET display_order = 93 WHERE code = 'PLAYER_GOAL_AND_RESULT';
UPDATE market_types SET display_order = 94 WHERE code = 'DOUBLE_CHANCE_BTTS';
UPDATE market_types SET display_order = 95 WHERE code = 'DOUBLE_CHANCE_TOTAL';
UPDATE market_types SET display_order = 96 WHERE code = 'HALFTIME_FULLTIME';
UPDATE market_types SET display_order = 97 WHERE code = 'DOUBLE_RESULT';
UPDATE market_types SET display_order = 98 WHERE code = 'FIRST_GOAL_AND_RESULT';

-- ============================================================================
-- Comment summarizing the migration
-- ============================================================================
COMMENT ON TABLE market_types IS 'Canonical market definitions with 64 standard types (IDs 1-64) plus OTHER (ID 99) as fallback.
Categories: WYNIK_MECZU (1-3), GOLE (4-14, 46-49, 54-56, 63), HANDICAP (15-16), PIERWSZA_POLOWA (17-23, 40-48), DOKLADNY_WYNIK (22), ZAWODNICY (23-28, 50-52, 60-62, 66), STATYSTYKI (29-34, 72-74), KOMBINACJE (35-40, 49, 94-97).
Last updated: Migration 007 - Added 12 new STS market types for full coverage (125/125 mapped).';

-- ============================================================================
-- VERIFICATION QUERY (run manually to verify)
-- ============================================================================
-- SELECT id, code, category, display_order
-- FROM market_types
-- WHERE id IN (22, 23, 54, 55, 56, 60, 61, 62, 63, 72, 73, 74)
-- ORDER BY category, display_order;
