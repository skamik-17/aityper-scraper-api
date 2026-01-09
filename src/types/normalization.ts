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
    MATCH_WINNER = "MATCH_WINNER",
    DOUBLE_CHANCE = "DOUBLE_CHANCE",
    DRAW_NO_BET = "DRAW_NO_BET",

    TOTAL_GOALS = "TOTAL_GOALS",
    BTTS = "BTTS",
    ODD_EVEN_GOALS = "ODD_EVEN_GOALS",
    WIN_TO_NIL = "WIN_TO_NIL",
    CLEAN_SHEET = "CLEAN_SHEET",
    HOME_TEAM_TO_SCORE = "HOME_TEAM_TO_SCORE",
    AWAY_TEAM_TO_SCORE = "AWAY_TEAM_TO_SCORE",
    TEAM_TOTAL_GOALS = "TEAM_TOTAL_GOALS",
    GOAL_RANGE = "GOAL_RANGE",
    BOTH_HALVES_GOALS = "BOTH_HALVES_GOALS",
    WINNING_MARGIN = "WINNING_MARGIN",

    ASIAN_HANDICAP = "ASIAN_HANDICAP",
    EUROPEAN_HANDICAP = "EUROPEAN_HANDICAP",

    HALF_TIME_RESULT = "HALF_TIME_RESULT",
    HALF_TIME_TOTAL_GOALS = "HALF_TIME_TOTAL_GOALS",
    HALF_TIME_BTTS = "HALF_TIME_BTTS",
    SECOND_HALF_RESULT = "SECOND_HALF_RESULT",
    SECOND_HALF_TOTAL_GOALS = "SECOND_HALF_TOTAL_GOALS",

    CORRECT_SCORE = "CORRECT_SCORE",

    GOALSCORER_FIRST = "GOALSCORER_FIRST",
    GOALSCORER_LAST = "GOALSCORER_LAST",
    GOALSCORER_ANYTIME = "GOALSCORER_ANYTIME",
    PLAYER_SHOTS = "PLAYER_SHOTS",
    PLAYER_CARDS = "PLAYER_CARDS",
    PLAYER_ASSISTS = "PLAYER_ASSISTS",

    CORNERS_TOTAL = "CORNERS_TOTAL",
    CORNERS_TEAM = "CORNERS_TEAM",
    CARDS_TOTAL = "CARDS_TOTAL",
    CARDS_TEAM = "CARDS_TEAM",
    FOULS_TOTAL = "FOULS_TOTAL",
    OFFSIDES_TOTAL = "OFFSIDES_TOTAL",

    RESULT_AND_BTTS = "RESULT_AND_BTTS",
    RESULT_AND_TOTAL = "RESULT_AND_TOTAL",
    HALFTIME_FULLTIME = "HALFTIME_FULLTIME",
    DOUBLE_RESULT = "DOUBLE_RESULT",
    DOUBLE_CHANCE_BTTS = "DOUBLE_CHANCE_BTTS",
    DOUBLE_CHANCE_TOTAL = "DOUBLE_CHANCE_TOTAL",

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
