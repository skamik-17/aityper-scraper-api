"use strict";
/**
 * Base Normalizer
 *
 * Abstract class providing common normalization logic for betting markets.
 * Each bookmaker-specific normalizer extends this class and overrides
 * patterns and selection normalization as needed.
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseNormalizer = void 0;
var normalization_js_1 = require("../../types/normalization.js");
var normalized_markets_js_1 = require("../../types/normalized-markets.js");
/**
 * Abstract base class for bookmaker-specific normalizers
 */
var BaseNormalizer = /** @class */ (function () {
    function BaseNormalizer() {
    }
    /**
     * Main entry point for normalizing a market
     *
     * @param market - Raw market data from scraper
     * @param homeTeam - Home team name for selection matching
     * @param awayTeam - Away team name for selection matching
     * @returns Normalized market with canonical types and keys
     */
    BaseNormalizer.prototype.normalize = function (market, homeTeam, awayTeam) {
        // Try ID-based mapping first (for bookmakers using numeric/coded IDs)
        var idResult = this.tryIdMapping(market.name);
        if (idResult) {
            return this.buildResult(market, idResult.type, idResult.group, idResult.param, homeTeam, awayTeam);
        }
        // Try pattern matching
        for (var _i = 0, _a = this.patterns; _i < _a.length; _i++) {
            var _b = _a[_i], pattern = _b.pattern, type = _b.type, group = _b.group, extractParam = _b.extractParam;
            var match = market.name.match(pattern);
            if (match) {
                var param = extractParam === null || extractParam === void 0 ? void 0 : extractParam(match);
                return this.buildResult(market, type, group, param, homeTeam, awayTeam);
            }
        }
        // Fallback to OTHER
        return this.buildResult(market, normalization_js_1.NormalizedMarketType.OTHER, normalization_js_1.NormalizedMarketGroup.OTHER, undefined, homeTeam, awayTeam);
    };
    /**
     * Try to map market name using ID-based lookup
     * Override in subclass if bookmaker uses "Rynek XX" or similar ID formats
     *
     * @param marketName - Raw market name to look up
     * @returns Type, group, and optional param if ID mapping found, null otherwise
     */
    BaseNormalizer.prototype.tryIdMapping = function (marketName) {
        return null; // Default: no ID mapping
    };
    /**
     * Build the normalized market result
     */
    BaseNormalizer.prototype.buildResult = function (market, type, group, param, homeTeam, awayTeam) {
        var _this = this;
        var marketGroup = group !== null && group !== void 0 ? group : this.inferGroup(type);
        var marketCategory = this.getCategoryForType(type);
        var marketKey = (0, normalization_js_1.buildMarketKey)(type, param);
        var normalizedSelections = market.selections.map(function (sel) { return (__assign(__assign({}, sel), { normalizedName: _this.normalizeSelectionName(sel.name, type, homeTeam, awayTeam) })); });
        return {
            originalName: market.name,
            normalizedType: type,
            normalizedGroup: marketGroup,
            marketKey: marketKey,
            paramValue: param,
            category: marketCategory,
            selections: normalizedSelections,
        };
    };
    /**
     * Infer market group from type using standard mapping
     *
     * @param type - Normalized market type
     * @returns Inferred market group
     */
    BaseNormalizer.prototype.inferGroup = function (type) {
        switch (type) {
            // Main markets
            case normalization_js_1.NormalizedMarketType.MATCH_WINNER:
            case normalization_js_1.NormalizedMarketType.DOUBLE_CHANCE:
            case normalization_js_1.NormalizedMarketType.DRAW_NO_BET:
                return normalization_js_1.NormalizedMarketGroup.MAIN;
            // Goals markets
            case normalization_js_1.NormalizedMarketType.TOTAL_GOALS:
            case normalization_js_1.NormalizedMarketType.BTTS:
            case normalization_js_1.NormalizedMarketType.ODD_EVEN_GOALS:
            case normalization_js_1.NormalizedMarketType.WIN_TO_NIL:
            case normalization_js_1.NormalizedMarketType.CLEAN_SHEET:
                return normalization_js_1.NormalizedMarketGroup.GOALS;
            // Handicap markets
            case normalization_js_1.NormalizedMarketType.ASIAN_HANDICAP:
            case normalization_js_1.NormalizedMarketType.EUROPEAN_HANDICAP:
                return normalization_js_1.NormalizedMarketGroup.HANDICAP;
            // Half-time markets
            case normalization_js_1.NormalizedMarketType.HALF_TIME_RESULT:
            case normalization_js_1.NormalizedMarketType.HALF_TIME_TOTAL_GOALS:
            case normalization_js_1.NormalizedMarketType.HALF_TIME_BTTS:
                return normalization_js_1.NormalizedMarketGroup.HALF_TIME;
            // Score markets
            case normalization_js_1.NormalizedMarketType.CORRECT_SCORE:
                return normalization_js_1.NormalizedMarketGroup.SCORE;
            // Player markets -> OTHER group (legacy compatibility)
            case normalization_js_1.NormalizedMarketType.GOALSCORER_FIRST:
            case normalization_js_1.NormalizedMarketType.GOALSCORER_LAST:
            case normalization_js_1.NormalizedMarketType.GOALSCORER_ANYTIME:
            case normalization_js_1.NormalizedMarketType.PLAYER_SHOTS:
            case normalization_js_1.NormalizedMarketType.PLAYER_CARDS:
            case normalization_js_1.NormalizedMarketType.PLAYER_ASSISTS:
                return normalization_js_1.NormalizedMarketGroup.OTHER;
            // Statistics markets -> OTHER group
            case normalization_js_1.NormalizedMarketType.CORNERS_TOTAL:
            case normalization_js_1.NormalizedMarketType.CORNERS_TEAM:
            case normalization_js_1.NormalizedMarketType.CARDS_TOTAL:
            case normalization_js_1.NormalizedMarketType.CARDS_TEAM:
            case normalization_js_1.NormalizedMarketType.FOULS_TOTAL:
            case normalization_js_1.NormalizedMarketType.OFFSIDES_TOTAL:
                return normalization_js_1.NormalizedMarketGroup.OTHER;
            // Combination markets -> OTHER group
            case normalization_js_1.NormalizedMarketType.RESULT_AND_BTTS:
            case normalization_js_1.NormalizedMarketType.RESULT_AND_TOTAL:
            case normalization_js_1.NormalizedMarketType.HALFTIME_FULLTIME:
            case normalization_js_1.NormalizedMarketType.DOUBLE_RESULT:
                return normalization_js_1.NormalizedMarketGroup.OTHER;
            // Fallback
            default:
                return normalization_js_1.NormalizedMarketGroup.OTHER;
        }
    };
    /**
     * Get category for market type using standard mapping
     *
     * @param type - Normalized market type
     * @returns Market category following Superbet pattern
     */
    BaseNormalizer.prototype.getCategoryForType = function (type) {
        return normalized_markets_js_1.MARKET_TYPE_TO_CATEGORY[type] || normalized_markets_js_1.MarketCategory.INNE;
    };
    /**
     * Helper to check if a selection name matches a team name
     * Uses multiple matching strategies: exact, contains, first word
     *
     * @param selectionName - Lowercase trimmed selection name
     * @param teamName - Team name to match against
     * @returns True if selection appears to reference the team
     */
    BaseNormalizer.prototype.matchesTeam = function (selectionName, teamName) {
        var normalizedSelection = selectionName.toLowerCase().trim();
        var normalizedTeam = teamName.toLowerCase().trim();
        // Empty check
        if (!normalizedSelection || !normalizedTeam) {
            return false;
        }
        // Exact match
        if (normalizedSelection === normalizedTeam) {
            return true;
        }
        // Contains check (either direction)
        if (normalizedSelection.includes(normalizedTeam)) {
            return true;
        }
        if (normalizedTeam.includes(normalizedSelection)) {
            return true;
        }
        // First word match (for "Manchester" matching "Manchester United")
        // Only if first word is reasonably long to avoid false positives
        var selectionFirst = normalizedSelection.split(/\s+/)[0];
        var teamFirst = normalizedTeam.split(/\s+/)[0];
        if (selectionFirst &&
            teamFirst &&
            selectionFirst === teamFirst &&
            selectionFirst.length > 3) {
            return true;
        }
        return false;
    };
    /**
     * Remove Polish diacritics from text for easier matching
     *
     * @param text - Text with potential diacritics
     * @returns Text with diacritics removed
     */
    BaseNormalizer.prototype.removeDiacritics = function (text) {
        return text
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "") // Remove combining diacritical marks
            .replace(/ł/g, "l")
            .replace(/Ł/g, "L");
    };
    /**
     * Check if string contains any Over/Under indicator keyword
     * Works with diacritics and various languages
     *
     * @param name - Selection name to check
     * @param lookingFor - 'over' or 'under'
     * @returns True if the keyword is found
     */
    BaseNormalizer.prototype.containsOverUnderKeyword = function (name, lookingFor) {
        var normalized = this.removeDiacritics(name.toLowerCase());
        if (lookingFor === "over") {
            return /^(over|powyzej|ponad|pow)\b/i.test(normalized) ||
                /\b(over|powyzej|ponad|pow|więcej|wiecej|więk|wiek)\b/i.test(normalized);
        }
        else {
            return /^(under|ponizej|pon)\b/i.test(normalized) ||
                /\b(under|ponizej|pon|mniej|mn)\b/i.test(normalized);
        }
    };
    /**
     * Common selection normalization patterns shared across bookmakers
     * Subclasses can call this as a fallback after trying bookmaker-specific patterns
     *
     * @param name - Lowercase trimmed selection name
     * @param marketType - Market type for context
     * @returns Normalized selection or UNKNOWN if no match
     */
    BaseNormalizer.prototype.normalizeCommonSelection = function (name, marketType) {
        // Normalize input: lowercase, trim, remove diacritics for matching
        var normalizedName = this.removeDiacritics(name.toLowerCase().trim());
        // ==========================================================================
        // 1X2 OUTCOMES - Single character and short codes
        // ==========================================================================
        // Home (1)
        if (/^1$|^home$|^gospodarz$/i.test(normalizedName)) {
            return normalization_js_1.NormalizedSelection.HOME;
        }
        // Draw (X)
        if (/^x$|^0$|^draw$|^remis$/i.test(normalizedName)) {
            return normalization_js_1.NormalizedSelection.DRAW;
        }
        // Away (2)
        if (/^2$|^away$|^gosc$|^gos[cć]$/i.test(normalizedName)) {
            return normalization_js_1.NormalizedSelection.AWAY;
        }
        // ==========================================================================
        // DOUBLE CHANCE - Two-outcome combinations
        // ==========================================================================
        // 1X or 10 (Home or Draw)
        if (/^(1x|10)$/i.test(normalizedName) || /1\s*(lub|or|l\.|&)\s*x/i.test(normalizedName)) {
            return normalization_js_1.NormalizedSelection.HOME_OR_DRAW;
        }
        // X2 or 02 (Draw or Away)
        if (/^(x2|02)$/i.test(normalizedName) || /x\s*(lub|or|l\.|&)\s*2/i.test(normalizedName) || /remis\s*(lub|or)\s*2/i.test(normalizedName)) {
            return normalization_js_1.NormalizedSelection.DRAW_OR_AWAY;
        }
        // 12 (Home or Away - No Draw)
        if (/^12$/i.test(normalizedName) || /1\s*(lub|or|l\.|&)\s*2/i.test(normalizedName)) {
            return normalization_js_1.NormalizedSelection.HOME_OR_AWAY;
        }
        // ==========================================================================
        // OVER/UNDER - Check for keywords anywhere in the string
        // This handles formats like:
        // - "Over 2.5"
        // - "2.5+"
        // - "Powyżej 2.5"
        // - "Powyzej (2.5)"
        // - "Over +2.5 goals"
        // ==========================================================================
        // Check for Over indicators
        if (this.containsOverUnderKeyword(normalizedName, "over")) {
            return normalization_js_1.NormalizedSelection.OVER;
        }
        // Check for Under indicators
        if (this.containsOverUnderKeyword(normalizedName, "under")) {
            return normalization_js_1.NormalizedSelection.UNDER;
        }
        // Numeric line indicators: "+" prefix means Over, "-" prefix means Under
        // This handles selections like "+2.5" or "-2.5"
        // Check original name (preserves the +/- signs)
        var trimmedOriginal = name.trim();
        if (/^\+[\d.,]+/.test(trimmedOriginal)) {
            return normalization_js_1.NormalizedSelection.OVER;
        }
        if (/^-[\d.,]+/.test(trimmedOriginal)) {
            return normalization_js_1.NormalizedSelection.UNDER;
        }
        // Suffix indicators: "2.5+" or "2.5-" (less common but exists)
        if (/[\d.,]+\+$/.test(trimmedOriginal)) {
            return normalization_js_1.NormalizedSelection.OVER;
        }
        if (/[\d.,]+-$/.test(trimmedOriginal)) {
            return normalization_js_1.NormalizedSelection.UNDER;
        }
        // ==========================================================================
        // YES/NO - BTTS and similar markets
        // Handles multiple languages and formats
        // ==========================================================================
        // Yes indicators
        if (/^(tak|yes|gg|si|1)\s*$/i.test(normalizedName)) {
            // Special case: "1" could be HOME for 1X2 or YES for BTTS
            if (normalizedName === "1" && marketType !== normalization_js_1.NormalizedMarketType.BTTS &&
                marketType !== normalization_js_1.NormalizedMarketType.HALF_TIME_BTTS) {
                return normalization_js_1.NormalizedSelection.HOME;
            }
            return normalization_js_1.NormalizedSelection.YES;
        }
        // No indicators
        if (/^(nie|no|ng|nope|0)\s*$/i.test(normalizedName)) {
            // Special case: "0" could be DRAW for 1X2 or NO for BTTS
            if (normalizedName === "0" && marketType !== normalization_js_1.NormalizedMarketType.BTTS &&
                marketType !== normalization_js_1.NormalizedMarketType.HALF_TIME_BTTS) {
                return normalization_js_1.NormalizedSelection.DRAW;
            }
            return normalization_js_1.NormalizedSelection.NO;
        }
        // ==========================================================================
        // ODD/EVEN - Parity markets
        // ==========================================================================
        if (/^(nieparzyste|odd|np)\s*$/i.test(normalizedName)) {
            return normalization_js_1.NormalizedSelection.ODD;
        }
        if (/^(parzyste|even|par)\s*$/i.test(normalizedName)) {
            return normalization_js_1.NormalizedSelection.EVEN;
        }
        // ==========================================================================
        // FALLBACK: Try to extract from patterns with embedded values
        // This handles cases where the selection includes a line value
        // e.g., "Powyzej 2.5" should be OVER even if keyword matching failed
        // ==========================================================================
        // Extract first word/number and check if it's a line value
        // If we find a pattern like "2.5 Over" or "Over 2.5", we already caught it above
        // This is for edge cases
        var words = normalizedName.split(/\s+/);
        if (words.length >= 2) {
            var firstWord = words[0];
            var lastWord = words[words.length - 1];
            // Check if first word is a line number (decimal)
            if (/^[\d.,]+$/.test(firstWord)) {
                // If format is "2.5 something" and second word suggests Over/Under
                if (words.length > 1) {
                    var remaining = words.slice(1).join(" ");
                    if (this.containsOverUnderKeyword(remaining, "over")) {
                        return normalization_js_1.NormalizedSelection.OVER;
                    }
                    if (this.containsOverUnderKeyword(remaining, "under")) {
                        return normalization_js_1.NormalizedSelection.UNDER;
                    }
                }
            }
            // Check if last word is a direction indicator
            if (/^(over|powyzej|ponad|under|ponizej|mniej|wiecej)$/i.test(lastWord)) {
                if (this.containsOverUnderKeyword(lastWord, "over")) {
                    return normalization_js_1.NormalizedSelection.OVER;
                }
                if (this.containsOverUnderKeyword(lastWord, "under")) {
                    return normalization_js_1.NormalizedSelection.UNDER;
                }
            }
        }
        return normalization_js_1.NormalizedSelection.UNKNOWN;
    };
    return BaseNormalizer;
}());
exports.BaseNormalizer = BaseNormalizer;
