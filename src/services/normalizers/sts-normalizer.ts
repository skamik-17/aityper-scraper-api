/**
 * STS Market Normalizer
 *
 * Handles market normalization specific to STS betting platform.
 * STS uses numeric "Rynek XX" format for most markets.
 *
 * Key challenges:
 * - Uses "Rynek XX" format where XX is a numeric market ID
 * - Known IDs: 1 (1X2), 10 (Double Chance), 43 (BTTS), 25 (Total Goals), etc.
 * - Unknown IDs appear in analysis: Rynek 11, 14, 28, 31, 49, 50, 51, 1224, 1229
 * - Has Polish market names when available
 *
 * Analysis showed:
 * - Coverage before normalizer: ~23.9%
 * - Main uncategorized markets: "Rynek 41", "Rynek 42", "Rynek 44", etc.
 * - Target coverage: >=90%
 */

import {
  NormalizedMarketType,
  NormalizedSelection,
  NormalizedMarketGroup,
} from "../../types/normalization.js";
import { BaseNormalizer, type MarketPattern } from "./base-normalizer.js";

/**
 * STS market ID mappings from MARKET_IDS constant and comprehensive analysis
 * Maps "Rynek XX" format to normalized types
 *
 * Analysis based on 21 Premier League matches with 2224 total markets
 */
const STS_ID_MAPPINGS: Map<
  number,
  {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    hasParam?: boolean;
  }
> = new Map([
  // ==========================================================================
  // KNOWN MARKETS FROM CONSTANTS (parser.ts)
  // ==========================================================================

  [1, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // MATCH_RESULT_1X2
  [10, { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }], // DOUBLE_CHANCE
  [43, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS
  [25, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // TOTAL_GOALS
  [5, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }], // HALF_TIME_RESULT
  [26, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }], // HALF_TIME_TOTAL
  [9, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // CORRECT_SCORE
  [4, { type: NormalizedMarketType.DRAW_NO_BET, group: NormalizedMarketGroup.MAIN }], // DRAW_NO_BET

  // ==========================================================================
  // COMPREHENSIVE ID MAPPINGS FROM ANALYSIS (2024-01-06)
  // Based on analysis of 21 Premier League matches with 2224 markets
  // ==========================================================================

  // ==========================================================================
  // TOTAL GOALS MARKETS (Over/Under with various lines)
  // Selections are numeric "+X" / "-X" or "4" / "5" for specific totals
  // ==========================================================================
  [8, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Total Goals 6/7/8 (3 selections)
  [11, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Total Goals 4/5 (2 selections)
  [23, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 1 goal (+1/-1)
  [28, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 1.5 goals
  [73, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 6/7/8 goals
  [74, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 9/10/11 goals
  [75, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 4/5 goals
  [80, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 1 (+1/-1)
  [103, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 6/7/8 goals
  [104, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 9/10/11 goals
  [105, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 4/5 goals

  // ==========================================================================
  // EUROPEAN HANDICAP MARKETS (3-way handicap with draw option)
  // Selections: "1 (X:Y)", "X (X:Y)", "2 (X:Y)" format
  // ==========================================================================
  [14, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // EH (0:1) - home -1 goal
  [20, { type: NormalizedMarketType.DRAW_NO_BET, group: NormalizedMarketGroup.MAIN }], // Level Handicap (1+0 / 2-0)
  [22, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // EH -2.5/+2.5
  [76, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // EH variant (0:1)
  [77, { type: NormalizedMarketType.DRAW_NO_BET, group: NormalizedMarketGroup.MAIN }], // Level Handicap variant (1+0 / 2-0)
  [79, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // EH +0.5/-0.5

  // ==========================================================================
  // HALF TIME TOTAL GOALS (Over/Under for first half only)
  // ==========================================================================
  [31, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }], // HT O/U 1.5
  [82, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }], // HT O/U 1.5
  [85, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }], // HT O/U 1.5
  [88, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }], // HT O/U 1.5

  // ==========================================================================
  // CORRECT SCORE MARKETS (Exact score predictions)
  // These have many selections (6-46 possible scorelines)
  // ==========================================================================
  [17, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Correct Score (7 selections)
  [33, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Correct Score (7 selections)
  [49, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Correct Score (6 selections)
  [57, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Correct Score (46 selections - full range)
  [98, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Correct Score (6 selections)
  [101, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Correct Score (10 selections)
  [124, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Correct Score (10 selections)
  [125, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Correct Score (7 selections)
  [126, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Correct Score (10 selections)

  // ==========================================================================
  // BOTH TEAMS TO SCORE (BTTS) VARIANTS
  // All use "26" (Tak/Yes) and "27" (Nie/No) outcome IDs
  // Different IDs represent different conditions or combinations
  // ==========================================================================
  [47, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [48, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [59, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [60, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [61, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [62, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [67, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [68, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [69, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [70, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [95, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [107, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [109, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [110, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [112, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [115, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [118, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [120, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [121, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [1232, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [1233, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [1234, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  [1235, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant

  // ==========================================================================
  // MATCH WINNER / RESULT MARKETS (3-way: 1, X, 2)
  // Various IDs for different 1X2 variants
  // ==========================================================================
  [40, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 variant (24/25)
  [41, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 variant (24/25)
  [42, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 variant (24/25)
  [63, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 (147/148/149)
  [64, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 (147/148/149)
  [65, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 (147/148/149)
  [66, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 variant (241-244)
  [71, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 (1/2/3)
  [94, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 (24/25)
  [102, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 (1/2/3)
  [106, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 variant
  [119, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 variant
  [1244, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 variant

  // ==========================================================================
  // WIN TO NIL / CLEAN SHEET MARKETS
  // ==========================================================================
  [35, { type: NormalizedMarketType.WIN_TO_NIL, group: NormalizedMarketGroup.GOALS }], // Win to Nil (4 selections)
  [36, { type: NormalizedMarketType.CLEAN_SHEET, group: NormalizedMarketGroup.GOALS }], // Clean Sheet (4 selections)
  [90, { type: NormalizedMarketType.WIN_TO_NIL, group: NormalizedMarketGroup.GOALS }], // Win to Nil variant (4 selections)

  // ==========================================================================
  // PLAYER/TEAM SPECIFIC MARKETS
  // These are typically player props (cards, corners, goals, etc.)
  // ==========================================================================
  [52, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Player markets (49 players)
  [53, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Player markets (49 players)
  [54, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Player markets (49 players)

  // ==========================================================================
  // COMBINATION MARKETS (Result + BTTS, Result + O/U, etc.)
  // These combine multiple markets into single bets
  // ==========================================================================
  [50, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + BTTS combo (+2.5 i tak/nie)
  [51, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + O/U combo (1 i -1.5, etc.)
  [99, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + O/U combo
  [807, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Combination market (929-934)
  [808, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Combination market (28-33)
  [809, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + O/U combo
  [810, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Combination market
  [811, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Combination market
  [812, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Double Chance + O/U combo
  [813, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Complex combination (17 selections)
  [814, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Combination market
  [815, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Combination market
  [816, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Combination market (9 selections)
  [817, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Combination market
  [818, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Combination market
  [1012, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // HT/FT + O/U combo (18 selections)

  // ==========================================================================
  // SPECIAL/OTHER MARKETS
  // These include niche markets like first to score, highest scoring half, etc.
  // ==========================================================================
  [44, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // First/Last to score (4 selections: 231-234)
  [178, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [179, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [185, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [192, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market (10 selections)
  [193, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [194, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [196, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant (26/27)
  [197, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant (26/27)
  [198, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant (26/27)
  [199, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [206, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [217, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant (26/27)
  [220, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [221, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [225, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [228, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [235, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [236, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [237, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [239, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [244, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [247, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [254, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [255, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [256, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [258, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market (7 selections)
  [283, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market (35 selections)
  [1051, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [1224, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant (26/27 = Tak/Nie)
  [1229, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant (26/27 = Tak/Nie)
  [1263, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [1264, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [1845, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [1850, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [1851, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [1852, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [1853, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  [1855, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant (26/27)
]);

export class STSNormalizer extends BaseNormalizer {
  readonly bookmaker = "sts";

  /**
   * Bookmaker-specific market patterns
   * Priority: matched before generic patterns
   * Note: Most STS markets use "Rynek XX" format, patterns are for Polish names
   */
  protected readonly patterns: MarketPattern[] = [
    // ==========================================================================
    // HALF-TIME MARKETS (check first as more specific)
    // ==========================================================================

    // Half-time BTTS
    {
      pattern: /^1\.\s*pol.*obie\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },
    {
      pattern: /^obie\s*strzel.*1\.\s*pol/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // Half-time total goals with line
    {
      pattern: /^1\.\s*pol.*liczba\s*gol/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => {
        const lineMatch = m[0]?.match(/(\d+[.,]?\d*)/);
        return lineMatch ? lineMatch[1].replace(",", ".") : undefined;
      },
    },

    // Half-time result
    {
      pattern: /^wynik\s*1\.\s*pol/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^1\.\s*pol.*wynik$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // ==========================================================================
    // BOTH TEAMS TO SCORE
    // ==========================================================================

    {
      pattern: /^obie\s*strzel/i,
      type: NormalizedMarketType.BTTS,
    },
    // "Obie druzyny" variant (without Polish character)
    {
      pattern: /^obie\s*dru/i,
      type: NormalizedMarketType.BTTS,
    },

    // ==========================================================================
    // MATCH WINNER / 1X2
    // ==========================================================================

    {
      pattern: /^wynik\s*meczu$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /^1x2$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // ==========================================================================
    // DOUBLE CHANCE
    // ==========================================================================

    {
      pattern: /^podwo[jo]na\s*szansa/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // ==========================================================================
    // TOTAL GOALS
    // ==========================================================================

    {
      pattern: /^liczba\s*gol/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => {
        const lineMatch = m[0]?.match(/(\d+[.,]?\d*)/);
        return lineMatch ? lineMatch[1].replace(",", ".") : undefined;
      },
    },

    // ==========================================================================
    // CORRECT SCORE
    // ==========================================================================

    {
      pattern: /^dok[lł]adn.*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ==========================================================================
    // DRAW NO BET
    // ==========================================================================

    {
      pattern: /^remis\s*=\s*zwrot/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // ==========================================================================
    // HANDICAP
    // ==========================================================================

    {
      pattern: /^handicap\s*azjatycki/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => {
        const lineMatch = m[0]?.match(/([-+]?\d+[.,]?\d*)/);
        return lineMatch ? lineMatch[1].replace(",", ".") : undefined;
      },
    },
    {
      pattern: /^handicap\s*europejski/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => {
        const lineMatch = m[0]?.match(/([-+]?\d+[.,]?\d*)/);
        return lineMatch ? lineMatch[1].replace(",", ".") : undefined;
      },
    },
  ];

  /**
   * Override tryIdMapping to handle STS's "Rynek XX" format
   */
  protected tryIdMapping(marketName: string): {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    param?: string;
  } | null {
    // Match "Rynek XX" format
    const rynekMatch = marketName.match(/^Rynek\s+(\d+)$/i);
    if (rynekMatch) {
      const marketId = parseInt(rynekMatch[1], 10);
      const mapping = STS_ID_MAPPINGS.get(marketId);

      if (mapping) {
        return {
          type: mapping.type,
          group: mapping.group,
        };
      }
    }

    return null;
  }

  /**
   * Selection normalization patterns specific to STS
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

    // STS-specific selection patterns

    // Polish "Tak" (Yes) and "Nie" (No) for BTTS
    if (/^tak$/i.test(name)) {
      return NormalizedSelection.YES;
    }
    if (/^nie$/i.test(name)) {
      return NormalizedSelection.NO;
    }

    // Over selections (starts with "+")
    if (/^\+/.test(name)) {
      return NormalizedSelection.OVER;
    }

    // Under selections (starts with "-")
    if (/^-/.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Over selections with line (e.g., "Powyzej (2.5)")
    if (/^powy[żz]ej/i.test(name)) {
      return NormalizedSelection.OVER;
    }

    // Under selections with line (e.g., "Ponizej (2.5)")
    if (/^poni[żz]ej/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Remis (draw)
    if (/^remis$/i.test(name)) {
      return NormalizedSelection.DRAW;
    }

    // Double Chance specific
    if (/^1x$|^1\s*lub\s*x/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (/^x2$|^x\s*lub\s*2/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (/^12$|^1\s*lub\s*2/i.test(name)) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Odd/Even
    if (/nieparzyste?/i.test(name)) {
      return NormalizedSelection.ODD;
    }
    if (/parzyste?/i.test(name)) {
      return NormalizedSelection.EVEN;
    }

    return NormalizedSelection.UNKNOWN;
  }
}

// Export singleton instance
export const stsNormalizer = new STSNormalizer();
