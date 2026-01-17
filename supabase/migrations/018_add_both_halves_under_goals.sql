-- ============================================================================
-- Migration: Add BOTH_HALVES_UNDER_GOALS market type
-- Date: 2026-01-16
-- Description: Adds new market type for betting on both halves having under X goals
-- ============================================================================

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  (252, 'BOTH_HALVES_UNDER_GOALS', 'Obie polowy ponizej X goli', 'Both Halves Under X Goals',
   'Czy obie polowy beda mialy ponizej X goli?', 'Will both halves have under X goals?',
   'BINARY_BUTTONS', 'GOLE', TRUE, 'decimal',
   ARRAY['YES', 'NO'], 252)
ON CONFLICT (id) DO NOTHING;
