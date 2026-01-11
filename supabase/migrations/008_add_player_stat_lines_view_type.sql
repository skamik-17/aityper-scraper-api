-- ============================================================================
-- Migration: Add PLAYER_STAT_LINES view type
-- Date: 2026-01-11
-- Description: Adds new view_type enum value for player stat markets that have
--              multiple line thresholds (1+, 2+, 3+) per player, unlike
--              PLAYER_DROPDOWN which has single odds per player.
-- ============================================================================

ALTER TYPE view_type ADD VALUE IF NOT EXISTS 'PLAYER_STAT_LINES';

UPDATE market_types
SET view_type = 'PLAYER_STAT_LINES'
WHERE code IN (
  'PLAYER_SHOTS',
  'PLAYER_CARDS',
  'PLAYER_ASSISTS',
  'PLAYER_SHOTS_ON_TARGET',
  'PLAYER_PASSES'
);

-- ============================================================================
-- VERIFICATION QUERY (run manually to verify)
-- ============================================================================
-- SELECT id, code, view_type
-- FROM market_types
-- WHERE code IN ('PLAYER_SHOTS', 'PLAYER_CARDS', 'PLAYER_ASSISTS', 'PLAYER_SHOTS_ON_TARGET', 'PLAYER_PASSES')
-- ORDER BY id;
