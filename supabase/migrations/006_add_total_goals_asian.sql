-- Migration: Add TOTAL_GOALS_ASIAN market type
-- Description: Adds new market type for "Liczba goli (z możliwym zwrotem)" - Asian-style totals with integer lines

-- Insert TOTAL_GOALS_ASIAN market type
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
  53,
  'TOTAL_GOALS_ASIAN',
  'Liczba goli (z możliwym zwrotem)',
  'Total Goals (Asian)',
  'Obstawiasz czy padnie więcej/mniej goli niż linia (przy trafieniu linii zwrot stawki)',
  'Bet on total goals with push/refund on exact line hit',
  'PARAMETER_SLIDER',
  'GOLE',
  true,
  'integer',
  ARRAY['OVER', 'UNDER'],
  11
) ON CONFLICT (id) DO UPDATE SET
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

-- Also upsert by code in case id is different
INSERT INTO market_types (
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
  'TOTAL_GOALS_ASIAN',
  'Liczba goli (z możliwym zwrotem)',
  'Total Goals (Asian)',
  'Obstawiasz czy padnie więcej/mniej goli niż linia (przy trafieniu linii zwrot stawki)',
  'Bet on total goals with push/refund on exact line hit',
  'PARAMETER_SLIDER',
  'GOLE',
  true,
  'integer',
  ARRAY['OVER', 'UNDER'],
  11
) ON CONFLICT (code) DO UPDATE SET
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
