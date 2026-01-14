-- ============================================================================
-- Migration: Add SECOND_HALF_EUROPEAN_HANDICAP market type
-- Date: 2026-01-13
-- Description: Fixes market ID 106 which was incorrectly mapped to EUROPEAN_HANDICAP
--              Should be separate SECOND_HALF_EUROPEAN_HANDICAP for 2nd half handicap betting
-- ============================================================================

-- Add SECOND_HALF_EUROPEAN_HANDICAP (ID 114)
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  (114, 'SECOND_HALF_EUROPEAN_HANDICAP', 'Handicap europejski 2. połowy', 'Second Half European Handicap',
   'Handicap europejski w drugiej połowie', 'European handicap in second half',
   'HANDICAP_SELECTOR', 'PIERWSZA_POLOWA', TRUE, 'handicap',
   ARRAY['HOME', 'DRAW', 'AWAY'], 54)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  view_type = EXCLUDED.view_type,
  category = EXCLUDED.category,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  selections = EXCLUDED.selections,
  display_order = EXCLUDED.display_order;

-- ============================================================================
-- VERIFICATION QUERY (run manually to verify)
-- ============================================================================
-- SELECT id, code, name_pl, category, view_type, display_order
-- FROM market_types
-- WHERE code = 'SECOND_HALF_EUROPEAN_HANDICAP';
