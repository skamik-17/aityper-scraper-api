# Betclic Scraper

## Overview

The Betclic scraper is unique among all bookmaker scrapers in this project - it does **NOT** use traditional DOM scraping with Playwright. Instead, it communicates directly with Betclic's **gRPC-web API** using Protocol Buffers.

### Key Architecture Differences

| Aspect | Other Scrapers (e.g., STS, Fortuna) | Betclic |
|--------|-------------------------------------|---------|
| Data Source | DOM parsing or WebSocket | gRPC-web API |
| Transport | Playwright browser | Node.js HTTPS |
| Encoding | JSON/HTML | Protocol Buffers (binary) |
| Navigation | Page.goto(), click() | Direct HTTP POST |
| Browser needed | Yes | No (pure Node.js) |

## File Structure & Responsibilities

```
backend/src/scrapers/bookmakers/betclic/
├── index.ts          # Main scraper class - orchestrates fetch + parse
├── navigation.ts     # gRPC transport layer, request building
├── parser.ts         # Protobuf decoding, market extraction
├── constants.ts      # API config, field numbers, filter values
└── types.ts          # TypeScript interfaces
```

### Key Files to Modify

| Task | File | Notes |
|------|------|-------|
| Add new market group filter | `constants.ts` | Add to `MARKET_GROUP_FILTERS` |
| Change request structure | `navigation.ts` | `buildMatchDetailsRequestWithFilter()` |
| Fix parsing bugs | `parser.ts` | `parseAllMarketsFromProto()` |
| Add new market type inference | `parser.ts` | `inferMarketType()` |
| Update API headers | `constants.ts` | `GRPC_HEADERS` |

## gRPC-web Protocol Deep Dive

### Endpoint

```
POST https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService/GetMatchWithNotification
```

### Request Structure

The HTTP body is **base64-encoded** gRPC-web frames:

```
HTTP Body = Base64(Frame)
Frame = Flag[1 byte] + Length[4 bytes BE] + ProtobufMessage[N bytes]
Flag = 0x00 (uncompressed)
```

### Protobuf Message Structure

```protobuf
// Current implementation
message GetMatchRequest {
  uint64 match_id = 1;  // Tag 0x08 + BigVarint
}

// With filter (for multi-tab)
message GetMatchRequest {
  uint64 match_id = 1;      // Tag 0x08 + BigVarint
  uint32 market_group = 2;  // Tag 0x10 (discovered field)
}
```

### Response Structure

```
Field 1 (Root Wrapper)
└── Field 1 (Match Info)
│   ├── Field 1: Match ID (BigInt varint)
│   └── Field 2: Match Name (string "HomeTeam - AwayTeam")
└── Field 2 (Market Groups) [REPEATED]
    ├── Field 2: Group Name (string, e.g., "Wynik meczu")
    └── Fields 3-20: Nested Markets [REPEATED]
        ├── Field 2: Market Name (string)
        └── Field 16: Outcomes [REPEATED]
            ├── Field 10: Short Name (string)
            ├── Field 11: Long Name (string)
            └── Field 12: Odds (double, 8 bytes LE)
```

### Required Headers

```typescript
const GRPC_HEADERS = {
  "Content-Type": "application/grpc-web-text",
  "Accept": "application/grpc-web-text",
  "X-Grpc-Web": "1",
  "X-Bg-Ref-Brand": "BETCLIC",
  "X-Bg-Ref-Platform": "DESKTOP",
  "X-Bg-Ref-Regulator-Zone": "PL",
  "X-Bg-Regulation": "PL",
  "User-Agent": "...",
  "Origin": "https://www.betclic.pl",
  "Referer": "https://www.betclic.pl/"
};
```

**Important:** Missing `Origin`, `Referer`, or `User-Agent` will result in HTTP 403 from CloudFront protection.

## Multi-Tab Scraping Architecture

### Problem

Betclic's match page has 7 tabs, each showing different market categories:
- **Top** - Main/Popular markets
- **Wynik** - Result markets
- **Strzelcy** - Goalscorer markets
- **Gole** - Goal markets
- **Metoda Gola** - Goal method markets
- **Wynik/Handicap** - Result & Handicap markets
- **Statystyki** - Statistics markets

### Solution

Send multiple gRPC requests with different filter values and merge results.

### MARKET_GROUP_FILTERS

Located in `constants.ts`, these constants map tab names to Protobuf filter values:

```typescript
export const MARKET_GROUP_FILTERS = {
  /**
   * Tab 1: Top (Main/Popular)
   * Markets: 1X2, Double Chance, BTTS, popular O/U, Handicap, Correct Score
   */
  TOP: 0,

  /**
   * Tab 2: Wynik (Result)
   * Markets: 1X2, Draw No Bet, Double Chance, HT/FT, Win to Nil
   */
  WYNIK: 1,

  /**
   * Tab 3: Strzelcy (Scorers)
   * Markets: Anytime Scorer, First/Last Scorer, 2+ Goals Scorer, Assists
   */
  STRZELCY: 2,

  /**
   * Tab 4: Gole (Goals)
   * Markets: Total Goals O/U, Team Goals O/U, BTTS, Goal Ranges, Half Goals
   */
  GOLE: 3,

  /**
   * Tab 5: Metoda Gola (Goal Method)
   * Markets: Penalty Goal, Header Goal, Free Kick Goal
   */
  METODA_GOLA: 4,

  /**
   * Tab 6: Wynik / Handicap (Result / Handicap)
   * Markets: Asian Handicap, European Handicap, Correct Score, Goal Margin
   */
  HANDICAP: 5,

  /**
   * Tab 7: Statystyki (Statistics)
   * Markets: Corners, Cards, Shots, Fouls, Offsides
   */
  STATYSTYKI: 6,
} as const;
```

### Data Flow

```
scrapeFullOffer()
    │
    ▼
fetchAllMarketGroups(matchId)
    │
    ├─► buildMatchDetailsRequestWithFilter(matchId, FILTER_TOP)
    ├─► buildMatchDetailsRequestWithFilter(matchId, FILTER_WYNIK)
    ├─► buildMatchDetailsRequestWithFilter(matchId, FILTER_STRZELCY)
    ├─► ... (all 7 filters)
    │
    ▼
[Buffer[], Buffer[], ...]
    │
    ▼
parseAllMarketsFromMultipleResponses(responses)
    │
    ├─► parseAllMarketsFromProto(response1)
    ├─► parseAllMarketsFromProto(response2)
    ├─► ... (parse each)
    │
    ▼
deduplicate by (name + type)
    │
    ▼
ScrapedMarket[]
```

### Implementation Components

| Component | File | Function |
|-----------|------|----------|
| Filter constants | `constants.ts` | `MARKET_GROUP_FILTERS` |
| Filtered request builder | `navigation.ts` | `buildMatchDetailsRequestWithFilter()` |
| Multi-fetch | `navigation.ts` | `fetchAllMarketGroups()` |
| Response merger | `parser.ts` | `parseAllMarketsFromMultipleResponses()` |
| Scraper integration | `index.ts` | `scrapeFullOffer()` |

## Parsing Strategies

### Strategy 1: Structured Parsing (Primary)

Used in `parseAllMarketsFromProto()`:
- Traverses known field numbers from `PROTO_FIELDS`
- Extracts market groups from Field 2
- Parses nested markets from Fields 3-20
- Gets outcomes from Field 16

### Strategy 2: Outcome Scanning (Fallback)

Used in `extractAllOutcomes()`:
- Binary scan for odds values (8-byte doubles where tag = 0x61)
- Backwards search for names (tags 0x52, 0x5a)
- Pattern matching for valid odds range (1.01 - 100.0)
- Resilient to schema changes

## How to Add New Market Groups

### Step 1: Discover Filter Value

Use the discovery scripts to find the correct filter value:

```bash
# Method 1: Use tab sniffer with Playwright
npx tsx scripts/betclic-tab-sniffer.ts "https://www.betclic.pl/pilka-nozna-sfootball/..."

# Method 2: Brute force filter values
npx tsx scripts/betclic-filter-discovery.ts

# Method 3: Test specific filter value
npx tsx scripts/betclic-market-discovery.ts --filter 5 --match 905675290968064
```

### Step 2: Add to Constants

Add the new filter to `constants.ts`:

```typescript
export const MARKET_GROUP_FILTERS = {
  // existing entries...
  NEW_TAB: <discovered_value>,  // e.g., NEW_TAB: 7
} as const;
```

### Step 3: Update Market Type Inference (if needed)

If the new market group introduces new market types, update `inferMarketType()` in `parser.ts`:

```typescript
function inferMarketType(name: string): string {
  const lower = name.toLowerCase();

  // existing patterns...

  // Add new patterns
  if (lower.includes("nowy wzorzec")) {
    return MARKET_TYPES.NEW_MARKET;
  }

  return "OTHER";
}
```

### Step 4: Add Market Type Constant (if needed)

Add new market type to `MARKET_TYPES` in `constants.ts`:

```typescript
export const MARKET_TYPES = {
  // existing...
  NEW_MARKET: "NEW_MARKET",
} as const;
```

### Step 5: Test

```bash
# Test with the discovery script
npx tsx scripts/betclic-market-discovery.ts --multi

# Run integration test
npx tsx scripts/betclic-integration-test.ts

# Run unit tests
cd backend && npm run test -- betclic
```

## Diagnostic Scripts

### Market Discovery (PRIMARY TOOL)

```bash
# Create and use discovery script
cd backend && npx tsx scripts/betclic-market-discovery.ts

# With proto structure analysis
npx tsx scripts/betclic-market-discovery.ts --proto

# Test specific filter value
npx tsx scripts/betclic-market-discovery.ts --filter 5

# Multi-tab mode (fetch all 7 tabs)
npx tsx scripts/betclic-market-discovery.ts --multi

# Specific match
npx tsx scripts/betclic-market-discovery.ts --match 905675290968064
```

**Output:**
- Total markets count
- Markets grouped by type
- Markets grouped by groupName
- Missing expected market types
- Suspicious markets (type=OTHER)
- Protobuf structure (with `--proto` flag)
- Multi-tab deduplication stats (with `--multi` flag)

### Filter Discovery

```bash
# Brute force test different field/value combinations
cd backend && npx tsx scripts/betclic-filter-discovery.ts
```

Tests different field numbers (2-10) with values (0-20) to discover which field controls market group filtering.

### Integration Test

```bash
# Verify full offer scraping works correctly
cd backend && npx tsx scripts/betclic-integration-test.ts

# With verbose output for detailed analysis
npx tsx scripts/betclic-integration-test.ts --verbose
```

Verifies:
- At least one match is returned
- Each match has expected number of markets
- Presence of key market types (CORNERS, CARDS, GOALSCORER, HANDICAP)
- Overall market coverage

## Troubleshooting

### Symptom: Empty Response

**Possible Causes:**
- Wrong headers in `constants.ts`
- API endpoint changed
- Request payload format changed

**Solutions:**
1. Verify all `GRPC_HEADERS` are present
2. Check if `User-Agent`, `Origin`, `Referer` are current
3. Test with discovery script: `npx tsx scripts/betclic-market-discovery.ts --proto`

### Symptom: HTTP 403 Forbidden

**Possible Cause:** Missing or incorrect headers

**Solution:** Check `GRPC_HEADERS` in `constants.ts`:
- `Origin`: Must be `https://www.betclic.pl`
- `Referer`: Must be `https://www.betclic.pl/`
- `User-Agent`: Must be a modern browser string
- `X-Bg-Ref-*`: All required headers present

### Symptom: Parse Returns 0 Markets

**Possible Causes:**
- API schema changed (field numbers shifted)
- Parser logic bug
- Market type inference failing

**Solutions:**
1. Use `--proto` flag to inspect response structure:
   ```bash
   npx tsx scripts/betclic-market-discovery.ts --proto
   ```
2. Check if `PROTO_FIELDS` in `constants.ts` match current schema
3. Verify `extractAllOutcomes()` fallback is working
4. Check if odds are in valid range (1.01 - 100.0)

### Symptom: Missing Specific Markets

**Possible Cause:** Filter value incorrect or market not in current tab

**Solutions:**
1. Run filter discovery to verify values:
   ```bash
   npx tsx scripts/betclic-filter-discovery.ts
   ```
2. Test each filter individually:
   ```bash
   for i in {0..6}; do
     echo "Testing filter $i"
     npx tsx scripts/betclic-market-discovery.ts --filter $i
   done
   ```
3. Check if market is in a different tab by inspecting `MARKET_GROUP_FILTERS` comments

### Symptom: Timeout Errors

**Possible Cause:** gRPC stream not closing

**Solution:** The implementation uses a 5-second read timeout to handle streaming responses. If timeouts persist:
1. Check `fetchGrpcWithNodeHttp` timeout value in `navigation.ts`
2. Increase `REQUEST_TIMEOUT` in `constants.ts`
3. Verify network connectivity to `offering.begmedia.com`

### Symptom: BigInt Errors

**Possible Cause:** Match ID overflow (IDs can be very large)

**Solution:** Ensure match IDs are encoded using `encodeBigVarint()` not `encodeVarint()`:
- Use `buildMatchDetailsRequest()` or `buildMatchDetailsRequestWithFilter()`
- These functions correctly handle BigInt encoding
- Do not manually construct protobuf for match details

### Symptom: Markets Not Deduplicating

**Possible Cause:** Markets have different type inference

**Solution:** Check `parseAllMarketsFromMultipleResponses()` in `parser.ts`:
1. Deduplication key is `'name:type'`
2. Ensure `inferMarketType()` returns consistent types for same market names
3. Log deduplication process to identify mismatched types

## Common Tasks

### Task: Add Support for New Market Type

```typescript
// 1. In constants.ts - add type constant
export const MARKET_TYPES = {
  // existing...
  NEW_MARKET: "NEW_MARKET",
};

// 2. In parser.ts - add inference pattern
function inferMarketType(name: string): string {
  const lower = name.toLowerCase();
  // existing patterns...
  if (lower.includes("nowy wzorzec")) {
    return MARKET_TYPES.NEW_MARKET;
  }
  return "OTHER";
}

// 3. In market-catalog.ts - add catalog entry (if new canonical type)
{
  code: "NEW_MARKET",
  labels: { pl: "Nowy market", en: "New Market" },
  category: MarketCategory.INNE,
  // ...
}
```

### Task: Handle API Changes

1. If requests fail, check:
   - Headers in `constants.ts` (may need update)
   - Endpoint URLs
   - Request payload structure
2. Use `--proto` flag to inspect response structure changes
3. Update field numbers in `PROTO_FIELDS` if changed
4. Run discovery scripts to verify new behavior

### Task: Debug Parsing Issues

1. Add logging in `parseAllMarketsFromProto()`:
   ```typescript
   console.log(`[Debug] Field ${fieldNum}: ${values.length} values`);
   ```
2. Use `--proto` flag for structure inspection
3. Check if `extractAllOutcomes()` fallback is being used
4. Verify odds are in valid range (1.01 - 100.0)

## Conventions

- **Match IDs** are very large numbers - always use `BigInt` for encoding
- **Polish names** in responses - normalize to English canonical codes
- **Field numbers** are from reverse engineering - document when discovering new ones
- **Delays** between requests: 100ms minimum to avoid rate limiting
- **Response validation**: minimum 100 bytes for valid market data

## Testing

### Unit Tests
```bash
cd backend && npm run test -- betclic
```

Tests cover:
- Request encoding (match ID and market group filter)
- Multi-fetch behavior
- Deduplication logic
- Market type inference

### Integration Test
```bash
cd backend && npx tsx scripts/betclic-integration-test.ts
```

Verifies:
- Full offer scraping works end-to-end
- Market coverage meets expectations
- Key market types are present
- Deduplication works correctly

### Manual Verification
```bash
# Start backend
cd backend && npm run dev

# Trigger scrape via API
curl -X POST http://localhost:3001/api/admin/scrape -H "Authorization: Bearer <API_KEY>"

# Check results
curl http://localhost:3001/api/odds?league=premier-league
```

## Additional Documentation

- **API Documentation:** `backend/docs/betclic-api-documentation.md` - Detailed gRPC endpoint documentation
- **Tab Analysis:** `backend/docs/betclic-tab-network-analysis.md` - Network behavior when switching tabs
- **Market Coverage:** `backend/docs/betclic-market-coverage-*.md` - Analysis of market coverage
- **Plans:** `plans/betclic-multi-tab-scraping-plan.md` - Implementation planning document

## Notes

### Current Limitations

Based on testing as of 2026-01-23, the API filter mechanism (Field 2 with values 0-6) returns identical responses for all 7 tabs. All filter values produce the same 3 market groups (Gole, Inne, Wynik meczu) and 343 markets.

**Current coverage:** 16.1% (5/31 expected types)

**Missing markets:**
- Statystyki: corners, cards, shots, fouls, offsides
- Strzelcy: assists, first/last scorer
- Metoda Gola: penalty, header, free kick
- Handicap: handicap variations, correct score

**Architecture Note:** The multi-tab implementation is architecturally correct and complete. The limitation is in the API's filter behavior, not the scraper implementation.

### Future Work

When API behavior changes or filter values are updated:
1. Re-run filter discovery: `betclic-filter-discovery.ts`
2. Update `MARKET_GROUP_FILTERS` in `constants.ts`
3. Re-verify coverage with integration test
4. Update this documentation with new findings

---

**Last Updated:** 2026-01-23
**Based On:** Multi-tab scraping implementation (impl-001 through impl-006)
**Related Documents:**
- `backend/docs/betclic-api-documentation.md`
- `backend/docs/betclic-tab-network-analysis.md`
- `backend/docs/betclic-market-coverage-final.md`
