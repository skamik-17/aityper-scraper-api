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
