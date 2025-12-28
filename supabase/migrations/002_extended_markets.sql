-- Extended markets schema for AITyper
-- Adds support for Double Chance, Over/Under, and BTTS markets

-- ============================================
-- Table: odds_double_chance
-- Stores Double Chance odds (1X, X2, 12)
-- ============================================
CREATE TABLE IF NOT EXISTS odds_double_chance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Match identification (same pattern as scraped_odds)
  league_slug TEXT NOT NULL DEFAULT 'ekstraklasa',
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_team_normalized TEXT NOT NULL,
  away_team_normalized TEXT NOT NULL,

  -- Bookmaker and odds
  bookmaker TEXT NOT NULL,
  home_or_draw DECIMAL(6,3),  -- 1X
  draw_or_away DECIMAL(6,3),  -- X2
  home_or_away DECIMAL(6,3),  -- 12

  -- Metadata
  event_url TEXT,

  -- Timestamps
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per match/bookmaker/scrape time
  UNIQUE(league_slug, home_team_normalized, away_team_normalized, bookmaker, scraped_at)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dc_league ON odds_double_chance(league_slug);
CREATE INDEX IF NOT EXISTS idx_dc_bookmaker ON odds_double_chance(bookmaker);
CREATE INDEX IF NOT EXISTS idx_dc_scraped_at ON odds_double_chance(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_dc_teams ON odds_double_chance(home_team_normalized, away_team_normalized);

-- ============================================
-- Table: odds_over_under
-- Stores Over/Under odds for various lines
-- ============================================
CREATE TABLE IF NOT EXISTS odds_over_under (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Match identification
  league_slug TEXT NOT NULL DEFAULT 'ekstraklasa',
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_team_normalized TEXT NOT NULL,
  away_team_normalized TEXT NOT NULL,

  -- Bookmaker and odds
  bookmaker TEXT NOT NULL,
  line DECIMAL(3,1) NOT NULL,  -- 0.5, 1.5, 2.5, 3.5, 4.5, 5.5
  over_odds DECIMAL(6,3),
  under_odds DECIMAL(6,3),

  -- Metadata
  event_url TEXT,

  -- Timestamps
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per match/bookmaker/line/scrape time
  UNIQUE(league_slug, home_team_normalized, away_team_normalized, bookmaker, line, scraped_at)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ou_league ON odds_over_under(league_slug);
CREATE INDEX IF NOT EXISTS idx_ou_bookmaker ON odds_over_under(bookmaker);
CREATE INDEX IF NOT EXISTS idx_ou_scraped_at ON odds_over_under(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_ou_teams ON odds_over_under(home_team_normalized, away_team_normalized);
CREATE INDEX IF NOT EXISTS idx_ou_line ON odds_over_under(line);

-- ============================================
-- Table: odds_btts
-- Stores Both Teams To Score odds
-- ============================================
CREATE TABLE IF NOT EXISTS odds_btts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Match identification
  league_slug TEXT NOT NULL DEFAULT 'ekstraklasa',
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_team_normalized TEXT NOT NULL,
  away_team_normalized TEXT NOT NULL,

  -- Bookmaker and odds
  bookmaker TEXT NOT NULL,
  yes_odds DECIMAL(6,3),
  no_odds DECIMAL(6,3),

  -- Metadata
  event_url TEXT,

  -- Timestamps
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per match/bookmaker/scrape time
  UNIQUE(league_slug, home_team_normalized, away_team_normalized, bookmaker, scraped_at)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_btts_league ON odds_btts(league_slug);
CREATE INDEX IF NOT EXISTS idx_btts_bookmaker ON odds_btts(bookmaker);
CREATE INDEX IF NOT EXISTS idx_btts_scraped_at ON odds_btts(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_btts_teams ON odds_btts(home_team_normalized, away_team_normalized);

-- ============================================
-- Views: Latest extended odds
-- Returns only the most recent odds per match/bookmaker
-- ============================================

CREATE OR REPLACE VIEW latest_double_chance AS
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY league_slug, home_team_normalized, away_team_normalized, bookmaker
      ORDER BY scraped_at DESC
    ) as rn
  FROM odds_double_chance
  WHERE scraped_at > NOW() - INTERVAL '2 hours'
)
SELECT id, league_slug, home_team, away_team, home_team_normalized, away_team_normalized,
       bookmaker, home_or_draw, draw_or_away, home_or_away, event_url, scraped_at
FROM ranked WHERE rn = 1;

CREATE OR REPLACE VIEW latest_over_under AS
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY league_slug, home_team_normalized, away_team_normalized, bookmaker, line
      ORDER BY scraped_at DESC
    ) as rn
  FROM odds_over_under
  WHERE scraped_at > NOW() - INTERVAL '2 hours'
)
SELECT id, league_slug, home_team, away_team, home_team_normalized, away_team_normalized,
       bookmaker, line, over_odds, under_odds, event_url, scraped_at
FROM ranked WHERE rn = 1;

CREATE OR REPLACE VIEW latest_btts AS
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY league_slug, home_team_normalized, away_team_normalized, bookmaker
      ORDER BY scraped_at DESC
    ) as rn
  FROM odds_btts
  WHERE scraped_at > NOW() - INTERVAL '2 hours'
)
SELECT id, league_slug, home_team, away_team, home_team_normalized, away_team_normalized,
       bookmaker, yes_odds, no_odds, event_url, scraped_at
FROM ranked WHERE rn = 1;

-- ============================================
-- Row Level Security (RLS)
-- ============================================
ALTER TABLE odds_double_chance ENABLE ROW LEVEL SECURITY;
ALTER TABLE odds_over_under ENABLE ROW LEVEL SECURITY;
ALTER TABLE odds_btts ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public read odds_double_chance" ON odds_double_chance
  FOR SELECT USING (true);
CREATE POLICY "Public read odds_over_under" ON odds_over_under
  FOR SELECT USING (true);
CREATE POLICY "Public read odds_btts" ON odds_btts
  FOR SELECT USING (true);

-- Service role full access
CREATE POLICY "Service role full access odds_double_chance" ON odds_double_chance
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access odds_over_under" ON odds_over_under
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access odds_btts" ON odds_btts
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Update cleanup function
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_old_odds() RETURNS void AS $$
BEGIN
  -- Delete 1X2 odds older than 24 hours
  DELETE FROM scraped_odds WHERE scraped_at < NOW() - INTERVAL '24 hours';

  -- Delete extended market odds older than 24 hours
  DELETE FROM odds_double_chance WHERE scraped_at < NOW() - INTERVAL '24 hours';
  DELETE FROM odds_over_under WHERE scraped_at < NOW() - INTERVAL '24 hours';
  DELETE FROM odds_btts WHERE scraped_at < NOW() - INTERVAL '24 hours';

  -- Delete scraper runs older than 7 days
  DELETE FROM scraper_runs WHERE started_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE odds_double_chance IS 'Double Chance market odds (1X, X2, 12)';
COMMENT ON TABLE odds_over_under IS 'Over/Under market odds for various lines';
COMMENT ON TABLE odds_btts IS 'Both Teams To Score market odds';
COMMENT ON VIEW latest_double_chance IS 'Most recent Double Chance odds per match/bookmaker';
COMMENT ON VIEW latest_over_under IS 'Most recent Over/Under odds per match/bookmaker/line';
COMMENT ON VIEW latest_btts IS 'Most recent BTTS odds per match/bookmaker';
