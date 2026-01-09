-- ============================================================================
-- Migration: Market consistency update and display order fixes
-- Date: 2026-01-09
-- Description: Ensures market_types table is consistent with market-registry.ts
-- ============================================================================

-- Update display_order for statistics markets to ensure proper ordering
UPDATE market_types SET display_order = 76 WHERE code = 'CORNERS_RACE';
UPDATE market_types SET display_order = 77 WHERE code = 'FIRST_CORNER';
UPDATE market_types SET display_order = 78 WHERE code = 'CORNERS_HANDICAP';
UPDATE market_types SET display_order = 79 WHERE code = 'CARDS_RACE';
UPDATE market_types SET display_order = 80 WHERE code = 'FIRST_CARD';

-- Update display_order for combination markets (moved to make room for stats)
UPDATE market_types SET display_order = 85 WHERE code = 'RESULT_AND_BTTS';
UPDATE market_types SET display_order = 86 WHERE code = 'RESULT_AND_TOTAL';
UPDATE market_types SET display_order = 87 WHERE code = 'HALFTIME_FULLTIME';
UPDATE market_types SET display_order = 88 WHERE code = 'DOUBLE_RESULT';
UPDATE market_types SET display_order = 89 WHERE code = 'DOUBLE_CHANCE_BTTS';
UPDATE market_types SET display_order = 90 WHERE code = 'DOUBLE_CHANCE_TOTAL';
UPDATE market_types SET display_order = 91 WHERE code = 'FIRST_GOAL_AND_RESULT';

-- Ensure FIRST_CORNER has correct selections (HOME, NONE, AWAY - not DRAW)
UPDATE market_types
SET selections = ARRAY['HOME', 'NONE', 'AWAY']
WHERE code = 'FIRST_CORNER' AND 'DRAW' = ANY(selections);

-- Ensure FIRST_CARD has correct selections (HOME, NONE, AWAY - not DRAW)
UPDATE market_types
SET selections = ARRAY['HOME', 'NONE', 'AWAY']
WHERE code = 'FIRST_CARD' AND 'DRAW' = ANY(selections);

-- Update FIRST_TEAM_TO_SCORE to include all valid selections
UPDATE market_types
SET selections = ARRAY['HOME', 'AWAY', 'NONE', 'BOTH']
WHERE code = 'FIRST_TEAM_TO_SCORE';

-- Update FIRST_GOAL_TIME to include all time periods
UPDATE market_types
SET selections = ARRAY['0-15', '16-30', '31-45', '46-60', '61-75', '76-90', 'NONE']
WHERE code = 'FIRST_GOAL_TIME';

-- Update FIRST_GOAL_AND_RESULT selections
UPDATE market_types
SET selections = ARRAY['HOME_HOME', 'HOME_DRAW', 'HOME_AWAY', 'AWAY_HOME', 'AWAY_DRAW', 'AWAY_AWAY', 'NONE']
WHERE code = 'FIRST_GOAL_AND_RESULT';

-- Add comment summarizing the complete market system
COMMENT ON TABLE market_types IS 'Canonical market definitions with 52 standard types (IDs 1-52) plus OTHER (ID 99) as fallback.
Categories: WYNIK_MECZU (1-3), GOLE (4-14, 46-48), HANDICAP (15-16), PIERWSZA_POLOWA (17-21),
DOKLADNY_WYNIK (22), ZAWODNICY (23-28, 50-52), STATYSTYKI (29-34, 41-45), KOMBINACJE (35-40, 49).
Last updated: Migration 004.';

-- ============================================================================
-- VERIFICATION QUERY (commented out - run manually to verify)
-- ============================================================================
-- SELECT id, code, category, display_order
-- FROM market_types
-- ORDER BY category, display_order;
