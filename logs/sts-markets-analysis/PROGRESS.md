# STS Market Analysis Progress Tracker

Generated: 2026-01-13
Total Markets: 114
Markets Reviewed: 114 / 114

## Status Legend
- [ ] Not started
- [x] Completed
- [~] In progress
- [!] Blocked/Issue

## Latest Market Discovery
- Run: `npx tsx scripts/sts-market-discovery.ts --all` (2026-01-13)
- Output: `backend/logs/test_sts.txt`
- Best fixture: RC Strasbourg vs FC Metz (ligue-1) — 114 markets
- Notes: Two fixtures returned no WebSocket data during scan

---

## Market Review Checklist

Review every market in order. Use the checklist to track full analysis per market.

### combinations (10 markets)
- [x] Market 49: Wynik + BTTS -> RESULT_AND_BTTS
- [x] Market 50: Wynik + liczba goli -> TOTAL_GOALS_AND_BTTS
- [x] Market 51: Wynik + liczba goli (szczeg) -> RESULT_AND_TOTAL
- [x] Market 258: Pierwszy gol + wynik -> FIRST_GOAL_AND_RESULT
- [x] Market 807: DC + BTTS (var1) -> DOUBLE_CHANCE_BTTS
- [x] Market 808: Wynik 2. poł + BTTS -> RESULT_AND_BTTS
- [x] Market 809: Wynik 2. poł + gole -> SECOND_HALF_RESULT_AND_TOTAL
- [x] Market 810: DC + BTTS (var2) -> DOUBLE_CHANCE_BTTS
- [x] Market 811: DC + BTTS (var3) -> DOUBLE_CHANCE_BTTS
- [x] Market 812: DC + gole -> DOUBLE_CHANCE_TOTAL

### correct-score (2 markets)
- [x] Market 57: HT/FT - Dokładny wynik -> HT_FT_CORRECT_SCORE
- [x] Market 283: Dokładny wynik -> CORRECT_SCORE

### first-half (17 markets)
- [x] Market 71: Wynik 1. połowy -> HALF_TIME_RESULT
- [x] Market 73: Pierwszy gol 1. poł -> FIRST_TEAM_TO_SCORE
- [x] Market 74: Podwójna szansa 1. poł -> DOUBLE_CHANCE
- [x] Market 75: Remis = zwrot 1. poł -> DRAW_NO_BET
- [x] Market 76: Handicap europejski 1. poł -> EUROPEAN_HANDICAP
- [x] Market 77: Handicap azjatycki 1. poł -> ASIAN_HANDICAP
- [x] Market 79: Handicap europejski 1. poł (alt) -> EUROPEAN_HANDICAP
- [x] Market 80: Liczba goli 1. poł (alt) -> HALF_TIME_TOTAL_GOALS
- [x] Market 82: Liczba goli 1. połowa -> HALF_TIME_TOTAL_GOALS
- [x] Market 85: Gole gosp 1. połowa -> HALF_TIME_TOTAL_GOALS
- [x] Market 88: Gole gości 1. połowa -> HALF_TIME_TOTAL_GOALS
- [x] Market 90: Przedział goli 1. poł -> HALF_TIME_GOAL_RANGE
- [x] Market 94: Parzyste/nieparzyste 1. poł -> ODD_EVEN_GOALS
- [x] Market 95: BTTS 1. połowa -> HALF_TIME_BTTS
- [x] Market 98: 1. poł - Wynik + BTTS -> HALF_TIME_RESULT_AND_BTTS
- [x] Market 99: Wynik + gole 1. poł -> RESULT_AND_TOTAL
- [x] Market 101: Dokładny wynik 1. poł -> CORRECT_SCORE

### goal-ranges (6 markets)
- [x] Market 813: Przedział goli -> GOAL_RANGE
- [x] Market 814: Przedział goli gosp -> TEAM_GOAL_RANGE
- [x] Market 815: Przedział goli gości -> TEAM_GOAL_RANGE
- [x] Market 816: Multiwynik -> MULTI_RESULT
- [x] Market 817: Przedział goli 1. poł (var4) -> HALF_TIME_GOAL_RANGE
- [x] Market 818: Przedział goli 2. poł -> SECOND_HALF_GOAL_RANGE

### goals (14 markets)
- [x] Market 8: Pierwszy gol -> FIRST_TEAM_TO_SCORE
- [x] Market 9: Ostatni gol -> FIRST_TEAM_TO_SCORE
- [x] Market 25: Liczba goli -> TOTAL_GOALS
- [x] Market 28: Gole gospodarzy -> TEAM_TOTAL_GOALS
- [x] Market 31: Gole gości -> TEAM_TOTAL_GOALS
- [x] Market 33: Przedział goli -> GOAL_RANGE
- [x] Market 35: Wygrana do zera (gosp) -> TEAM_GOAL_RANGE
- [x] Market 36: Czyste konto -> TEAM_GOAL_RANGE
- [x] Market 43: Obie strzelą (BTTS) -> BTTS
- [x] Market 44: Która strzeli pierwsza -> FIRST_TEAM_TO_SCORE
- [x] Market 47: Wygrana do zera (gosp) -> WIN_TO_NIL
- [x] Market 48: Wygrana do zera (gość) -> WIN_TO_NIL
- [x] Market 1224: Gość strzeli -> AWAY_TEAM_TO_SCORE
- [x] Market 1229: Gospodarz strzeli -> HOME_TEAM_TO_SCORE

### half-analysis (13 markets)
- [x] Market 58: Połowa/Koniec (HT/FT) -> HALFTIME_FULLTIME
- [x] Market 59: Gole w obu połowach (gosp) -> BOTH_HALVES_GOALS
- [x] Market 60: Gole w obu połowach (gość) -> BOTH_HALVES_GOALS
- [x] Market 61: Połowa z więcej goli -> BOTH_HALVES_GOALS
- [x] Market 62: (nieznany ID 62) -> BOTH_HALVES_GOALS
- [x] Market 63: (nieznany ID 63) -> BOTH_HALVES_GOALS
- [x] Market 64: (nieznany ID 64) -> BOTH_HALVES_GOALS
- [x] Market 65: (nieznany ID 65) -> BOTH_HALVES_GOALS
- [x] Market 66: (nieznany ID 66) -> BOTH_HALVES_GOALS
- [x] Market 67: (nieznany ID 67) -> BOTH_HALVES_GOALS
- [x] Market 68: (nieznany ID 68) -> BOTH_HALVES_GOALS
- [x] Market 69: (nieznany ID 69) -> BOTH_HALVES_GOALS
- [x] Market 70: (nieznany ID 70) -> BOTH_HALVES_GOALS

### half-team-score (4 markets)
- [x] Market 1232: 1. poł - Gość strzeli -> HALF_TIME_AWAY_TO_SCORE
- [x] Market 1233: 1. poł - Gospodarz strzeli -> HALF_TIME_HOME_TO_SCORE
- [x] Market 1234: 2. poł - Gość strzeli -> SECOND_HALF_AWAY_TO_SCORE
- [x] Market 1235: 2. poł - Gospodarz strzeli -> SECOND_HALF_HOME_TO_SCORE

### handicaps (4 markets)
- [x] Market 14: Handicap europejski -> EUROPEAN_HANDICAP
- [x] Market 17: Margines zwycięstwa -> WINNING_MARGIN
- [x] Market 20: Handicap azjatycki -> ASIAN_HANDICAP
- [x] Market 22: Handicap azjatycki (alt) -> EUROPEAN_HANDICAP

### ht-ft-combos (1 market)
- [x] Market 1012: HT/FT + gole -> HALFTIME_FULLTIME_AND_TOTAL

### main-results (3 markets)
- [x] Market 1: Wynik meczu (1X2) -> MATCH_WINNER
- [x] Market 10: Podwójna szansa -> DOUBLE_CHANCE
- [x] Market 11: Remis = zwrot -> DRAW_NO_BET

### other (1 market)
- [x] Market 1244: Margines zwycięstwa (var5) -> HT_OR_FT_RESULT

### player-markets (4 markets)
- [x] Market 52: Pierwszy strzelec -> GOALSCORER_FIRST
- [x] Market 53: Ostatni strzelec -> GOALSCORER_LAST
- [x] Market 54: Strzelec w meczu -> GOALSCORER_ANYTIME
- [x] Market 1051: Strzelec + wynik -> PLAYER_GOAL_AND_RESULT

### second-half (15 markets)
- [x] Market 102: Wynik 2. połowy -> SECOND_HALF_RESULT
- [x] Market 103: Pierwszy gol 2. poł -> FIRST_TEAM_TO_SCORE
- [x] Market 104: Podwójna szansa 2. poł -> DOUBLE_CHANCE
- [x] Market 105: Remis = zwrot 2. poł -> DRAW_NO_BET
- [x] Market 106: Handicap europejski 2. poł -> EUROPEAN_HANDICAP
- [x] Market 107: Handicap azjatycki 2. poł -> ASIAN_HANDICAP
- [x] Market 109: Handicap europejski 2. poł (alt) -> EUROPEAN_HANDICAP
- [x] Market 110: Liczba goli 2. poł (alt) -> SECOND_HALF_TOTAL_GOALS
- [x] Market 112: Liczba goli 2. połowa -> SECOND_HALF_TOTAL_GOALS
- [x] Market 115: Gole gosp 2. połowa -> TEAM_TOTAL_GOALS
- [x] Market 118: Gole gości 2. połowa -> TEAM_TOTAL_GOALS
- [x] Market 119: Przedział goli gosp 2. poł -> TEAM_GOAL_RANGE
- [x] Market 120: Parzyste/nieparzyste 2. poł -> ODD_EVEN_GOALS
- [x] Market 121: BTTS 2. połowa -> SECOND_HALF_BTTS
- [x] Market 124: Dokładny wynik 2. poł -> CORRECT_SCORE

### time-based (7 markets)
- [x] Market 23: Liczba goli (zwrot) -> TOTAL_GOALS_ASIAN
- [x] Market 40: Parzyste/nieparzyste -> ODD_EVEN_GOALS
- [x] Market 41: Parzyste/nieparzyste (gosp) -> ODD_EVEN_GOALS
- [x] Market 42: Parzyste/nieparzyste (gość) -> ODD_EVEN_GOALS
- [x] Market 125: Czas pierwszego gola -> FIRST_GOAL_TIME
- [x] Market 126: Czas pierwszego gola (var) -> FIRST_GOAL_TIME
- [x] Market 132: Wynik w X minucie -> TIME_PERIOD_RESULT

### uncategorized (13 markets)
- [x] Market 220: Więcej rzutów rożnych -> CORNERS_RACE
- [x] Market 221: Pierwszy rzut rożny -> FIRST_CORNER
- [x] Market 225: Rzuty rożne handicap -> CORNERS_HANDICAP
- [x] Market 228: Rzuty rożne suma -> CORNERS_TOTAL
- [x] Market 235: Rzuty rożne 1. poł -> HALF_TIME_CORNERS_TOTAL
- [x] Market 236: Rzuty rożne gosp -> CORNERS_TEAM
- [x] Market 237: Rzuty rożne gości -> CORNERS_TEAM
- [x] Market 239: Więcej rożnych (var) -> CORNERS_RACE
- [x] Market 244: Rzuty rożne handicap (var) -> CORNERS_HANDICAP
- [x] Market 247: Rzuty rożne suma (var) -> CORNERS_TOTAL
- [x] Market 254: Rożne gosp 1. poł -> HALF_TIME_CORNERS_TEAM
- [x] Market 255: Rożne gości 1. poł -> HALF_TIME_CORNERS_TEAM
- [x] Market 256: Więcej rożnych 1. poł -> HALF_TIME_CORNERS_RACE

---

## Completed Work Log

| Date | Market ID | Change | Files Modified |
|------|-----------|--------|----------------|
| 2026-01-13 | 50 | Added TOTAL_GOALS_AND_BTTS mapping and selections | sts-normalizer.ts, types.ts, market-catalog.ts, selection-normalizer.ts, factory.ts |
| 2026-01-13 | 51 | Fixed RESULT_AND_TOTAL selection parsing | sts-normalizer.ts |
| 2026-01-13 | 99 | RESULT_AND_TOTAL selections normalized via STS parser | sts-normalizer.ts |
| 2026-01-13 | 809 | Fixed SECOND_HALF_RESULT_AND_TOTAL selection parsing | sts-normalizer.ts |
| 2026-01-13 | 813 | Avoided 1X2 overrides for goal ranges | sts-normalizer.ts |
