# Betclic Market Coverage Baseline

**Generated:** 2026-01-22
**Test Match ID:** 905675290968064
**Test Match:** West Ham - Sunderland (Premier League)
**Test URL:** https://www.betclic.pl/pilka-nozna-sfootball/premier-league-c3/west-ham-sunderland-m905675290968064

---

## Executive Summary

This document establishes the baseline market coverage for the Betclic scraper **before** implementing multi-tab fetching. The current implementation fetches data from a single gRPC request without market group filters, which appears to return only a subset of available markets.

### Key Findings

| Metric | Value |
|--------|-------|
| **Total Markets Found** | 343 |
| **Unique Market Types** | 5 |
| **Unique Market Groups** | 3 |
| **Expected Market Types** | 8 (basic) / 30+ (full) |
| **Coverage (Basic)** | 62.5% (5/8 types) |
| **Missing Critical Types** | CORRECT_SCORE, HANDICAP, HALF_TIME_1X2 |

---

## 1. Total Markets Found

**343 markets** were parsed from the gRPC response.

However, the distribution is heavily skewed:
- **334 markets (97.4%)** are GOALSCORER type (player markets)
- **9 markets (2.6%)** are other types

This suggests the current response may be returning the "Strzelcy" (Scorers) tab data predominantly, with only basic match result markets from other tabs.

---

## 2. Market Types Found

| Type | Count | Percentage | Status |
|------|-------|------------|--------|
| GOALSCORER | 334 | 97.4% | Found |
| OVER_UNDER | 6 | 1.7% | Found |
| 1X2 | 1 | 0.3% | Found |
| DOUBLE_CHANCE | 1 | 0.3% | Found |
| BTTS | 1 | 0.3% | Found |

### Sample Markets by Type

| Type | Sample Market Names |
|------|---------------------|
| GOALSCORER | "Strzelec: West Ham", "Strzelec: Sunderland" |
| OVER_UNDER | "Liczba goli 0.5", "Liczba goli 1.5", "Liczba goli 2.5" |
| 1X2 | "Wynik meczu" |
| DOUBLE_CHANCE | "Podwojna szansa" |
| BTTS | "Obie druzyny strzela" |

---

## 3. Market Groups Found

| Group Name | Count | Market Types |
|------------|-------|--------------|
| Inne | 334 | GOALSCORER |
| Gole | 7 | OVER_UNDER, BTTS |
| Wynik meczu | 2 | 1X2, DOUBLE_CHANCE |

**Note:** The "Inne" (Other) group contains all goalscorer markets, which should ideally be in a "Strzelcy" (Scorers) group. This may indicate a parsing or grouping issue.

---

## 4. Expected Market Types by Tab

Based on the Betclic website analysis (see `betclic-tab-network-analysis.md` and `betclic-multi-tab-scraping-plan.md`), the following market types are expected from each of the 7 tabs:

### Tab 1: Top (Main/Popular)
| Expected Type | Status | Notes |
|---------------|--------|-------|
| 1X2 | FOUND | Match result |
| DOUBLE_CHANCE | FOUND | 1X, X2, 12 |
| BTTS | FOUND | Both teams to score |
| OVER_UNDER | FOUND | Total goals |
| HANDICAP | MISSING | Asian/European handicap |
| CORRECT_SCORE | MISSING | Exact score |
| GOALSCORER | FOUND | Anytime scorer |

### Tab 2: Wynik (Result)
| Expected Type | Status | Notes |
|---------------|--------|-------|
| 1X2 | FOUND | Match result |
| DRAW_NO_BET | MISSING | DNB market |
| DOUBLE_CHANCE | FOUND | 1X, X2, 12 |
| HALF_TIME_1X2 | MISSING | HT result |
| HT_FT | MISSING | Half-time/Full-time |
| WIN_TO_NIL | MISSING | Clean sheet win |
| RESULT_BTTS | MISSING | Result + BTTS combo |

### Tab 3: Strzelcy (Scorers)
| Expected Type | Status | Notes |
|---------------|--------|-------|
| GOALSCORER | FOUND | Anytime scorer (334 markets!) |
| FIRST_SCORER | MISSING | First goalscorer |
| LAST_SCORER | MISSING | Last goalscorer |
| SCORER_2PLUS | MISSING | 2+ goals scorer |
| SCORER_HATTRICK | MISSING | Hat-trick scorer |
| PLAYER_ASSIST | MISSING | Player assists |

### Tab 4: Gole (Goals)
| Expected Type | Status | Notes |
|---------------|--------|-------|
| OVER_UNDER | FOUND | Total goals O/U |
| TEAM_TOTAL_GOALS | MISSING | Team goals O/U |
| BTTS | FOUND | Both teams to score |
| GOAL_RANGE | MISSING | Goal ranges (0-1, 2-3, etc.) |
| HALF_GOALS | MISSING | Goals per half |
| ODD_EVEN_GOALS | MISSING | Odd/Even total |

### Tab 5: Metoda Gola (Goal Method)
| Expected Type | Status | Notes |
|---------------|--------|-------|
| PENALTY_GOAL | MISSING | Goal from penalty |
| HEADER_GOAL | MISSING | Goal by header |
| FREE_KICK_GOAL | MISSING | Goal from free kick |

### Tab 6: Wynik / Handicap (Result / Handicap)
| Expected Type | Status | Notes |
|---------------|--------|-------|
| HANDICAP | MISSING | European handicap |
| ASIAN_HANDICAP | MISSING | Asian handicap |
| CORRECT_SCORE | MISSING | Exact score |
| GOAL_MARGIN | MISSING | Winning margin |

### Tab 7: Statystyki (Statistics)
| Expected Type | Status | Notes |
|---------------|--------|-------|
| CORNERS | MISSING | Corner markets |
| CARDS | MISSING | Card markets |
| SHOTS | MISSING | Shot markets |
| FOULS | MISSING | Foul markets |
| OFFSIDES | MISSING | Offside markets |

---

## 5. Coverage Analysis

### Basic Expected Types (from discovery script)

| Expected Type | Status |
|---------------|--------|
| 1X2 | FOUND |
| DOUBLE_CHANCE | FOUND |
| BTTS | FOUND |
| OVER_UNDER | FOUND |
| CORRECT_SCORE | MISSING |
| HANDICAP | MISSING |
| HALF_TIME_1X2 | MISSING |
| GOALSCORER | FOUND |

**Basic Coverage: 5/8 = 62.5%**

### Full Expected Types (all 7 tabs)

| Category | Expected | Found | Missing |
|----------|----------|-------|---------|
| Match Result | 7 | 3 | 4 |
| Scorers | 6 | 1 | 5 |
| Goals | 6 | 2 | 4 |
| Goal Method | 3 | 0 | 3 |
| Handicap | 4 | 0 | 4 |
| Statistics | 5 | 0 | 5 |
| **TOTAL** | **31** | **6** | **25** |

**Full Coverage: 6/31 = 19.4%**

---

## 6. Missing Market Types Summary

### Critical Missing (High Priority)
1. **CORRECT_SCORE** - Popular market, expected in Top/Handicap tabs
2. **HANDICAP** - Essential for value betting
3. **HALF_TIME_1X2** - Common market type
4. **ASIAN_HANDICAP** - Important for professional bettors

### Important Missing (Medium Priority)
5. **FIRST_SCORER** - Popular player market
6. **LAST_SCORER** - Popular player market
7. **TEAM_TOTAL_GOALS** - Team-specific O/U
8. **CORNERS** - Statistics market
9. **CARDS** - Statistics market

### Nice to Have (Lower Priority)
10. **PENALTY_GOAL** - Goal method
11. **HEADER_GOAL** - Goal method
12. **FREE_KICK_GOAL** - Goal method
13. **SHOTS** - Statistics
14. **FOULS** - Statistics

---

## 7. Conclusion

### Is Multi-Tab Fetching Needed?

**YES - Multi-tab fetching is required.**

Evidence:
1. **Only 19.4% coverage** of expected market types
2. **Missing entire categories**: Handicap, Statistics, Goal Method
3. **Skewed distribution**: 97% of markets are GOALSCORER type
4. **Missing critical markets**: CORRECT_SCORE, HANDICAP, HALF_TIME_1X2

### Root Cause Analysis

The current implementation sends a single gRPC request with only the match ID:
```protobuf
message GetMatchRequest {
  uint64 match_id = 1;  // Tag 0x08
}
```

Based on network analysis, Betclic's API uses a **market group filter** parameter to return different market categories. Without this filter, the API appears to return a default subset (possibly "Top" tab + Scorers).

### Recommended Next Steps

1. **Discovery Phase**: Use `betclic-filter-discovery.ts` to identify the correct field number and values for market group filtering
2. **Implementation Phase**: Add `buildMatchDetailsRequestWithFilter()` and `fetchAllMarketGroups()` functions
3. **Parsing Phase**: Implement `parseAllMarketsFromMultipleResponses()` for merging and deduplication
4. **Verification Phase**: Re-run discovery script to confirm improved coverage

### Expected Improvement

After implementing multi-tab fetching:
- **Expected market types**: 30+ (vs current 6)
- **Expected coverage**: >90% (vs current 19.4%)
- **Expected total markets**: 500+ per match (vs current 343)

---

## Appendix A: Raw Discovery Output

```
====================================================================================================
BETCLIC MARKET DISCOVERY - ANALYSIS SUMMARY
====================================================================================================

Match: West Ham - Sunderland
Match ID: 905675290968064
Home Team: West Ham
Away Team: Sunderland

----------------------------------------------------------------------------------------------------
TOTAL MARKETS: 343
----------------------------------------------------------------------------------------------------

====================================================================================================
MARKETS BY TYPE
====================================================================================================

Type                      Count    Sample Markets
───────────────────────── ──────── ────────────────────────────────────────────────────────────
  GOALSCORER             334      Strzelec: West Ham, Strzelec: Sunderland
  OVER_UNDER             6        Liczba goli 0.5, Liczba goli 1.5
  1X2                    1        Wynik meczu
  DOUBLE_CHANCE          1        Podwojna szansa
  BTTS                   1        Obie druzyny strzela

====================================================================================================
MARKETS BY GROUP NAME
====================================================================================================

Group Name                          Count    Types
─────────────────────────────────── ──────── ──────────────────────────────────────────────────
Inne                                334      GOALSCORER
Gole                                7        OVER_UNDER, BTTS
Wynik meczu                         2        1X2, DOUBLE_CHANCE

====================================================================================================
MISSING EXPECTED MARKET TYPES
====================================================================================================
  CORRECT_SCORE
  HANDICAP
  HALF_TIME_1X2
```

---

## Appendix B: Test Environment

- **Script**: `backend/scripts/betclic-market-discovery.ts`
- **Command**: `npx tsx scripts/betclic-market-discovery.ts`
- **API Endpoint**: `https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService/GetMatchWithNotification`
- **Response Size**: 98,066 bytes
- **Parse Time**: <1 second

---

*End of Document*
