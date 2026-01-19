CREATE TABLE odds (
  id BIGSERIAL PRIMARY KEY,
  match_id TEXT NOT NULL,
  league_slug TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  bookmaker TEXT NOT NULL,
  event_url TEXT,
  market_type_id INTEGER NOT NULL REFERENCES market_types(id),
  market_key TEXT NOT NULL,
  param_value TEXT,
  selections JSONB NOT NULL,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT odds_unique_entry UNIQUE (match_id, bookmaker, market_key, scraped_at)
);

CREATE INDEX idx_odds_match_id ON odds(match_id);
CREATE INDEX idx_odds_league ON odds(league_slug);
CREATE INDEX idx_odds_bookmaker ON odds(bookmaker);
CREATE INDEX idx_odds_market_type_id ON odds(market_type_id);
CREATE INDEX idx_odds_market_key ON odds(market_key);
CREATE INDEX idx_odds_scraped_at ON odds(scraped_at DESC);
CREATE INDEX idx_odds_match_market ON odds(match_id, market_key);
CREATE INDEX idx_odds_match_league_scraped ON odds(match_id, league_slug, scraped_at DESC);

CREATE VIEW latest_odds AS
SELECT 
  o.id,
  o.match_id,
  o.league_slug,
  o.home_team,
  o.away_team,
  o.bookmaker,
  o.event_url,
  o.market_type_id,
  o.market_key,
  o.param_value,
  o.selections,
  o.scraped_at,
  mt.code AS market_code,
  mt.name_pl AS market_name_pl,
  mt.name_en AS market_name_en,
  mt.view_type,
  mt.category,
  mt.has_parameter,
  mt.selections AS expected_selections
FROM (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY match_id, bookmaker, market_key 
      ORDER BY scraped_at DESC
    ) AS rn
  FROM odds
) o
JOIN market_types mt ON o.market_type_id = mt.id
WHERE o.rn = 1;

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
