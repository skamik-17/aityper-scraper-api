-- Add custom_name column to odds table for team-specific market labels
-- This allows bookmaker normalizers to provide custom labels for markets like RED_CARD_TEAM
-- Example: "Czerwona kartka - Arsenal" instead of just "Czerwona kartka drużyny"

ALTER TABLE odds ADD COLUMN IF NOT EXISTS custom_name TEXT;

-- Update latest_odds view to include custom_name
CREATE OR REPLACE VIEW latest_odds AS
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
  o.custom_name,
  o.selections,
  o.scraped_at,
  mt.code AS market_code,
  COALESCE(o.custom_name, mt.name_pl) AS market_name_pl,
  COALESCE(o.custom_name, mt.name_en) AS market_name_en,
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

-- Update market_comparison view to use custom_name
CREATE OR REPLACE VIEW market_comparison AS
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
