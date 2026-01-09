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

    // Draw No Bet / Level Handicap
    [4, "draw-no-bet"],
    [20, "draw-no-bet"],
    [77, "draw-no-bet"],

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
    [1855, "btts"],

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
    [9, "correct-score"],
    [17, "correct-score"],
    [33, "correct-score"],
    [49, "correct-score"],
    [57, "correct-score"],
    [98, "correct-score"],
    [101, "correct-score"],
    [124, "correct-score"],
    [125, "correct-score"],
    [126, "correct-score"],

    // ========================================================================
    // PLAYER MARKETS (ZAWODNICY)
    // ========================================================================
    // Goalscorer Anytime
    [52, "goalscorer-anytime"],

    // Player Shots
    [53, "player-shots"],

    // Player Cards
    [54, "player-cards"],

    // ========================================================================
    // COMBINATION MARKETS (KOMBINACJE)
    // ========================================================================
    // Result + BTTS
    [50, "result-and-btts"],

    // Result + Total (many variants)
    [51, "result-and-total"],
    [99, "result-and-total"],
    [807, "result-and-total"],
    [808, "result-and-total"],
    [809, "result-and-total"],
    [810, "result-and-total"],
    [811, "result-and-total"],
    [812, "result-and-total"],
    [813, "result-and-total"],
    [814, "result-and-total"],
    [815, "result-and-total"],
    [816, "result-and-total"],
    [817, "result-and-total"],
    [818, "result-and-total"],

    // HT/FT + O/U combo
    [1012, "halftime-fulltime"],

    // ========================================================================
    // OTHER / UNKNOWN
    // ========================================================================
    // These map to OTHER for now
    // TODO: Add more markets to registry to cover these
    [44, "other"], // First/Last to score
    [178, "other"],
    [179, "other"],
    [185, "other"],
    [192, "other"],
    [193, "other"],
    [194, "other"],
    [199, "other"],
    [206, "other"],
    [220, "other"],
    [221, "other"],
    [225, "other"],
    [228, "other"],
    [235, "other"],
    [236, "other"],
    [237, "other"],
    [239, "other"],
    [244, "other"],
    [247, "other"],
    [254, "other"],
    [255, "other"],
    [256, "other"],
    [258, "other"],
    [283, "other"],
    [1051, "other"],
    [1263, "other"],
    [1264, "other"],
    [1845, "other"],
    [1850, "other"],
    [1851, "other"],
    [1852, "other"],
    [1853, "other"],
    [1855, "other"],
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
