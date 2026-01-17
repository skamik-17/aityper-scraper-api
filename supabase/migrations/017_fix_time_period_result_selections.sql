-- Normalize TIME_PERIOD_RESULT selections: "1"->HOME, "X"->DRAW, "2"->AWAY

UPDATE odds
SET selections = (
  SELECT jsonb_agg(
    CASE 
      WHEN elem->>'normalizedName' = '1' THEN 
        jsonb_set(elem, '{normalizedName}', '"HOME"')
      WHEN elem->>'normalizedName' = 'X' THEN 
        jsonb_set(elem, '{normalizedName}', '"DRAW"')
      WHEN elem->>'normalizedName' = '2' THEN 
        jsonb_set(elem, '{normalizedName}', '"AWAY"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements(selections) AS elem
)
WHERE market_type_id = 48
  AND EXISTS (
    SELECT 1 
    FROM jsonb_array_elements(selections) AS elem
    WHERE elem->>'normalizedName' IN ('1', 'X', '2')
  );
