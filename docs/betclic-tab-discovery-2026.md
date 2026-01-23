# Betclic Tab Discovery Analysis

**Date:** 2026-01-23
**Analysis Type:** Tab Switching Behavior & API Filtering Test
**Matches Tested:**
- Primary: 905675290968064 (West Ham vs Sunderland)
- Secondary: 906705046382080 (failed - match likely ended)

---

## Executive Summary

**CRITICAL FINDINGS:**

1. **Pure API approach is confirmed correct** - Tab switching does NOT trigger network requests
2. **API filtering (Field 2) does NOT work** - All filter values return identical data
3. **Initial API response contains only partial market data** - 342 markets, mostly player props
4. **Tab switching is purely client-side filtering** - All data loaded once, filtered by JavaScript
5. **Significant market coverage gap** - API returns 5 market types, UI shows 20+ types

**RECOMMENDATION:** Use **Hybrid Approach** - Fetch API data for player props, but capture browser state for full market coverage.

---

## Methodology

### Phase 1: Filter Value Testing

Tested Field 2 filter values against baseline (no filter) on match 905675290968064:

```bash
npx tsx scripts/betclic-market-discovery.ts --filter 0 --match 905675290968064
npx tsx scripts/betclic-market-discovery.ts --filter 1 --match 905675290968064
npx tsx scripts/betclic-market-discovery.ts --filter 5 --match 905675290968064
```

### Phase 2: Screenshot Analysis

Analyzed all 5 screenshots in `docs/betclic-screenshots/` using screenshot-analyzer agent:

- **Top.png** - Default tab, popular markets
- **Wynik.png** - Result markets and combinations
- **Strzelcy.png** - Player goalscorer markets
- **Gole.png** - Goal-related markets (O/U, BTTS, team goals)
- **Metoda_Gola.png** - Goal method markets (penalty, header, free kick)

### Phase 3: Baseline Market Discovery

Ran full market discovery on test match:

```bash
npx tsx scripts/betclic-market-discovery.ts --match 905675290968064
```

---

## Filter Testing Results

### Test Summary

| Filter Value | Response Size | Market Count | Market Groups | Difference from Baseline |
|--------------|----------------|---------------|----------------|------------------------|
| **Baseline (none)** | 98,098 bytes | 342 | Gole, Inne, Wynik meczu | N/A |
| **0** | 98,098 bytes | 342 | Gole, Inne, Wynik meczu | **IDENTICAL** |
| **1** | 98,098 bytes | 342 | Gole, Inne, Wynik meczu | **IDENTICAL** |
| **5** | 98,098 bytes | 342 | Gole, Inne, Wynik meczu | **IDENTICAL** |

### Hex Comparison

Since all responses are identical, no hex differences exist.

**Baseline payload structure:**
```
Field 1 (tag 0x08): match ID = 905675290968064
Field 2 (tag 0x10): filter value [added in test]
```

**Finding:** Adding Field 2 with values 0, 1, 5 produces **NO CHANGE** in response.

### Protobuf Field Analysis

**Current request structure (buildMatchDetailsRequest):**
```protobuf
message GetMatchRequest {
  uint64 match_id = 1;  // Tag 0x08, varint
}

// Field 2 tested separately:
message GetMatchRequestWithFilter {
  uint64 match_id = 1;      // Tag 0x08
  uint32 market_group = 2;  // Tag 0x10 - DOES NOT FILTER
}
```

**Finding:** Field 2 (market_group) is **ignored** by Betclic API as of 2026-01-23.

---

## Screenshot Analysis Results

### Tab 1: Top

**Visible Markets (from screenshot analysis):**

| Market Type | Polish Name | Category |
|-------------|--------------|-----------|
| 1X2 | Wynik meczu (z wyłączeniem dogrywki) | Result |
| Double Chance | Podwójna szansa | Result |
| Over/Under | Powyżej/Poniżej | Goals |
| BTTS | Oba zespoły strzelą gola | Goals |
| Handicap | Handicap | Handicap |
| Half Time / Full Time | 1. połowa Wynik / 2. połowa Wynik | Half/Full |
| Correct Score | Dokładny wynik | Correct Score |
| Anytime Scorer | Strzelec | Player |
| Team Goals | Liczba goli - [Nazwa Drużyny] | Goals |
| Player Stats (OPTA) | Liczba celnych strzałów zawodnika | Stats |
| Combo Markets | Various promotions | Combos |

**Expected market types:** 1X2, DOUBLE_CHANCE, OVER_UNDER, BTTS, HANDICAP, CORRECT_SCORE, HALF_TIME_1X2, GOALSCORER

### Tab 2: Wynik

**Additional markets vs Top tab:**

| Market Type | Polish Name | Notes |
|-------------|--------------|--------|
| Draw No Bet | Remis - zwrot | Push on draw |
| HT/FT | Wynik Meczu Połowa / Cały | Half/Full time result |
| Win to Nil | Zwycięstwo do zera | Team keeps clean sheet |
| Result + BTTS Combos | Wynik meczu & oba zespoły strzelą | Result & BTTS |
| Half/Full Time Double Chance | Podwójna szansa (1. połowa lub mecz) | Chance Mix |
| Win Both Halves | Wygrają obie połowy | Team wins each half |
| Early Payout | Przewaga dwoma bramkami lub wygrana | 2-goal lead pays out |

**Key finding:** Wynik tab focuses on **combination markets** and **result variations** not in Top tab.

### Tab 3: Strzelcy

**Player market types:**

| Market Type | Polish Name | Options |
|-------------|--------------|----------|
| Anytime Scorer | Strzelec | Individual players |
| First/Last Scorer | Pierwszy/ostatni strzelec | First or last goal |
| 2+ Goals Scorer | Strzelcy (Specjalne) - 2 lub więcej | Multi-goal |
| 3+ Goals Scorer | 3 lub więcej | Hat-trick |
| Both Players to Score | Obaj gracze strzelą | Player pair |
| Hat-trick | Hat-trick | Exactly 3 goals |
| Player Assists | Którykolwiek zawodnik zaliczy asystę | Assists |
| SuperSub 90' | Zawodnik lub jego zmiennik | Transfer to sub counts |
| Player + Assist | Strzeli gola i zaliczy asystę | Both required |

**Teams in screenshot:**
- West Ham: Callum Wilson, Jarrod Bowen, James Ward-Prowse, C. Summerville, L. Paquetá
- Sunderland: Ahmed Abdullahi, Brian Brobbey, Wilson Isidor, Eliezer Mayenda, Simon Adingra, Abdoullah Ba, Enzo Le Fee, Bertrand Traore

### Tab 4: Gole

**Goal market categories:**

#### Gole - Popularne
| Market | Lines | Notes |
|---------|---------|--------|
| Total Goals O/U | 0.5, 1.5, 2.5 | Standard O/U |
| BTTS | Tak/Nie | Both teams score |
| Result & Goals | Wynik i gole | Combo: 1/X/2 + O/U |

#### Team Goals
| Market | Lines | Teams |
|---------|---------|--------|
| 1H Team Goals | Powyżej 0.5 | West Ham, Sunderland |
| 2H Team Goals | Powyżej 0.5 | West Ham, Sunderland |
| Full Match Team Goals | 0.5, 1.5, 2.5 | West Ham, Sunderland |

#### Goal Timing
| Market | Intervals |
|---------|-----------|
| 1st Goal Time | 0-10, 11-20, 21+ min |
| Goals in Interval | 00:00-14:59, etc. | Time-based O/U |

#### Goal Methods
| Market | Options |
|---------|----------|
| Clean Sheet | Tak/Nie | Team doesn't concede |
| Score in Both Halves | Tak/Nie | Player/team scores in 1H and 2H |
| Exact Goals | 0, 1, 2+ | Per half or match |

**Key finding:** Gole tab has **granular goal markets** including timing, team-specific, and method variations.

### Tab 5: Metoda Gola (Sub-tabs: 3)

#### Sub-tab 1: Rzut karny (Penalty)

| Market | Options | Sample Odds |
|---------|-----------|--------------|
| Penalty Goal - Match | West Ham / Sunderland / Any / None | 6.50 / 7.50 / 3.80 / 1.18 |
| Penalty Goal - 1H | West Ham / Sunderland / Any | 11.00 / 13.00 / 6.00 |
| Penalty Goal - 2H | West Ham / Sunderland / Any | 10.00 / 11.00 / 5.25 |
| Both Teams Score Penalty | Tak | 35.00 |
| Player Penalty Goal | Individual players | 8.50 - 9.00 |

#### Sub-tab 2: Główka (Header)

| Market | Options | Sample Odds |
|---------|-----------|--------------|
| Header Goal - 1H | Tak/Nie | 4.15 / 1.14 |
| Header Goal - 2H | Tak/Nie | 3.43 / 1.20 |
| Header Goals - Both Halves | Tak | 10.75 |
| Header Goal - Match | Tak/Nie | 2.50 / 1.43 |
| Player Header Goal | Individual players | 6.50 - 7.00 |
| Team Header Goals | West Ham / Sunderland | 5.40 / 1.06 vs 3.93 / 1.16 |

#### Sub-tab 3: Rzuty wolne (Free Kick)

| Market | Options | Sample Odds |
|---------|-----------|--------------|
| Direct Free Kick Goal - Match | Tak | 12.00 |
| Team Free Kick Goal | West Ham / Sunderland | 25.00 each |
| Both Teams Free Kick Goal | Tak | 250.00 |
| Player Free Kick Goal | Individual players | 30.00 - 35.00 |

**Key finding:** Metoda Gola tab has **3 sub-tabs** for different goal methods with specialized markets.

---

## API Response Analysis

### Baseline Market Count

```bash
npx tsx scripts/betclic-market-discovery.ts --match 905675290968064
```

**Results:**
- Total Markets: **342**
- Response Size: **98,098 bytes** (98 KB)
- Market Groups: **3** (Gole, Inne, Wynik meczu)

### Market Type Breakdown

| Market Type | Count | Percentage |
|-------------|---------|------------|
| **GOALSCORER** | 333 | **97.4%** |
| **OVER_UNDER** | 6 | 1.8% |
| **1X2** | 1 | 0.3% |
| **DOUBLE_CHANCE** | 1 | 0.3% |
| **BTTS** | 1 | 0.3% |

### Market Group Breakdown

| Group Name | Count | Market Types |
|------------|---------|--------------|
| **Inne** (Other) | 333 | GOALSCORER (all 333) |
| **Gole** (Goals) | 7 | OVER_UNDER (6), BTTS (1) |
| **Wynik meczu** (Match Result) | 2 | 1X2 (1), DOUBLE_CHANCE (1) |

### Missing Market Types (Expected from Screenshots)

| Market Type | Expected in Screenshots | Found in API | Status |
|-------------|----------------------|----------------|--------|
| **CORRECT_SCORE** | Top, Wynik | ❌ NO | **MISSING** |
| **HANDICAP** | Top, Wynik/Handicap | ❌ NO | **MISSING** |
| **HALF_TIME_1X2** | Top, Wynik | ❌ NO | **MISSING** |
| **HT_FT** | Wynik | ❌ NO | **MISSING** |
| **WIN_BOTH_HALVES** | Wynik | ❌ NO | **MISSING** |
| **WIN_TO_NIL** | Wynik | ❌ NO | **MISSING** |
| **CLEAN_SHEET** | Gole | ❌ NO | **MISSING** |
| **GOAL_TIMING** | Gole | ❌ NO | **MISSING** |
| **GOAL_METHOD** (Penalty/Header/FreeKick) | Metoda Gola | ❌ NO | **MISSING** |
| **PLAYER_ASSISTS** | Strzelcy | ❌ NO | **MISSING** |
| **FIRST_LAST_SCORER** | Strzelcy | ❌ NO | **MISSING** |
| **HAT_TRICK** | Strzelcy | ❌ NO | **MISSING** |

**Coverage Analysis:**
- **Expected from screenshots:** 20+ market types
- **Actually returned by API:** 5 market types
- **Coverage:** ~25% (5/20 types)
- **Focus:** 97% of markets are player props (GOALSCORER)

---

## Comparison: Captured vs Expected

### Market Coverage Matrix

| Tab | Market Types Expected (from Screenshots) | Found in API | Gap |
|------|-----------------------------------|----------------|------|
| **Top** | 1X2, DOUBLE_CHANCE, OVER_UNDER, BTTS, HANDICAP, CORRECT_SCORE, HALF_TIME_1X2, GOALSCORER | 1X2 ✅, DOUBLE_CHANCE ✅, OVER_UNDER ✅, BTTS ✅, GOALSCORER ✅ | HANDICAP ❌, CORRECT_SCORE ❌, HALF_TIME_1X2 ❌ |
| **Wynik** | 1X2, DOUBLE_CHANCE, DRAW_NO_BET, HT_FT, WIN_TO_NIL, WIN_BOTH_HALVES | 1X2 ✅, DOUBLE_CHANCE ✅ | DRAW_NO_BET ❌, HT_FT ❌, WIN_TO_NIL ❌, WIN_BOTH_HALVES ❌ |
| **Strzelcy** | ANYTIME_SCORER, FIRST_LAST_SCORER, HAT_TRICK, PLAYER_ASSISTS | GOALSCORER ✅ (partial) | FIRST_LAST_SCORER ❌, HAT_TRICK ❌, PLAYER_ASSISTS ❌ |
| **Gole** | OVER_UNDER, BTTS, TEAM_GOALS, GOAL_TIMING, CLEAN_SHEET | OVER_UNDER ✅, BTTS ✅ | TEAM_GOALS ❌, GOAL_TIMING ❌, CLEAN_SHEET ❌ |
| **Metoda Gola** | PENALTY_GOAL, HEADER_GOAL, FREE_KICK_GOAL | ❌ | ALL MISSING ❌ |

### Coverage by Category

| Category | Expected Types | Found in API | Coverage |
|----------|----------------|----------------|----------|
| **Result Markets** | 1X2, DOUBLE_CHANCE, DRAW_NO_BET, HT_FT, WIN_BOTH_HALVES, WIN_TO_NIL | 1X2, DOUBLE_CHANCE | 2/6 = 33% |
| **Goal Markets** | OVER_UNDER, BTTS, TEAM_GOALS, GOAL_TIMING, CLEAN_SHEET | OVER_UNDER, BTTS | 2/5 = 40% |
| **Player Markets** | ANYTIME_SCORER, FIRST_LAST_SCORER, HAT_TRICK, PLAYER_ASSISTS | GOALSCORER (generic) | 1/4 = 25% |
| **Method Markets** | PENALTY_GOAL, HEADER_GOAL, FREE_KICK_GOAL | NONE | 0/3 = 0% |
| **Exact Markets** | CORRECT_SCORE | NONE | 0/1 = 0% |

---

## Technical Findings

### Finding 1: Client-Side Tab Filtering (Confirmed)

**Evidence:**
1. All 7 tabs tested in research-002 - **0 network requests** triggered
2. All filter values (0, 1, 5) tested - **0 differences** in responses
3. Screenshots show **different market sets** per tab
4. API returns **single response** with all data it has

**Conclusion:** Betclic loads **all available market data** in initial `GetMatchWithNotification` response, then uses **JavaScript to filter display** based on tab selection.

### Finding 2: API Does Not Support Field 2 Filtering

**Evidence:**
- Request with Field 2 (market_group) value 0: **Identical** to baseline
- Request with Field 2 value 1: **Identical** to baseline
- Request with Field 2 value 5: **Identical** to baseline

**Conclusion:** `buildMatchDetailsRequestWithFilter()` in navigation.ts **does not filter** data server-side. Field 2 is either:
- Ignored by API
- Used for other purposes (caching, logging)
- Deprecated feature

**Implication:** Multi-tab API fetching (`fetchAllMarketGroups()` in navigation.ts) will return **7 identical responses**, wasting bandwidth and time.

### Finding 3: API Response Has Significant Market Coverage Gap

**Evidence:**
- Screenshots show **20+ market types** across 5 tabs
- API returns only **5 market types** (1X2, DOUBLE_CHANCE, OVER_UNDER, BTTS, GOALSCORER)
- 97% of API markets are **GOALSCORER** (player props)
- **Major missing types:** CORRECT_SCORE, HANDICAP, HALF_TIME_1X2, WIN_BOTH_HALVES, GOAL_TIMING, GOAL_METHOD

**Possible explanations:**

1. **Different response for authenticated users** - Screenshots may show logged-in state
2. **Different response based on geolocation** - PL vs other regions
3. **JavaScript-rendered markets** - Some markets calculated in browser from API data
4. **Time-sensitive availability** - Some markets only available closer to match time
5. **Match-specific** - Test match has limited market set

**Investigation needed:**
- Check if response differs with cookies/session
- Compare response headers (X-Bg-Ref-Regulator-Zone, etc.)
- Verify if some markets are calculated client-side from GOALSCORER data

### Finding 4: Tab Structure Complexity

**Evidence from screenshot analysis:**
- Top tab: Standard market cards
- Wynik tab: Accordion-style sections with sub-markets
- Strzelcy tab: Grid layout with players × market types
- Gole tab: Deeply nested sections (Gole, Both Teams, Team Goals, Half Goals, Timing)
- Metoda Gola tab: **3 sub-tabs** (Penalty, Header, Free Kick)

**Conclusion:** Tab structure is **highly variable**, making automated tab clicking challenging. Standard Playwright selectors (`button:has-text()`, `a:has-text()`) will **not work reliably** for all tabs.

---

## Session/Cookie Requirements

### Headers Used by Browser

From research-002 and current implementation:

```typescript
const GRPC_HEADERS = {
  "Content-Type": "application/grpc-web-text",
  "Accept": "application/grpc-web-text",
  "X-Grpc-Web": "1",
  "X-Bg-Ref-Brand": "BETCLIC",
  "X-Bg-Ref-Platform": "DESKTOP",
  "X-Bg-Ref-Regulator-Zone": "PL",
  "User-Agent": "Mozilla/5.0 ...",
  "Origin": "https://www.betclic.pl",
  "Referer": "https://www.betclic.pl/"
};
```

### Session Testing

**Research-001 finding:** No session/cookie dependency detected for API calls.

**Current investigation finding:** API works without cookies/session headers.

**Recommendation:** Try adding real browser cookies to API request to test if logged-in state returns more markets:

```typescript
// Capture cookies from Playwright and add to API request
const cookies = await page.context().cookies();
const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");
headers["Cookie"] = cookieHeader;
```

---

## Recommendations

### Recommendation 1: Hybrid Scraping Approach (RECOMMENDED)

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│             Hybrid Scraper Architecture                │
└─────────────────────────────────────────────────────────────┘

1. API Fetch (Primary)
   ├─ Fetch match details via GetMatchWithNotification
   ├─ Parse 342 markets (mainly player props)
   └─ Extract basic market data (1X2, O/U, BTTS)

2. Browser State Capture (Secondary)
   ├─ Navigate to match page with Playwright
   ├─ Wait for initial load (markets rendered)
   ├─ DO NOT click tabs (no new network requests)
   ├─ Capture rendered HTML for each tab using JavaScript
   │  ├─ Evaluate: document.querySelector('.tab-content')
   │  ├─ Iterate through all tabs programmatically
   │  └─ Extract market data from DOM
   └─ Parse DOM to extract odds/selections

3. Data Merging
   ├─ Use API data for player props (333 markets)
   ├─ Use DOM data for missing market types
   ├─ Deduplicate by market name + type
   └─ Return unified dataset
```

**Benefits:**
- ✅ Fast API fetch for bulk player props
- ✅ Complete market coverage from browser
- ✅ No need to simulate tab clicks (slow)
- ✅ Robust to API changes
- ✅ Leverages JavaScript filtering already in place

**Trade-offs:**
- ⚠️ Requires Playwright (slower than pure API)
- ⚠️ More complex parsing (DOM + protobuf)
- ⚠️ Potential breaking if Betclic changes UI

### Recommendation 2: Fallback Architecture

```
if (API market count < expected_threshold) {
    // Use hybrid approach
    return scrapeHybrid(matchId, matchUrl);
} else {
    // Pure API sufficient
    return scrapeApiOnly(matchId);
}
```

**Threshold:** If API returns < 200 markets, use hybrid approach.

### Recommendation 3: Skip API Filtering

**Action:**
- **Keep** `fetchAllMarketGroups()` for compatibility (may work for future versions)
- **Add deprecation comment:** "API Field 2 filtering not functional as of 2026-01-23"
- **Document** in navigation.ts: "All filter values return identical data"
- **Do NOT use** in production (wastes bandwidth)

### Recommendation 4: Investigate Session-Based Responses

**Experiment:**
1. Login to Betclic with real account in Playwright
2. Capture cookies after login
3. Make API request with cookies
4. Compare market count to current baseline

**Hypothesis:** Logged-in users may see more markets (especially goal method, correct score).

### Recommendation 5: Focus on DOM Parsing, Not Tab Clicking

**Rationale:**
- Tab switching does NOT trigger network requests (confirmed)
- All data is already loaded in DOM
- JavaScript filters DOM elements by tab

**Implementation:**
```typescript
async function scrapeAllTabsDom(page: Page): Promise<ScrapedMarket[]> {
  const allMarkets: ScrapedMarket[] = [];

  // Get all tab content elements
  const tabs = await page.locator('[role="tab"]').all();

  for (const tab of tabs) {
    // Activate tab via JavaScript (click may be flaky)
    await tab.evaluate((el) => el.click());

    // Wait for DOM update
    await page.waitForTimeout(500);

    // Extract markets from visible DOM
    const tabMarkets = await extractMarketsFromDom(page);
    allMarkets.push(...tabMarkets);
  }

  return allMarkets;
}
```

---

## Implementation Priority

### High Priority (For Full Coverage)

1. **Implement DOM-based market extraction**
   - Parse markets from rendered HTML
   - Handle all 5 tab structures
   - Extract odds and selections

2. **Create hybrid scraper function**
   - API fetch for baseline
   - DOM extraction for missing markets
   - Merge and deduplicate

3. **Test on multiple matches**
   - Verify coverage > 80%
   - Compare against screenshots

### Medium Priority (Robustness)

4. **Add cookie/session testing**
   - Test with real login
   - Compare market coverage

5. **Improve error handling**
   - Graceful fallback if DOM extraction fails
   - Retry logic for network issues

### Low Priority (Cleanup)

6. **Deprecate multi-tab API code**
   - Add comments
   - Keep for potential future use

7. **Update documentation**
   - AGENTS.md with hybrid pattern
   - README with architecture diagram

---

## Conclusion

### Summary of Findings

| Aspect | Finding | Impact |
|---------|----------|--------|
| **Tab Behavior** | Client-side filtering, no network requests | Pure tab clicking won't work |
| **API Filtering** | Field 2 ignored, all values identical | Multi-tab API fetch is useless |
| **API Coverage** | 342 markets, 5 types, 97% player props | Major gap vs UI (20+ types) |
| **Session/Cookie** | Not required for current API response | May affect logged-in users |
| **Recommendation** | Hybrid approach (API + DOM) | Best balance of speed and coverage |

### Final Recommendation

**Use Hybrid Scraping Approach:**

1. **Primary:** API fetch for player props (fast, reliable)
2. **Secondary:** DOM extraction for all other markets (complete coverage)
3. **Fallback:** Pure API if coverage is sufficient

**Do NOT implement:**
- ❌ Tab clicking automation (no network requests)
- ❌ Multi-tab API filtering (Field 2 ignored)
- ❌ Pure Playwright scraping (too slow)

**Next Steps:**
1. Create DOM parser for Betclic market UI
2. Implement hybrid scraper
3. Test on 5+ matches
4. Compare coverage to expected market types

---

## Files Created

- `backend/docs/betclic-tab-discovery-2026.md` - This document

## Related Documents

- `backend/docs/betclic-tab-discovery-2026-01-23.md` - Tab click network analysis
- `backend/docs/betclic-api-documentation.md` - gRPC endpoint docs
- `backend/src/scrapers/bookmakers/betclic/navigation.ts` - API implementation
- `backend/src/scrapers/bookmakers/betclic/parser.ts` - Protobuf parser
- `docs/betclic-screenshots/` - Visual reference for all tabs

---

**Analysis completed:** 2026-01-23
**Total analysis time:** ~2 hours
**Matches tested:** 2 (1 successful, 1 failed)
**Screenshots analyzed:** 5
**Filter values tested:** 3 (0, 1, 5) + baseline
