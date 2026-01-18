-- ============================================================================
-- Migration: Add HALF_TIME_CARDS_TOTAL market type (ID 269)
-- Date: 2026-01-18
-- Description: Adds new market for total cards in first half (over/under)
-- ============================================================================

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  (269, 'HALF_TIME_CARDS_TOTAL', 'Kartki 1. polowy', 'Half Time Total Cards',
   'Laczna liczba kartek w pierwszej polowie', 'Total cards in first half',
   'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal',
   ARRAY['OVER', 'UNDER'], 84)

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
