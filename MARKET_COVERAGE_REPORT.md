# Market Normalization Coverage Report
## Based on Actual Scanned Data from Supabase

### Overview
- Total bookmakers: 14
- Target markets: 40 (10 Core + 20 Non-Core + 10 Extended)
- Target: 70% overall coverage per bookmaker
- Analysis date: 2026-01-08

### Current Real Coverage Status

| Bookmaker | Core/10 | Non-Core/20 | Extended/10 | Overall/40 | Status |
|-----------|----------|--------------|-------------|------------|---------|
| **lvbet** | 100% (10) | 60% (12) | 80% (8) | **75% (30)** | ✅ Above 70% |
| **betfan** | 100% (10) | 70% (14) | 60% (6) | **75% (30)** | ✅ Above 70% |
| **betcris** | 100% (10) | 65% (13) | 60% (6) | **72.5% (29)** | ✅ Above 70% |
| totalbet | 100% (10) | 70% (14) | 10% (1) | 62.5% (25) | ❌ Below 70% |
| fuksiarz | 100% (10) | 50% (10) | 50% (5) | 62.5% (25) | ❌ Below 70% |
| forbet | 100% (10) | 60% (12) | 10% (1) | 57.5% (23) | ❌ Below 70% |
| etoto | 100% (10) | 55% (11) | 20% (2) | 57.5% (23) | ❌ Below 70% |
| pzbuk | 80% (8) | 70% (14) | 0% (0) | 55% (22) | ❌ Below 70% |
| superbet | 100% (10) | 45% (9) | 10% (1) | 47.5% (19) | ❌ Below 70% |
| betters | 100% (10) | 35% (7) | 0% (0) | 42.5% (17) | ❌ Below 70% |
| fortuna | 100% (10) | 30% (6) | 10% (1) | 42.5% (17) | ❌ Below 70% |
| sts | 70% (7) | 35% (7) | 20% (2) | 40% (16) | ❌ Below 70% |
| betclic | 50% (5) | 15% (3) | 0% (0) | 20% (8) | ❌ Below 70% |
| **Average** | **93%** | **58%** | **28%** | **60%** | **Need 23% more** |

### Key Findings

#### ✅ Positive (3/14 bookmakers meet 70% target)
1. **lvbet (75%)**: Excellent extended market coverage with CORNERS_TEAM, CARDS_TEAM, OFFSIDES_TOTAL
2. **betfan (75%)**: Strong coverage with all core markets and HOME_TEAM_TO_SCORE
3. **betcris (72.5%)**: Very comprehensive with PLAYER stats and FOULS_TOTAL

#### ❌ Areas for Improvement (11/14 bookmakers below 70%)

**Most Critical (<50% overall):**
1. **betclic (20%)**: Only has 5 core markets, missing 33/40 target markets
2. **sts (40%)**: Missing HALF_TIME_RESULT from core, limited non-core
3. **betters (42.5%)**: Good core coverage, but lacks non-core and extended markets

**Moderate Need Improvement (40-60% overall):**
4. **fortuna (42.5%)**: Strong core, but weak non-core and extended
5. **superbet (47.5%)**: Good core, but only PLAYER_CARDS in extended
6. **etoto (57.5%)**: Good core, limited extended (only PLAYER_SHOTS)
7. **forbet (57.5%)**: Good core, weak extended (only OFFSIDES_TOTAL)
8. **pzbuk (55%)**: Missing 2 core markets (ASIAN, EU HANDICAP)

**Near Target (60-65% overall):**
9. **fuksiarz (62.5%)**: Missing non-core markets like TEAM_TOTAL_GOALS, GOAL_RANGE
10. **totalbet (62.5%)**: Strong non-core, but very weak extended

### Market-Specific Gaps

**Extended Markets (target 10, avg 28% coverage):**
| Market | Bookmakers With Data | Coverage |
|--------|-------------------|----------|
| PLAYER_SHOTS | 6/14 (betcris, etoto, fuksiarz, lvbet, sts, superbet) | 43% |
| PLAYER_CARDS | 6/14 (betcris, betfan, fuksiarz, lvbet, sts, superbet) | 43% |
| OFFSIDES_TOTAL | 5/14 (betcris, betfan, forbet, fuksiarz, lvbet, sts) | 36% |
| HOME_TEAM_TO_SCORE | 5/14 (betfan, etoto, fuksiarz, lvbet, totalbet) | 36% |
| FOULS_TOTAL | 5/14 (betcris, betfan, forbet, fuksiarz, lvbet) | 36% |
| CORNERS_TEAM | 3/14 (betcris, fortuna, lvbet) | 21% |
| CARDS_TEAM | 2/14 (betcris, lvbet) | 14% |
| PLAYER_ASSISTS | 1/14 (betfan only) | 7% |
| DOUBLE_RESULT | 1/14 (lvbet only) | 7% |
| AWAY_TEAM_TO_SCORE | 0/14 (none) | 0% |

### Recommendations

1. **Scrapers with <70% coverage need work:**
   - Focus on identifying more market types in the DOM/API responses
   - Add pattern matching for currently unclassified "OTHER" markets
   - Update scraper constants with discovered market IDs

2. **Priority for quick wins (>50% improvement needed):**
   - **betclic**: Add 5 more core markets + discover 15+ non-core/extended
   - **sts**: Add HALF_TIME_RESULT, improve non-core coverage
   - **betters**: Focus on non-core and extended markets discovery

3. **Extended markets strategy:**
   - These are the hardest to reach (avg 28%)
   - Focus on bookmakers that already have some extended markets
   - Gradually expand to other bookmakers as patterns emerge

4. **Data quality check:**
   - Ensure normalization is not misclassifying available markets as "OTHER"
   - Verify scrapers are capturing all visible markets on bookmaker pages/APIs

### Next Steps

To reach 70% overall coverage, each bookmaker needs to discover additional markets. The test file has been updated to reflect real data from Supabase, removing fictional 100% coverage.

**Gap to 70% for each bookmaker:**
- betclic: +50% (need +20 markets)
- sts: +30% (need +12 markets)
- betters: +27.5% (need +11 markets)
- fortuna: +27.5% (need +11 markets)
- superbet: +22.5% (need +9 markets)
- etoto: +12.5% (need +5 markets)
- forbet: +12.5% (need +5 markets)
- pzbuk: +15% (need +6 markets)
- fuksiarz: +7.5% (need +3 markets)
- totalbet: +7.5% (need +3 markets)

Total additional markets needed across all bookmakers: ~105
