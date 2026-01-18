-- Update PLAYER_SHOTS_ON_TARGET selections to include threshold values
-- Market ID 1852 from STS uses 1+, 2+, 3+, 4+, 5+ selections

UPDATE market_types
SET 
  selections = ARRAY['OVER', 'UNDER', '1+', '2+', '3+', '4+', '5+'],
  view_type = 'PLAYER_STAT_LINES'
WHERE code = 'PLAYER_SHOTS_ON_TARGET';
