-- ============================================================================
-- Migration: Add HALF_TIME_CORRECT_SCORE market type
-- Date: 2026-01-13
-- Description: Fixes market ID 101 which was incorrectly mapped to CORRECT_SCORE
--              Should be separate HALF_TIME_CORRECT_SCORE for first half correct scores
-- ============================================================================

-- Add HALF_TIME_CORRECT_SCORE (ID 113)
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  (113, 'HALF_TIME_CORRECT_SCORE', 'Dokładny wynik 1. połowy', 'Half Time Correct Score',
   'Przewidywany dokładny wynik po pierwszej połowie', 'Exact score at half time',
   'SCORE_GRID', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['SCORE'], 53)
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
-- WHERE code = 'HALF_TIME_CORRECT_SCORE';
