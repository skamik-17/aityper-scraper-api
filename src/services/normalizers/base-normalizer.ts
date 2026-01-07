/**
 * Base Normalizer
 *
 * Abstract class providing common normalization logic for betting markets.
 * Each bookmaker-specific normalizer extends this class and overrides
 * patterns and selection normalization as needed.
 */

import {
  NormalizedMarketType,
  NormalizedSelection,
  NormalizedMarketGroup,
  buildMarketKey,
} from "../../types/normalization.js";
import { MarketCategory, MARKET_TYPE_TO_CATEGORY } from "../../types/normalized-markets.js";

/**
 * Raw market data interface for input to normalizer
 */
export interface RawMarketData {
  name: string;
  selections: Array<{
    name: string;
    odds: number;
  }>;
  type?: string;
  groupName?: string;
}

/**
 * Normalized market output
 */
export interface NormalizedMarket {
  originalName: string;
  normalizedType: NormalizedMarketType;
  normalizedGroup: NormalizedMarketGroup;
  marketKey: string;
  paramValue?: string;
  category: MarketCategory;
  selections: Array<{
    name: string;
    odds: number;
    normalizedName: NormalizedSelection;
  }>;
}

/**
 * Pattern definition for market type detection
 */
export interface MarketPattern {
  /** Regex pattern to match market name */
  pattern: RegExp;
  /** Normalized market type to assign when matched */
  type: NormalizedMarketType;
  /** Optional group override (defaults to inferred from type) */
  group?: NormalizedMarketGroup;
  /** Optional function to extract parameter value from regex match */
  extractParam?: (match: RegExpMatchArray) => string | undefined;
}

/**
 * Abstract base class for bookmaker-specific normalizers
 */
export abstract class BaseNormalizer {
  /** Bookmaker identifier (lowercase) */
  abstract readonly bookmaker: string;

  /** Bookmaker-specific market patterns - matched before falling back to OTHER */
  protected abstract readonly patterns: MarketPattern[];

  /**
   * Main entry point for normalizing a market
   *
   * @param market - Raw market data from scraper
   * @param homeTeam - Home team name for selection matching
   * @param awayTeam - Away team name for selection matching
   * @returns Normalized market with canonical types and keys
   */
  normalize(
    market: RawMarketData,
    homeTeam?: string,
    awayTeam?: string
  ): NormalizedMarket {
    // Try ID-based mapping first (for bookmakers using numeric/coded IDs)
    const idResult = this.tryIdMapping(market.name);
    if (idResult) {
      return this.buildResult(
        market,
        idResult.type,
        idResult.group,
        idResult.param,
        homeTeam,
        awayTeam
      );
    }

    // Try pattern matching
    for (const { pattern, type, group, extractParam } of this.patterns) {
      const match = market.name.match(pattern);
      if (match) {
        const param = extractParam?.(match);
        return this.buildResult(market, type, group, param, homeTeam, awayTeam);
      }
    }

    // Fallback to OTHER
    return this.buildResult(
      market,
      NormalizedMarketType.OTHER,
      NormalizedMarketGroup.OTHER,
      undefined,
      homeTeam,
      awayTeam
    );
  }

  /**
   * Try to map market name using ID-based lookup
   * Override in subclass if bookmaker uses "Rynek XX" or similar ID formats
   *
   * @param marketName - Raw market name to look up
   * @returns Type, group, and optional param if ID mapping found, null otherwise
   */
  protected tryIdMapping(marketName: string): {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    param?: string;
  } | null {
    return null; // Default: no ID mapping
  }

  /**
   * Build the normalized market result
   */
  protected buildResult(
    market: RawMarketData,
    type: NormalizedMarketType,
    group: NormalizedMarketGroup | undefined,
    param: string | undefined,
    homeTeam?: string,
    awayTeam?: string
  ): NormalizedMarket {
    const marketGroup = group ?? this.inferGroup(type);
    const marketCategory = this.getCategoryForType(type);
    const marketKey = buildMarketKey(type, param);

    const normalizedSelections = market.selections.map((sel) => ({
      ...sel,
      normalizedName: this.normalizeSelectionName(
        sel.name,
        type,
        homeTeam,
        awayTeam
      ),
    }));

    return {
      originalName: market.name,
      normalizedType: type,
      normalizedGroup: marketGroup,
      marketKey,
      paramValue: param,
      category: marketCategory,
      selections: normalizedSelections,
    };
  }

  /**
   * Infer market group from type using standard mapping
   *
   * @param type - Normalized market type
   * @returns Inferred market group
   */
  protected inferGroup(type: NormalizedMarketType): NormalizedMarketGroup {
    switch (type) {
      // Main markets
      case NormalizedMarketType.MATCH_WINNER:
      case NormalizedMarketType.DOUBLE_CHANCE:
      case NormalizedMarketType.DRAW_NO_BET:
        return NormalizedMarketGroup.MAIN;

      // Goals markets
      case NormalizedMarketType.TOTAL_GOALS:
      case NormalizedMarketType.BTTS:
      case NormalizedMarketType.ODD_EVEN_GOALS:
      case NormalizedMarketType.WIN_TO_NIL:
      case NormalizedMarketType.CLEAN_SHEET:
        return NormalizedMarketGroup.GOALS;

      // Handicap markets
      case NormalizedMarketType.ASIAN_HANDICAP:
      case NormalizedMarketType.EUROPEAN_HANDICAP:
        return NormalizedMarketGroup.HANDICAP;

      // Half-time markets
      case NormalizedMarketType.HALF_TIME_RESULT:
      case NormalizedMarketType.HALF_TIME_TOTAL_GOALS:
      case NormalizedMarketType.HALF_TIME_BTTS:
        return NormalizedMarketGroup.HALF_TIME;

      // Score markets
      case NormalizedMarketType.CORRECT_SCORE:
        return NormalizedMarketGroup.SCORE;

      // Fallback
      default:
        return NormalizedMarketGroup.OTHER;
    }
  }

  /**
   * Get category for market type using standard mapping
   *
   * @param type - Normalized market type
   * @returns Market category following Superbet pattern
   */
  protected getCategoryForType(type: NormalizedMarketType): MarketCategory {
    return MARKET_TYPE_TO_CATEGORY[type] || MarketCategory.INNE;
  }

  /**
   * Normalize a selection name to canonical value
   * Must be implemented by each bookmaker normalizer to handle specific naming conventions
   *
   * @param selectionName - Raw selection name from bookmaker
   * @param marketType - Normalized market type (affects interpretation)
   * @param homeTeam - Home team name for matching
   * @param awayTeam - Away team name for matching
   * @returns Normalized selection identifier
   */
  protected abstract normalizeSelectionName(
    selectionName: string,
    marketType: NormalizedMarketType,
    homeTeam?: string,
    awayTeam?: string
  ): NormalizedSelection;

  /**
   * Helper to check if a selection name matches a team name
   * Uses multiple matching strategies: exact, contains, first word
   *
   * @param selectionName - Lowercase trimmed selection name
   * @param teamName - Team name to match against
   * @returns True if selection appears to reference the team
   */
  protected matchesTeam(selectionName: string, teamName: string): boolean {
    const normalizedSelection = selectionName.toLowerCase().trim();
    const normalizedTeam = teamName.toLowerCase().trim();

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
    const selectionFirst = normalizedSelection.split(/\s+/)[0];
    const teamFirst = normalizedTeam.split(/\s+/)[0];
    if (
      selectionFirst &&
      teamFirst &&
      selectionFirst === teamFirst &&
      selectionFirst.length > 3
    ) {
      return true;
    }

    return false;
  }

  /**
   * Common selection normalization patterns shared across bookmakers
   * Subclasses can call this as a fallback after trying bookmaker-specific patterns
   *
   * @param name - Lowercase trimmed selection name
   * @param marketType - Market type for context
   * @returns Normalized selection or UNKNOWN if no match
   */
  protected normalizeCommonSelection(
    name: string,
    marketType: NormalizedMarketType
  ): NormalizedSelection {
    // 1X2 outcomes
    if (/^1$|^home$|^gospodarz$/i.test(name)) {
      return NormalizedSelection.HOME;
    }
    if (/^x$|^draw$|^remis$/i.test(name)) {
      return NormalizedSelection.DRAW;
    }
    if (/^2$|^away$|^gość$|^gosc$/i.test(name)) {
      return NormalizedSelection.AWAY;
    }

    // Double Chance
    if (/^1x$/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (/^x2$/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (/^12$/i.test(name)) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Over/Under - match at start to handle "Ponad 2.5" etc.
    if (/^(over|powyżej|powyzej|ponad|pow)\b/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    if (/^(under|poniżej|ponizej|pon)\b/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Yes/No (BTTS and similar)
    if (/^(tak|yes|gg)$/i.test(name)) {
      return NormalizedSelection.YES;
    }
    if (/^(nie|no|ng)$/i.test(name)) {
      return NormalizedSelection.NO;
    }

    // Odd/Even
    if (/^(nieparzyste|odd)$/i.test(name)) {
      return NormalizedSelection.ODD;
    }
    if (/^(parzyste|even)$/i.test(name)) {
      return NormalizedSelection.EVEN;
    }

    return NormalizedSelection.UNKNOWN;
  }
}
