-- ============================================================================
-- Migration: Add missing market types for STS mappings
-- Date: 2026-01-09
-- Description: Adds market types 46-52 that are defined in market-registry.ts
--              but were missing from the database. These are required for proper
--              STS market normalization after fixing incorrect mappings.
-- ============================================================================

-- FIRST_TEAM_TO_SCORE (ID 46) - "Która drużyna strzeli gola"
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (46, 'FIRST_TEAM_TO_SCORE', 'Która drużyna strzeli pierwszego gola', 'First Team To Score',
        'Która drużyna strzeli pierwszego gola?', 'Which team will score first?',
        'GOLE', ARRAY['HOME', 'AWAY', 'NONE', 'BOTH'], 'TRIPLE_BUTTONS', false, null, 21)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

-- FIRST_GOAL_TIME (ID 47) - "Czas pierwszego gola"
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (47, 'FIRST_GOAL_TIME', 'Czas pierwszego gola', 'First Goal Time',
        'W którym przedziale czasowym padnie pierwszy gol?', 'In which time period will the first goal be scored?',
        'GOLE', ARRAY['0-15', '16-30', '31-45', '46-60', '61-75', '76-90', 'NONE'], 'TRIPLE_BUTTONS', false, null, 22)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

-- TIME_PERIOD_RESULT (ID 48) - "Wynik w przedziale czasowym"
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (48, 'TIME_PERIOD_RESULT', 'Wynik w przedziale czasowym', 'Time Period Result',
        'Jaki będzie wynik w określonym przedziale czasowym?', 'What will be the result in a specific time period?',
        'GOLE', ARRAY['HOME', 'DRAW', 'AWAY'], 'TRIPLE_BUTTONS', true, 'integer', 23)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

-- FIRST_GOAL_AND_RESULT (ID 49) - "Pierwszy gol i wynik"
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (49, 'FIRST_GOAL_AND_RESULT', 'Pierwszy gol i wynik', 'First Goal & Result',
        'Która drużyna strzeli pierwszego gola i jaki będzie wynik?', 'Which team scores first and what will be the result?',
        'KOMBINACJE', ARRAY['HOME_HOME', 'HOME_DRAW', 'HOME_AWAY', 'AWAY_HOME', 'AWAY_DRAW', 'AWAY_AWAY', 'NONE'], 'COMBINATION', false, null, 86)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

-- PLAYER_GOAL_AND_RESULT (ID 50) - "Gol zawodnika i wynik"
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (50, 'PLAYER_GOAL_AND_RESULT', 'Gol zawodnika i wynik', 'Player Goal & Result',
        'Zawodnik strzeli gola i jaki będzie wynik meczu?', 'Player scores and what will be the match result?',
        'ZAWODNICY', ARRAY['PLAYER_HOME', 'PLAYER_DRAW', 'PLAYER_AWAY'], 'PLAYER_DROPDOWN', true, 'player', 66)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

-- PLAYER_SHOTS_ON_TARGET (ID 51) - "Celne strzały zawodnika"
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (51, 'PLAYER_SHOTS_ON_TARGET', 'Celne strzały zawodnika', 'Player Shots On Target',
        'Liczba celnych strzałów zawodnika', 'Player shots on target count',
        'ZAWODNICY', ARRAY['OVER', 'UNDER'], 'PLAYER_DROPDOWN', true, 'player', 67)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

-- PLAYER_PASSES (ID 52) - "Podania zawodnika"
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (52, 'PLAYER_PASSES', 'Podania zawodnika', 'Player Passes',
        'Liczba podań zawodnika', 'Player pass count',
        'ZAWODNICY', ARRAY['OVER', 'UNDER'], 'PLAYER_DROPDOWN', true, 'player', 68)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

-- ============================================================================
-- Update comment on market_types table
-- ============================================================================
COMMENT ON TABLE market_types IS 'Canonical market definitions with 52 standard types (IDs 1-52) plus OTHER (ID 99).
Categories: WYNIK_MECZU (1-3), GOLE (4-14, 46-48), HANDICAP (15-16), PIERWSZA_POLOWA (17-21),
DOKLADNY_WYNIK (22), ZAWODNICY (23-28, 50-52), STATYSTYKI (29-34, 41-45), KOMBINACJE (35-40, 49).
Last updated: Migration 005 - Added missing market types 46-52.';

-- ============================================================================
-- VERIFICATION QUERY (run manually to verify)
-- ============================================================================
-- SELECT id, code, category, display_order
-- FROM market_types
-- WHERE id BETWEEN 46 AND 52 OR id = 99
-- ORDER BY id;
