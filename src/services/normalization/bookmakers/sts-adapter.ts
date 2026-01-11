/**
 * STS Adapter
 *
 * Bookmaker adapter for STS (Star Tytuł Sportowy).
 *
 * STS uses "Rynek XX" format where XX is a numeric market ID.
 * Most patterns are in MARKET_REGISTRY, this adapter only contains:
 * - ID mappings (Rynek XX → market definition ID)
 * - Selection overrides (STS-specific codes like "1X", "02")
 */

import type { BookmakerAdapter } from "../types.js";
import { NormalizedSelection } from "../types.js";

/**
 * STS Adapter
 *
 * ID mappings are organized by market category for maintainability.
 * These correspond to the IDs defined in market-registry.ts bookmakerData.
 */
export const stsAdapter: BookmakerAdapter = {
  bookmaker: "sts",
  bookmakerName: "STS",

  // ==========================================================================
  // ID Mappings: Rynek XX → Market Definition ID
  // ==========================================================================
  idMappings: new Map([
    // ========================================================================
    // MAIN MARKETS (WYNIK_MECZU)
    // ========================================================================
    // Match Winner - 1X2 (ONLY market 1 is real match winner!)
    [1, "match-winner"],

    // Half Time Result (1. połowa)
    [71, "half-time-result"],

    // Second Half Result (2. połowa)
    [102, "other"], // TODO: Add second-half-result market type

    // Odd/Even Goals (Suma goli - parzysta/nieparzysta)
    [40, "other"], // Suma goli (odd/even)
    [41, "other"], // 1. drużyna - suma goli
    [42, "other"], // 2. drużyna - suma goli
    [94, "other"], // 1. połowa - suma goli
    [120, "other"], // 2. połowa - suma goli

    // Half with more goals (Połowa z większą liczbą goli)
    [63, "other"], // Połowa z większą liczbą goli
    [64, "other"], // 1. drużyna - połowa z większą liczbą goli
    [65, "other"], // 2. drużyna - połowa z większą liczbą goli

    // Both halves BTTS combos
    [66, "other"], // 1. połowa / 2. połowa - obie drużyny - strzelą gola

    // 2nd half European Handicap
    [106, "european-handicap"], // 2. połowa - handicap 1X2

    // 2nd half exact goals (not match-winner!)
    [119, "other"], // 2. połowa - dokładna liczba goli

    // 1st half OR final result (NOT match-winner!)
    [1244, "other"], // 1. połowa lub wynik końcowy

    // Double Chance
    [10, "double-chance"],

    // Draw No Bet / Level Handicap / 2-way Winner
    [4, "draw-no-bet"],  // Zakład bez remisu
    [20, "asian-handicap"],  // Handicap (z możliwością zwrotu) - uses "1 (+X)", "2 (-X)" format
    [77, "asian-handicap"],  // 1. połowa - handicap
    [259, "draw-no-bet"], // Zwycięzca walki
    [314, "draw-no-bet"], // Zwycięzca meczu
    [368, "draw-no-bet"], // Zwycięzca meczu

    // ========================================================================
    // GOALS MARKETS (GOLE)
    // ========================================================================
    // Total Goals - Over/Under (Liczba goli) - decimal lines (0.5, 1.5, 2.5, etc.)
    [25, "total-goals"],   // Liczba goli (decimal lines, no push)

    // Total Goals Asian - integer lines with push/refund
    [23, "total-goals-asian"],   // Liczba goli (z możliwym zwrotem) - integer lines (1, 2, 3, etc.)
    [80, "total-goals-asian"],   // 1. połowa - liczba goli (z możliwym zwrotem)
    [110, "total-goals-asian"],  // 2. połowa - liczba goli (z możliwym zwrotem)

    // Team Total Goals
    [28, "total-goals"],   // 1. drużyna - liczba goli
    [31, "total-goals"],   // 2. drużyna - liczba goli

    // First/Last Goal markets (NOT total goals!)
    [8, "other"],    // 1. gol (First goal - which team)
    [73, "other"],   // 1. połowa - 1. gol

    // 1st Half Double Chance / Draw No Bet (NOT total goals!)
    [74, "other"],   // 1. połowa - podwójna szansa
    [75, "other"],   // 1. połowa - zakład bez remisu

    // 2nd Half markets
    [103, "other"],  // 2. połowa - 1. gol
    [104, "other"],  // 2. połowa - podwójna szansa
    [105, "other"],  // 2. połowa - zakład bez remisu
    // Note: [110] is already mapped to "total-goals-asian" above
    [112, "total-goals"],  // 2. połowa - liczba goli (decimal lines)
    [115, "other"],  // 2. połowa - 1. drużyna - liczba goli
    [118, "other"],  // 2. połowa - 2. drużyna - liczba goli

    // BTTS - only REAL BTTS markets
    [43, "btts"],    // Obie drużyny - strzelą gola
    [95, "btts"],    // 1. połowa - obie drużyny - strzelą gola
    [121, "btts"],   // 2. połowa - obie drużyny - strzelą gola

    // Will team score? (team-specific BTTS variants)
    [1224, "other"], // 2. drużyna - strzeli gola
    [1229, "other"], // 1. drużyna - strzeli gola
    [1232, "other"], // 1. połowa - 2. drużyna - strzeli gola
    [1233, "other"], // 1. połowa - 1. drużyna - strzeli gola
    [1234, "other"], // 2. połowa - 2. drużyna - strzeli gola
    [1235, "other"], // 2. połowa - 1. drużyna - strzeli gola

    // Win to Nil (wygra do zera) - uses outcome IDs 26=Yes, 27=No
    [47, "win-to-nil"],   // 1. drużyna - wygra do zera
    [48, "win-to-nil"],   // 2. drużyna - wygra do zera

    // Team Exact Goals (dokładna liczba goli) - uses outcome IDs 1237-1240 (0, 1, 2, 3+)
    [35, "other"],        // 1. drużyna - dokładna liczba goli
    [36, "other"],        // 2. drużyna - dokładna liczba goli
    [90, "other"],        // 1. połowa - dokładna liczba goli

    // Team wins both halves / at least one half (NOT BTTS!)
    [59, "other"],   // 1. drużyna - wygra obie połowy
    [60, "other"],   // 2. drużyna - wygra obie połowy
    [61, "other"],   // 1. drużyna - wygra co najmniej jedną połowę
    [62, "other"],   // 2. drużyna - wygra co najmniej jedną połowę

    // Team scores in both halves (NOT BTTS!)
    [67, "other"],   // 1. drużyna - strzeli gola w obu połowach
    [68, "other"],   // 2. drużyna - strzeli gola w obu połowach

    // Both halves over/under 1.5 (NOT BTTS!)
    [69, "other"],   // Obie połowy powyżej 1.5 gola
    [70, "other"],   // Obie połowy poniżej 1.5 gola

    // 2nd Half Handicaps
    [107, "asian-handicap"],     // 2. połowa - handicap (z możliwością zwrotu)
    [109, "european-handicap"],  // 2. połowa - handicap

    // Unknown BTTS-related IDs (need verification)
    [196, "other"],
    [197, "other"],
    [198, "other"],
    [217, "other"],

    // ========================================================================
    // HANDICAP MARKETS
    // ========================================================================
    // European Handicap
    [14, "european-handicap"],
    [22, "european-handicap"],
    [76, "european-handicap"],
    [79, "european-handicap"],

    // ========================================================================
    // HALF-TIME MARKETS
    // ========================================================================
    // Half Time Result - NOTE: Market 5 doesn't exist in current STS data!
    // Market 71 is the real "1. połowa" (already mapped above)
    [5, "half-time-result"], // Keep for backward compatibility if it appears

    // Half Time Total Goals
    [26, "half-time-total-goals"],  // 1. połowa - liczba goli (legacy?)
    [82, "half-time-total-goals"],  // 1. połowa - liczba goli
    [85, "half-time-total-goals"],  // 1. połowa - 1. drużyna - liczba goli
    [88, "half-time-total-goals"],  // 1. połowa - 2. drużyna - liczba goli

    // ========================================================================
    // CORRECT SCORE
    // ========================================================================
    // Market 283 = main Correct Score (IDs 1783-1817)
    // Market 101 = 1st Half Correct Score
    // Market 124 = 2nd Half Correct Score
    [283, "correct-score"],
    [101, "correct-score"],
    [124, "correct-score"],
    [57, "other"],

    // ========================================================================
    // GOALSCORER MARKETS
    // ========================================================================
    // Market 9 = Last Goal (Ostatni gol)
    [9, "goalscorer-last"],
    // Market 52 = First Goalscorer (Zawodnik - strzeli 1. gola)
    [52, "goalscorer-first"],
    // Market 53 = Last Goalscorer (Zawodnik - strzeli ostatniego gola)
    [53, "goalscorer-last"],
    // Market 54 = Anytime Goalscorer (Zawodnik - strzeli gola)
    [54, "goalscorer-anytime"],

    // ========================================================================
    // GOALS MARKETS - additional
    // ========================================================================
    // Market 17 = Winning Margin (Różnica zwycięstwa)
    [17, "winning-margin"],
    // Market 33 = Goal Range (Przedział goli)
    [33, "goal-range"],
    // Market 98 = HT Result + BTTS combo (NOT simple HT BTTS!)
    [98, "other"],  // 1. połowa - wynik i obie drużyny - strzelą gola

    // ========================================================================
    // PLAYER MARKETS (ZAWODNICY)
    // ========================================================================
    // Player Goals with thresholds
    [1850, "goalscorer-anytime"], // Player goals with thresholds (1+, 2+, 3+)

    // Player Shots
    [1851, "player-shots"], // Player shots with thresholds

    // Player Assists
    [1845, "player-assists"], // Player assists with thresholds

    // ========================================================================
    // COMBINATION MARKETS (KOMBINACJE)
    // ========================================================================
    // Result + BTTS - selections should be: "1 i tak", "1 i nie", "X i tak", etc.
    // NOTE: Market 49/50 contains BTTS+O/U data ("+2.5 i tak"), NOT Result+BTTS
    // These need to be mapped to OTHER until we have a BTTS_AND_TOTAL type
    [49, "other"], // BTTS + O/U combo (not Result+BTTS)
    [50, "other"], // BTTS + O/U combo (not Result+BTTS)

    // Result + Total (many variants)
    // NOTE: Markets 807-818 contain complex combo data
    [51, "result-and-total"],
    [99, "result-and-total"],
    // Goal range / multi-goal markets - these are NOT result+total
    [807, "other"],
    [808, "other"],
    [809, "other"],
    [810, "other"],
    [811, "other"],
    [812, "other"],
    [813, "other"],
    [814, "other"],
    [815, "other"],
    [816, "other"],
    [817, "other"],
    [818, "other"],

    // HT/FT Result - simple 9 outcomes (1/1, 1/X, 1/2, X/1, X/X, X/2, 2/1, 2/X, 2/2)
    // Market 58 = simple HT/FT
    [58, "halftime-fulltime"],
    // NOTE: Market 1012 is HT/FT + O/U combo - NOT simple HT/FT!
    [1012, "other"], // HT/FT + O/U combo - needs separate type

    // ========================================================================
    // STATISTICS MARKETS (STATYSTYKI)
    // ========================================================================
    // Corners Race (Więcej rzutów rożnych)
    [220, "corners-race"],
    [239, "corners-race"], // 1. połowa - więcej rzutów rożnych

    // First Corner (Pierwszy rzut rożny)
    [221, "first-corner"],

    // Corners Handicap
    [225, "corners-handicap"],
    [244, "corners-handicap"], // 1. połowa - rzuty rożne - handicap

    // Cards Race (Więcej kartek)
    [178, "cards-race"],
    [199, "cards-race"], // 1. połowa - więcej kartek

    // First Card (Pierwsza kartka)
    [179, "first-card"],

    // ========================================================================
    // GOALS TIMING MARKETS (GOLE)
    // ========================================================================
    // First Team To Score
    [44, "first-team-to-score"], // "Która drużyna strzeli gola"

    // First Goal Time
    [125, "first-goal-time"], // "1. gol - przedziały 15-minutowe"
    [126, "first-goal-time"], // "1. gol - przedziały 10-minutowe"

    // Time Period Result
    [132, "time-period-result"], // "Wynik od 1. do 10. minuty"

    // ========================================================================
    // ADDITIONAL COMBINATION MARKETS
    // ========================================================================
    [258, "first-goal-and-result"], // "1. gol i wynik końcowy"

    // ========================================================================
    // ADDITIONAL PLAYER MARKETS
    // ========================================================================
    [1051, "player-goal-and-result"], // "Zawodnik - strzeli gola i wynik końcowy"
    [1852, "player-shots-on-target"], // "celne strzały"
    [1853, "player-passes"], // "podania"

    // ========================================================================
    // DRAW NO BET - Additional
    // ========================================================================
    [11, "draw-no-bet"],  // Zakład bez remisu

    // ========================================================================
    // OTHER / UNKNOWN
    // ========================================================================
    // These map to OTHER - remaining unmapped markets
    [185, "other"],
    [192, "other"],
    [193, "other"],
    [194, "other"],
    [206, "other"],
    [228, "other"],
    [235, "other"],
    [236, "other"],
    [237, "other"],
    [247, "other"],
    [254, "other"],
    [255, "other"],
    [256, "other"],
    // Note: 283 is already mapped to correct-score above - no duplicate here
    [1263, "other"],
    [1264, "other"],
    [1855, "player-cards"], // Player gets card (otrzyma kartkę)
  ]),

  // ==========================================================================
  // Selection Name Overrides (STS-specific codes)
  // ==========================================================================
  selectionOverrides: {
    // ========================================================================
    // MATCH WINNER - STS uses "1"=HOME, "2"=AWAY, "3"=DRAW (non-standard!)
    // ========================================================================
    "^3$": "DRAW" as NormalizedSelection,

    // ========================================================================
    // Double Chance codes (STS uses "1X", "02", "12" format)
    // ========================================================================
    "^1x$": "HOME_OR_DRAW" as NormalizedSelection,
    "^10$": "HOME_OR_DRAW" as NormalizedSelection,
    "^x2$": "DRAW_OR_AWAY" as NormalizedSelection,
    "^02$": "DRAW_OR_AWAY" as NormalizedSelection,
    "^12$": "HOME_OR_AWAY" as NormalizedSelection,

    // ========================================================================
    // Polish team terms
    // ========================================================================
    "^gospodarz": "HOME" as NormalizedSelection,
    "^go[śćś]cie": "AWAY" as NormalizedSelection,

    // ========================================================================
    // BTTS outcome IDs (STS uses numeric IDs for selections)
    // ========================================================================
    "^26$": "YES" as NormalizedSelection,
    "^27$": "NO" as NormalizedSelection,

    // ========================================================================
    // Draw No Bet - numeric outcome IDs (Market 11)
    // STS uses simple numeric IDs 4=HOME, 5=AWAY for Draw No Bet
    // ========================================================================
    "^4$": "HOME" as NormalizedSelection,
    "^5$": "AWAY" as NormalizedSelection,

    // ========================================================================
    // Over/Under uses +X.X/-X.X format handled by common patterns
    // Note: IDs 12/13 are used but conflict with Double Chance "12"
    // ========================================================================

    // ========================================================================
    // Asian Handicap format: "1 (+X)" or "2 (-X)"
    // ========================================================================
    "^1\\s*\\([+-]": "HOME" as NormalizedSelection,
    "^2\\s*\\([+-]": "AWAY" as NormalizedSelection,

    // ========================================================================
    // European Handicap format: "1 (+0.5)", "2 (-0.5)", "X (...)"
    // ========================================================================
    "^1\\s*\\(": "HOME" as NormalizedSelection,
    "^2\\s*\\(": "AWAY" as NormalizedSelection,
    "^x\\s*\\(": "DRAW" as NormalizedSelection,



    // ========================================================================
    // Result + Total combo - numeric outcome IDs
    // ========================================================================
    "^957$": "HOME" as NormalizedSelection,
    "^958$": "DRAW" as NormalizedSelection,
    "^959$": "AWAY" as NormalizedSelection,
    "^960$": "HOME" as NormalizedSelection,
    "^1009$": "AWAY" as NormalizedSelection,
  },
};
