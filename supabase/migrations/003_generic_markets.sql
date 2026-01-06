-- Generic Markets Schema for AITyper
-- Replaces specific market tables (Double Chance, Over/Under, BTTS)
-- with a unified JSONB-based structure for full offer scraping

-- ============================================
-- Drop old extended market views and tables
-- ============================================
DROP VIEW IF EXISTS latest_double_chance;
DROP VIEW IF EXISTS latest_over_under;
DROP VIEW IF EXISTS latest_btts;

DROP TABLE IF EXISTS odds_double_chance;
DROP TABLE IF EXISTS odds_over_under;
DROP TABLE IF EXISTS odds_btts;

-- ============================================
-- Table: scraped_market_groups
-- Organizes markets into UI groups (e.g., "Goals", "1st Half")
-- ============================================
CREATE TABLE IF NOT EXISTS scraped_market_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Match and bookmaker identification
  match_id TEXT NOT NULL,           -- Normalized match identifier
  bookmaker TEXT NOT NULL,

  -- Group info
  name TEXT NOT NULL,               -- "Main", "Goals", "1st Half", "Corners"
  display_order INT DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per match/bookmaker/group
  UNIQUE(match_id, bookmaker, name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_market_groups_match ON scraped_market_groups(match_id);
CREATE INDEX IF NOT EXISTS idx_market_groups_bookmaker ON scraped_market_groups(bookmaker);

-- ============================================
-- Table: scraped_markets
-- Generic market storage with JSONB selections
-- ============================================
CREATE TABLE IF NOT EXISTS scraped_markets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Match identification
  match_id TEXT NOT NULL,           -- Normalized match identifier
  league_slug TEXT NOT NULL DEFAULT 'ekstraklasa',
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_team_normalized TEXT NOT NULL,
  away_team_normalized TEXT NOT NULL,

  -- Bookmaker and group
  bookmaker TEXT NOT NULL,
  group_id UUID REFERENCES scraped_market_groups(id) ON DELETE SET NULL,

  -- Market info
  external_id TEXT,                 -- Bookmaker's internal market ID
  name TEXT NOT NULL,               -- "Match Winner", "Total Goals 2.5"
  normalized_type TEXT DEFAULT 'UNKNOWN', -- "1X2", "OVER_UNDER", "BTTS", "DOUBLE_CHANCE"

  -- Core data: JSONB array of selections
  -- Format: [{"name": "Over 2.5", "odds": 1.85, "externalId": "abc123", "status": "active"}]
  selections JSONB NOT NULL,

  -- Metadata
  event_url TEXT,

  -- Timestamps
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per match/bookmaker/market/scrape time
  UNIQUE(match_id, bookmaker, name, scraped_at)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_markets_match_bookmaker ON scraped_markets(match_id, bookmaker);
CREATE INDEX IF NOT EXISTS idx_markets_league ON scraped_markets(league_slug);
CREATE INDEX IF NOT EXISTS idx_markets_scraped_at ON scraped_markets(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_markets_normalized_type ON scraped_markets(normalized_type);
CREATE INDEX IF NOT EXISTS idx_markets_teams ON scraped_markets(home_team_normalized, away_team_normalized);

-- GIN index for JSONB selections (enables efficient querying of nested data)
CREATE INDEX IF NOT EXISTS idx_markets_selections ON scraped_markets USING GIN (selections);

-- ============================================
-- View: latest_markets
-- Returns only the most recent markets per match/bookmaker/market
-- ============================================
CREATE OR REPLACE VIEW latest_markets AS
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY match_id, bookmaker, name
      ORDER BY scraped_at DESC
    ) as rn
  FROM scraped_markets
  WHERE scraped_at > NOW() - INTERVAL '2 hours'
)
SELECT id, match_id, league_slug, home_team, away_team, home_team_normalized, away_team_normalized,
       bookmaker, group_id, external_id, name, normalized_type, selections, event_url, scraped_at
FROM ranked WHERE rn = 1;

-- ============================================
-- View: latest_markets_by_type
-- Returns latest markets grouped by normalized type
-- ============================================
CREATE OR REPLACE VIEW latest_markets_by_type AS
SELECT
  match_id,
  league_slug,
  home_team,
  away_team,
  bookmaker,
  normalized_type,
  name,
  selections,
  scraped_at
FROM latest_markets
ORDER BY match_id, bookmaker, normalized_type, name;

-- ============================================
-- Row Level Security (RLS)
-- ============================================
ALTER TABLE scraped_market_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraped_markets ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public read scraped_market_groups" ON scraped_market_groups
  FOR SELECT USING (true);
CREATE POLICY "Public read scraped_markets" ON scraped_markets
  FOR SELECT USING (true);

-- Service role full access
CREATE POLICY "Service role full access scraped_market_groups" ON scraped_market_groups
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access scraped_markets" ON scraped_markets
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Update cleanup function
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_old_odds() RETURNS void AS $$
BEGIN
  -- Delete 1X2 odds older than 24 hours
  DELETE FROM scraped_odds WHERE scraped_at < NOW() - INTERVAL '24 hours';

  -- Delete generic markets older than 24 hours
  DELETE FROM scraped_markets WHERE scraped_at < NOW() - INTERVAL '24 hours';

  -- Delete orphaned market groups (no markets reference them)
  DELETE FROM scraped_market_groups
  WHERE id NOT IN (SELECT DISTINCT group_id FROM scraped_markets WHERE group_id IS NOT NULL);

  -- Delete scraper runs older than 7 days
  DELETE FROM scraper_runs WHERE started_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Helper function: Get all markets for a match
-- ============================================
CREATE OR REPLACE FUNCTION get_match_markets(
  p_match_id TEXT,
  p_bookmaker TEXT DEFAULT NULL
) RETURNS TABLE (
  id UUID,
  bookmaker TEXT,
  group_name TEXT,
  market_name TEXT,
  normalized_type TEXT,
  selections JSONB,
  scraped_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.bookmaker,
    g.name as group_name,
    m.name as market_name,
    m.normalized_type,
    m.selections,
    m.scraped_at
  FROM latest_markets m
  LEFT JOIN scraped_market_groups g ON m.group_id = g.id
  WHERE m.match_id = p_match_id
    AND (p_bookmaker IS NULL OR m.bookmaker = p_bookmaker)
  ORDER BY g.display_order, m.name;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Helper function: Get market count per match
-- ============================================
CREATE OR REPLACE FUNCTION get_market_counts(
  p_league_slug TEXT DEFAULT NULL
) RETURNS TABLE (
  match_id TEXT,
  home_team TEXT,
  away_team TEXT,
  bookmaker TEXT,
  market_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.match_id,
    m.home_team,
    m.away_team,
    m.bookmaker,
    COUNT(*) as market_count
  FROM latest_markets m
  WHERE p_league_slug IS NULL OR m.league_slug = p_league_slug
  GROUP BY m.match_id, m.home_team, m.away_team, m.bookmaker
  ORDER BY m.match_id, m.bookmaker;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE scraped_market_groups IS 'Market group organization for UI display';
COMMENT ON TABLE scraped_markets IS 'Generic market storage with JSONB selections - replaces specific market tables';
COMMENT ON COLUMN scraped_markets.selections IS 'JSONB array: [{"name": "Over 2.5", "odds": 1.85, "externalId": "abc", "status": "active"}]';
COMMENT ON COLUMN scraped_markets.normalized_type IS 'Normalized market type: 1X2, OVER_UNDER, BTTS, DOUBLE_CHANCE, HANDICAP, CORNERS, etc.';
COMMENT ON VIEW latest_markets IS 'Most recent markets per match/bookmaker/market name';
COMMENT ON VIEW latest_markets_by_type IS 'Latest markets organized by normalized type for comparison';
COMMENT ON FUNCTION get_match_markets IS 'Get all markets for a specific match, optionally filtered by bookmaker';
COMMENT ON FUNCTION get_market_counts IS 'Get market counts per match/bookmaker for monitoring';
