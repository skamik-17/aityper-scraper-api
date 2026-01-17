-- ============================================================================
-- Migration: Update EXACT_GOALS view_type from TRIPLE_BUTTONS to COMBINATION
-- Date: 2026-01-17
-- Description: Updates view_type for EXACT_GOALS market because TRIPLE_BUTTONS
--              only displays first 3 selections, but EXACT_GOALS has 7 (0,1,2,3,4,5,6+)
-- ============================================================================

-- Update view_type for EXACT_GOALS (id=219)
UPDATE market_types
SET view_type = 'COMBINATION'
WHERE code = 'EXACT_GOALS';
