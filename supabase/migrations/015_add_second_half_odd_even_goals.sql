-- ============================================================================
-- Migration: Add SECOND_HALF_ODD_EVEN_GOALS market type
-- Date: 2026-01-13
-- Description: Fixes market ID 120 which was incorrectly mapped to ODD_EVEN_GOALS
--              Should be separate SECOND_HALF_ODD_EVEN_GOALS for 2nd half odd/even betting
-- ============================================================================

-- Add SECOND_HALF_ODD_EVEN_GOALS (ID 115)
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  (115, 'SECOND_HALF_ODD_EVEN_GOALS', 'Parzyste/Nieparzyste 2. połowa', 'Second Half Odd/Even Goals',
   'Parzyste/nieparzyste w drugiej połowie', 'Odd/Even goals in second half',
   'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['ODD', 'EVEN'], 54)
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
-- WHERE code = 'SECOND_HALF_ODD_EVEN_GOALS';
