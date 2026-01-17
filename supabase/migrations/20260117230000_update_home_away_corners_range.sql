-- ============================================================================
-- Migration: Update HOME_CORNERS_RANGE and AWAY_CORNERS_RANGE
-- Date: 2026-01-17
-- Description: Updates selections and view_type for corners range markets.
--              - Adds new selection values: 0, 1, 2, 3+ (in addition to existing 0-2, 3-4, 5+)
--              - Changes view_type from TRIPLE_BUTTONS to COMBINATION
-- ============================================================================

-- Update HOME_CORNERS_RANGE (ID 237)
UPDATE market_types
SET 
    selections = ARRAY['0', '1', '2', '3+', '0-2', '3-4', '5+'],
    view_type = 'COMBINATION'
WHERE code = 'HOME_CORNERS_RANGE';

-- Update AWAY_CORNERS_RANGE (ID 238)
UPDATE market_types
SET 
    selections = ARRAY['0', '1', '2', '3+', '0-2', '3-4', '5+'],
    view_type = 'COMBINATION'
WHERE code = 'AWAY_CORNERS_RANGE';
