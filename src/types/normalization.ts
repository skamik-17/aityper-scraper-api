/**
 * Market Normalization Types
 *
 * Canonical types for normalizing betting markets across different bookmakers.
 * These types enable comparison of equivalent markets regardless of bookmaker-specific naming.
 */

/**
 * Normalized market type categories
 * Maps to canonical market types regardless of bookmaker naming conventions
 */
export enum NormalizedMarketType {
    // Main markets
    MATCH_WINNER = "MATCH_WINNER",           // 1X2
    DOUBLE_CHANCE = "DOUBLE_CHANCE",         // 1X, X2, 12
    DRAW_NO_BET = "DRAW_NO_BET",

    // Goals markets
    TOTAL_GOALS = "TOTAL_GOALS",             // Over/Under X.5
    BTTS = "BTTS",                           // Both Teams To Score
    ODD_EVEN_GOALS = "ODD_EVEN_GOALS",
    WIN_TO_NIL = "WIN_TO_NIL",
    CLEAN_SHEET = "CLEAN_SHEET",

    // Handicap markets
    ASIAN_HANDICAP = "ASIAN_HANDICAP",
    EUROPEAN_HANDICAP = "EUROPEAN_HANDICAP",

    // Half-time markets
    HALF_TIME_RESULT = "HALF_TIME_RESULT",
    HALF_TIME_TOTAL_GOALS = "HALF_TIME_TOTAL_GOALS",
    HALF_TIME_BTTS = "HALF_TIME_BTTS",

    // Score markets
    CORRECT_SCORE = "CORRECT_SCORE",

    // Player markets (ZAWODNICY)
    GOALSCORER_FIRST = "GOALSCORER_FIRST",
    GOALSCORER_LAST = "GOALSCORER_LAST",
    GOALSCORER_ANYTIME = "GOALSCORER_ANYTIME",
    PLAYER_SHOTS = "PLAYER_SHOTS",
    PLAYER_CARDS = "PLAYER_CARDS",
    PLAYER_ASSISTS = "PLAYER_ASSISTS",

    // Team goal markets (ZAWODNICY - team-based)
    HOME_TEAM_TO_SCORE = "HOME_TEAM_TO_SCORE",      // "Arsenal strzeli gola"
    AWAY_TEAM_TO_SCORE = "AWAY_TEAM_TO_SCORE",      // "Liverpool strzeli gola"

    // Statistics markets (STATYSTYKI)
    CORNERS_TOTAL = "CORNERS_TOTAL",
    CORNERS_TEAM = "CORNERS_TEAM",
    CARDS_TOTAL = "CARDS_TOTAL",
    CARDS_TEAM = "CARDS_TEAM",
    FOULS_TOTAL = "FOULS_TOTAL",
    OFFSIDES_TOTAL = "OFFSIDES_TOTAL",

    // Combination markets (KOMBINACJE)
    RESULT_AND_BTTS = "RESULT_AND_BTTS",
    RESULT_AND_TOTAL = "RESULT_AND_TOTAL",
    HALFTIME_FULLTIME = "HALFTIME_FULLTIME",
    DOUBLE_RESULT = "DOUBLE_RESULT",

    // Fallback
    OTHER = "OTHER",
}

/**
 * Normalized selection names
 * Canonical names for bet outcomes regardless of language/bookmaker
 */
export enum NormalizedSelection {
    // 1X2 outcomes
    HOME = "HOME",
    DRAW = "DRAW",
    AWAY = "AWAY",

    // Double Chance outcomes
    HOME_OR_DRAW = "HOME_OR_DRAW",   // 1X
    DRAW_OR_AWAY = "DRAW_OR_AWAY",   // X2
    HOME_OR_AWAY = "HOME_OR_AWAY",   // 12

    // Over/Under outcomes
    OVER = "OVER",
    UNDER = "UNDER",

    // BTTS outcomes
    YES = "YES",
    NO = "NO",

    // Odd/Even outcomes
    ODD = "ODD",
    EVEN = "EVEN",

    // Unknown fallback
    UNKNOWN = "UNKNOWN",
}

/**
 * Standardized group names for UI organization
 */
export enum NormalizedMarketGroup {
    MAIN = "MAIN",           // Match winner, Draw no bet
    GOALS = "GOALS",         // Total goals, BTTS, Win to nil
    HANDICAP = "HANDICAP",   // Asian/European handicap
    HALF_TIME = "HALF_TIME", // 1st half markets
    SCORE = "SCORE",         // Correct score
    OTHER = "OTHER",         // Unmapped markets
}

/**
 * Mapping from market type to group
 */
export const MARKET_TYPE_TO_GROUP: Record<NormalizedMarketType, NormalizedMarketGroup> = {
    [NormalizedMarketType.MATCH_WINNER]: NormalizedMarketGroup.MAIN,
    [NormalizedMarketType.DOUBLE_CHANCE]: NormalizedMarketGroup.MAIN,
    [NormalizedMarketType.DRAW_NO_BET]: NormalizedMarketGroup.MAIN,

    [NormalizedMarketType.TOTAL_GOALS]: NormalizedMarketGroup.GOALS,
    [NormalizedMarketType.BTTS]: NormalizedMarketGroup.GOALS,
    [NormalizedMarketType.ODD_EVEN_GOALS]: NormalizedMarketGroup.GOALS,
    [NormalizedMarketType.WIN_TO_NIL]: NormalizedMarketGroup.GOALS,
    [NormalizedMarketType.CLEAN_SHEET]: NormalizedMarketGroup.GOALS,

    [NormalizedMarketType.ASIAN_HANDICAP]: NormalizedMarketGroup.HANDICAP,
    [NormalizedMarketType.EUROPEAN_HANDICAP]: NormalizedMarketGroup.HANDICAP,

    [NormalizedMarketType.HALF_TIME_RESULT]: NormalizedMarketGroup.HALF_TIME,
    [NormalizedMarketType.HALF_TIME_TOTAL_GOALS]: NormalizedMarketGroup.HALF_TIME,
    [NormalizedMarketType.HALF_TIME_BTTS]: NormalizedMarketGroup.HALF_TIME,

    [NormalizedMarketType.CORRECT_SCORE]: NormalizedMarketGroup.SCORE,

    // Player markets -> OTHER group (legacy compatibility)
    [NormalizedMarketType.GOALSCORER_FIRST]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.GOALSCORER_LAST]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.GOALSCORER_ANYTIME]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.PLAYER_SHOTS]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.PLAYER_CARDS]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.PLAYER_ASSISTS]: NormalizedMarketGroup.OTHER,

    // Team goal markets -> GOALS group
    [NormalizedMarketType.HOME_TEAM_TO_SCORE]: NormalizedMarketGroup.GOALS,
    [NormalizedMarketType.AWAY_TEAM_TO_SCORE]: NormalizedMarketGroup.GOALS,

    // Statistics markets -> OTHER group
    [NormalizedMarketType.CORNERS_TOTAL]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.CORNERS_TEAM]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.CARDS_TOTAL]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.CARDS_TEAM]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.FOULS_TOTAL]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.OFFSIDES_TOTAL]: NormalizedMarketGroup.OTHER,

    // Combination markets -> OTHER group
    [NormalizedMarketType.RESULT_AND_BTTS]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.RESULT_AND_TOTAL]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.HALFTIME_FULLTIME]: NormalizedMarketGroup.OTHER,
    [NormalizedMarketType.DOUBLE_RESULT]: NormalizedMarketGroup.OTHER,

    [NormalizedMarketType.OTHER]: NormalizedMarketGroup.OTHER,
};

/**
 * Generate a canonical market key
 * Format: TYPE or TYPE:PARAM (e.g., "TOTAL_GOALS:2.5")
 */
export function buildMarketKey(type: NormalizedMarketType, param?: string): string {
    if (param) {
        // Normalize decimal separator to dot
        const normalizedParam = param.replace(",", ".");
        return `${type}:${normalizedParam}`;
    }
    return type;
}
