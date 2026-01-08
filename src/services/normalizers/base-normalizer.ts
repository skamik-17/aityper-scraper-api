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

      // Player markets -> OTHER group (legacy compatibility)
      case NormalizedMarketType.GOALSCORER_FIRST:
      case NormalizedMarketType.GOALSCORER_LAST:
      case NormalizedMarketType.GOALSCORER_ANYTIME:
      case NormalizedMarketType.PLAYER_SHOTS:
      case NormalizedMarketType.PLAYER_CARDS:
      case NormalizedMarketType.PLAYER_ASSISTS:
        return NormalizedMarketGroup.OTHER;

      // Statistics markets -> OTHER group
      case NormalizedMarketType.CORNERS_TOTAL:
      case NormalizedMarketType.CORNERS_TEAM:
      case NormalizedMarketType.CARDS_TOTAL:
      case NormalizedMarketType.CARDS_TEAM:
      case NormalizedMarketType.FOULS_TOTAL:
      case NormalizedMarketType.OFFSIDES_TOTAL:
        return NormalizedMarketGroup.OTHER;

      // Combination markets -> OTHER group
      case NormalizedMarketType.RESULT_AND_BTTS:
      case NormalizedMarketType.RESULT_AND_TOTAL:
      case NormalizedMarketType.HALFTIME_FULLTIME:
      case NormalizedMarketType.DOUBLE_RESULT:
        return NormalizedMarketGroup.OTHER;

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
   * Remove Polish diacritics from text for easier matching
   *
   * @param text - Text with potential diacritics
   * @returns Text with diacritics removed
   */
  protected removeDiacritics(text: string): string {
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove combining diacritical marks
      .replace(/ł/g, "l")
      .replace(/Ł/g, "L");
  }

  /**
   * Check if string contains any Over/Under indicator keyword
   * Works with diacritics and various languages
   *
   * @param name - Selection name to check
   * @param lookingFor - 'over' or 'under'
   * @returns True if the keyword is found
   */
  protected containsOverUnderKeyword(name: string, lookingFor: "over" | "under"): boolean {
    const normalized = this.removeDiacritics(name.toLowerCase());

    if (lookingFor === "over") {
      return /^(over|powyzej|ponad|pow)\b/i.test(normalized) ||
             /\b(over|powyzej|ponad|pow|więcej|wiecej|więk|wiek)\b/i.test(normalized);
    } else {
      return /^(under|ponizej|pon)\b/i.test(normalized) ||
             /\b(under|ponizej|pon|mniej|mn)\b/i.test(normalized);
    }
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
    // Normalize input: lowercase, trim, remove diacritics for matching
    const normalizedName = this.removeDiacritics(name.toLowerCase().trim());
    const trimmedOriginal = name.trim();

    // ==========================================================================
    // MARKET-TYPE SPECIFIC SELECTIONS
    // Check market type first to determine expected selection format
    // ==========================================================================

    // BTTS and HALF_TIME_BTTS markets use YES/NO selections
    // Check these BEFORE Over/Under to avoid misclassification
    if (marketType === NormalizedMarketType.BTTS || marketType === NormalizedMarketType.HALF_TIME_BTTS) {
      // Yes indicators
      if (/^(tak|yes|gg|si|sim|gol)\s*$/i.test(normalizedName)) {
        return NormalizedSelection.YES;
      }
      // No indicators
      if (/^(nie|no|ng|n[ao]o|brak)\s*$/i.test(normalizedName)) {
        return NormalizedSelection.NO;
      }
      // Special case: "1" can mean YES for BTTS
      if (/^1\s*$/i.test(normalizedName)) {
        return NormalizedSelection.YES;
      }
      // Special case: "0" or "2" can mean NO for BTTS
      if (/^(0|2)\s*$/i.test(normalizedName)) {
        return NormalizedSelection.NO;
      }
    }

    // TOTAL_GOALS and HALF_TIME_TOTAL_GOALS use OVER/UNDER selections
    if (marketType === NormalizedMarketType.TOTAL_GOALS || marketType === NormalizedMarketType.HALF_TIME_TOTAL_GOALS) {
      // Check for Over indicators
      if (this.containsOverUnderKeyword(normalizedName, "over")) {
        return NormalizedSelection.OVER;
      }
      // Check for Under indicators
      if (this.containsOverUnderKeyword(normalizedName, "under")) {
        return NormalizedSelection.UNDER;
      }
      // Numeric line indicators: "+" prefix means Over, "-" prefix means Under
      if (/^\+[\d.,]+/.test(trimmedOriginal)) {
        return NormalizedSelection.OVER;
      }
      if (/^-[\d.,]+/.test(trimmedOriginal)) {
        return NormalizedSelection.UNDER;
      }
      // Suffix indicators: "2.5+" or "2.5-"
      if (/[\d.,]+\+$/.test(trimmedOriginal)) {
        return NormalizedSelection.OVER;
      }
      if (/[\d.,]+-$/.test(trimmedOriginal)) {
        return NormalizedSelection.UNDER;
      }
      // Short codes
      if (/^(o|over)\s*$/i.test(normalizedName)) {
        return NormalizedSelection.OVER;
      }
      if (/^(u|under)\s*$/i.test(normalizedName)) {
        return NormalizedSelection.UNDER;
      }
    }

    // GOALSCORER markets - keep original names (player names)
    // These should not be normalized to standard selections
    if (marketType === NormalizedMarketType.GOALSCORER_FIRST ||
        marketType === NormalizedMarketType.GOALSCORER_LAST ||
        marketType === NormalizedMarketType.GOALSCORER_ANYTIME) {
      // Return UNKNOWN to preserve the original player name
      // The calling code should use the original name for display
      return NormalizedSelection.UNKNOWN;
    }

    // ==========================================================================
    // 1X2 OUTCOMES - Single character and short codes
    // ==========================================================================

    // Home (1)
    if (/^1$|^home$|^gospodarz$/i.test(normalizedName)) {
      return NormalizedSelection.HOME;
    }

    // Draw (X)
    if (/^x$|^0$|^draw$|^remis$/i.test(normalizedName)) {
      return NormalizedSelection.DRAW;
    }

    // Away (2)
    if (/^2$|^away$|^gosc$|^gos[cć]$/i.test(normalizedName)) {
      return NormalizedSelection.AWAY;
    }

    // ==========================================================================
    // DOUBLE CHANCE - Two-outcome combinations
    // ==========================================================================

    // 1X or 10 (Home or Draw)
    if (/^(1x|10)$/i.test(normalizedName) || /1\s*(lub|or|l\.|&)\s*x/i.test(normalizedName)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }

    // X2 or 02 (Draw or Away)
    if (/^(x2|02)$/i.test(normalizedName) || /x\s*(lub|or|l\.|&)\s*2/i.test(normalizedName) || /remis\s*(lub|or)\s*2/i.test(normalizedName)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }

    // 12 (Home or Away - No Draw)
    if (/^12$/i.test(normalizedName) || /1\s*(lub|or|l\.|&)\s*2/i.test(normalizedName)) {
      return NormalizedSelection.HOME_OR_AWAY;
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
      return NormalizedSelection.OVER;
    }

    // Check for Under indicators
    if (this.containsOverUnderKeyword(normalizedName, "under")) {
      return NormalizedSelection.UNDER;
    }

    // Numeric line indicators: "+" prefix means Over, "-" prefix means Under
    // This handles selections like "+2.5" or "-2.5"
    // Check original name (preserves the +/- signs)
    if (/^\+[\d.,]+/.test(trimmedOriginal)) {
      return NormalizedSelection.OVER;
    }
    if (/^-[\d.,]+/.test(trimmedOriginal)) {
      return NormalizedSelection.UNDER;
    }

    // Suffix indicators: "2.5+" or "2.5-" (less common but exists)
    if (/[\d.,]+\+$/.test(trimmedOriginal)) {
      return NormalizedSelection.OVER;
    }
    if (/[\d.,]+-$/.test(trimmedOriginal)) {
      return NormalizedSelection.UNDER;
    }

    // ==========================================================================
    // YES/NO - BTTS and similar markets
    // Handles multiple languages and formats
    // ==========================================================================

    // Yes indicators
    if (/^(tak|yes|gg|si|1)\s*$/i.test(normalizedName)) {
      // Special case: "1" could be HOME for 1X2 or YES for BTTS
      if (normalizedName === "1" && marketType !== NormalizedMarketType.BTTS &&
          marketType !== NormalizedMarketType.HALF_TIME_BTTS) {
        return NormalizedSelection.HOME;
      }
      return NormalizedSelection.YES;
    }

    // No indicators
    if (/^(nie|no|ng|nope|0)\s*$/i.test(normalizedName)) {
      // Special case: "0" could be DRAW for 1X2 or NO for BTTS
      if (normalizedName === "0" && marketType !== NormalizedMarketType.BTTS &&
          marketType !== NormalizedMarketType.HALF_TIME_BTTS) {
        return NormalizedSelection.DRAW;
      }
      return NormalizedSelection.NO;
    }

    // ==========================================================================
    // ODD/EVEN - Parity markets
    // ==========================================================================

    if (/^(nieparzyste|odd|np)\s*$/i.test(normalizedName)) {
      return NormalizedSelection.ODD;
    }
    if (/^(parzyste|even|par)\s*$/i.test(normalizedName)) {
      return NormalizedSelection.EVEN;
    }

    // ==========================================================================
    // FALLBACK: Try to extract from patterns with embedded values
    // This handles cases where the selection includes a line value
    // e.g., "Powyzej 2.5" should be OVER even if keyword matching failed
    // ==========================================================================

    // Extract first word/number and check if it's a line value
    // If we find a pattern like "2.5 Over" or "Over 2.5", we already caught it above
    // This is for edge cases
    const words = normalizedName.split(/\s+/);
    if (words.length >= 2) {
      const firstWord = words[0];
      const lastWord = words[words.length - 1];

      // Check if first word is a line number (decimal)
      if (/^[\d.,]+$/.test(firstWord)) {
        // If format is "2.5 something" and second word suggests Over/Under
        if (words.length > 1) {
          const remaining = words.slice(1).join(" ");
          if (this.containsOverUnderKeyword(remaining, "over")) {
            return NormalizedSelection.OVER;
          }
          if (this.containsOverUnderKeyword(remaining, "under")) {
            return NormalizedSelection.UNDER;
          }
        }
      }

      // Check if last word is a direction indicator
      if (/^(over|powyzej|ponad|under|ponizej|mniej|wiecej)$/i.test(lastWord)) {
        if (this.containsOverUnderKeyword(lastWord, "over")) {
          return NormalizedSelection.OVER;
        }
        if (this.containsOverUnderKeyword(lastWord, "under")) {
          return NormalizedSelection.UNDER;
        }
      }
    }

    return NormalizedSelection.UNKNOWN;
  }
}
