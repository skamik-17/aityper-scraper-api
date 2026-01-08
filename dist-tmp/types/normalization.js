"use strict";
/**
 * Market Normalization Types
 *
 * Canonical types for normalizing betting markets across different bookmakers.
 * These types enable comparison of equivalent markets regardless of bookmaker-specific naming.
 */
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MARKET_TYPE_TO_GROUP = exports.NormalizedMarketGroup = exports.NormalizedSelection = exports.NormalizedMarketType = void 0;
exports.buildMarketKey = buildMarketKey;
/**
 * Normalized market type categories
 * Maps to canonical market types regardless of bookmaker naming conventions
 */
var NormalizedMarketType;
(function (NormalizedMarketType) {
    // Main markets
    NormalizedMarketType["MATCH_WINNER"] = "MATCH_WINNER";
    NormalizedMarketType["DOUBLE_CHANCE"] = "DOUBLE_CHANCE";
    NormalizedMarketType["DRAW_NO_BET"] = "DRAW_NO_BET";
    // Goals markets
    NormalizedMarketType["TOTAL_GOALS"] = "TOTAL_GOALS";
    NormalizedMarketType["BTTS"] = "BTTS";
    NormalizedMarketType["ODD_EVEN_GOALS"] = "ODD_EVEN_GOALS";
    NormalizedMarketType["WIN_TO_NIL"] = "WIN_TO_NIL";
    NormalizedMarketType["CLEAN_SHEET"] = "CLEAN_SHEET";
    // Handicap markets
    NormalizedMarketType["ASIAN_HANDICAP"] = "ASIAN_HANDICAP";
    NormalizedMarketType["EUROPEAN_HANDICAP"] = "EUROPEAN_HANDICAP";
    // Half-time markets
    NormalizedMarketType["HALF_TIME_RESULT"] = "HALF_TIME_RESULT";
    NormalizedMarketType["HALF_TIME_TOTAL_GOALS"] = "HALF_TIME_TOTAL_GOALS";
    NormalizedMarketType["HALF_TIME_BTTS"] = "HALF_TIME_BTTS";
    // Score markets
    NormalizedMarketType["CORRECT_SCORE"] = "CORRECT_SCORE";
    // Player markets (ZAWODNICY)
    NormalizedMarketType["GOALSCORER_FIRST"] = "GOALSCORER_FIRST";
    NormalizedMarketType["GOALSCORER_LAST"] = "GOALSCORER_LAST";
    NormalizedMarketType["GOALSCORER_ANYTIME"] = "GOALSCORER_ANYTIME";
    NormalizedMarketType["PLAYER_SHOTS"] = "PLAYER_SHOTS";
    NormalizedMarketType["PLAYER_CARDS"] = "PLAYER_CARDS";
    NormalizedMarketType["PLAYER_ASSISTS"] = "PLAYER_ASSISTS";
    // Statistics markets (STATYSTYKI)
    NormalizedMarketType["CORNERS_TOTAL"] = "CORNERS_TOTAL";
    NormalizedMarketType["CORNERS_TEAM"] = "CORNERS_TEAM";
    NormalizedMarketType["CARDS_TOTAL"] = "CARDS_TOTAL";
    NormalizedMarketType["CARDS_TEAM"] = "CARDS_TEAM";
    NormalizedMarketType["FOULS_TOTAL"] = "FOULS_TOTAL";
    NormalizedMarketType["OFFSIDES_TOTAL"] = "OFFSIDES_TOTAL";
    // Combination markets (KOMBINACJE)
    NormalizedMarketType["RESULT_AND_BTTS"] = "RESULT_AND_BTTS";
    NormalizedMarketType["RESULT_AND_TOTAL"] = "RESULT_AND_TOTAL";
    NormalizedMarketType["HALFTIME_FULLTIME"] = "HALFTIME_FULLTIME";
    NormalizedMarketType["DOUBLE_RESULT"] = "DOUBLE_RESULT";
    // Fallback
    NormalizedMarketType["OTHER"] = "OTHER";
})(NormalizedMarketType || (exports.NormalizedMarketType = NormalizedMarketType = {}));
/**
 * Normalized selection names
 * Canonical names for bet outcomes regardless of language/bookmaker
 */
var NormalizedSelection;
(function (NormalizedSelection) {
    // 1X2 outcomes
    NormalizedSelection["HOME"] = "HOME";
    NormalizedSelection["DRAW"] = "DRAW";
    NormalizedSelection["AWAY"] = "AWAY";
    // Double Chance outcomes
    NormalizedSelection["HOME_OR_DRAW"] = "HOME_OR_DRAW";
    NormalizedSelection["DRAW_OR_AWAY"] = "DRAW_OR_AWAY";
    NormalizedSelection["HOME_OR_AWAY"] = "HOME_OR_AWAY";
    // Over/Under outcomes
    NormalizedSelection["OVER"] = "OVER";
    NormalizedSelection["UNDER"] = "UNDER";
    // BTTS outcomes
    NormalizedSelection["YES"] = "YES";
    NormalizedSelection["NO"] = "NO";
    // Odd/Even outcomes
    NormalizedSelection["ODD"] = "ODD";
    NormalizedSelection["EVEN"] = "EVEN";
    // Unknown fallback
    NormalizedSelection["UNKNOWN"] = "UNKNOWN";
})(NormalizedSelection || (exports.NormalizedSelection = NormalizedSelection = {}));
/**
 * Standardized group names for UI organization
 */
var NormalizedMarketGroup;
(function (NormalizedMarketGroup) {
    NormalizedMarketGroup["MAIN"] = "MAIN";
    NormalizedMarketGroup["GOALS"] = "GOALS";
    NormalizedMarketGroup["HANDICAP"] = "HANDICAP";
    NormalizedMarketGroup["HALF_TIME"] = "HALF_TIME";
    NormalizedMarketGroup["SCORE"] = "SCORE";
    NormalizedMarketGroup["OTHER"] = "OTHER";
})(NormalizedMarketGroup || (exports.NormalizedMarketGroup = NormalizedMarketGroup = {}));
/**
 * Mapping from market type to group
 */
exports.MARKET_TYPE_TO_GROUP = (_a = {},
    _a[NormalizedMarketType.MATCH_WINNER] = NormalizedMarketGroup.MAIN,
    _a[NormalizedMarketType.DOUBLE_CHANCE] = NormalizedMarketGroup.MAIN,
    _a[NormalizedMarketType.DRAW_NO_BET] = NormalizedMarketGroup.MAIN,
    _a[NormalizedMarketType.TOTAL_GOALS] = NormalizedMarketGroup.GOALS,
    _a[NormalizedMarketType.BTTS] = NormalizedMarketGroup.GOALS,
    _a[NormalizedMarketType.ODD_EVEN_GOALS] = NormalizedMarketGroup.GOALS,
    _a[NormalizedMarketType.WIN_TO_NIL] = NormalizedMarketGroup.GOALS,
    _a[NormalizedMarketType.CLEAN_SHEET] = NormalizedMarketGroup.GOALS,
    _a[NormalizedMarketType.ASIAN_HANDICAP] = NormalizedMarketGroup.HANDICAP,
    _a[NormalizedMarketType.EUROPEAN_HANDICAP] = NormalizedMarketGroup.HANDICAP,
    _a[NormalizedMarketType.HALF_TIME_RESULT] = NormalizedMarketGroup.HALF_TIME,
    _a[NormalizedMarketType.HALF_TIME_TOTAL_GOALS] = NormalizedMarketGroup.HALF_TIME,
    _a[NormalizedMarketType.HALF_TIME_BTTS] = NormalizedMarketGroup.HALF_TIME,
    _a[NormalizedMarketType.CORRECT_SCORE] = NormalizedMarketGroup.SCORE,
    // Player markets -> OTHER group (legacy compatibility)
    _a[NormalizedMarketType.GOALSCORER_FIRST] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.GOALSCORER_LAST] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.GOALSCORER_ANYTIME] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.PLAYER_SHOTS] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.PLAYER_CARDS] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.PLAYER_ASSISTS] = NormalizedMarketGroup.OTHER,
    // Statistics markets -> OTHER group
    _a[NormalizedMarketType.CORNERS_TOTAL] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.CORNERS_TEAM] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.CARDS_TOTAL] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.CARDS_TEAM] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.FOULS_TOTAL] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.OFFSIDES_TOTAL] = NormalizedMarketGroup.OTHER,
    // Combination markets -> OTHER group
    _a[NormalizedMarketType.RESULT_AND_BTTS] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.RESULT_AND_TOTAL] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.HALFTIME_FULLTIME] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.DOUBLE_RESULT] = NormalizedMarketGroup.OTHER,
    _a[NormalizedMarketType.OTHER] = NormalizedMarketGroup.OTHER,
    _a);
/**
 * Generate a canonical market key
 * Format: TYPE or TYPE:PARAM (e.g., "TOTAL_GOALS:2.5")
 */
function buildMarketKey(type, param) {
    if (param) {
        // Normalize decimal separator to dot
        var normalizedParam = param.replace(",", ".");
        return "".concat(type, ":").concat(normalizedParam);
    }
    return type;
}
