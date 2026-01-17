-- ============================================================================
-- Migration: Update HOME/AWAY_EXACT_GOALS view_type and selections
-- Date: 2026-01-17
-- Description: Updates view_type from TRIPLE_BUTTONS to COMBINATION and
--              expands selections from 4 to 7 options for HOME_EXACT_GOALS and
--              AWAY_EXACT_GOALS markets.
-- Reason: TRIPLE_BUTTONS only displays first 3 selections, but these markets
--          have 7 (0,1,2,3,4,5,6+) which requires COMBINATION view_type.
-- ============================================================================

-- Update HOME_EXACT_GOALS (id=233)
UPDATE market_types
SET
  view_type = 'COMBINATION',
  selections = ARRAY['0', '1', '2', '3', '4', '5', '6+']
WHERE code = 'HOME_EXACT_GOALS';

-- Update AWAY_EXACT_GOALS (id=234)
UPDATE market_types
SET
  view_type = 'COMBINATION',
  selections = ARRAY['0', '1', '2', '3', '4', '5', '6+']
WHERE code = 'AWAY_EXACT_GOALS';
