"use strict";
/**
 * Normalized Markets Types
 *
 * Types for normalized betting markets with category support following Superbet pattern.
 * These types enable cross-bookmaker comparison and organized display in UI.
 */
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_ORDER = exports.CATEGORY_LABELS = exports.NormalizedSelection = exports.MARKET_TYPE_TO_CATEGORY = exports.NormalizedMarketType = exports.MarketCategory = void 0;
// ============================================================================
// Market Category Enum (Superbet Pattern)
// ============================================================================
/**
 * Market categories for UI organization (following Superbet pattern)
 * Polish labels are used for frontend display
 */
var MarketCategory;
(function (MarketCategory) {
    /** Match result markets - 1X2, Double Chance, Draw No Bet */
    MarketCategory["WYNIK_MECZU"] = "WYNIK_MECZU";
    /** Goals markets - BTTS, Over/Under, Odd/Even, Win to Nil, Clean Sheet */
    MarketCategory["GOLE"] = "GOLE";
    /** Handicap markets - Asian Handicap, European Handicap */
    MarketCategory["HANDICAP"] = "HANDICAP";
    /** First half markets - HT Result, HT Goals, HT BTTS */
    MarketCategory["PIERWSZA_POLOWA"] = "PIERWSZA_POLOWA";
    /** Correct Score markets */
    MarketCategory["DOKLADNY_WYNIK"] = "DOKLADNY_WYNIK";
    /** Player props - goalscorers, cards, assists */
    MarketCategory["ZAWODNICY"] = "ZAWODNICY";
    /** Statistics - corners, team cards, fouls */
    MarketCategory["STATYSTYKI"] = "STATYSTYKI";
    /** Combination markets - Result+BTTS, Result+O/U, HT/FT */
    MarketCategory["KOMBINACJE"] = "KOMBINACJE";
    /** Other markets - truly unknown/special markets */
    MarketCategory["INNE"] = "INNE";
})(MarketCategory || (exports.MarketCategory = MarketCategory = {}));
// ============================================================================
// Type to Category Mapping
// ============================================================================
/**
 * Re-export NormalizedMarketType for convenience
 */
var normalization_js_1 = require("./normalization.js");
Object.defineProperty(exports, "NormalizedMarketType", { enumerable: true, get: function () { return normalization_js_1.NormalizedMarketType; } });
/**
 * Mapping from NormalizedMarketType to MarketCategory
 * Follows the Superbet pattern for market organization
 */
exports.MARKET_TYPE_TO_CATEGORY = {
    // Match result markets
    MATCH_WINNER: MarketCategory.WYNIK_MECZU,
    DOUBLE_CHANCE: MarketCategory.WYNIK_MECZU,
    DRAW_NO_BET: MarketCategory.WYNIK_MECZU,
    // Goals markets
    TOTAL_GOALS: MarketCategory.GOLE,
    BTTS: MarketCategory.GOLE,
    ODD_EVEN_GOALS: MarketCategory.GOLE,
    WIN_TO_NIL: MarketCategory.GOLE,
    CLEAN_SHEET: MarketCategory.GOLE,
    // Handicap markets
    ASIAN_HANDICAP: MarketCategory.HANDICAP,
    EUROPEAN_HANDICAP: MarketCategory.HANDICAP,
    // First half markets
    HALF_TIME_RESULT: MarketCategory.PIERWSZA_POLOWA,
    HALF_TIME_TOTAL_GOALS: MarketCategory.PIERWSZA_POLOWA,
    HALF_TIME_BTTS: MarketCategory.PIERWSZA_POLOWA,
    // Correct score
    CORRECT_SCORE: MarketCategory.DOKLADNY_WYNIK,
    // Player markets -> ZAWODNICY
    GOALSCORER_FIRST: MarketCategory.ZAWODNICY,
    GOALSCORER_LAST: MarketCategory.ZAWODNICY,
    GOALSCORER_ANYTIME: MarketCategory.ZAWODNICY,
    PLAYER_SHOTS: MarketCategory.ZAWODNICY,
    PLAYER_CARDS: MarketCategory.ZAWODNICY,
    PLAYER_ASSISTS: MarketCategory.ZAWODNICY,
    // Statistics markets -> STATYSTYKI
    CORNERS_TOTAL: MarketCategory.STATYSTYKI,
    CORNERS_TEAM: MarketCategory.STATYSTYKI,
    CARDS_TOTAL: MarketCategory.STATYSTYKI,
    CARDS_TEAM: MarketCategory.STATYSTYKI,
    FOULS_TOTAL: MarketCategory.STATYSTYKI,
    OFFSIDES_TOTAL: MarketCategory.STATYSTYKI,
    // Combination markets -> KOMBINACJE
    RESULT_AND_BTTS: MarketCategory.KOMBINACJE,
    RESULT_AND_TOTAL: MarketCategory.KOMBINACJE,
    HALFTIME_FULLTIME: MarketCategory.KOMBINACJE,
    DOUBLE_RESULT: MarketCategory.KOMBINACJE,
    // Other (fallback)
    OTHER: MarketCategory.INNE,
};
// ============================================================================
// Normalized Market Interfaces
// ============================================================================
/**
 * Re-export NormalizedSelection for convenience
 */
var normalization_js_2 = require("./normalization.js");
Object.defineProperty(exports, "NormalizedSelection", { enumerable: true, get: function () { return normalization_js_2.NormalizedSelection; } });
// ============================================================================
// Category Labels (Polish)
// ============================================================================
/**
 * Polish labels for market categories
 */
exports.CATEGORY_LABELS = (_a = {},
    _a[MarketCategory.WYNIK_MECZU] = "Wynik meczu",
    _a[MarketCategory.GOLE] = "Gole",
    _a[MarketCategory.HANDICAP] = "Handicap",
    _a[MarketCategory.PIERWSZA_POLOWA] = "Pierwsza połowa",
    _a[MarketCategory.DOKLADNY_WYNIK] = "Dokładny wynik",
    _a[MarketCategory.ZAWODNICY] = "Zawodnicy",
    _a[MarketCategory.STATYSTYKI] = "Statystyki",
    _a[MarketCategory.KOMBINACJE] = "Kombinacje",
    _a[MarketCategory.INNE] = "Inne",
    _a);
/**
 * Sort order for categories in UI
 */
exports.CATEGORY_ORDER = [
    MarketCategory.WYNIK_MECZU,
    MarketCategory.GOLE,
    MarketCategory.HANDICAP,
    MarketCategory.PIERWSZA_POLOWA,
    MarketCategory.DOKLADNY_WYNIK,
    MarketCategory.ZAWODNICY,
    MarketCategory.STATYSTYKI,
    MarketCategory.KOMBINACJE,
    MarketCategory.INNE,
];
