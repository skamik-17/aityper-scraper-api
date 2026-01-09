-- ============================================================================
-- Migration: Add INNE to market_category enum and OTHER to market_types
-- Date: 2026-01-09
-- Description: Fixes schema mismatches between database and TypeScript code
-- ============================================================================

-- Step 1: Add INNE to market_category enum
ALTER TYPE market_category ADD VALUE IF NOT EXISTS 'INNE';

-- Step 2: Add OTHER market type to market_types table
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES (
  99,
  'OTHER',
  'Inne',
  'Other',
  'Rynki nieobsługiwane przez system normalizacji',
  'Markets not supported by normalization system',
  'TRIPLE_BUTTONS',
  'INNE',
  FALSE,
  NULL,
  ARRAY['HOME', 'DRAW', 'AWAY'],
  999
)
ON CONFLICT (id) DO NOTHING;

-- Step 3: Comment explaining the fix
COMMENT ON TYPE market_category IS 'Market categories for UI organization. Includes INNE as fallback for unknown markets. Added in migration 002 to match TypeScript enum.';
COMMENT ON TABLE market_types IS 'Canonical market definitions. Includes OTHER (id 99) as fallback for unrecognized markets. Added in migration 002.';
