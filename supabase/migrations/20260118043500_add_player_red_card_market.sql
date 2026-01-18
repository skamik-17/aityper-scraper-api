-- Migration: Add PLAYER_RED_CARD market type
-- Date: 2026-01-18
-- Used by STS (market ID 2153)

INSERT INTO market_types (
  id,
  code,
  name_pl,
  name_en,
  description_pl,
  description_en,
  view_type,
  category,
  has_parameter,
  param_type,
  selections,
  display_order
) VALUES (
  143,
  'PLAYER_RED_CARD',
  'Zawodnik otrzyma czerwona kartke',
  'Player Red Card',
  'Czy zawodnik otrzyma czerwona kartke?',
  'Will the player receive a red card?',
  'PLAYER_STAT_LINES',
  'ZAWODNICY',
  TRUE,
  'player',
  ARRAY['YES'],
  76
)
ON CONFLICT (id) DO NOTHING;
