/**
 * Normalizer Factory
 *
 * Factory function to create the normalizer facade that routes to bookmaker-specific normalizers.
 * This replaces the old UnifiedNormalizer with a simpler adapter-first approach.
 */

import type {
  BookmakerMarketNormalizer,
  RawBookmakerMarket,
  NormalizationContext,
  NormalizedMarketOutput,
  NormalizedMarket,
  NormalizedSelection,
  MarketCategory,
} from "./types.js";
import {
  stsNormalizer,
  fortunaNormalizer,
  superbetNormalizer,
  betclicNormalizer,
  betcrisNormalizer,
  betfanNormalizer,
  bettersNormalizer,
  etotoNormalizer,
  forbetNormalizer,
  fuksiarzNormalizer,
  lebullNormalizer,
  lvbetNormalizer,
  pzbukNormalizer,
  totalbetNormalizer,
} from "./bookmakers/index.js";
import { MarketCategory as MC } from "./types.js";

/**
 * Map of bookmaker code to normalizer
 */
const NORMALIZER_MAP: Map<string, BookmakerMarketNormalizer> = new Map([
  ["sts", stsNormalizer],
  ["fortuna", fortunaNormalizer],
  ["superbet", superbetNormalizer],
  ["betclic", betclicNormalizer],
  ["betcris", betcrisNormalizer],
  ["betfan", betfanNormalizer],
  ["betters", bettersNormalizer],
  ["etoto", etotoNormalizer],
  ["forbet", forbetNormalizer],
  ["fuksiarz", fuksiarzNormalizer],
  ["lebull", lebullNormalizer],
  ["lvbet", lvbetNormalizer],
  ["pzbuk", pzbukNormalizer],
  ["totalbet", totalbetNormalizer],
]);

/**
 * Get the normalizer for a specific bookmaker
 */
export function getNormalizerForBookmaker(bookmaker: string): BookmakerMarketNormalizer | undefined {
  return NORMALIZER_MAP.get(bookmaker.toLowerCase());
}

/**
 * Get all supported bookmaker codes
 */
export function getSupportedBookmakers(): string[] {
  return Array.from(NORMALIZER_MAP.keys());
}

/**
 * Check if a bookmaker has a normalizer
 */
export function hasNormalizer(bookmaker: string): boolean {
  return NORMALIZER_MAP.has(bookmaker.toLowerCase());
}

/**
 * Normalizer Facade
 * 
 * Provides a unified interface for market normalization while routing
 * to bookmaker-specific normalizers internally.
 */
export interface NormalizerFacade {
  /**
   * Normalize a single market
   */
  normalize(
    market: { name: string; type?: string; selections: Array<{ name: string; odds: number }> },
    bookmaker: string,
    homeTeam?: string,
    awayTeam?: string
  ): NormalizedMarket;

  /**
   * Normalize multiple markets at once
   */
  normalizeBatch(
    markets: Array<{ name: string; type?: string; selections: Array<{ name: string; odds: number }> }>,
    bookmaker: string,
    homeTeam?: string,
    awayTeam?: string
  ): NormalizedMarket[];

  /**
   * Get normalizer for a specific bookmaker
   */
  getNormalizer(bookmaker: string): BookmakerMarketNormalizer | undefined;

  /**
   * Check if normalizer exists for bookmaker
   */
  hasNormalizer(bookmaker: string): boolean;

  /**
   * Get all supported bookmakers
   */
  getSupportedBookmakers(): string[];
}

/**
 * Convert NormalizedMarketOutput to NormalizedMarket (legacy format)
 */
function toNormalizedMarket(
  output: NormalizedMarketOutput | null,
  originalName: string,
  originalSelections: Array<{ name: string; odds: number }>
): NormalizedMarket {
  if (!output) {
    console.warn(`[Normalizer] Market mapped to OTHER: "${originalName}"`);
    const truncatedName = originalName.slice(0, 30).replace(/\s+/g, "-");
    return {
      name: originalName,
      normalizedType: "OTHER",
      marketKey: `OTHER:${truncatedName}`,
      category: MC.INNE,
      selections: originalSelections.map((sel) => ({
        name: sel.name,
        normalizedName: "UNKNOWN" as NormalizedSelection,
        odds: sel.odds,
      })),
    };
  }

  // Map category from market code
  const category = getCategoryForMarketCode(output.marketCode);

  return {
    name: originalName,
    normalizedType: output.marketCode,
    marketKey: output.marketKey,
    category,
    paramValue: output.paramValue,
    selections: output.selections.map((sel) => ({
      name: sel.label,
      normalizedName: sel.code,
      odds: sel.odds,
    })),
  };
}

/**
 * Get category for a market code
 */
function getCategoryForMarketCode(code: string): MarketCategory {
  // Main markets
  if (["MATCH_WINNER", "DOUBLE_CHANCE", "DRAW_NO_BET"].includes(code)) {
    return MC.WYNIK_MECZU;
  }
  // Goals markets
  if ([
    "TOTAL_GOALS", "TOTAL_GOALS_ASIAN", "BTTS", "ODD_EVEN_GOALS",
    "WIN_TO_NIL", "CLEAN_SHEET", "HOME_TEAM_TO_SCORE", "AWAY_TEAM_TO_SCORE",
    "TEAM_TOTAL_GOALS", "GOAL_RANGE", "BOTH_HALVES_GOALS", "WINNING_MARGIN"
  ].includes(code)) {
    return MC.GOLE;
  }
  // Handicap markets
  if (["ASIAN_HANDICAP", "EUROPEAN_HANDICAP"].includes(code)) {
    return MC.HANDICAP;
  }
  // Half-time markets
  if ([
    "HALF_TIME_RESULT", "HALF_TIME_TOTAL_GOALS", "HALF_TIME_BTTS",
    "SECOND_HALF_RESULT", "SECOND_HALF_TOTAL_GOALS"
  ].includes(code)) {
    return MC.PIERWSZA_POLOWA;
  }
  // Correct score
  if (code === "CORRECT_SCORE") {
    return MC.DOKLADNY_WYNIK;
  }
  // Player markets
  if ([
    "GOALSCORER_FIRST", "GOALSCORER_LAST", "GOALSCORER_ANYTIME",
    "PLAYER_SHOTS", "PLAYER_CARDS", "PLAYER_ASSISTS",
    "PLAYER_SHOTS_ON_TARGET", "PLAYER_PASSES", "PLAYER_GOAL_AND_RESULT"
  ].includes(code)) {
    return MC.ZAWODNICY;
  }
  // Statistics markets
  if ([
    "CORNERS_TOTAL", "CORNERS_TEAM", "CORNERS_RACE", "FIRST_CORNER", "CORNERS_HANDICAP",
    "CARDS_TOTAL", "CARDS_TEAM", "CARDS_RACE", "FIRST_CARD",
    "FOULS_TOTAL", "OFFSIDES_TOTAL"
  ].includes(code)) {
    return MC.STATYSTYKI;
  }
  // Combination markets
  if ([
    "RESULT_AND_BTTS", "RESULT_AND_TOTAL", "HALFTIME_FULLTIME",
    "DOUBLE_RESULT", "DOUBLE_CHANCE_BTTS", "DOUBLE_CHANCE_TOTAL",
    "FIRST_TEAM_TO_SCORE", "FIRST_GOAL_TIME", "TIME_PERIOD_RESULT", "FIRST_GOAL_AND_RESULT"
  ].includes(code)) {
    return MC.KOMBINACJE;
  }
  // Default
  return MC.INNE;
}

/**
 * Create the normalizer facade
 */
export function createNormalizer(): NormalizerFacade {
  return {
    normalize(market, bookmaker, homeTeam, awayTeam) {
      const normalizer = getNormalizerForBookmaker(bookmaker);
      
      if (!normalizer) {
        // No normalizer for this bookmaker - return fallback
        console.warn(`[Normalizer] No normalizer found for bookmaker: ${bookmaker}`);
        return toNormalizedMarket(null, market.name, market.selections);
      }

      const ctx: NormalizationContext = {
        homeTeam: homeTeam || "",
        awayTeam: awayTeam || "",
      };

      const rawMarket: RawBookmakerMarket = {
        name: market.name,
        selections: market.selections,
      };

      // If market has a type from scraper, include it as bookmakerMarketId for pattern matching
      if (market.type) {
        rawMarket.bookmakerMarketId = market.type;
      }

      const output = normalizer.normalizeMarket(rawMarket, ctx);
      return toNormalizedMarket(output, market.name, market.selections);
    },

    normalizeBatch(markets, bookmaker, homeTeam, awayTeam) {
      return markets.map((m) => this.normalize(m, bookmaker, homeTeam, awayTeam));
    },

    getNormalizer(bookmaker) {
      return getNormalizerForBookmaker(bookmaker);
    },

    hasNormalizer(bookmaker) {
      return hasNormalizer(bookmaker);
    },

    getSupportedBookmakers() {
      return getSupportedBookmakers();
    },
  };
}

/**
 * Singleton normalizer instance
 *
 * Use this for convenience instead of creating a new instance each time
 */
export const normalizer = createNormalizer();
