-- ============================================================================
-- Migration: Update HALF_TIME_CORNERS_RANGE selections
-- Date: 2026-01-17
-- Description: Adds new selection values for HALF_TIME_CORNERS_RANGE market type.
--              Market ID 256 in STS uses selections: 0-2, 3-4, 5+
--              Combined with existing selections: 0-4, 5-6, 7+
-- ============================================================================

UPDATE market_types
SET selections = ARRAY['0-2', '3-4', '5+', '0-4', '5-6', '7+']
WHERE code = 'HALF_TIME_CORNERS_RANGE';
