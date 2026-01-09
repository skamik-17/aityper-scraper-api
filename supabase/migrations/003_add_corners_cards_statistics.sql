-- ============================================================================
-- Migration: Add new statistics market types (Corners Race, First Corner, etc.)
-- Date: 2026-01-09
-- Description: Adds 5 new market types for corners and cards statistics
-- ============================================================================

-- Add new market types for corners statistics
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  -- CORNERS_RACE - Which team will have more corners
  (41, 'CORNERS_RACE', 'Więcej rzutów rożnych', 'Corners Race',
   'Która drużyna wykona więcej rzutów rożnych?', 'Which team will have more corners?',
   'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL,
   ARRAY['HOME', 'DRAW', 'AWAY'], 76),

  -- FIRST_CORNER - First corner kick
  (42, 'FIRST_CORNER', 'Pierwszy rzut rożny', 'First Corner',
   'Która drużyna wykona pierwszy rzut rożny?', 'Which team will take the first corner?',
   'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL,
   ARRAY['HOME', 'NONE', 'AWAY'], 77),

  -- CORNERS_HANDICAP - Corners with handicap
  (43, 'CORNERS_HANDICAP', 'Rzuty rożne - handicap', 'Corners Handicap',
   'Handicap na liczbę rzutów rożnych', 'Handicap on total corners',
   'HANDICAP_SELECTOR', 'STATYSTYKI', TRUE, 'handicap',
   ARRAY['HOME', 'AWAY'], 78),

  -- CARDS_RACE - Which team will have more cards
  (44, 'CARDS_RACE', 'Więcej kartek', 'Cards Race',
   'Która drużyna otrzyma więcej kartek?', 'Which team will receive more cards?',
   'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL,
   ARRAY['HOME', 'DRAW', 'AWAY'], 79),

  -- FIRST_CARD - First card
  (45, 'FIRST_CARD', 'Pierwsza kartka', 'First Card',
   'Która drużyna otrzyma pierwszą kartkę?', 'Which team will receive the first card?',
   'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL,
   ARRAY['HOME', 'NONE', 'AWAY'], 80)
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

-- Update display_order for combination markets to make room for new statistics
UPDATE market_types SET display_order = 85 WHERE code = 'RESULT_AND_BTTS';
UPDATE market_types SET display_order = 86 WHERE code = 'RESULT_AND_TOTAL';
UPDATE market_types SET display_order = 87 WHERE code = 'HALFTIME_FULLTIME';
UPDATE market_types SET display_order = 88 WHERE code = 'DOUBLE_RESULT';
UPDATE market_types SET display_order = 89 WHERE code = 'DOUBLE_CHANCE_BTTS';
UPDATE market_types SET display_order = 90 WHERE code = 'DOUBLE_CHANCE_TOTAL';

-- Add goals timing markets
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  -- FIRST_TEAM_TO_SCORE
  (46, 'FIRST_TEAM_TO_SCORE', 'Która drużyna strzeli gola', 'First Team To Score',
   'Która drużyna strzeli pierwszego/ostatniego gola?', 'Which team will score first/last?',
   'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
   ARRAY['HOME', 'AWAY', 'NONE', 'BOTH'], 21),

  -- FIRST_GOAL_TIME
  (47, 'FIRST_GOAL_TIME', 'Czas pierwszego gola', 'First Goal Time',
   'W którym przedziale czasowym padnie pierwszy gol?', 'In which time period will the first goal be scored?',
   'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
   ARRAY['0-15', '16-30', '31-45', '46-60', '61-75', '76-90', 'NONE'], 22),

  -- TIME_PERIOD_RESULT
  (48, 'TIME_PERIOD_RESULT', 'Wynik w przedziale czasowym', 'Time Period Result',
   'Jaki będzie wynik w określonym przedziale czasowym?', 'What will be the result in a specific time period?',
   'TRIPLE_BUTTONS', 'GOLE', TRUE, 'integer',
   ARRAY['HOME', 'DRAW', 'AWAY'], 23)
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

-- Add combination market
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  -- FIRST_GOAL_AND_RESULT
  (49, 'FIRST_GOAL_AND_RESULT', 'Pierwszy gol i wynik', 'First Goal & Result',
   'Która drużyna strzeli pierwszego gola i jaki będzie wynik?', 'Which team scores first and what will be the result?',
   'COMBINATION', 'KOMBINACJE', FALSE, NULL,
   ARRAY['HOME_HOME', 'HOME_DRAW', 'HOME_AWAY', 'AWAY_HOME', 'AWAY_DRAW', 'AWAY_AWAY', 'NONE'], 86)
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

-- Add additional player markets
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  -- PLAYER_GOAL_AND_RESULT
  (50, 'PLAYER_GOAL_AND_RESULT', 'Gol zawodnika i wynik', 'Player Goal & Result',
   'Zawodnik strzeli gola i jaki będzie wynik meczu?', 'Player scores and what will be the match result?',
   'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player',
   ARRAY['PLAYER_HOME', 'PLAYER_DRAW', 'PLAYER_AWAY'], 66),

  -- PLAYER_SHOTS_ON_TARGET
  (51, 'PLAYER_SHOTS_ON_TARGET', 'Celne strzały zawodnika', 'Player Shots On Target',
   'Liczba celnych strzałów zawodnika', 'Player shots on target count',
   'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player',
   ARRAY['OVER', 'UNDER'], 67),

  -- PLAYER_PASSES
  (52, 'PLAYER_PASSES', 'Podania zawodnika', 'Player Passes',
   'Liczba podań zawodnika', 'Player pass count',
   'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player',
   ARRAY['OVER', 'UNDER'], 68)
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

-- Add comment
COMMENT ON TABLE market_types IS 'Canonical market definitions. Includes 52 standard market types plus OTHER (id 99) as fallback. Migration 003 added corners, cards, goals timing, and additional player markets.';
