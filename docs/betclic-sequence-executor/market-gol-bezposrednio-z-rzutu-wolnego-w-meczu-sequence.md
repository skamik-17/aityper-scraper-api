# Market Sequence: Gol bezpośrednio z rzutu wolnego w meczu

## Summary
Market "Gol bezpośrednio z rzutu wolnego w meczu" został pomyślnie znormalizowany jako `FREE_KICK_GOAL` z nowym view type `SINGLE_SELECTION`.

## Steps Performed

### Step 1: Market Normalization
**Problem:** Market zmapował się na `OTHER` (niezmapowany).

**Solution:**
- Dodano mapowanie w `betclic-normalizer.ts`:
  ```typescript
  "gol bezposrednio z rzutu wolnego w meczu": "FREE_KICK_GOAL"
  ```
- Market `FREE_KICK_GOAL` (numericId: 268) już istniał w market-catalog.ts

### Step 2: Selection Mapping
**Result:** Selection "Tak" correctly mapped to "YES" ✅
- Normalizacja selekcji działała poprawnie z default mapping
- No changes needed

### Step 3: View Type Implementation

**Problem 1:** Market ma tylko jedną selekcję "Tak", ale `BINARY_BUTTONS` wymaga minimum 2 selekcji.

**Solution:**
1. Added new ViewType `SINGLE_SELECTION` to:
   - `/workspace/backend/src/services/normalization/types.ts`
   - `/workspace/src/types/normalized-markets.ts`

2. Created component `/workspace/src/components/markets/bet-views/SingleSelection.tsx`:
   - Based on BinaryButtons pattern
   - Renders single button for markets with only YES selection
   - Includes proper null checks for parameter data

3. Updated `/workspace/src/components/markets/bet-views/MarketBetRenderer.tsx`:
   - Added case for `ViewType.SINGLE_SELECTION`

4. Updated `FREE_KICK_GOAL` in `market-catalog.ts`:
   - Changed `viewType` from `BINARY_BUTTONS` to `SINGLE_SELECTION`
   - Updated `selections` to `["YES"]` (removed "NO")
   - Updated `selectionOrder` to `["YES"]`

**Problem 2:** `parameters: []` was empty, causing SingleSelection component to return null.

**Solution:**
Modified `/workspace/backend/src/services/market-type-grouper.ts`:
- Added logic to create `parameters[0]` for markets with `viewType === "SINGLE_SELECTION"`
- Set `hasParameters: true` for SINGLE_SELECTION markets
- Format includes bookmaker data with YES selection and odds

**Verification:** View type checker confirmed 100% compatibility ✅

## Discovery Output

**Market:** Gol bezpośrednio z rzutu wolnego w meczu
**Normalized:** FREE_KICK_GOAL
**Tab:** METODA_GOLA
**Group:** Rzuty wolne (subca_ftb_frk)
**ViewType:** SINGLE_SELECTION
**Selection:** Tak → YES (odds: 8.00)

## Final Frontend JSON
```json
{
  "marketKey": "FREE_KICK_GOAL",
  "type": "FREE_KICK_GOAL",
  "category": "GOLE",
  "label": "Gol bezpośrednio z rzutu wolnego",
  "description": "Czy w meczu padnie gol bezpośrednio z rzutu wolnego?",
  "displayOrder": 26,
  "viewType": "SINGLE_SELECTION",
  "parameters": [
    {
      "value": "base",
      "label": "",
      "bookmakers": [
        {
          "bookmaker": "betclic",
          "bookmakerName": "betclic",
          "selections": [
            {
              "type": "YES",
              "odds": 8,
              "hasNoTaxPromo": false
            }
          ]
        }
      ]
    }
  ],
  "defaultParameter": "base",
  "hasParameters": true
}
```

## Files Modified
1. `backend/src/services/normalization/bookmakers/betclic-normalizer.ts`
2. `backend/src/data/market-catalog.ts`
3. `backend/src/services/normalization/types.ts`
4. `src/types/normalized-markets.ts`
5. `src/components/markets/bet-views/SingleSelection.tsx` (NEW)
6. `src/components/markets/bet-views/MarketBetRenderer.tsx`
7. `backend/src/services/market-type-grouper.ts`

## Notes
- This market is binary (YES-only) with high odds (typically 8.00+)
- SINGLE_SELECTION view type can be reused for other markets like HEADER_GOAL, OWN_GOAL, etc.
- Normalization handles markets with hasParameters=false by creating parameters[0] internally
