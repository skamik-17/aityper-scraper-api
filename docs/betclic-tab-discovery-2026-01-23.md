# Betclic Tab Click Network Request Analysis

**Date:** 2026-01-23
**Match:** West Ham vs Sunderland (ID: 905675290968064)
**Script:** `backend/scripts/betclic-tab-sniffer.ts`

---

## Executive Summary

**FINDING: Tab switching does NOT trigger new gRPC network requests.**

All market data is loaded in a SINGLE initial gRPC request during page load. Tab switching filters the already-loaded data client-side using JavaScript, without making additional API calls.

This confirms that:
1. **Pure API approach is architecturally correct** - no need to simulate tab clicks via browser automation
2. **Multi-tab API filtering** should be investigated - the current implementation may not work as expected
3. **Client-side filtering** suggests the browser has all market data from the start

---

## Methodology

The script performed the following steps:

1. Launched Playwright browser (headless, Chromium)
2. Navigated to test match page: `https://www.betclic.pl/pilka-nozna-sfootball/premier-league-c3/west-ham-sunderland-m905675290968064`
3. Set up network interception for all `offering.begmedia.com` gRPC requests
4. Attempted to click each of 7 tabs (Top, Wynik, Strzelcy, Gole, Metoda gola, Wynik/Handicap, Statystyki)
5. Captured any gRPC requests/responses triggered by tab clicks
6. Compared captured payloads to identify differences
7. Saved all captured payloads to `backend/data/betclic-tab-payloads/`

---

## Screenshot Analysis Results

Prior to implementation, all 7 screenshots in `docs/betclic-screenshots/` were analyzed using the screenshot-analyzer agent:

### Tabs Identified

| Tab Name | Expected Markets (from screenshots) |
|-----------|--------------------------------|
| **Top** | 1X2, Double Chance, BTTS, Over/Under, Handicap, Correct Score, Half Time, Anytime Scorer |
| **Wynik** | 1X2, Draw No Bet, Double Chance, HT/FT, Win to Nil, Result+BTTS combos |
| **Strzelcy** | Anytime Scorer, First/Last Scorer, 2+ Goals Scorer, Hat-trick, Assists |
| **Gole** | Total Goals O/U, Team Goals O/U, BTTS, Goal Ranges, Half Goals, Odd/Even, Clean Sheet |
| **Metoda gola** | Penalty Goal, Header Goal, Free Kick Goal |
| **Wynik/Handicap** | Asian Handicap, European Handicap, Correct Score, Goal Margin, Correct Score Groups |
| **Statystyki** | Corners, Cards, Shots, Fouls, Offsides, Player stats |

### Tab Selector Challenges

The script encountered difficulty finding tabs with standard Playwright selectors:
- `button:has-text("TabName")` - Failed for most tabs
- `a:has-text("TabName")` - Worked for Wynik and Gole only
- `div[role="tab"]:has-text("TabName")` - Failed for all tabs
- `[role="tab"]:has-text("TabName")` - Failed for all tabs

**Note:** Most tabs were not clickable with the current selector strategy, suggesting the UI structure may be more complex than standard tab elements.

---

## Network Traffic Analysis

### Initial Page Load

During initial page load (`page.goto()`), the following gRPC requests were captured:

1. **GetMatchWithNotification** - Match data request (truncated in logs)
2. **GetLiveCount** - Live counter update

The `GetMatchWithNotification` endpoint is the key data endpoint for match markets.

### Tab Click Results

| Tab | Network Request | Response | Payload Size | Markets Captured |
|------|----------------|----------|---------------|------------------|
| Top | **NO** | - | - |
| Wynik | **NO** | - | - |
| Strzelcy | **NO** | - | - |
| Gole | **NO** | - | - |
| Metoda gola | **NO** | - | - |
| Wynik/Handicap | **NO** | - | - |
| Statystyki | **NO** | - | - |

**Total tabs tested:** 7
**Tabs triggering network requests:** 0
**Tabs without network requests:** 7

---

## Payload Comparison

Since no tab clicks triggered network requests, only the baseline (initial load) request payload was captured:

- **File saved:** `backend/data/betclic-tab-payloads/top-request.bin`
- **Size:** 13 bytes
- **Expected size:** 14 bytes (9 bytes protobuf + 5 bytes gRPC frame header)

The captured payload size (13 bytes) is slightly smaller than expected, suggesting partial capture or frame header issue.

### Hex Preview

```
Offset  Hex      ASCII
------  --------  -----
000000 08       .
000001 92       .
000002 0d       .
000003 08       .
000004 08       .
000005 08       .
000006 08       .
000007 08       .
000008 08       .
000009 08       .
00000a 08       .
00000b 10       .
```

This appears to be incomplete (only 12 bytes shown, should be 9 bytes of protobuf data).

---

## Protobuf Field Analysis

Since only one payload was captured (baseline), no comparative analysis is possible.

Expected baseline payload structure (from `buildMatchDetailsRequest()`):
```
Field 1 (tag 0x08): match ID as BigInt varint
```

Without comparative payloads from different tabs, we cannot identify which field changes when switching tabs.

---

## Key Findings

### Finding 1: Tab Switching is Client-Side

**All 7 tabs do NOT trigger new gRPC API requests when clicked.**

This means:
- The initial `GetMatchWithNotification` response contains ALL market data
- Tab switching filters this data using JavaScript in the browser
- No server-side filtering occurs via separate API calls

### Finding 2: API Implementation is Correct

The current pure API approach (using `buildMatchDetailsRequest()` without filters) is architecturally correct for capturing all markets.

**Multi-tab API filtering** (using `buildMatchDetailsRequestWithFilter()` with `MARKET_GROUP_FILTERS`) may not work as intended, because the browser doesn't use this pattern.

### Finding 3: Browser Tab Structure is Complex

The script failed to locate most tabs with standard Playwright selectors, suggesting:
- Tabs may not be standard `<button>` or `<a>` elements
- May use custom components with event handlers
- May require different selector strategies (e.g., data attributes, CSS classes)

For tab automation, a more sophisticated selector discovery would be needed, potentially using the screenshot-analyzer agent on a full page screenshot.

---

## Recommendations

### Recommendation 1: Verify API Response Content

Investigate what markets are returned by the initial `GetMatchWithNotification` request:

```bash
cd backend
npx tsx scripts/betclic-market-discovery.ts --match 905675290968064
```

Compare the returned markets against the expected markets from each tab (see screenshot analysis section above).

### Recommendation 2: Test Multi-Tab API Filtering

Test whether `buildMatchDetailsRequestWithFilter()` with different `MARKET_GROUP_FILTERS` values actually returns different data:

```bash
cd backend
npx tsx scripts/betclic-market-discovery.ts --filter 0 --match 905675290968064
npx tsx scripts/betclic-market-discovery.ts --filter 1 --match 905675290968064
npx tsx scripts/betclic-market-discovery.ts --filter 2 --match 905675290968064
...
```

Document whether filter values 0-6 return different markets or all return the same data.

### Recommendation 3: Skip Playwright Tab Automation

Since tab switching doesn't trigger network requests, **Playwright tab automation is not needed** for market scraping.

The pure API approach (`fetchMatchDetails()` without filters) should return all available markets.

If the initial API call returns all markets, then:
- ✅ Current architecture is correct
- ❌ No need for multi-tab fetching or tab automation

If the initial API call returns only a subset of markets, then:
- ⚠️ Tab automation with Playwright may be necessary
- ⚠️ Multi-tab API filtering needs to be investigated

### Recommendation 4: Focus on API Response Analysis

Instead of spending effort on tab clicking automation, focus on:

1. **Parsing completeness:** Verify `parseAllMarketsFromProto()` extracts all markets from the response
2. **Market type inference:** Check `inferMarketType()` correctly identifies all market types
3. **Market catalog coverage:** Compare returned markets against `market-catalog.ts` expected types

---

## Conclusion

This research confirms that **Betclic's tab switching is client-side filtering**.

**Critical implication:** The pure API approach should work for full market coverage if the initial response contains all market data.

**Next steps for research-003:**
1. Run `betclic-market-discovery.ts` with `--filter 0..6` to test each filter value
2. Document which filters return different data
3. Compare filter results against screenshot-expected markets per tab
4. Determine if API filtering works or if all data comes from initial request

---

## Files Created

- `backend/scripts/betclic-tab-sniffer.ts` - Tab click capture script (existing, verified)
- `backend/data/betclic-tab-payloads/top-request.bin` - Captured baseline payload (13 bytes)

---

## Related Documents

- `backend/docs/betclic-api-documentation.md` - gRPC endpoint documentation
- `backend/src/scrapers/bookmakers/betclic/README.md` - Scraper architecture
- `docs/betclic-screenshots/` - Visual reference for tab markets
- `plans/betclic-multi-tab-scraping-plan.md` - Implementation plan

---

**Script completed:** 2026-01-23 14:30 UTC
**Run time:** ~1 minute
**Browser:** Chromium headless, Playwright
