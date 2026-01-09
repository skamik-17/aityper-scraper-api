-- ============================================================================
-- AITyper Fresh Database Schema
-- Version: 1.0
-- Description: Simplified schema with canonical market types and normalized odds storage
-- ============================================================================

-- ============================================================================
-- ENUMS
-- ============================================================================

-- View types for frontend component rendering
CREATE TYPE view_type AS ENUM (
  'BINARY_BUTTONS',      -- 1: YES/NO, OVER/UNDER - 2 simple buttons
  'TRIPLE_BUTTONS',      -- 2: 1X2 - 3 buttons (Home, Draw, Away)
  'PARAMETER_SLIDER',    -- 3: Over/Under with parameter selection
  'HANDICAP_SELECTOR',   -- 4: Handicap markets with +/- values
  'SCORE_GRID',          -- 5: Correct score - grid of scores
  'PLAYER_DROPDOWN',     -- 6: Goalscorer - dropdown + buttons
  'STAT_RANGE',          -- 7: Corners, Cards - range selector
  'COMBINATION',         -- 8: Combined markets (Result + BTTS)
  'HALFTIME_FULLTIME'    -- 9: 9 outcomes HT/FT grid
);

-- Parameter types for markets that need them
CREATE TYPE parameter_type AS ENUM (
  'decimal',    -- Over/Under lines: 0.5, 1.5, 2.5, etc.
  'integer',    -- Whole numbers: 1, 2, 3
  'handicap',   -- Handicap values: -1.5, +0.5, etc.
  'score',      -- Correct score: 1-0, 2-1, etc.
  'player'      -- Player names
);

-- Market categories
CREATE TYPE market_category AS ENUM (
  'WYNIK_MECZU',      -- Match result markets
  'GOLE',             -- Goals markets
  'HANDICAP',         -- Handicap markets
  'PIERWSZA_POLOWA',  -- First/Second half markets
  'DOKLADNY_WYNIK',   -- Correct score
  'ZAWODNICY',        -- Player markets
  'STATYSTYKI',       -- Statistics (corners, cards)
  'KOMBINACJE'        -- Combined markets
);

-- ============================================================================
-- REFERENCE TABLES
-- ============================================================================

-- Canonical market definitions (40 types)
CREATE TABLE market_types (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_pl TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_pl TEXT NOT NULL,
  description_en TEXT NOT NULL,
  view_type view_type NOT NULL,
  category market_category NOT NULL,
  has_parameter BOOLEAN NOT NULL DEFAULT FALSE,
  param_type parameter_type,
  selections TEXT[] NOT NULL,
  display_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for common lookups
CREATE INDEX idx_market_types_code ON market_types(code);
CREATE INDEX idx_market_types_category ON market_types(category);
CREATE INDEX idx_market_types_display_order ON market_types(display_order);

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Odds storage - only normalized markets
CREATE TABLE odds (
  id BIGSERIAL PRIMARY KEY,
  
  -- Match identification
  match_id TEXT NOT NULL,              -- Format: league:home_norm:away_norm
  league_slug TEXT NOT NULL,
  home_team TEXT NOT NULL,             -- Canonical name
  away_team TEXT NOT NULL,             -- Canonical name
  
  -- Source
  bookmaker TEXT NOT NULL,
  event_url TEXT,
  
  -- Market identification (links to market_types)
  market_type_id INTEGER NOT NULL REFERENCES market_types(id),
  market_key TEXT NOT NULL,            -- Unique key: TYPE:param (e.g., TOTAL_GOALS:2.5)
  param_value TEXT,                    -- Parameter if applicable (2.5, -1.0, player name)
  
  -- Odds data (JSONB for flexibility)
  selections JSONB NOT NULL,           -- [{name, normalizedName, odds}]
  
  -- Metadata
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT odds_unique_entry UNIQUE (match_id, bookmaker, market_key, scraped_at)
);

-- Indexes for common queries
CREATE INDEX idx_odds_match_id ON odds(match_id);
CREATE INDEX idx_odds_league ON odds(league_slug);
CREATE INDEX idx_odds_bookmaker ON odds(bookmaker);
CREATE INDEX idx_odds_market_type_id ON odds(market_type_id);
CREATE INDEX idx_odds_market_key ON odds(market_key);
CREATE INDEX idx_odds_scraped_at ON odds(scraped_at DESC);
CREATE INDEX idx_odds_match_market ON odds(match_id, market_key);

-- Composite index for full offer queries
CREATE INDEX idx_odds_match_league_scraped ON odds(match_id, league_slug, scraped_at DESC);

-- ============================================================================
-- SCRAPER MONITORING
-- ============================================================================

CREATE TABLE scraper_runs (
  id BIGSERIAL PRIMARY KEY,
  bookmaker TEXT NOT NULL,
  league_slug TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',  -- running, success, error
  matches_found INTEGER DEFAULT 0,
  markets_saved INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER
);

CREATE INDEX idx_scraper_runs_bookmaker ON scraper_runs(bookmaker);
CREATE INDEX idx_scraper_runs_league ON scraper_runs(league_slug);
CREATE INDEX idx_scraper_runs_started ON scraper_runs(started_at DESC);
CREATE INDEX idx_scraper_runs_status ON scraper_runs(status);

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Latest odds per market (deduped by most recent scrape)
CREATE VIEW latest_odds AS
SELECT DISTINCT ON (match_id, bookmaker, market_key)
  o.*,
  mt.code AS market_code,
  mt.name_pl AS market_name_pl,
  mt.name_en AS market_name_en,
  mt.view_type,
  mt.category,
  mt.has_parameter,
  mt.selections AS expected_selections
FROM odds o
JOIN market_types mt ON o.market_type_id = mt.id
ORDER BY match_id, bookmaker, market_key, scraped_at DESC;

-- Market comparison view (for comparing odds across bookmakers)
CREATE VIEW market_comparison AS
SELECT 
  lo.match_id,
  lo.league_slug,
  lo.home_team,
  lo.away_team,
  lo.market_key,
  lo.market_type_id,
  lo.market_code,
  lo.market_name_pl,
  lo.market_name_en,
  lo.view_type,
  lo.category,
  lo.param_value,
  lo.bookmaker,
  lo.selections,
  lo.event_url,
  lo.scraped_at
FROM latest_odds lo
ORDER BY lo.match_id, lo.category, lo.market_key, lo.bookmaker;

-- Matches with odds summary
CREATE VIEW matches_with_odds AS
SELECT 
  match_id,
  league_slug,
  home_team,
  away_team,
  COUNT(DISTINCT bookmaker) AS bookmaker_count,
  COUNT(DISTINCT market_key) AS market_count,
  MAX(scraped_at) AS last_updated,
  array_agg(DISTINCT bookmaker) AS bookmakers
FROM latest_odds
GROUP BY match_id, league_slug, home_team, away_team;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Get best odds for a market across all bookmakers
CREATE OR REPLACE FUNCTION get_best_odds(p_match_id TEXT, p_market_key TEXT)
RETURNS TABLE (
  selection_name TEXT,
  best_odds NUMERIC,
  bookmaker TEXT,
  all_odds JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH odds_expanded AS (
    SELECT 
      lo.bookmaker,
      sel->>'name' AS sel_name,
      sel->>'normalizedName' AS sel_normalized,
      (sel->>'odds')::NUMERIC AS odds_value
    FROM latest_odds lo,
    LATERAL jsonb_array_elements(lo.selections) AS sel
    WHERE lo.match_id = p_match_id AND lo.market_key = p_market_key
  ),
  best AS (
    SELECT 
      COALESCE(sel_normalized, sel_name) AS selection_name,
      MAX(odds_value) AS best_odds
    FROM odds_expanded
    GROUP BY COALESCE(sel_normalized, sel_name)
  )
  SELECT 
    b.selection_name,
    b.best_odds,
    (SELECT oe.bookmaker FROM odds_expanded oe 
     WHERE COALESCE(oe.sel_normalized, oe.sel_name) = b.selection_name 
     AND oe.odds_value = b.best_odds LIMIT 1) AS bookmaker,
    (SELECT jsonb_agg(jsonb_build_object('bookmaker', oe.bookmaker, 'odds', oe.odds_value))
     FROM odds_expanded oe 
     WHERE COALESCE(oe.sel_normalized, oe.sel_name) = b.selection_name) AS all_odds
  FROM best b;
END;
$$ LANGUAGE plpgsql;

-- Clean up old odds data
CREATE OR REPLACE FUNCTION cleanup_old_odds(hours_to_keep INTEGER DEFAULT 24)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM odds 
  WHERE scraped_at < NOW() - (hours_to_keep || ' hours')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SEED DATA: 40 Canonical Market Types
-- ============================================================================

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order) VALUES
-- WYNIK MECZU (Match Result) - 3 markets
(1, 'MATCH_WINNER', 'Wynik meczu', 'Match Result', 'Obstawiasz kto wygra mecz (1X2)', 'Bet on match result (1X2)', 'TRIPLE_BUTTONS', 'WYNIK_MECZU', FALSE, NULL, ARRAY['HOME', 'DRAW', 'AWAY'], 1),
(2, 'DOUBLE_CHANCE', 'Podwójna szansa', 'Double Chance', 'Obstawiasz dwa możliwe wyniki (1X, X2, 12)', 'Bet on two possible outcomes', 'TRIPLE_BUTTONS', 'WYNIK_MECZU', FALSE, NULL, ARRAY['HOME_OR_DRAW', 'DRAW_OR_AWAY', 'HOME_OR_AWAY'], 2),
(3, 'DRAW_NO_BET', 'Remis bez zakładu', 'Draw No Bet', 'Przy remisie zwrot stawki', 'Stake returned if draw', 'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL, ARRAY['HOME', 'AWAY'], 3),

-- GOLE (Goals) - 11 markets
(4, 'TOTAL_GOALS', 'Liczba goli', 'Total Goals', 'Obstawiasz czy padnie więcej/mniej goli niż linia', 'Bet on total goals over/under a line', 'PARAMETER_SLIDER', 'GOLE', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 10),
(5, 'BTTS', 'Obie strzelą', 'Both Teams To Score', 'Czy obie drużyny strzelą gola?', 'Will both teams score?', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['YES', 'NO'], 11),
(6, 'ODD_EVEN_GOALS', 'Parzyste/Nieparzyste', 'Odd/Even Goals', 'Czy łączna liczba goli będzie parzysta czy nieparzysta?', 'Will total goals be odd or even?', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['ODD', 'EVEN'], 12),
(7, 'WIN_TO_NIL', 'Wygrana do zera', 'Win To Nil', 'Drużyna wygra nie tracąc gola', 'Team wins without conceding', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['HOME', 'AWAY'], 13),
(8, 'CLEAN_SHEET', 'Czyste konto', 'Clean Sheet', 'Drużyna nie straci gola', 'Team keeps clean sheet', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['HOME', 'AWAY'], 14),
(9, 'HOME_TEAM_TO_SCORE', 'Gospodarz strzeli', 'Home Team To Score', 'Czy drużyna gospodarzy strzeli gola?', 'Will home team score?', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['YES', 'NO'], 15),
(10, 'AWAY_TEAM_TO_SCORE', 'Gość strzeli', 'Away Team To Score', 'Czy drużyna gości strzeli gola?', 'Will away team score?', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['YES', 'NO'], 16),
(11, 'TEAM_TOTAL_GOALS', 'Gole drużyny', 'Team Total Goals', 'Liczba goli konkretnej drużyny', 'Goals scored by specific team', 'PARAMETER_SLIDER', 'GOLE', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 17),
(12, 'GOAL_RANGE', 'Przedział goli', 'Goal Range', 'W jakim przedziale będzie liczba goli?', 'Goal range bracket', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['0-1', '2-3', '4-5', '6+'], 18),
(13, 'BOTH_HALVES_GOALS', 'Gole w obu połowach', 'Goals In Both Halves', 'Czy padnie gol w obu połowach?', 'Will there be goals in both halves?', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['YES', 'NO'], 19),
(14, 'WINNING_MARGIN', 'Margines zwycięstwa', 'Winning Margin', 'Różnica bramek zwycięzcy', 'Winner''s goal difference', 'PARAMETER_SLIDER', 'GOLE', TRUE, 'integer', ARRAY['HOME', 'AWAY', 'DRAW'], 20),

-- HANDICAP - 2 markets
(15, 'ASIAN_HANDICAP', 'Handicap azjatycki', 'Asian Handicap', 'Wynik z uwzględnieniem przewagi/straty bramkowej', 'Result with goal advantage/disadvantage', 'HANDICAP_SELECTOR', 'HANDICAP', TRUE, 'handicap', ARRAY['HOME', 'AWAY'], 30),
(16, 'EUROPEAN_HANDICAP', 'Handicap europejski', 'European Handicap', 'Handicap z możliwością remisu', 'Handicap with draw option', 'HANDICAP_SELECTOR', 'HANDICAP', TRUE, 'handicap', ARRAY['HOME', 'DRAW', 'AWAY'], 31),

-- PIERWSZA POŁOWA (First/Second Half) - 5 markets
(17, 'HALF_TIME_RESULT', 'Wynik 1. połowy', 'Half Time Result', 'Wynik po pierwszej połowie', 'Result at half time', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['HOME', 'DRAW', 'AWAY'], 40),
(18, 'HALF_TIME_TOTAL_GOALS', 'Gole 1. połowy', 'Half Time Goals', 'Liczba goli w pierwszej połowie', 'Goals in first half', 'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 41),
(19, 'HALF_TIME_BTTS', 'BTTS 1. połowa', 'Half Time BTTS', 'Obie strzelą w pierwszej połowie', 'Both teams score in first half', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['YES', 'NO'], 42),
(20, 'SECOND_HALF_RESULT', 'Wynik 2. połowy', 'Second Half Result', 'Wynik drugiej połowy', 'Result of second half', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['HOME', 'DRAW', 'AWAY'], 43),
(21, 'SECOND_HALF_TOTAL_GOALS', 'Gole 2. połowy', 'Second Half Goals', 'Liczba goli w drugiej połowie', 'Goals in second half', 'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 44),

-- DOKŁADNY WYNIK (Correct Score) - 1 market
(22, 'CORRECT_SCORE', 'Dokładny wynik', 'Correct Score', 'Przewidywany dokładny wynik meczu', 'Exact final score prediction', 'SCORE_GRID', 'DOKLADNY_WYNIK', FALSE, NULL, ARRAY['SCORE'], 50),

-- ZAWODNICY (Players) - 6 markets
(23, 'GOALSCORER_FIRST', 'Pierwszy strzelec', 'First Goalscorer', 'Który zawodnik strzeli pierwszego gola?', 'Which player scores first?', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['PLAYER'], 60),
(24, 'GOALSCORER_LAST', 'Ostatni strzelec', 'Last Goalscorer', 'Który zawodnik strzeli ostatniego gola?', 'Which player scores last?', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['PLAYER'], 61),
(25, 'GOALSCORER_ANYTIME', 'Strzelec w meczu', 'Anytime Goalscorer', 'Zawodnik strzeli gola w meczu', 'Player scores anytime in match', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['PLAYER'], 62),
(26, 'PLAYER_SHOTS', 'Strzały zawodnika', 'Player Shots', 'Liczba strzałów zawodnika', 'Player shot count', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['OVER', 'UNDER'], 63),
(27, 'PLAYER_CARDS', 'Kartki zawodnika', 'Player Cards', 'Zawodnik otrzyma kartkę', 'Player receives card', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['YES', 'NO'], 64),
(28, 'PLAYER_ASSISTS', 'Asysty zawodnika', 'Player Assists', 'Zawodnik zaliczy asystę', 'Player provides assist', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['YES', 'NO'], 65),

-- STATYSTYKI (Statistics) - 6 markets
(29, 'CORNERS_TOTAL', 'Rzuty rożne', 'Total Corners', 'Łączna liczba rzutów rożnych', 'Total corners in match', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 70),
(30, 'CORNERS_TEAM', 'Rożne drużyny', 'Team Corners', 'Rzuty rożne konkretnej drużyny', 'Corners for specific team', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 71),
(31, 'CARDS_TOTAL', 'Kartki w meczu', 'Total Cards', 'Łączna liczba kartek', 'Total cards in match', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 72),
(32, 'CARDS_TEAM', 'Kartki drużyny', 'Team Cards', 'Kartki dla konkretnej drużyny', 'Cards for specific team', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 73),
(33, 'FOULS_TOTAL', 'Faule w meczu', 'Total Fouls', 'Łączna liczba fauli', 'Total fouls in match', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 74),
(34, 'OFFSIDES_TOTAL', 'Spalone w meczu', 'Total Offsides', 'Łączna liczba spalonych', 'Total offsides in match', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 75),

-- KOMBINACJE (Combinations) - 6 markets
(35, 'RESULT_AND_BTTS', 'Wynik + BTTS', 'Result & BTTS', 'Wynik meczu i czy obie strzelą', 'Match result and both teams score', 'COMBINATION', 'KOMBINACJE', FALSE, NULL, ARRAY['HOME_YES', 'HOME_NO', 'DRAW_YES', 'DRAW_NO', 'AWAY_YES', 'AWAY_NO'], 80),
(36, 'RESULT_AND_TOTAL', 'Wynik + Gole', 'Result & Total', 'Wynik meczu i liczba goli', 'Match result and total goals', 'COMBINATION', 'KOMBINACJE', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'DRAW_OVER', 'DRAW_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 81),
(37, 'HALFTIME_FULLTIME', 'Przerwa/Koniec', 'HT/FT', 'Wynik w przerwie i na koniec meczu', 'Half time and full time result', 'HALFTIME_FULLTIME', 'KOMBINACJE', FALSE, NULL, ARRAY['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'], 82),
(38, 'DOUBLE_RESULT', 'Podwójny wynik', 'Double Result', 'Kto prowadzi w dwóch punktach czasowych', 'Who leads at two time points', 'HALFTIME_FULLTIME', 'KOMBINACJE', FALSE, NULL, ARRAY['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'], 83),
(39, 'DOUBLE_CHANCE_BTTS', 'Podwójna szansa + BTTS', 'Double Chance & BTTS', 'Podwójna szansa i obie strzelą', 'Double chance and both teams score', 'COMBINATION', 'KOMBINACJE', FALSE, NULL, ARRAY['1X_YES', '1X_NO', 'X2_YES', 'X2_NO', '12_YES', '12_NO'], 84),
(40, 'DOUBLE_CHANCE_TOTAL', 'Podwójna szansa + Gole', 'Double Chance & Total', 'Podwójna szansa i liczba goli', 'Double chance and total goals', 'COMBINATION', 'KOMBINACJE', TRUE, 'decimal', ARRAY['1X_OVER', '1X_UNDER', 'X2_OVER', 'X2_UNDER', '12_OVER', '12_UNDER'], 85);

-- ============================================================================
-- PERMISSIONS (for Supabase)
-- ============================================================================

-- Grant access to authenticated users (if using Supabase Auth)
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
-- GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Service role has full access by default
