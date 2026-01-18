-- ============================================================================
-- Migration: Add CARDS_EXACT_RANGE market type (ID 268)
-- Date: 2026-01-18
-- Description: Adds new market for exact card count ranges in matches
-- ============================================================================

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  (268, 'CARDS_EXACT_RANGE', 'Dokladna liczba kartek', 'Exact Card Count Range',
   'Przedzial liczby kartek w meczu', 'Exact range of cards in match',
   'COMBINATION', 'STATYSTYKI', FALSE, NULL,
   ARRAY['0-1', '2-3', '4-5', '6-7', '8+', '0-2', '3-4', '5-6', '7+', '9+'], 90)

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
