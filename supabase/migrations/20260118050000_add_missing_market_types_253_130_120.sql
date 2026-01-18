-- ============================================================================
-- Migration: Add missing market types (253, 130, 120)
-- Date: 2026-01-18
-- Description: Adds BOTH_HALVES_OVER_GOALS, PLAYER_GOALS, and fixes SECOND_HALF_ODD_EVEN_GOALS ID
-- ============================================================================

-- Fix SECOND_HALF_ODD_EVEN_GOALS: exists with ID 115 but market-catalog.ts says ID 120
-- First delete wrong ID, then insert correct one
DELETE FROM market_types WHERE id = 115 AND code = 'SECOND_HALF_ODD_EVEN_GOALS';
DELETE FROM market_types WHERE code = 'SECOND_HALF_ODD_EVEN_GOALS';

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  (253, 'BOTH_HALVES_OVER_GOALS', 'Obie polowy powyzej X goli', 'Both Halves Over X Goals',
   'Czy obie polowy beda mialy powyzej X goli?', 'Will both halves have over X goals?',
   'BINARY_BUTTONS', 'GOLE', TRUE, 'decimal',
   ARRAY['YES', 'NO'], 253),

  (130, 'PLAYER_GOALS', 'Gole zawodnika', 'Player Goals',
   'Liczba goli zawodnika', 'Player goal count',
   'PLAYER_STAT_LINES', 'ZAWODNICY', TRUE, 'player',
   ARRAY['1+', '2+', '3+', '4+'], 66),

  (120, 'SECOND_HALF_ODD_EVEN_GOALS', '2. polowa - parzyste/nieparzyste', '2nd Half Odd/Even Goals',
   'Czy liczba goli w 2. polowie bedzie parzysta czy nieparzysta?', 'Will total goals in second half be odd or even?',
   'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['ODD', 'EVEN'], 46)

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
