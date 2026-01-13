#!/bin/bash
set -e

# Apply migration 012 directly to Supabase
# Usage: ./apply_migration_direct.sh

DB_URL=${SUPABASE_URL:-"http://127.0.0.1:54321"}

echo "Applying migration 012 to database at $DB_URL..."

psql "$DB_URL" << 'SQL'
INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  (105, 'HALF_TIME_AWAY_TO_SCORE', '1. połowa - gość strzeli', 'Away Team To Score (1st Half)',
   'Czy goście strzelą w 1. połowie?', 'Will away team score in first half?',
   'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['YES', 'NO'], 105),

  (111, 'TOTAL_GOALS_AND_BTTS', 'Gole + BTTS', 'Total Goals & BTTS',
   'Liczba goli i czy obie strzelą', 'Total goals and both teams score',
   'COMBINATION', 'KOMBINACJE', TRUE, 'decimal',
   ARRAY['OVER_YES', 'UNDER_YES', 'OVER_NO', 'UNDER_NO'], 92)
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
SQL

echo "Migration 012 completed successfully!"
