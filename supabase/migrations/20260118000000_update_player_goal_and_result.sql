-- ============================================================================
-- Migration: Update PLAYER_GOAL_AND_RESULT view_type and selections
-- Date: 2026-01-18
-- Description: Updates PLAYER_GOAL_AND_RESULT (ID 50) to match the correct
--              definition in market-catalog.ts:
--              - view_type: PLAYER_DROPDOWN -> PLAYER_STAT_LINES
--              - selections: PLAYER_HOME/DRAW/AWAY -> HOME/DRAW/AWAY
-- ============================================================================

UPDATE market_types
SET
  view_type = 'PLAYER_STAT_LINES',
  selections = ARRAY['HOME', 'DRAW', 'AWAY']
WHERE code = 'PLAYER_GOAL_AND_RESULT';

-- ============================================================================
-- VERIFICATION QUERY (run manually to verify)
-- ============================================================================
-- SELECT id, code, view_type, selections
-- FROM market_types
-- WHERE code = 'PLAYER_GOAL_AND_RESULT';
-- Expected: id=50, code='PLAYER_GOAL_AND_RESULT', view_type='PLAYER_STAT_LINES',
--          selections={HOME,DRAW,AWAY}
