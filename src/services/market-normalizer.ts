/**
 * Market Normalizer Service
 *
 * Transforms raw scraped market data into canonical format for cross-bookmaker comparison.
 * Now uses the unified normalization system from ./normalization/
 *
 * @deprecated Use normalizeMarketsForBookmaker from ./normalization/index.js directly
 */

import type { ScrapedMarket, MarketSelection } from "../types/full-offer.js";
import {
    NormalizedMarketType,
    NormalizedSelection,
    NormalizedMarketGroup,
    MARKET_TYPE_TO_GROUP,
    buildMarketKey,
} from "../types/normalization.js";
import { MarketCategory, MARKET_TYPE_TO_CATEGORY } from "../types/normalized-markets.js";
import { normalizer } from "./normalization/index.js";

// ============================================================================
// Selection Normalization Patterns
// ============================================================================

/**
 * Patterns for normalizing selection names to canonical values
 * Uses word-start matching (not exact) to handle variations like "poniżej 0.5"
 */
const SELECTION_PATTERNS: Array<{
    pattern: RegExp;
    normalized: NormalizedSelection;
}> = [
        // Over/Under - match at start of string, allow numbers after
        { pattern: /^(over|powyżej|powyzej|ponad|pow)\b/i, normalized: NormalizedSelection.OVER },
        { pattern: /^(under|poniżej|ponizej|pon)\b/i, normalized: NormalizedSelection.UNDER },

        // Yes/No (BTTS) - exact or start
        { pattern: /^(yes|tak|si|ja|sí|oui|gg)$/i, normalized: NormalizedSelection.YES },
        { pattern: /^(no|nie|nein|non|ng)$/i, normalized: NormalizedSelection.NO },

        // 1X2 outcomes
        { pattern: /^(1|home|gospodarz|dom|heim|casa)$/i, normalized: NormalizedSelection.HOME },
        { pattern: /^(x|draw|remis|empate|nul|unentschieden|pareggio)$/i, normalized: NormalizedSelection.DRAW },
        { pattern: /^(2|away|gość|gosc|auswärts|fuera|ospite)$/i, normalized: NormalizedSelection.AWAY },

        // Double Chance
        { pattern: /^(1x|home.*draw|1 lub x)$/i, normalized: NormalizedSelection.HOME_OR_DRAW },
        { pattern: /^(x2|draw.*away|x lub 2)$/i, normalized: NormalizedSelection.DRAW_OR_AWAY },
        { pattern: /^(12|home.*away|1 lub 2)$/i, normalized: NormalizedSelection.HOME_OR_AWAY },

        // Odd/Even
        { pattern: /^(odd|nieparzyste|impar|ungerade|dispari)/i, normalized: NormalizedSelection.ODD },
        { pattern: /^(even|parzyste|par|gerade|pari)/i, normalized: NormalizedSelection.EVEN },
    ];

/**
 * Normalize a selection name to canonical value
 */
export function normalizeSelectionName(rawName: string): NormalizedSelection {
    const trimmed = rawName.trim().toLowerCase();

    for (const { pattern, normalized } of SELECTION_PATTERNS) {
        if (pattern.test(trimmed)) {
            return normalized;
        }
    }

    return NormalizedSelection.UNKNOWN;
}

// ============================================================================
// Market Type Detection Patterns
// ============================================================================

/**
 * Patterns for detecting market types from market names
 * Higher priority patterns should come first
 */
const MARKET_TYPE_PATTERNS: Array<{
    pattern: RegExp;
    type: NormalizedMarketType;
    extractParam?: (match: RegExpMatchArray) => string | undefined;
}> = [
        // Half-time markets (check first - more specific)
        {
            pattern: /^(1[.:]?\s*poł|pierwsz.*poł|1st.*half|half.*time).*gol.*([\d,\.]+)/i,
            type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
            extractParam: (m) => m[2]?.replace(",", "."),
        },
        {
            pattern: /(1[.:]?\s*poł|pierwsz.*poł|1st.*half|half.*time).*(wynik|result|1x2)/i,
            type: NormalizedMarketType.HALF_TIME_RESULT,
        },
        {
            pattern: /(1[.:]?\s*poł|pierwsz.*poł|1st.*half|half.*time).*(btts|obie.*strzel)/i,
            type: NormalizedMarketType.HALF_TIME_BTTS,
        },

        // Over/Under Total Goals
        {
            pattern: /(liczba.*gol|total.*goal|over.*under|gole|bramk).*([\d,\.]+)/i,
            type: NormalizedMarketType.TOTAL_GOALS,
            extractParam: (m) => m[2]?.replace(",", "."),
        },
        {
            pattern: /^(powyżej|poniżej|over|under)\s*([\d,\.]+)/i,
            type: NormalizedMarketType.TOTAL_GOALS,
            extractParam: (m) => m[2]?.replace(",", "."),
        },

        // Handicaps
        {
            pattern: /(handicap.*azjat|asian.*handicap).*([\-\+]?[\d,\.]+)/i,
            type: NormalizedMarketType.ASIAN_HANDICAP,
            extractParam: (m) => m[2]?.replace(",", "."),
        },
        {
            pattern: /(handicap.*europ|european.*handicap).*([\-\+]?[\d,\.]+)/i,
            type: NormalizedMarketType.EUROPEAN_HANDICAP,
            extractParam: (m) => m[2]?.replace(",", "."),
        },
        {
            pattern: /handicap.*([\-\+]?[\d,\.]+)/i,
            type: NormalizedMarketType.ASIAN_HANDICAP,
            extractParam: (m) => m[1]?.replace(",", "."),
        },

        // BTTS
        {
            pattern: /(obie.*strzel|btts|both.*team.*score|gg.*ng)/i,
            type: NormalizedMarketType.BTTS,
        },

        // Double Chance
        {
            pattern: /(podwójn.*szans|double.*chance|1x.*x2.*12)/i,
            type: NormalizedMarketType.DOUBLE_CHANCE,
        },

        // Match Winner / 1X2
        {
            pattern: /(wynik.*mecz|match.*result|match.*winner|1x2|końcowy.*wynik)/i,
            type: NormalizedMarketType.MATCH_WINNER,
        },

        // Draw No Bet
        {
            pattern: /(remis.*zwrot|draw.*no.*bet|dnb)/i,
            type: NormalizedMarketType.DRAW_NO_BET,
        },

        // Correct Score
        {
            pattern: /(dokładn.*wynik|correct.*score|exact.*score)/i,
            type: NormalizedMarketType.CORRECT_SCORE,
        },

        // Odd/Even
        {
            pattern: /(parzyste|nieparzyste|odd.*even)/i,
            type: NormalizedMarketType.ODD_EVEN_GOALS,
        },

        // Win to Nil / Clean Sheet
        {
            pattern: /(wygran.*zer|win.*nil|to.*nil)/i,
            type: NormalizedMarketType.WIN_TO_NIL,
        },
        {
            pattern: /(czyst.*kont|clean.*sheet)/i,
            type: NormalizedMarketType.CLEAN_SHEET,
        },
    ];

/**
 * Detect market type and extract parameter from market name
 */
export function detectMarketType(marketName: string): {
    type: NormalizedMarketType;
    param?: string;
} {
    const trimmed = marketName.trim();

    for (const { pattern, type, extractParam } of MARKET_TYPE_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match) {
            const param = extractParam?.(match);
            return { type, param };
        }
    }

    return { type: NormalizedMarketType.OTHER };
}

// ============================================================================
// String Type Mapping (from existing scraper type hints)
// ============================================================================

/**
 * Map existing string types (from scrapers like Superbet) to normalized types
 */
const STRING_TYPE_MAP: Record<string, NormalizedMarketType> = {
    "1X2": NormalizedMarketType.MATCH_WINNER,
    "DOUBLE_CHANCE": NormalizedMarketType.DOUBLE_CHANCE,
    "OVER_UNDER": NormalizedMarketType.TOTAL_GOALS,
    "BTTS": NormalizedMarketType.BTTS,
    "ASIAN_HANDICAP": NormalizedMarketType.ASIAN_HANDICAP,
    "EUROPEAN_HANDICAP": NormalizedMarketType.EUROPEAN_HANDICAP,
    "HALF_TIME_1X2": NormalizedMarketType.HALF_TIME_RESULT,
    "HALF_TIME_OVER_UNDER": NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    "HALF_TIME_BTTS": NormalizedMarketType.HALF_TIME_BTTS,
    "CORRECT_SCORE": NormalizedMarketType.CORRECT_SCORE,
    "ODD_EVEN": NormalizedMarketType.ODD_EVEN_GOALS,
    "DRAW_NO_BET": NormalizedMarketType.DRAW_NO_BET,
    "WIN_TO_NIL": NormalizedMarketType.WIN_TO_NIL,
    "CLEAN_SHEET": NormalizedMarketType.CLEAN_SHEET,
};

// ============================================================================
// Main Normalizer
// ============================================================================

export interface NormalizationResult {
    /** Normalized market type */
    normalizedType: NormalizedMarketType;
    /** Canonical market key (e.g., "TOTAL_GOALS:2.5") */
    marketKey: string;
    /** Extracted parameter value (e.g., "2.5") */
    paramValue?: string;
    /** Normalized group for UI */
    normalizedGroup: NormalizedMarketGroup;
    /** Market category following Superbet pattern */
    category: MarketCategory;
    /** Selections with normalized names */
    selections: MarketSelection[];
}

/**
 * Normalize a single market
 * Applies type detection, key generation, and selection normalization
 */
export function normalizeMarket(market: ScrapedMarket): NormalizationResult {
    let normalizedType: NormalizedMarketType;
    let paramValue: string | undefined;

    // Strategy 1: Use existing type hint from scraper (e.g., Superbet provides these)
    if (market.type && STRING_TYPE_MAP[market.type]) {
        normalizedType = STRING_TYPE_MAP[market.type];

        // Extract param from market name if it's a parameterized market
        if (
            normalizedType === NormalizedMarketType.TOTAL_GOALS ||
            normalizedType === NormalizedMarketType.ASIAN_HANDICAP ||
            normalizedType === NormalizedMarketType.EUROPEAN_HANDICAP ||
            normalizedType === NormalizedMarketType.HALF_TIME_TOTAL_GOALS
        ) {
            const paramMatch = market.name.match(/([\d]+[,\.][\d]+)/);
            if (paramMatch) {
                paramValue = paramMatch[1].replace(",", ".");
            }
        }
    } else {
        // Strategy 2: Detect type from market name using patterns
        const detected = detectMarketType(market.name);
        normalizedType = detected.type;
        paramValue = detected.param;
    }

    // Build canonical market key
    const marketKey = buildMarketKey(normalizedType, paramValue);

    // Determine group
    const normalizedGroup = MARKET_TYPE_TO_GROUP[normalizedType];

    // Determine category following Superbet pattern
    const category = MARKET_TYPE_TO_CATEGORY[normalizedType] || MarketCategory.INNE;

    // Normalize selections
    const normalizedSelections = market.selections.map((sel) => ({
        ...sel,
        normalizedName: normalizeSelectionName(sel.name),
    }));

    return {
        normalizedType,
        marketKey,
        paramValue,
        normalizedGroup,
        category,
        selections: normalizedSelections,
    };
}

/**
 * Apply normalization to a market, returning the updated market object
 */
export function applyNormalization(market: ScrapedMarket): ScrapedMarket {
    const result = normalizeMarket(market);

    return {
        ...market,
        normalizedType: result.normalizedType,
        normalizedGroup: result.normalizedGroup,
        marketKey: result.marketKey,
        paramValue: result.paramValue,
        category: result.category,
        selections: result.selections,
    };
}

/**
 * Normalize all markets in a collection
 */
export function normalizeMarkets(markets: ScrapedMarket[]): ScrapedMarket[] {
    return markets.map(applyNormalization);
}

export function normalizeMarketForBookmaker(
    market: ScrapedMarket,
    bookmaker: string,
    homeTeam?: string,
    awayTeam?: string
): ScrapedMarket {
    const result = normalizer.normalize(market, bookmaker, homeTeam, awayTeam);

    return {
        ...market,
        normalizedType: result.normalizedType as NormalizedMarketType,
        normalizedGroup: MARKET_TYPE_TO_GROUP[result.normalizedType as NormalizedMarketType] || NormalizedMarketGroup.OTHER,
        marketKey: result.marketKey,
        paramValue: result.paramValue,
        category: result.category,
        selections: result.selections.map((sel, idx) => ({
            ...market.selections[idx],
            normalizedName: sel.normalizedName as NormalizedSelection,
        })),
    };
}

export function normalizeMarketsForBookmaker(
    markets: ScrapedMarket[],
    bookmaker: string,
    homeTeam?: string,
    awayTeam?: string
): ScrapedMarket[] {
    return markets.map((m) =>
        normalizeMarketForBookmaker(m, bookmaker, homeTeam, awayTeam)
    );
}
