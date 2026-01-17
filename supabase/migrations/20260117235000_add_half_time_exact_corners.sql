-- ============================================================================
-- Migration: Add HALF_TIME_HOME_EXACT_CORNERS and HALF_TIME_AWAY_EXACT_CORNERS
-- Date: 2026-01-17
-- Description: Adds new market types for exact corners count per team in 1st half.
--              Market IDs 254 and 255 were previously mapped to HALF_TIME_CORNERS_TEAM_RANGE
--              but STS uses them for exact corner counts (0, 1, 2, 3+).
-- ============================================================================

-- Add HALF_TIME_HOME_EXACT_CORNERS (ID 254)
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES (
  254,
  'HALF_TIME_HOME_EXACT_CORNERS',
  '1. polowa - gospodarz - dokladna liczba roznych',
  '1st Half Home Exact Corners',
  'Dokladna liczba roznych gospodarzy w 1. polowie',
  'Exact corners for home team in 1st half',
  'COMBINATION',
  'STATYSTYKI',
  FALSE,
  NULL,
  ARRAY['0', '1', '2', '3+'],
  254
)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  view_type = EXCLUDED.view_type,
  selections = EXCLUDED.selections;

-- Add HALF_TIME_AWAY_EXACT_CORNERS (ID 255)
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES (
  255,
  'HALF_TIME_AWAY_EXACT_CORNERS',
  '1. polowa - gosc - dokladna liczba roznych',
  '1st Half Away Exact Corners',
  'Dokladna liczba roznych gosci w 1. polowie',
  'Exact corners for away team in 1st half',
  'COMBINATION',
  'STATYSTYKI',
  FALSE,
  NULL,
  ARRAY['0', '1', '2', '3+'],
  255
)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  view_type = EXCLUDED.view_type,
  selections = EXCLUDED.selections;
