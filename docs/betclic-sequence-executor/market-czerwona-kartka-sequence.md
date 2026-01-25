# Czerwona kartka - Normalization Sequence

## Market Details
- **Betclic name:** Czerwona kartka
- **Group:** Kartki (subca_ftb_crd)
- **Tab:** STATYSTYKI
- **Match ID:** 905675314241536 (Manchester City - Wolverhampton)

## Sequence Execution

### Step 1: Market Normalization
**Initial State:**
- Market was normalized to OTHER (unmapped)
- No existing RED_CARD code in market-catalog.ts

**Action Taken:**
- Ran betclic-normalizer agent to add RED_CARD market type
- Added mapping: `"czerwona kartka": "RED_CARD"` to BETCLIC_MARKET_NAME_TO_CODE

**Result:**
- ✅ Market correctly normalized to RED_CARD
- ✅ Expected selections: [YES, NO]

### Step 2: Selections Verification
**Raw selections:**
- "Tak" (4.90) → YES
- "Nie" (1.08) → NO

**Result:**
- ✅ All selections correctly mapped using normalizeYesNoSelection() helper
- ✅ Tak → YES, Nie → NO

### Step 3: View Type Verification
**ViewType:** BINARY_BUTTONS
**Parameters:** None (binary market)

**Verification:**
- ✅ All selections [YES, NO] are supported by BINARY_BUTTONS
- ✅ 100% compatibility

## Changes Made

### Files Modified:

1. **backend/src/services/normalization/types.ts**
   - Added `RED_CARD: "RED_CARD"` to NormalizedMarketType enum

2. **backend/src/data/market-catalog.ts**
   - Added complete RED_CARD market definition:
     ```typescript
     {
       numericId: 273,
       code: "RED_CARD",
       slug: "red-card",
       category: MarketCategory.STATYSTYKI,
       labels: { pl: "Czerwona kartka", en: "Red Card" },
       descriptions: { pl: "Czy w meczu będzie czerwona kartka?", en: "Will there be a red card in the match?" },
       selections: ["YES", "NO"],
       viewType: ViewType.BINARY_BUTTONS,
       displayOrder: 82
     }
     ```

3. **backend/src/services/normalization/bookmakers/betclic-normalizer.ts**
   - Added `"czerwona kartka": "RED_CARD"` to BETCLIC_MARKET_NAME_TO_CODE
   - Added RED_CARD case to normalizeSelectionForMarket() function

## Validation
- ✅ TypeScript compilation successful
- ✅ Discovery script shows correct normalization
- ✅ View type verified by betclic-view-type-checker agent

## Final State
Market "Czerwona kartka" is now fully normalized and ready for frontend display with BINARY_BUTTONS view type.
