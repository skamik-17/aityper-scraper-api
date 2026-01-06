/**
 * Fortuna Market Normalizer
 *
 * Handles market normalization specific to Fortuna betting platform.
 * Fortuna uses "Rynek ufo:mtyp:XX-XX" format for most markets.
 *
 * Key challenges:
 * - Uses "Rynek ufo:mtyp:XX-XX" format (e.g., "Rynek ufo:mtyp:00-6z")
 * - Known IDs from constants: ufo:mtyp:00-00 (1X2), ufo:mtyp:00-01 (DC), etc.
 * - Unknown IDs from analysis: ufo:mtyp:00-6z, 00-ev, 00-hh, 00-he, 00-hm, 00-la, etc.
 * - Has Polish market names when available
 *
 * Analysis showed:
 * - Coverage before normalizer: ~5.3%
 * - Main uncategorized markets: "Rynek ufo:mtyp:00-6z", "00-ev", "00-hh", "00-he", etc.
 * - Target coverage: >=90%
 */

import {
  NormalizedMarketType,
  NormalizedSelection,
  NormalizedMarketGroup,
} from "../../types/normalization.js";
import { BaseNormalizer, type MarketPattern } from "./base-normalizer.js";

/**
 * Fortuna market ID mappings from MARKET_TYPE_IDS constant and analysis
 * Maps "ufo:mtyp:XX-XX" format to normalized types
 */
const FORTUNA_ID_MAPPINGS: Map<
  string,
  {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    hasParam?: boolean;
  }
> = new Map([
  // ==========================================================================
  // KNOWN MARKETS FROM CONSTANTS (constants.ts)
  // ==========================================================================

  ["00-00", { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // MATCH_RESULT
  ["00-01", { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }], // DOUBLE_CHANCE
  ["00-0u", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // OVER_UNDER
  ["00-1c", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS
  ["00-02", { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }], // HALF_TIME_RESULT
  ["00-18", { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }], // HALF_TIME_OVER_UNDER
  ["00-1d", { type: NormalizedMarketType.HALF_TIME_BTTS, group: NormalizedMarketGroup.HALF_TIME }], // HALF_TIME_BTTS
  ["00-0v", { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // ASIAN_HANDICAP
  ["00-0w", { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // EUROPEAN_HANDICAP
  ["00-04", { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // CORRECT_SCORE
  ["00-03", { type: NormalizedMarketType.DRAW_NO_BET, group: NormalizedMarketGroup.MAIN }], // DRAW_NO_BET
  ["00-1a", { type: NormalizedMarketType.ODD_EVEN_GOALS, group: NormalizedMarketGroup.GOALS }], // ODD_EVEN_GOALS

  // ==========================================================================
  // ADDITIONAL IDs FROM ANALYSIS (high-frequency uncategorized markets)
  // ==========================================================================

  // Alternative/variant market IDs discovered in analysis
  // These appear frequently in the "OTHER" category

  // Total goals variants
  ["00-6z", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U variant
  ["00-71", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Team goals O/U
  ["00-70", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Another O/U variant
  ["00-0b", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Goals range

  // Half-time variants
  ["00-ev", { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }], // HT result variant
  ["00-hh", { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }], // HT goals variant
  ["00-he", { type: NormalizedMarketType.HALF_TIME_BTTS, group: NormalizedMarketGroup.HALF_TIME }], // HT BTTS variant
  ["00-hm", { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }], // Another HT result

  // Double chance variants
  ["00-la", { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }], // DC variant
  ["00-ln", { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }], // Another DC variant
  ["00-lq", { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }], // DC with combo
  ["00-ld", { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 variant

  // Handicap variants
  ["00-hs", { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // AH variant
  ["00-lk", { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // EH variant
  ["00-li", { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // Generic handicap

  // Correct score variants
  ["00-lf", { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Score variant
  ["00-lg", { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Another score variant

  // ==========================================================================
  // EXTENDED ID MAPPINGS (from Fortuna platform analysis)
  // ==========================================================================

  // Win to nil / clean sheet
  ["00-lh", { type: NormalizedMarketType.WIN_TO_NIL, group: NormalizedMarketGroup.GOALS }], // Win to nil
  ["00-lj", { type: NormalizedMarketType.CLEAN_SHEET, group: NormalizedMarketGroup.GOALS }], // Clean sheet

  // Goal-related specials
  ["00-lm", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-ln", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS in halves
  ["00-lp", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Highest scoring half
  ["00-lq", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + BTTS combo
  ["00-lr", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + O/U combo

  // Half-time/full-time combo
  ["00-ls", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.HALF_TIME }], // HT/FT

  // Team specific goals
  ["00-lt", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Home goals
  ["00-lu", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Away goals

  // ==========================================================================
  // ADDITIONAL VARIANT IDs (from extended data analysis)
  // ==========================================================================

  ["00-ma", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 3.5
  ["00-mb", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 4.5
  ["00-mc", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 1.5
  ["00-md", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 0.5

  ["00-me", { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }], // HT O/U 0.5
  ["00-mF", { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }], // HT O/U 1.5

  ["00-mg", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-mh", { type: NormalizedMarketType.HALF_TIME_BTTS, group: NormalizedMarketGroup.HALF_TIME }], // HT BTTS variant

  ["00-mi", { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // AH 0.5
  ["00-mj", { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // AH 1.5
  ["00-mk", { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // EH 1
  ["00-ml", { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // EH 2

  // ==========================================================================
  // HIGH-FREQUENCY IDs FROM ANALYSIS (Top uncategorized markets)
  // ==========================================================================

  // Double chance with handicap combo markets
  ["00-23", { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }], // DC with handicap combo
  ["00-0i", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo market

  // Match winner variants
  ["00-5z", { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 variant
  ["00-61", { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 variant
  ["00-60", { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 variant

  // Total goals variants (with different lines)
  ["00-2i", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 1.5
  ["00-10", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 2.5
  ["00-13", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 2.5 alt
  ["00-3b", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 2
  ["00-3c", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 0.5
  ["00-3d", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 0.5 alt
  ["00-2j", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 0.5 variant
  ["00-2k", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 0.5 variant2
  ["00-0t", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 5.5
  ["00-ks", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 4.5
  ["00-h7", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 6.5

  // Asian handicap variants (different lines)
  ["00-2h", { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // AH 0
  ["00-0h", { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // AH 0.5
  ["00-37", { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // AH 0.5 alt

  // European handicap variants
  ["00-1l", { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }], // EH variant

  // Special combo markets
  ["00-lq", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + over/under combo

  // Team-specific markets (corners, etc.)
  ["00-64", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Team corners
  ["00-65", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Team corners alt

  // ==========================================================================
  // ADDITIONAL IDS FROM 2026 ANALYSIS
  // ==========================================================================

  ["00-lo", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo
  ["00-1t", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo
  ["00-0z", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo
  ["00-1n", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo
  ["00-25", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo
  ["00-1j", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo
  ["00-29", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo
  ["00-1u", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo
  ["00-1k", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo
  ["00-27", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo
  ["00-2s", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo
  ["00-1z", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + BTTS combo

  // ==========================================================================
  // ADDITIONAL MEDIUM-FREQUENCY IDS
  // ==========================================================================

  ["00-0p", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special 3-way market
  ["00-gg", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special 3-way market variant
  ["00-k9", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Single selection market
  ["00-bu", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-k8", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-ka", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Single selection
  ["00-k6", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 1.5
  ["00-bt", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-k7", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-6x", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Player markets
  ["00-73", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Player markets
  ["00-6y", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Player markets
  ["00-gv", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // High line O/U (20.5)
  ["00-hb", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // O/U 5.5 special
  ["00-2v", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Complex combo
  ["00-kp", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // O/U 10.5
  ["00-h3", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 1.5
  ["00-h5", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // O/U 21.5
  ["00-kq", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // O/U 15.5
  ["00-gw", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // O/U 9.5
  ["00-gx", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // O/U 11.5
  ["00-l5", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // O/U 2.5 special
  ["00-l6", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // O/U 2.5 special2
  ["00-m7", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-gd", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special 3-way
  ["00-kx", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // O/U 1.5 special
  ["00-ky", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // O/U 1.5 special2
  ["00-gh", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special 3-way variant
  ["00-gj", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special 3-way variant2

  // ==========================================================================
  // REMAINING UNRESOLVED IDs (Round 2 from analysis)
  // ==========================================================================

  // Total goals variants
  ["00-0i", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 12.5
  ["00-kr", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U 3.5

  // Match winner variants
  ["00-2d", { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // 1X2 variant

  // BTTS variants and combos
  ["00-26", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS halves combo
  ["00-1h", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-2p", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-1s", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-1r", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-1i", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-36", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant

  // Special markets (remaining as OTHER)
  ["00-lq", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Winning margin special
  ["00-lo", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Multi-over selection
  ["00-1t", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Which team scores first
  ["00-1b", { type: NormalizedMarketType.ODD_EVEN_GOALS, group: NormalizedMarketGroup.GOALS }], // Odd/Even
  ["00-2m", { type: NormalizedMarketType.ODD_EVEN_GOALS, group: NormalizedMarketGroup.GOALS }], // Odd/Even variant
  ["00-0z", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Winning score combo
  ["00-25", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Total goals range
  ["00-1n", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // HT/FT result combo
  ["00-1j", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + BTTS combo

  // ==========================================================================
  // REMAINING BTTS VARIANTS
  // ==========================================================================
  ["00-1f", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-2o", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-1o", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-2n", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-1g", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-2b", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-2c", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["00-3g", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant (Yes/No)
  ["00-1e", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // Which team scores
  ["00-39", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant

  // ==========================================================================
  // DOUBLE CHANCE VARIANTS
  // ==========================================================================
  ["00-2f", { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }], // DC variant

  // ==========================================================================
  // CORRECT SCORE / WINNING SCORE VARIANTS
  // ==========================================================================
  ["00-3j", { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Correct score variant
  ["00-2t", { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Winning score
  ["00-6w", { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Correct score variant2

  // ==========================================================================
  // OTHER SPECIAL MARKETS (Low frequency or too complex to normalize)
  // ==========================================================================
  ["00-29", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Total goals range
  ["00-27", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Total goals range variant
  ["00-1u", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Which team scores first
  ["00-2s", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // No goal/draw variant
  ["00-1k", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // BTTS + O/U combo
]);

// Half-time/full-time combo type (not in standard enum but useful for categorization)
const HALF_TIME_FULL_TIME = "HALF_TIME_FULL_TIME" as const;

export class FortunaNormalizer extends BaseNormalizer {
  readonly bookmaker = "fortuna";

  /**
   * Bookmaker-specific market patterns
   * Priority: matched before generic patterns
   */
  protected readonly patterns: MarketPattern[] = [
    // ==========================================================================
    // HALF-TIME MARKETS (check first as more specific)
    // ==========================================================================

    // Half-time BTTS
    {
      pattern: /^obie\s*strzel[aą]\s*1\.\s*pol/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },
    {
      pattern: /^1\.\s*pol.*obie\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // Half-time total goals with line
    {
      pattern: /^liczba\s*goli\s*1\.\s*pol.*[:\s]+(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    {
      pattern: /^1\.\s*pol.*liczba\s*goli/i,
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
    {
      pattern: /^1\.\s*pol.*1x2$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // ==========================================================================
    // TOTAL GOALS / OVER UNDER MARKETS
    // ==========================================================================

    // "Liczba bramek X.5" format (Fortuna uses "bramek" not "goli")
    {
      pattern: /^liczba\s*bramek\s*[:\s]+(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // "Liczba goli" alternative (with or without line number)
    {
      pattern: /^liczba\s*goli\s*[:\s]+(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    {
      pattern: /^liczba\s*goli$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // ==========================================================================
    // BOTH TEAMS TO SCORE (BTTS)
    // ==========================================================================

    // "Obie druzyny strzelaca gola" (with and without diacritics)
    {
      pattern: /^obie\s*dru[żz]yny\s*strzel[ąa]\s*(gola)?$/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /^obie\s*strzel/i,
      type: NormalizedMarketType.BTTS,
    },

    // ==========================================================================
    // MATCH WINNER / 1X2
    // ==========================================================================

    {
      pattern: /^wygrana\s*meczu/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
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
      pattern: /^mecz\s*:\s*dwojtyp$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },
    {
      pattern: /^podw[oó]jna\s*szansa$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // ==========================================================================
    // HANDICAP MARKETS
    // ==========================================================================

    // Asian handicap with value
    {
      pattern: /^handicap\s*azjatycki/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => {
        const lineMatch = m[0]?.match(/([-+]?\d+[.,]?\d*)/);
        return lineMatch ? lineMatch[1].replace(",", ".") : undefined;
      },
    },

    // European handicap with value
    {
      pattern: /^handicap\s*europejski/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => {
        const lineMatch = m[0]?.match(/([-+]?\d+[.,]?\d*)/);
        return lineMatch ? lineMatch[1].replace(",", ".") : undefined;
      },
    },

    // Generic handicap (treat as Asian)
    {
      pattern: /^handicap\s*[:\s]*([-+]?\d+[.,]?\d*)/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ==========================================================================
    // CORRECT SCORE
    // ==========================================================================

    {
      pattern: /^dok[lł]adny\s*wynik$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ==========================================================================
    // DRAW NO BET
    // ==========================================================================

    {
      pattern: /^remis\s*bez\s*zak[lł]adu$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },
    {
      pattern: /^remis\s*=\s*zwrot$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // ==========================================================================
    // ODD/EVEN GOALS
    // ==========================================================================

    {
      pattern: /^parzyste\s*[\/]?\s*nieparzyste$/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },
    {
      pattern: /^nieparzyste\s*[\/]?\s*parzyste$/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },

    // ==========================================================================
    // WIN TO NIL / CLEAN SHEET
    // ==========================================================================

    {
      pattern: /^wygrana\s*do\s*zera$/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },
    {
      pattern: /^czyst.*konto/i,
      type: NormalizedMarketType.CLEAN_SHEET,
    },
  ];

  /**
   * Override tryIdMapping to handle Fortuna's "Rynek ufo:mtyp:XX-XX" format
   */
  protected tryIdMapping(marketName: string): {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    param?: string;
  } | null {
    // Match "Rynek ufo:mtyp:XX-XX" format
    const rynekMatch = marketName.match(/^Rynek\s+ufo:mtyp:(\d+[-]\w+)$/i);
    if (rynekMatch) {
      const marketId = rynekMatch[1].toLowerCase(); // Keep lowercase for lookup
      const mapping = FORTUNA_ID_MAPPINGS.get(marketId);

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
   * Selection normalization patterns specific to Fortuna
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

    // Fortuna-specific selection patterns

    // Fortuna uses "1", "0", "2" codes for 1X2 outcomes
    if (name === "1") {
      return NormalizedSelection.HOME;
    }
    if (name === "0" || name === "x") {
      return NormalizedSelection.DRAW;
    }
    if (name === "2") {
      return NormalizedSelection.AWAY;
    }

    // Over selections - Fortuna uses "+" prefix or "powyzej"
    if (/^\+/i.test(name) || /^powy[żż]/i.test(name)) {
      return NormalizedSelection.OVER;
    }

    // Under selections - Fortuna uses "-" prefix or "ponizej"
    if (/^-/i.test(name) && !name.includes("remis") || /^poni[żż]/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Remis (draw)
    if (/^remis$/i.test(name)) {
      return NormalizedSelection.DRAW;
    }

    // Double Chance specific (Fortuna uses "10", "02", "12" codes)
    if (name === "10" || /^1x$/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (name === "02" || /^x2$/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (name === "12") {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Double Chance with team names
    if (homeTeam && name.includes(`${homeTeam.toLowerCase()} lub remis`)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (awayTeam && name.includes(`remis lub ${awayTeam.toLowerCase()}`)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (homeTeam && awayTeam &&
        (name.includes(`${homeTeam.toLowerCase()} lub ${awayTeam.toLowerCase()}`) ||
         name.includes(`${awayTeam.toLowerCase()} lub ${homeTeam.toLowerCase()}`))) {
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
export const fortunaNormalizer = new FortunaNormalizer();
