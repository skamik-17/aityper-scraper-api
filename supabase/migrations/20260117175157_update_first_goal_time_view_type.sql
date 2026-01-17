-- ============================================================================
-- Migration: Update FIRST_GOAL_TIME view_type to COMBINATION
-- Date: 2026-01-17
-- Description: Updates view_type from TRIPLE_BUTTONS to COMBINATION for
--              FIRST_GOAL_TIME market.
-- Reason: COMBINATION supports any number of selections, while
--          TRIPLE_BUTTONS requires minimum 3 selections and is designed
--          for markets with exactly 3 options (HOME, DRAW, AWAY).
--          FIRST_GOAL_TIME has 7 selections (0-15, 16-30, 31-45, 46-60,
--          61-75, 76-90, NONE) which is better suited for COMBINATION.
-- ============================================================================

-- Update FIRST_GOAL_TIME (id=47)
UPDATE market_types
SET view_type = 'COMBINATION'
WHERE code = 'FIRST_GOAL_TIME';
