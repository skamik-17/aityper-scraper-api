# BACKEND SRC KNOWLEDGE BASE

## OVERVIEW
Core backend source tree and service boundaries.

## STRUCTURE
```
src/
├── config/        # Env and runtime config
├── data/          # Market and team data
├── middleware/    # Express middleware
├── repositories/  # Supabase access
├── routes/        # API routing
├── scrapers/      # Playwright scrapers
├── services/      # Orchestration and normalization
├── types/         # Backend types
├── utils/         # Shared helpers
└── scripts/       # Debug and analysis tools
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Config | `backend/src/config/` | ENV validation and constants |
| Scraper orchestration | `backend/src/services/` | Scheduler and scraper service |
| Normalization | `backend/src/services/normalization/` | Bookmaker-specific normalizers |
| Data registry | `backend/src/data/market-catalog.ts` | Market definitions |

## CONVENTIONS
- Keep DB logic in repositories; keep orchestration in services.
- Use backend types from `backend/src/types/`.

## ANTI-PATTERNS
- Avoid business logic inside repositories.
- Do not bypass normalization before saving markets.

## BETCLIC SCRAPER PATTERNS

### Architecture: gRPC-web with Protocol Buffers

Betclic is unique among all bookmaker scrapers - it does **NOT** use Playwright DOM scraping. Instead:

- **Transport:** Direct Node.js HTTPS requests (no browser)
- **Encoding:** Protocol Buffers (binary) with base64-encoded gRPC-web frames
- **Request Structure:**
  ```
  HTTP Body = Base64(Frame)
  Frame = Flag[1 byte] + Length[4 bytes BE] + ProtobufMessage[N bytes]
  ```
- **Endpoint:** `POST https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService/GetMatchWithNotification`

### Protobuf Field Encoding

**Field Numbers → Wire Tags:**
- Tag = (fieldNum << 3) | wireType
- WireType 0 = varint, 2 = length-delimited (bytes/string), 1 = double
- Field 1 (matchId) → tag 0x08
- Field 2 (marketGroup filter) → tag 0x10

**Varint Encoding:**
- Large match IDs use `encodeBigVarint()` (BigInt support)
- Regular integers use `encodeVarint()`
- Always use `BigInt` for match IDs - they can overflow JavaScript Number

### Required Headers

Missing any of these causes HTTP 403:

```typescript
{
  "Content-Type": "application/grpc-web-text",
  "Accept": "application/grpc-web-text",
  "X-Grpc-Web": "1",
  "X-Bg-Ref-Brand": "BETCLIC",
  "X-Bg-Ref-Platform": "DESKTOP",
  "X-Bg-Ref-Regulator-Zone": "PL",
  "X-Bg-Regulation": "PL",
  "User-Agent": "<modern browser string>",
  "Origin": "https://www.betclic.pl",
  "Referer": "https://www.betclic.pl/"
}
```

### Filter Discovery Methodology

**Problem:** Betclic website has 7 tabs, each showing different market categories. The API uses a filter field to control which markets are returned.

**Discovery Process:**

1. **Use Tab Sniffer (Playwright)** - Capture real network traffic:
   ```bash
   npx tsx scripts/betclic-tab-sniffer.ts "https://www.betclic.pl/pilka-nozna-..."
   ```
   Captures gRPC payloads when user clicks each tab.

2. **Brute Force Filter Values** - Test different field/value combinations:
   ```bash
   npx tsx scripts/betclic-filter-discovery.ts
   ```
   Tests fields 2-10 with values 0-20, comparing response sizes to baseline.

3. **Market Discovery Script** - Test specific filters:
   ```bash
   npx tsx scripts/betclic-market-discovery.ts --filter 5 --match 905675290968064
   npx tsx scripts/betclic-market-discovery.ts --proto  # Inspect structure
   ```

**MARKET_GROUP_FILTERS Pattern:**

Located in `constants.ts`, these constants map tab names to filter values:

```typescript
export const MARKET_GROUP_FILTERS = {
  /** Tab 1: Top - Main/Popular markets */
  TOP: 0,
  /** Tab 2: Wynik - Result markets */
  WYNIK: 1,
  /** Tab 3: Strzelcy - Goalscorer markets */
  STRZELCY: 2,
  /** Tab 4: Gole - Goal markets */
  GOLE: 3,
  /** Tab 5: Metoda Gola - Goal method markets */
  METODA_GOLA: 4,
  /** Tab 6: Wynik/Handicap - Result & Handicap markets */
  HANDICAP: 5,
  /** Tab 7: Statystyki - Statistics markets */
  STATYSTYKI: 6,
} as const;
```

**Key Pattern:** Use `as const` for type safety and include JSDoc comments explaining each tab's market categories.

### Multi-Tab Fetching Pattern

**Problem:** Need to fetch markets from all 7 tabs and merge into single market list.

**Solution:**

1. **Fetch All Market Groups** (navigation.ts):
   - Iterate over `MARKET_GROUP_FILTERS` values
   - Call `buildMatchDetailsRequestWithFilter()` for each
   - Call `fetchGrpcStream()` with 100ms delay between requests
   - Filter out responses smaller than 100 bytes (invalid)
   - Return `Promise<Buffer[]>`

2. **Parse Multiple Responses** (parser.ts):
   - Call `parseAllMarketsFromProto()` for each buffer
   - Merge all markets into single array
   - Deduplicate using `'name:type'` as unique key
   - Log total markets before/after deduplication

3. **Data Flow:**
   ```
   scrapeFullOffer()
       ↓
   fetchAllMarketGroups(matchId)
       ↓
   [Buffer[], Buffer[], ...] (7 responses)
       ↓
   parseAllMarketsFromMultipleResponses(responses)
       ↓
   deduplicate by (name + type)
       ↓
   ScrapedMarket[]
   ```

### Market Merging & Deduplication

**Deduplication Key:** `'name:type'`

```typescript
const marketKey = `${market.name}:${market.type}`;
```

**Why this key:**
- Same market name can appear in different tabs (e.g., "1X2" in Top and Wynik)
- Different market types are not duplicates (e.g., "Total Goals" O/U vs Exact Goals)
- Market type is determined by `inferMarketType()` in parser.ts

**Fallback Pattern:** Try multi-tab fetching first, fall back to single request if it fails. This ensures backwards compatibility if API behavior changes.

### Parsing Strategies

**Primary Strategy - Structured Parsing** (`parseAllMarketsFromProto()`):
- Traverses known field numbers from `PROTO_FIELDS` constant
- Extracts market groups from Field 2
- Parses nested markets from Fields 3-20
- Gets outcomes from Field 16

**Fallback Strategy - Outcome Scanning** (`extractAllOutcomes()`):
- Binary scan for odds values (8-byte doubles where tag = 0x61)
- Backwards search for names (tags 0x52, 0x5a)
- Pattern matching for valid odds range (1.01 - 100.0)
- Resilient to schema changes

**Market Type Inference Pattern** (`inferMarketType()`):
- Use lowercase `includes()` for Polish keyword matching
- Include English fallbacks for robustness
- Match specific patterns before generic ones
- Return `"OTHER"` for unmatched markets

### Diagnostic Scripts

**betclic-market-discovery.ts** (PRIMARY TOOL):
```bash
# Basic usage
npx tsx scripts/betclic-market-discovery.ts

# Proto structure analysis
npx tsx scripts/betclic-market-discovery.ts --proto

# Test specific filter
npx tsx scripts/betclic-market-discovery.ts --filter 5

# Multi-tab mode
npx tsx scripts/betclic-market-discovery.ts --multi

# Specific match
npx tsx scripts/betclic-market-discovery.ts --match 905675290968064
```

**Output:**
- Total markets count
- Markets grouped by type/groupName
- Missing expected market types
- Suspicious markets (type=OTHER)
- Protobuf structure (with `--proto`)
- Multi-tab deduplication stats (with `--multi`)

**betclic-filter-discovery.ts:**
```bash
npx tsx scripts/betclic-filter-discovery.ts
```
Brute force tests different field/value combinations to discover filter field.

**betclic-integration-test.ts:**
```bash
npx tsx scripts/betclic-integration-test.ts
npx tsx scripts/betclic-integration-test.ts --verbose
```
Verifies full offer scraping meets acceptance criteria.

### File Structure

```
backend/src/scrapers/bookmakers/betclic/
├── index.ts          # Main scraper - orchestrates fetch + parse
├── navigation.ts     # gRPC transport, request building, multi-fetch
├── parser.ts         # Protobuf decoding, market extraction, merging
├── constants.ts      # API config, field numbers, MARKET_GROUP_FILTERS, TAB_SELECTORS
├── types.ts          # TypeScript interfaces
└── README.md         # Comprehensive documentation
```

### TAB_SELECTORS Pattern

**Purpose:** CSS selectors for Betclic tab navigation (Playwright DOM scraping)

**Source:** Screenshot analysis of `docs/betclic-screenshots/Top.png`

**Structure:** All selectors follow ARIA accessibility patterns (`role="tab"`, `role="tablist"`)

**Components:**
- `container` - Primary/fallback for tab list container
- `button` - Generic tab button selector (used by tab-scraper.ts)
- `buttonPattern` - Template selector with placeholder `{{TabName}}` for specific tabs
- `tabs` - Pre-computed tab names: TOP, WYNIK, STRZELCY, GOLE, METODA_GOLA, HANDICAP, STATYSTYKI
- `excludeTab` - "MyCombi" special feature tab (not a market category)
- `activeIndicator` - CSS/ARIA attributes for selected tab detection
- `allTabs` - Generic selector for all tab buttons

**Helper Function:** `getTabSelector(tabName, options?)` - Returns complete selector for specific tab name

**Key Pattern:** Use `as const` for type safety, provide primary/fallback selectors for resilience

### Performance Optimization Patterns

**Session Caching (Tab Scraper):**
- Module-level `cachedSession` variable tracks browser session for reuse between matches
- `SESSION_REUSE_THRESHOLD` (2 minutes): Prefers reuse within this window
- `SESSION_TTL` (5 minutes): Maximum cache lifetime
- Session marked as `isBusy` during use to prevent concurrent access
- `cleanup()` method properly closes cached session to prevent memory leaks

**Resource Blocking:**
- `BLOCKED_ANALYTICS_DOMAINS`: 12 tracking/analytics domains blocked for performance
- `BLOCKED_SCRIPT_PATTERNS`: 12 tracking patterns (analytics, pixel, beacon, gtag, etc.)
- Blocked resource types: image, font, media, stylesheet
- First rule in `setupGrpcOnlyInterception()` allows gRPC (offering.begmedia.com)
- Essential scripts from betclic.pl allowed through (needed for tab functionality)
- All other resources blocked to improve load times by 50-80%

**Performance Metrics Tracking:**
- `PerformanceMetrics` interface tracks: sessionReused, navigationTime, totalResponses, matchDuration, tab durations
- `logPerformanceMetrics()` outputs comprehensive performance statistics
- Metrics help verify optimization targets: < 60s for 10 matches avg

### Common Tasks

**Add New Market Group:**
1. Discover filter value using sniffer or brute force script
2. Add to `MARKET_GROUP_FILTERS` in `constants.ts`
3. Test with discovery script

**Add New Market Type:**
1. Add to `MARKET_TYPES` in `constants.ts`
2. Update `inferMarketType()` in `parser.ts`
3. Add catalog entry in `market-catalog.ts` (if new canonical type)

**Fix Parsing Bugs:**
1. Use `--proto` flag to inspect response structure
2. Check `PROTO_FIELDS` in `constants.ts`
3. Update `parseAllMarketsFromProto()` or `inferMarketType()`

**Handle API Changes:**
1. Update headers in `constants.ts` if requests fail
2. Use `--proto` to inspect response structure changes
3. Update field numbers in `PROTO_FIELDS`
4. Run discovery scripts to verify new behavior

### Conventions

- **Match IDs:** Always use `BigInt` - they can be very large numbers
- **Polish names:** Responses are in Polish - normalize to English canonical codes
- **Field numbers:** From reverse engineering - document when discovering new ones
- **Delays:** 100ms minimum between requests to avoid rate limiting
- **Response validation:** Minimum 100 bytes for valid market data
- **Logging:** Always log number of responses/markets fetched for visibility

### Troubleshooting Quick Reference

| Symptom | Cause | Solution |
|---------|-------|----------|
| Empty response | Wrong headers | Update `GRPC_HEADERS` |
| HTTP 403 | Missing Origin/Referer | Check headers |
| Parse returns 0 markets | Schema change | Use `--proto` to inspect |
| Missing markets | Filter needed | Implement multi-tab |
| Timeout errors | Stream not closing | Check timeout in navigation.ts |
| BigInt errors | Match ID overflow | Use `encodeBigVarint()` |
| No deduplication | Type mismatch | Check `inferMarketType()` |

### Related Documentation

- `backend/src/scrapers/bookmakers/betclic/README.md` - Full scraper documentation
- `backend/docs/betclic-api-documentation.md` - gRPC API details
- `backend/docs/betclic-tab-network-analysis.md` - Tab switching network behavior
- `backend/docs/betclic-market-coverage-*.md` - Market coverage analysis
- `plans/betclic-multi-tab-scraping-plan.md` - Implementation planning
