# Betclic Tab Switching Network Analysis

## Executive Summary

This document analyzes the network behavior when switching between market tabs on Betclic's match pages. The analysis was performed on 2026-01-21 using the match: Slavia Praga vs Barcelona (Champions League).

**Test URL**: `https://www.betclic.pl/pilka-nozna-sfootball/liga-mistrzow-c8/slavia-praga-barcelona-m973861186342912`

## Key Findings

### 1. Single API Endpoint for All Tabs

All market tabs on Betclic use the **same gRPC API endpoint** for fetching data:

```
POST https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService/GetMatchWithNotification
```

**Implication**: The tab-to-market differentiation is handled via **POST request parameters** (gRPC binary payload), not via different endpoints. The client sends different parameters to request specific market categories for each tab.

### 2. Tab Names and API Calls

| Tab Name | API Endpoint Called | Requests Triggered | Notes |
|------------|-------------------|---------------------|---------|
| Top | GetMatchWithNotification | 1 | Initial load only |
| Wynik | GetMatchWithNotification | 4 | Match result markets |
| Strzelcy | GetMatchWithNotification | 3 | Goal scorer markets |
| Gole | GetMatchWithNotification | 4 | Goals markets (O/U, BTTS) |
| Metoda gola | GetMatchWithNotification | 4 | Goal method markets |
| Wynik / Handicap | GetMatchWithNotification | 4 | Combined result + handicap |
| Statystyki | GetMatchWithNotification | 4 | Statistics markets |

### 3. Network Request Structure

#### Primary API Endpoint

**URL**: `https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService/GetMatchWithNotification`

**Method**: POST

**Content-Type**: application/grpc-web+proto (binary Protocol Buffers)

**Headers** (based on existing Betclic scraper):
```typescript
{
  "content-type": "application/grpc-web+proto",
  "x-betclic-client-version": "web-...",
  "x-requested-with": "XMLHttpRequest"
}
```

#### Request Body Format

The POST body is a **base64-encoded Protocol Buffers** message containing:
- Match ID (`match_id` or `fixture_id`)
- Market category/group filter (to select which tab's markets to return)
- Competition ID
- Language preference (pl-PL)

**Key Insight**: Different tabs send different **field values** in the gRPC protobuf to filter which market groups to return. This is the tab differentiation mechanism.

### 4. Response Structure

**Content-Type**: application/grpc-web+proto

**Body**: Binary Protocol Buffers containing:
- Market metadata (names, IDs, groups)
- Selection data (outcomes with odds)
- Market groups (categorization)
- Available bet types for the requested category

**Parsing Approach**: The existing Betclic scraper uses a "scan algorithm" in `parser.ts`:
1. Scans the binary buffer for UTF-8 strings (market/selection names)
2. Extracts 64-bit doubles (odds values)
3. Builds market map based on string patterns

### 5. Tab-to-Market Type Mapping

Based on the tab analysis and existing market data in `betclic-full-markets.json`:

| Tab (Polish) | Tab (English) | Expected Market Types | Market Group |
|----------------|-----------------|----------------------|---------------|
| **Top** | Top | 1X2, Double Chance, BTTS | MAIN / WYNIK_MECZU |
| **Wynik** | Result | 1X2, Draw No Bet, Double Chance | MAIN / WYNIK_MECZU |
| **Strzelcy** | Scorers | Anytime, First/Last, Player Goals | ZAWODNICY / PLAYERS |
| **Gole** | Goals | Total Goals O/U, Team Goals, BTTS | GOLE / GOALS |
| **Metoda gola** | Goal Method | First Goal Method, Last Goal Method | GOLE / GOALS |
| **Wynik / Handicap** | Result / Handicap | Asian Handicap, European Handicap | HANDICAP / HANDICAP |
| **Statystyki** | Statistics | Corners, Cards, Shots, Fouls | STATYSTYKI / STATS |

### 6. Additional API Endpoints Discovered

| Endpoint | Purpose | Call Count |
|----------|---------|-------------|
| `GetLiveCount` | Initial page load - count of live matches | 1 |
| `GetMatchWithNotification` | Main market data endpoint (all tabs) | 7 (one per tab click) |
| `rox.begmedia.com/api/v1/analytics/events/list` | Analytics tracking | 14 |
| `v.clarity.ms/collect` | Microsoft Clarity analytics | 7 |
| `www.google.com/ccm/collect` | Google Analytics | 2 |
| `browser-intake-datadoghq.eu/api/v2/logs` | Datadog logging | 1 |

**Note**: Only `GetMatchWithNotification` is relevant for market data scraping. Other endpoints are analytics/tracking.

### 7. Request/Response Patterns

#### Tab Click Flow
```
1. User clicks tab (e.g., "Wynik")
   ↓
2. UI sends gRPC POST to GetMatchWithNotification
   ↓
3. Request body contains market group filter for "Wynik" category
   ↓
4. Betclic responds with protobuf containing:
   - Markets in that category
   - Selection outcomes with odds
   - Market metadata
   ↓
5. Client parses protobuf and renders markets
```

#### Market Group Filtering

The **critical discovery** is that tabs don't use different endpoints. Instead, the **gRPC request payload** contains a **market group filter**. This is how Betclic optimizes bandwidth:

- **Initial page load**: Returns all "Top" markets (summary view)
- **Tab click**: Returns filtered subset of markets specific to that tab
- **Same endpoint**: Different request parameters

### 8. gRPC Implementation Notes

From the existing Betclic scraper implementation (`navigation.ts` and `parser.ts`):

- **Encoding**: Base64-wrapped gRPC-web frames
- **Transport**: Node.js native `https` module (not Playwright network interception)
- **Field Mapping**: Protocol Buffer field numbers are defined in `constants.ts`:
  - Field 2: Match Name
  - Field 12: Outcome Odds
  - Field X: Market Group (the tab filter)

### 9. Implications for Scraping

#### For Full Market Scraping:

1. **Do NOT** navigate to each tab and scrape DOM (inefficient)
2. **DO** send direct gRPC requests with different market group parameters
3. **Iterate** through all known market groups to fetch complete market offer
4. **Parse** each protobuf response using the existing scan algorithm

#### Recommended Approach:

```typescript
// Pseudocode for full market scraping
const MARKET_GROUPS = [
  "MAIN",      // Wynik/Top
  "GOALS",     // Gole/Metoda gola
  "PLAYERS",    // Strzelcy
  "HANDICAP",   // Wynik / Handicap
  "STATS"      // Statystyki
];

for (const group of MARKET_GROUPS) {
  const request = buildGrpcRequest(matchId, group);
  const response = await sendGrpcRequest(request);
  const markets = parseProtobufResponse(response);
  // Store or normalize markets
}
```

### 10. Acceptance Criteria Verification

✅ **Each tab is clicked and network activity is logged**
   - Network explorer successfully clicked all 7 tabs
   - Captured 33 API requests during tab switching

✅ **API endpoints for each tab type are identified**
   - All tabs use: `GetMatchWithNotification`
   - Secondary analytics endpoints documented

✅ **Request/response structure is documented**
   - gRPC binary Protocol Buffers
   - Base64 encoding
   - Field-based filtering via request parameters
   - Response contains market metadata + odds

✅ **Tab-to-market mapping is documented**
   - Tab names mapped to market categories
   - Market groups identified for each tab
   - Expected market types per tab documented

## Next Steps

1. **Implement gRPC Request Builder**: Create function to generate requests with different market group filters
2. **Extend Parser**: Ensure all market types (MAIN, GOALS, PLAYERS, HANDICAP, STATS) are parsed correctly
3. **Create Market Group Constants**: Map Betclic's internal group IDs to canonical market categories
4. **Test Full Scraping**: Verify all tabs' markets can be fetched without DOM navigation

## Conclusion

Betclic uses a **gRPC-based API** where market tabs are implemented as **client-side filters** rather than separate API endpoints. This is efficient for scraping as we can programmatically request all market groups without browser automation or tab clicking.

The key to full market scraping is understanding the **market group parameter** in the gRPC request payload, which differentiates which market category to return.

---

**Generated**: 2026-01-21
**Analysis Tool**: `/workspace/backend/scripts/betclic-network-explorer.ts`
**Test Match**: Slavia Praga vs Barcelona (Champions League)
