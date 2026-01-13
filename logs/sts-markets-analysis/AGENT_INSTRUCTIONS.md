# STS Market Analysis - Agent Instructions

## Purpose

This document contains step-by-step instructions for an AI agent to systematically analyze and fix STS market normalization issues.

## Setup

### Key Files to Reference

| File | Purpose |
|------|---------|
| `backend/logs/sts-markets-analysis/PROGRESS.md` | Progress tracking |
| `backend/logs/sts-markets-analysis/_PRIORITY_OTHER_MARKETS.txt` | Markets needing work |
| `backend/src/services/normalization/bookmakers/sts-normalizer.ts` | STS market type mapping |
| `backend/src/scrapers/bookmakers/sts/outcome-map.ts` | Outcome ID to selection name |
| `backend/src/data/market-catalog.ts` | Market definitions and ViewTypes |
| `backend/src/services/normalization/types.ts` | Type definitions |
| `src/components/markets/bet-views/` | Frontend view components |

### Available ViewTypes

```typescript
ViewType = {
  BINARY_BUTTONS,      // 2 options: YES/NO, OVER/UNDER
  TRIPLE_BUTTONS,      // 3 options: HOME/DRAW/AWAY
  PARAMETER_SLIDER,    // Over/Under with line selection
  HANDICAP_SELECTOR,   // Handicap with +/- values
  SCORE_GRID,          // Correct score grid
  PLAYER_DROPDOWN,     // Player selector
  PLAYER_STAT_LINES,   // Player stats with thresholds
  STAT_RANGE,          // Statistics range
  COMBINATION,         // Combined markets (6 options)
  HALFTIME_FULLTIME,   // 9-outcome HT/FT grid
}
```

---

## Workflow Loop

For each market that needs work, follow these steps:

### Step 1: Check Progress File

Read `PROGRESS.md` and find the next uncompleted market (marked with `[ ]`).

### Step 2: Read Market Data

Read the relevant category file or `_PRIORITY_OTHER_MARKETS.txt` to understand:
- Market ID
- Polish name
- Current normalization status
- Number of selections
- Raw outcome IDs and names
- JSON structure

### Step 3: Analysis Checklist

For the selected market, verify:

#### 3.1 Normalization
- [ ] What is the canonical market type?
- [ ] Does it exist in `NormalizedMarketType` enum?
- [ ] If not, should we create a new type or map to existing?

#### 3.2 Selections
- [ ] How many selections does this market have?
- [ ] Are all outcome IDs properly mapped in `outcome-map.ts`?
- [ ] Do the selection names match expected format?
- [ ] Are the odds reasonable for each selection?

#### 3.3 View Type
- [ ] Which `ViewType` is most appropriate?
- [ ] Check `src/components/markets/bet-views/` to verify the component can handle this market
- [ ] Does the number of selections match the ViewType expectations?
  - `BINARY_BUTTONS`: 2 selections
  - `TRIPLE_BUTTONS`: 3-4 selections
  - `COMBINATION`: 6 selections
  - `HALFTIME_FULLTIME`: 9 selections
  - `SCORE_GRID`: Variable (grid of scores)

#### 3.4 Other Issues
- [ ] Are there any missing outcome mappings?
- [ ] Is the parameter extraction correct?
- [ ] Are there duplicate markets that should be consolidated?

### Step 4: Implement Changes

Based on analysis, modify the necessary files:

#### 4.1 Add to STS Normalizer

File: `backend/src/services/normalization/bookmakers/sts-normalizer.ts`

Add market ID to appropriate mapping array:
```typescript
private static MARKET_ID_TO_TYPE: Record<number, NormalizedMarketType> = {
  // ... existing mappings
  NEW_MARKET_ID: 'NEW_MARKET_TYPE',
};
```

#### 4.2 Add Outcome Mappings

File: `backend/src/scrapers/bookmakers/sts/outcome-map.ts`

Add new outcome ID mappings if needed:
```typescript
export const STS_OUTCOME_ID_TO_SELECTION: Record<number, string> = {
  // ... existing
  NEW_ID: "Selection Name",
};
```

#### 4.3 Add Market Catalog Entry

File: `backend/src/data/market-catalog.ts`

Add new market definition if it doesn't exist:
```typescript
{
  numericId: NEXT_ID,
  code: "NEW_MARKET_CODE",
  slug: "new-market-slug",
  category: MarketCategory.APPROPRIATE_CATEGORY,
  labels: { pl: "Polish Name", en: "English Name" },
  descriptions: { pl: "...", en: "..." },
  hasParameter: false, // or true
  selections: ["SEL1", "SEL2", ...],
  viewType: ViewType.APPROPRIATE_TYPE,
  displayOrder: XXX,
}
```

#### 4.4 Update Types (if new market type)

File: `backend/src/services/normalization/types.ts`

Add to `NormalizedMarketType`:
```typescript
NEW_MARKET_TYPE: "NEW_MARKET_TYPE",
```

### Step 5: Update Progress

Mark the task as completed in `PROGRESS.md`:
```markdown
- [x] Market ID XX: Name -> NEW_TYPE
```

Add entry to COMPLETED WORK LOG:
```markdown
| Date | Market ID | Change | Files Modified |
| 2026-01-13 | XX | Added NEW_TYPE mapping | sts-normalizer.ts, market-catalog.ts |
```

### Step 6: Repeat

Go back to Step 1 for the next market.

---

## Priority Market Quick Reference

### Easy Fixes (existing ViewTypes work)

| ID | Market | Suggested Type | ViewType |
|----|--------|----------------|----------|
| 1232 | 1. poł - Gość strzeli | HALF_TIME_AWAY_TO_SCORE | BINARY_BUTTONS |
| 1233 | 1. poł - Gospodarz strzeli | HALF_TIME_HOME_TO_SCORE | BINARY_BUTTONS |
| 1234 | 2. poł - Gość strzeli | SECOND_HALF_AWAY_TO_SCORE | BINARY_BUTTONS |
| 1235 | 2. poł - Gospodarz strzeli | SECOND_HALF_HOME_TO_SCORE | BINARY_BUTTONS |
| 98 | 1. poł - Wynik + BTTS | HALF_TIME_RESULT_AND_BTTS | COMBINATION |

### Medium Complexity

| ID | Market | Suggested Type | ViewType | Notes |
|----|--------|----------------|----------|-------|
| 1244 | Margines zwycięstwa (var5) | HT_OR_FT_RESULT | TRIPLE_BUTTONS | Actually "1. połowa lub wynik końcowy" |
| 816 | Multiwynik | MULTI_RESULT | COMBINATION? | 9 unique selections, may need new view |

### Complex (may need new ViewType)

| ID | Market | Selections | Notes |
|----|--------|------------|-------|
| 57 | HT/FT - Dokładny wynik | 46 | Score grid for HT/FT combo scores |
| 1012 | HT/FT + gole | 16 | HT/FT result + over/under 2.5 combo |

---

## Testing

After making changes:

1. Run tests: `cd backend && npm run test`
2. Run market discovery: `cd backend && npx tsx scripts/sts-market-discovery.ts laliga`
3. Verify the market is no longer mapped to OTHER

---

## Notes

- Always preserve existing mappings
- Use descriptive selection codes (HOME_YES, not HY)
- Match ViewType to selection count
- Consider frontend rendering when choosing ViewType
- Add Polish AND English labels for new markets
