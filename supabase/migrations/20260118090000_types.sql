CREATE TYPE view_type AS ENUM (
  'BINARY_BUTTONS',
  'TRIPLE_BUTTONS',
  'PARAMETER_SLIDER',
  'HANDICAP_SELECTOR',
  'SCORE_GRID',
  'PLAYER_DROPDOWN',
  'STAT_RANGE',
  'COMBINATION',
  'HALFTIME_FULLTIME'
);

ALTER TYPE view_type ADD VALUE IF NOT EXISTS 'PLAYER_STAT_LINES';

CREATE TYPE parameter_type AS ENUM (
  'decimal',
  'integer',
  'handicap',
  'score',
  'player'
);

CREATE TYPE market_category AS ENUM (
  'WYNIK_MECZU',
  'GOLE',
  'HANDICAP',
  'PIERWSZA_POLOWA',
  'DOKLADNY_WYNIK',
  'ZAWODNICY',
  'STATYSTYKI',
  'KOMBINACJE'
);

ALTER TYPE market_category ADD VALUE IF NOT EXISTS 'INNE';

COMMENT ON TYPE market_category IS 'Market categories for UI organization. Includes INNE as fallback for unknown markets. Added in migration 002 to match TypeScript enum.';
