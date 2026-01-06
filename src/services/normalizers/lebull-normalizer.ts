/**
 * LeBull Market Normalizer
 *
 * Handles market normalization specific to LeBull betting platform.
 * LeBull uses numeric stake type IDs (stakeTypeId) from the sbteam.xyz API.
 * When the parser doesn't recognize an ID, it falls back to "Rynek XXX" format.
 *
 * This normalizer:
 * 1. Maps known stake type IDs to normalized market types
 * 2. Handles the "Rynek XXX" format by extracting and mapping the ID
 * 3. Falls back to pattern matching for any named markets
 *
 * Known stake type IDs from sbteam.xyz API:
 * - 1: Match Result (1X2)
 * - 2: Handicap (Asian)
 * - 3: Over/Under Total Goals
 * - 5: Half Time Result
 * - 6: Half Time Over/Under
 * - 7: Correct Score
 * - 9: Draw No Bet
 * - 26: BTTS
 * - 27: Match Winner + Over/Under combo
 * - 28: Match Winner + BTTS combo
 * - 37: Double Chance
 * - 69: European Handicap (3-way)
 * - 75: Odd/Even Total Goals
 * - 134: Half Time BTTS
 * - 618: Win to Nil
 * - 748: Clean Sheet
 *
 * Coverage target: >=90%
 */

import {
  NormalizedMarketType,
  NormalizedSelection,
  NormalizedMarketGroup,
} from "../../types/normalization.js";
import { BaseNormalizer, type MarketPattern } from "./base-normalizer.js";

/**
 * Mapping of LeBull stake type IDs to normalized market types
 * These IDs are from the sbteam.xyz API used by LeBull
 */
const STAKE_TYPE_ID_MAP: Map<
  number,
  { type: NormalizedMarketType; group: NormalizedMarketGroup }
> = new Map([
  // Main markets
  [1, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }],
  [37, { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }],
  [9, { type: NormalizedMarketType.DRAW_NO_BET, group: NormalizedMarketGroup.MAIN }],

  // Goals markets
  [3, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  [26, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }],
  [75, { type: NormalizedMarketType.ODD_EVEN_GOALS, group: NormalizedMarketGroup.GOALS }],
  [618, { type: NormalizedMarketType.WIN_TO_NIL, group: NormalizedMarketGroup.GOALS }],
  [748, { type: NormalizedMarketType.CLEAN_SHEET, group: NormalizedMarketGroup.GOALS }],

  // Handicap markets
  [2, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP }],
  [69, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP }],

  // Half-time markets
  [5, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [6, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME }],
  [134, { type: NormalizedMarketType.HALF_TIME_BTTS, group: NormalizedMarketGroup.HALF_TIME }],

  // Score markets
  [7, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }],

  // Combo markets - map to primary market type
  // 27 = Match Winner + Over/Under - treat as TOTAL_GOALS combo
  [27, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  // 28 = Match Winner + BTTS - treat as BTTS combo
  [28, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }],

  // Additional discovered IDs from extended stake types
  // Team totals
  [80, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  [144, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  [356, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  [545, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  [702, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  [724, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],

  // Half-time specific combinations
  [40390, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],

  // Exotic high-ID markets (often player/special markets - map to OTHER)
  // These will be handled by pattern matching if they have meaningful names
]);

/**
 * Set of stake type IDs that should be classified as OTHER
 * These are specialized markets (cards, corners, player props, minute bets, etc.)
 * that don't fit into the standard market categories.
 *
 * LeBull extended stake types include many exotic markets with high IDs.
 * IDs above 1000 are typically special markets.
 */
const OTHER_STAKE_TYPE_IDS: Set<number> = new Set([
  // Low-numbered known "other" markets
  4,      // Specific minute/time markets
  8,      // Penalty markets
  10,     // First goal scorer
  11,     // Last goal scorer
  12,     // Anytime goalscorer
  13,     // Team to score first
  14,     // Team to score last
  15,     // Specific scorer markets
  16,     // Double/hat-trick markets
  17,     // Double/hat-trick markets
  18,     // Scorer related
  19,     // Scorer related
  20,     // Scorer related
  21,     // Scorer related
  22,     // Cards markets
  23,     // Cards markets
  24,     // Corners markets
  25,     // Corners markets
  29,     // Time of goals
  30,     // Time of goals
  31,     // Time of goals
  32,     // Time of goals
  33,     // Period markets
  34,     // Period markets
  35,     // Period markets
  36,     // Period markets
  38,     // Combo markets
  39,     // Combo markets
  40,     // Combo markets
  41,     // Combo markets
  42,     // Special markets
  43,     // Special markets
  44,     // Special markets
  45,     // Special markets
  46,     // Special markets
  47,     // Special markets
  48,     // Special markets
  49,     // Special markets
  50,     // Special markets

  // Half-time specialty markets
  40390,  // Half-time special combo
  40397,  // Half-time special
  40495,  // Half-time special

  // High-ID special/exotic markets
  176415, // Special market
  183254, // Special market
  217797, // Special market
  261946, // Special market
  270665, // Special market
  274556, // Special market
  313638, // Special market
  313639, // Special market
  332815, // Special market
  333649, // Special market
  350009, // Special market
  350010, // Special market
  350171, // Special market
  357318, // Special market
  5699562, // Player/special market
  5699564, // Player/special market
  5701801, // Player/special market
  5774433, // Player/special market
]);

export class LeBullNormalizer extends BaseNormalizer {
  readonly bookmaker = "lebull";

  /**
   * Bookmaker-specific market patterns
   *
   * These match named markets produced by the LeBull parser's getMarketName function.
   * The parser converts known stake type IDs to Polish market names:
   * - 1 (MATCH_RESULT) -> "Wynik meczu"
   * - 3 (OVER_UNDER) -> "Liczba goli X.X"
   * - 5 (HALF_TIME_RESULT) -> "Wynik 1. polowy"
   * - 6 (HALF_TIME_OVER_UNDER) -> "Liczba goli 1. polowa X.X"
   * - 7 (CORRECT_SCORE) -> "Dokladny wynik"
   * - 9 (DRAW_NO_BET) -> "Remis = zwrot"
   * - 26 (BTTS) -> "Obie druzyny strzela"
   * - 37 (DOUBLE_CHANCE) -> "Podwojna szansa"
   * - 2 (HANDICAP) -> "Handicap X.X"
   *
   * Unknown stake types fall back to "Rynek {stakeTypeId}" format,
   * which is handled by tryIdMapping method.
   */
  protected readonly patterns: MarketPattern[] = [
    // ========================================================================
    // HALF-TIME MARKETS (must match first for specificity)
    // ========================================================================

    // "Wynik 1. polowy" - exact format from parser
    {
      pattern: /^wynik\s*1\.\s*po[lł]owy?$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // "Liczba goli 1. polowa X.X" - exact format from parser with line
    {
      pattern: /^liczba\s*goli?\s*1\.\s*po[lł]ow[ay]?\s*(\d+[.,]?\d*)$/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // "Liczba goli 1. polowa" - without line
    {
      pattern: /^liczba\s*goli?\s*1\.\s*po[lł]ow[ay]?$/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },

    // Half-time BTTS (generic pattern)
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // ========================================================================
    // BTTS (Both Teams To Score)
    // ========================================================================

    // "Obie druzyny strzela" - exact format from parser (note: strzela not strzela gola)
    {
      pattern: /^obie\s*dru[żz]yny\s*strzel[aą]?$/i,
      type: NormalizedMarketType.BTTS,
    },

    // More general BTTS patterns
    {
      pattern: /obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /^btts$/i,
      type: NormalizedMarketType.BTTS,
    },

    // ========================================================================
    // TOTAL GOALS MARKETS
    // ========================================================================

    // "Liczba goli X.X" - exact format from parser with line
    {
      pattern: /^liczba\s*goli?\s*(\d+[.,]?\d*)$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // "Liczba goli" - without line
    {
      pattern: /^liczba\s*goli?$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // Over/Under format
    {
      pattern: /powy[żz]ej\s*\/?\s*poni[żz]ej\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ========================================================================
    // HANDICAP MARKETS
    // ========================================================================

    // "Handicap X.X" - exact format from parser with line
    {
      pattern: /^handicap\s*([-+]?\d+[.,]?\d*)$/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // "Handicap" - without line
    {
      pattern: /^handicap$/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
    },

    // ========================================================================
    // DOUBLE CHANCE
    // ========================================================================

    // "Podwojna szansa" - exact format from parser
    {
      pattern: /^podw[oó]jn[aey]?\s*szans[aey]?$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // More general patterns
    {
      pattern: /podw[oó]jn.*szans/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // ========================================================================
    // DRAW NO BET
    // ========================================================================

    // "Remis = zwrot" - exact format from parser
    {
      pattern: /^remis\s*=\s*zwrot$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // More general patterns
    {
      pattern: /remis\s*zwraca/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // ========================================================================
    // MATCH WINNER / 1X2
    // ========================================================================

    // "Wynik meczu" - exact format from parser
    {
      pattern: /^wynik\s*meczu$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Standard 1X2
    {
      pattern: /^1x2$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // ========================================================================
    // CORRECT SCORE
    // ========================================================================

    // "Dokladny wynik" - exact format from parser
    {
      pattern: /^dok[lł]adn[y]?\s*wynik$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // More general patterns
    {
      pattern: /dok[lł]adn.*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ========================================================================
    // ODD/EVEN GOALS
    // ========================================================================

    {
      pattern: /parzyste?\s*\/?\s*nieparzyste?/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },
    {
      pattern: /nieparzyste?\s*\/?\s*parzyste?/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },

    // ========================================================================
    // WIN TO NIL / CLEAN SHEET
    // ========================================================================

    {
      pattern: /wygra\s*do\s*zera/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },
    {
      pattern: /czyst.*konto/i,
      type: NormalizedMarketType.CLEAN_SHEET,
    },
  ];

  /**
   * Try to map market name using stake type ID lookup
   * LeBull uses "Rynek XXX" format for unrecognized stake types
   */
  protected tryIdMapping(marketName: string): {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    param?: string;
  } | null {
    // Try to extract stake type ID from "Rynek XXX" format
    const match = marketName.match(/^Rynek\s+(\d+)$/i);
    if (!match) {
      return null;
    }

    const stakeTypeId = parseInt(match[1], 10);

    // Check if it's in our known OTHER category
    if (OTHER_STAKE_TYPE_IDS.has(stakeTypeId)) {
      return {
        type: NormalizedMarketType.OTHER,
        group: NormalizedMarketGroup.OTHER,
      };
    }

    // Look up in our ID mapping
    const mapping = STAKE_TYPE_ID_MAP.get(stakeTypeId);
    if (mapping) {
      return {
        type: mapping.type,
        group: mapping.group,
      };
    }

    // For very high IDs (above 1000), treat as OTHER
    // These are typically exotic/special markets (player props, specials, etc.)
    if (stakeTypeId > 1000) {
      return {
        type: NormalizedMarketType.OTHER,
        group: NormalizedMarketGroup.OTHER,
      };
    }

    // For remaining low IDs, return null to fall through to pattern matching
    // or ultimately to OTHER
    return null;
  }

  /**
   * Selection normalization patterns specific to LeBull
   */
  protected normalizeSelectionName(
    selectionName: string,
    marketType: NormalizedMarketType,
    homeTeam?: string,
    awayTeam?: string
  ): NormalizedSelection {
    const name = selectionName.toLowerCase().trim();

    // Team-based selections (check first for accuracy)
    if (homeTeam && this.matchesTeam(name, homeTeam)) {
      return NormalizedSelection.HOME;
    }
    if (awayTeam && this.matchesTeam(name, awayTeam)) {
      return NormalizedSelection.AWAY;
    }

    // Use common selection patterns from base class
    const common = this.normalizeCommonSelection(name, marketType);
    if (common !== NormalizedSelection.UNKNOWN) {
      return common;
    }

    // LeBull-specific selection patterns

    // Over selections with Polish variants
    if (/^powy[żz]ej/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    if (/^ponad/i.test(name)) {
      return NormalizedSelection.OVER;
    }

    // Under selections with Polish variants
    if (/^poni[żz]ej/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Remis (draw)
    if (/^remis$/i.test(name)) {
      return NormalizedSelection.DRAW;
    }

    // Yes/No for BTTS and similar markets
    if (/^(tak|yes|gg)$/i.test(name)) {
      return NormalizedSelection.YES;
    }
    if (/^(nie|no|ng|brak)$/i.test(name)) {
      return NormalizedSelection.NO;
    }

    // Odd/Even Polish variants
    if (/nieparzyste?a?/i.test(name)) {
      return NormalizedSelection.ODD;
    }
    if (/parzyste?a?/i.test(name)) {
      return NormalizedSelection.EVEN;
    }

    // Double Chance selections
    if (/^1x$|^1\s*lub\s*x$/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (/^x2$|^x\s*lub\s*2$/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (/^12$|^1\s*lub\s*2$/i.test(name)) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Selections with handicap format "Team (+/-X.X)"
    if (/\([+-]?\d+[.,]?\d*\)/.test(name)) {
      const teamPart = name.replace(/\s*\([+-]?\d+[.,]?\d*\)\s*$/, "").trim();
      if (homeTeam && this.matchesTeam(teamPart, homeTeam)) {
        return NormalizedSelection.HOME;
      }
      if (awayTeam && this.matchesTeam(teamPart, awayTeam)) {
        return NormalizedSelection.AWAY;
      }
    }

    return NormalizedSelection.UNKNOWN;
  }
}

// Export singleton instance
export const lebullNormalizer = new LeBullNormalizer();
