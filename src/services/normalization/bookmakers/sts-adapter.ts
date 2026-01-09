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
    // Match Winner - 1X2
    [1, "match-winner"],
    [40, "match-winner"],
    [41, "match-winner"],
    [42, "match-winner"],
    [63, "match-winner"],
    [64, "match-winner"],
    [65, "match-winner"],
    [66, "match-winner"],
    [71, "match-winner"],
    [94, "match-winner"],
    [102, "match-winner"],
    [106, "match-winner"],
    [119, "match-winner"],
    [1244, "match-winner"],

    // Double Chance
    [10, "double-chance"],

    // Draw No Bet / Level Handicap / 2-way Winner
    [4, "draw-no-bet"],
    [20, "draw-no-bet"],
    [77, "draw-no-bet"],
    [259, "draw-no-bet"], // Zwycięzca walki
    [314, "draw-no-bet"], // Zwycięzca meczu
    [368, "draw-no-bet"], // Zwycięzca meczu

    // ========================================================================
    // GOALS MARKETS (GOLE)
    // ========================================================================
    // Total Goals - various lines
    [25, "total-goals"],
    [8, "total-goals"],
    [11, "total-goals"],
    [23, "total-goals"],
    [28, "total-goals"],
    [73, "total-goals"],
    [74, "total-goals"],
    [75, "total-goals"],
    [80, "total-goals"],
    [103, "total-goals"],
    [104, "total-goals"],
    [105, "total-goals"],

    // BTTS - many variants
    [43, "btts"],
    [47, "btts"],
    [48, "btts"],
    [59, "btts"],
    [60, "btts"],
    [61, "btts"],
    [62, "btts"],
    [67, "btts"],
    [68, "btts"],
    [69, "btts"],
    [70, "btts"],
    [95, "btts"],
    [107, "btts"],
    [109, "btts"],
    [110, "btts"],
    [112, "btts"],
    [115, "btts"],
    [118, "btts"],
    [120, "btts"],
    [121, "btts"],
    [196, "btts"],
    [197, "btts"],
    [198, "btts"],
    [217, "btts"],
    [1224, "btts"],
    [1229, "btts"],
    [1232, "btts"],
    [1233, "btts"],
    [1234, "btts"],
    [1235, "btts"],

    // Win to Nil
    [35, "win-to-nil"],
    [90, "win-to-nil"],

    // Clean Sheet
    [36, "clean-sheet"],

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
    // Half Time Result
    [5, "half-time-result"],

    // Half Time Total Goals
    [26, "half-time-total-goals"],
    [31, "half-time-total-goals"],
    [82, "half-time-total-goals"],
    [85, "half-time-total-goals"],
    [88, "half-time-total-goals"],

    // ========================================================================
    // CORRECT SCORE
    // ========================================================================
    // Market 283 = main Correct Score (IDs 1783-1817)
    // Market 101 = 1st Half Correct Score
    // Market 124 = 2nd Half Correct Score
    [283, "correct-score"],
    [101, "correct-score"],
    [124, "correct-score"],
    [57, "correct-score"], // Alternative correct score variant

    // ========================================================================
    // GOALSCORER MARKETS
    // ========================================================================
    // Market 9 = Last Goal (Ostatni gol) - NOT Correct Score!
    [9, "goalscorer-last"],

    // ========================================================================
    // GOALS MARKETS - additional
    // ========================================================================
    // Market 17 = Winning Margin (Różnica zwycięstwa)
    [17, "winning-margin"],
    // Market 33 = Goal Range (Przedział goli)
    [33, "goal-range"],
    // Market 98 = HT BTTS
    [98, "half-time-btts"],

    // ========================================================================
    // PLAYER MARKETS (ZAWODNICY)
    // ========================================================================
    // Goalscorer Anytime
    [52, "goalscorer-anytime"],
    [1850, "goalscorer-anytime"], // Player goals with thresholds (1+, 2+, 3+)

    // Player Shots
    [53, "player-shots"],
    [1851, "player-shots"], // Player shots with thresholds

    // Player Cards
    [54, "player-cards"],

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
    [283, "other"],
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
    // Over/Under - additional numeric IDs
    // Note: IDs 12/13 not included as they conflict with Double Chance "12"
    // STS sends "+2.5"/"-2.5" names for Over/Under which are handled by common patterns
    // ========================================================================
    "^4$": "OVER" as NormalizedSelection,
    "^5$": "UNDER" as NormalizedSelection,

    // ========================================================================
    // Draw No Bet / Asian Handicap format: "1 (+X)" or "2 (-X)"
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
    // Clean Sheet / Win to Nil - STS numeric outcome IDs
    // Format: 1237=Home CS, 1238=Home fails, 1239=Away CS, 1240=Away fails
    // ========================================================================
    "^1237$": "HOME" as NormalizedSelection,
    "^1238$": "AWAY" as NormalizedSelection,
    "^1239$": "AWAY" as NormalizedSelection,
    "^1240$": "HOME" as NormalizedSelection,

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
