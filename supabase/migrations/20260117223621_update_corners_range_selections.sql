-- ============================================================================
-- Migration: Update CORNERS_RANGE selections
-- Date: 2026-01-17
-- Description: Adds new selection values for CORNERS_RANGE market type.
--              Market ID 235 in STS is now correctly mapped to CORNERS_RANGE
--              (previously incorrectly mapped to HALF_TIME_CORNERS_RANGE).
--              New selections: 0-3, 4-6, 7+ (in addition to existing 0-8, 9-11, 12+)
-- ============================================================================

UPDATE market_types
SET selections = ARRAY['0-3', '4-6', '7+', '0-8', '9-11', '12+']
WHERE code = 'CORNERS_RANGE';
