-- ============================================================================
-- Migration: Add HOME_TEAM_ODD_EVEN_GOALS and AWAY_TEAM_ODD_EVEN_GOALS
-- Date: 2026-01-17
-- Description: Adds two new market types for team-specific odd/even goals:
--              - HOME_TEAM_ODD_EVEN_GOALS: Home team goals odd/even
--              - AWAY_TEAM_ODD_EVEN_GOALS: Away team goals odd/even
-- ============================================================================

-- Insert HOME_TEAM_ODD_EVEN_GOALS market type
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
  116,
  'HOME_TEAM_ODD_EVEN_GOALS',
  'Gospodarz - parzyste/nieparzyste',
  'Home Team Odd/Even Goals',
  'Czy liczba goli gospodarzy będzie parzysta czy nieparzysta?',
  'Will home team goals be odd or even?',
  'BINARY_BUTTONS',
  'GOLE',
  FALSE,
  NULL,
  ARRAY['ODD', 'EVEN'],
  14
) ON CONFLICT (id) DO NOTHING;

-- Insert AWAY_TEAM_ODD_EVEN_GOALS market type
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
  117,
  'AWAY_TEAM_ODD_EVEN_GOALS',
  'Gość - parzyste/nieparzyste',
  'Away Team Odd/Even Goals',
  'Czy liczba goli gości będzie parzysta czy nieparzysta?',
  'Will away team goals be odd or even?',
  'BINARY_BUTTONS',
  'GOLE',
  FALSE,
  NULL,
  ARRAY['ODD', 'EVEN'],
  15
) ON CONFLICT (id) DO NOTHING;
