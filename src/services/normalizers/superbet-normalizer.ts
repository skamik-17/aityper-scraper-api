/**
 * Superbet Market Normalizer
 *
 * Handles market normalization specific to Superbet betting platform.
 * Superbet is the most complex bookmaker as it uses numeric market IDs
 * that appear as "Rynek XXXXXX" in market names.
 *
 * Key challenges:
 * - Known IDs are in 500-600 range (documented in scraper constants)
 * - Unknown IDs are 6-digit numbers (200000+, 230000+ range)
 * - Market names are generic "Rynek {ID}" format when ID is unknown
 * - Some markets have Polish text names that need pattern matching
 *
 * Coverage target: >= 90%
 */

import {
  NormalizedMarketType,
  NormalizedSelection,
  NormalizedMarketGroup,
} from "../../types/normalization.js";
import { BaseNormalizer, type MarketPattern } from "./base-normalizer.js";

/**
 * Comprehensive market ID mappings for Superbet
 *
 * IDs are extracted from:
 * 1. Known constants in scraper (500-600 range)
 * 2. API analysis discovering additional IDs (200000+ range)
 *
 * Each ID maps to normalized type and group.
 */
const SUPERBET_ID_MAPPINGS: Map<
  number,
  {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    hasParam?: boolean; // Whether this market type uses line parameters
  }
> = new Map([
  // ==========================================================================
  // MAIN MARKETS (500-600 range from known constants)
  // ==========================================================================

  // Match Result / 1X2
  [547, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }],

  // Double Chance
  [548, { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }],
  [531, { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }],

  // Draw No Bet
  [560, { type: NormalizedMarketType.DRAW_NO_BET, group: NormalizedMarketGroup.MAIN }],

  // ==========================================================================
  // GOALS MARKETS
  // ==========================================================================

  // Both Teams To Score (BTTS)
  [539, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }],
  [559, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }],

  // Total Goals (Over/Under)
  [200734, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [551, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [552, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],

  // Odd/Even Goals
  [558, { type: NormalizedMarketType.ODD_EVEN_GOALS, group: NormalizedMarketGroup.GOALS }],

  // Win To Nil
  [561, { type: NormalizedMarketType.WIN_TO_NIL, group: NormalizedMarketGroup.GOALS }],

  // Clean Sheet
  [562, { type: NormalizedMarketType.CLEAN_SHEET, group: NormalizedMarketGroup.GOALS }],

  // ==========================================================================
  // HANDICAP MARKETS
  // ==========================================================================

  // Asian Handicap
  [549, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],

  // European Handicap
  [550, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],

  // ==========================================================================
  // HALF-TIME MARKETS
  // ==========================================================================

  // 1st Half Result
  [553, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],

  // 1st Half Total Goals
  [554, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],

  // 1st Half BTTS
  [557, { type: NormalizedMarketType.HALF_TIME_BTTS, group: NormalizedMarketGroup.HALF_TIME }],

  // ==========================================================================
  // SCORE MARKETS
  // ==========================================================================

  // Correct Score
  [556, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }],

  // ==========================================================================
  // EXTENDED MARKET IDS (discovered from API analysis)
  // These are dynamically generated IDs that appear in the 200000+ range
  // ==========================================================================

  // Additional Total Goals variants
  [231194, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Special goal range combo market

  // Handicap variants
  [236216, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [236218, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],

  // Asian Total Goals variants (quarter lines like 2.25, 2.75)
  [236220, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [236222, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],

  // Team Asian Handicap
  [236226, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],

  // Match Total Goals (alternative ranges)
  [236228, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [236230, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [236232, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],

  // Half-time markets (extended IDs)
  [236240, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [236242, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [236244, { type: NormalizedMarketType.HALF_TIME_BTTS, group: NormalizedMarketGroup.HALF_TIME }],

  // ==========================================================================
  // ADDITIONAL MARKET IDS (from analysis - need verification)
  // These are common IDs that appear frequently in the scraped data
  // ==========================================================================

  // Player markets (goalscorer, assists, shots) - go to OTHER
  [600, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [601, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],

  // Team-specific total goals
  [200247, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Time-based 1X2
  [200736, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [200737, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [200738, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [200739, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],

  // Total Goals markets with lines (0.5, 3.5, etc.)
  [544, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [704, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [713, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [733, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [200735, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],

  // BTTS + Total Goals combo markets (legitimately OTHER)
  [231000, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [231001, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [231002, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [231003, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [231004, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [231005, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [231045, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],

  // Combo/special markets
  [542, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [200753, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // DNB + Total Goals
  [200754, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // 1X2 + Total Goals
  [200765, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Total Goals + BTTS
  [200766, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Total Goals + BTTS
  [200770, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Double Chance + Total Goals
  [200771, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Double Chance + Total Goals
  [200772, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // BTTS combo

  // Player score markets
  [233482, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [233483, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [233484, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [233485, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],

  // High-frequency player markets (player goals, player props) - IDs not already mapped
  [201787, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Player goals
  [236224, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Player goals (overrides ASIAN_HANDICAP - actually a player market)
  [236246, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Player goals


  // Time-based markets
  [200248, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Time-based goals

  // Corners and other stats (go to OTHER)
  [236424, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [236426, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [236428, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [236430, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [236436, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],

  // Additional combo and special markets (from extended analysis)
  [201511, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [200755, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [200756, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [200773, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [200571, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],

  // Additional frequently appearing markets
  [201506, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [201507, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [201512, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [201513, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [201519, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [201590, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [201597, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [201666, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [201803, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [201804, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [201805, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [201826, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [233486, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [233487, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [233488, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [236432, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
]);

export class SuperbetNormalizer extends BaseNormalizer {
  readonly bookmaker = "superbet";

  /**
   * Pattern-based matching for text market names
   * Used when market has Polish text name instead of "Rynek XXX" format
   */
  protected readonly patterns: MarketPattern[] = [
    // ==========================================================================
    // HALF-TIME MARKETS (check first as more specific)
    // ==========================================================================

    // 1st half BTTS
    {
      pattern: /^obie\s*(?:drużyny\s*)?strzelą?\s*1\.\s*poł/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-?\s*obie\s*(?:drużyny\s*)?strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // 1st half total goals with line
    {
      pattern: /^liczba\s*goli\s*1\.\s*poł(?:owa|owy)?\s*([\d,\.]+)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-?\s*liczba\s*goli\s*([\d,\.]+)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // 1st half result
    {
      pattern: /^wynik\s*1\.\s*poł(?:owy|owa)?$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-?\s*wynik$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-?\s*1x2$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // ==========================================================================
    // MAIN MATCH MARKETS
    // ==========================================================================

    // Match winner / 1X2
    {
      pattern: /^wynik\s*meczu$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /^1x2$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /^końcowy\s*wynik$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Double chance (with and without Polish diacritics)
    {
      pattern: /^podw[oó]jna?\s*szansa$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // Draw no bet
    {
      pattern: /^remis\s*=?\s*zwrot$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },
    {
      pattern: /^zakład\s*bez\s*remisu$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // ==========================================================================
    // TOTAL GOALS MARKETS
    // ==========================================================================

    // Total goals with line (e.g., "Liczba goli 2.5")
    {
      pattern: /^liczba\s*goli\s*([\d,\.]+)$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Over/Under format
    {
      pattern: /^gole\s*(?:ponad|powyżej|poniżej)\s*(?:\/\s*(?:poniżej|powyżej)\s*)?([\d,\.]+)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ==========================================================================
    // BTTS MARKETS
    // ==========================================================================

    // BTTS (with and without Polish diacritics)
    {
      pattern: /^obie\s*(?:dru[żz]yny\s*)?strzel[aą]?\s*(?:gola?)?\s*$/i,
      type: NormalizedMarketType.BTTS,
    },

    // 1st half BTTS (standalone pattern)
    {
      pattern: /^obie\s*strzel[aą]?\s*1\.\s*pol[oó]w/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // ==========================================================================
    // HANDICAP MARKETS
    // ==========================================================================

    // Asian handicap with line
    {
      pattern: /^handicap\s*azjatycki\s*([\-\+]?[\d,\.]+)?/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // European handicap with line
    {
      pattern: /^handicap\s*europejski\s*([\-\+]?[\d,\.]+)?/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Generic handicap (treat as Asian)
    {
      pattern: /^handicap\s*([\-\+]?[\d,\.]+)?$/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ==========================================================================
    // CORRECT SCORE
    // ==========================================================================

    {
      pattern: /^dokładn?y\s*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ==========================================================================
    // WIN TO NIL / CLEAN SHEET
    // ==========================================================================

    {
      pattern: /^wygrana?\s*do\s*zera$/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },

    {
      pattern: /^czyst.*kont/i,
      type: NormalizedMarketType.CLEAN_SHEET,
    },

    // ==========================================================================
    // ODD/EVEN GOALS
    // ==========================================================================

    {
      pattern: /^parzyste?\s*\/?\s*nieparzyste?$/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },
    {
      pattern: /^nieparzyste?\s*\/?\s*parzyste?$/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },
  ];

  /**
   * Override tryIdMapping to handle Superbet's "Rynek XXXXXX" format
   * Extracts the numeric ID and looks it up in the mapping table
   */
  protected tryIdMapping(marketName: string): {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    param?: string;
  } | null {
    // Match "Rynek XXXXXX" format
    const rynekMatch = marketName.match(/^Rynek\s+(\d+)$/i);
    if (rynekMatch) {
      const marketId = parseInt(rynekMatch[1], 10);
      const mapping = SUPERBET_ID_MAPPINGS.get(marketId);

      if (mapping) {
        // For parameterized markets, try to extract param from selection data
        // This is handled separately as we don't have selection data here
        return {
          type: mapping.type,
          group: mapping.group,
        };
      }
    }

    // Also check for market names with embedded IDs
    // e.g., "Liczba goli 2.5" contains param but not ID
    return null;
  }

  /**
   * Extract parameter from market name for parameterized markets
   * Handles formats like:
   * - "Liczba goli 2.5"
   * - "Handicap azjatycki -1.5"
   * - "1. polowa - Liczba goli 0.5"
   */
  protected extractParamFromName(marketName: string): string | undefined {
    // Look for decimal number patterns
    const paramMatch = marketName.match(/([\-\+]?\d+[,\.]\d+)/);
    if (paramMatch) {
      return paramMatch[1].replace(",", ".");
    }

    // Look for whole number handicaps
    const intMatch = marketName.match(/handicap.*?([\-\+]\d+)/i);
    if (intMatch) {
      return intMatch[1];
    }

    return undefined;
  }

  /**
   * Selection normalization patterns specific to Superbet
   * Superbet uses:
   * - "1", "X"/"0", "2" for 1X2
   * - "GG"/"NG" or "Tak"/"Nie" for BTTS
   * - "O"/"U" or "Powyżej"/"Poniżej" for Over/Under
   * - Team names for handicaps and DNB
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

    // ==========================================================================
    // 1X2 OUTCOMES
    // ==========================================================================

    if (/^1$/i.test(name)) {
      // "1" can mean HOME for 1X2, or YES for BTTS on some markets
      if (marketType === NormalizedMarketType.BTTS || marketType === NormalizedMarketType.HALF_TIME_BTTS) {
        return NormalizedSelection.YES;
      }
      return NormalizedSelection.HOME;
    }

    if (/^(x|0|remis)$/i.test(name)) {
      return NormalizedSelection.DRAW;
    }

    if (/^2$/i.test(name)) {
      // "2" can mean AWAY for 1X2, or NO for BTTS on some markets
      if (marketType === NormalizedMarketType.BTTS || marketType === NormalizedMarketType.HALF_TIME_BTTS) {
        return NormalizedSelection.NO;
      }
      return NormalizedSelection.AWAY;
    }

    // ==========================================================================
    // DOUBLE CHANCE
    // ==========================================================================

    if (/^(1x|10)$/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (/^(x2|02)$/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (/^12$/i.test(name)) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // ==========================================================================
    // OVER/UNDER
    // ==========================================================================

    if (/^(o|over)$/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    if (/^(u|under)$/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Polish variants with potential line values
    if (/^(powyżej|powyzej|ponad)/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    if (/^(poniżej|ponizej)/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // ==========================================================================
    // BTTS (GG/NG or Tak/Nie)
    // ==========================================================================

    if (/^(gg|tak|yes)$/i.test(name)) {
      return NormalizedSelection.YES;
    }
    if (/^(ng|nie|no)$/i.test(name)) {
      return NormalizedSelection.NO;
    }

    // ==========================================================================
    // ODD/EVEN
    // ==========================================================================

    if (/^nieparzyste?$/i.test(name)) {
      return NormalizedSelection.ODD;
    }
    if (/^parzyste?$/i.test(name)) {
      return NormalizedSelection.EVEN;
    }

    // ==========================================================================
    // SELECTIONS WITH HANDICAP/LINE IN NAME
    // e.g., "Manchester United (+1.5)" or "Liverpool (-0.5)"
    // ==========================================================================

    const handicapMatch = name.match(/^(.+?)\s*\(([\-\+]?[\d,\.]+)\)\s*$/);
    if (handicapMatch) {
      const teamPart = handicapMatch[1].trim();

      if (homeTeam && this.matchesTeam(teamPart, homeTeam)) {
        return NormalizedSelection.HOME;
      }
      if (awayTeam && this.matchesTeam(teamPart, awayTeam)) {
        return NormalizedSelection.AWAY;
      }
    }

    // ==========================================================================
    // FALLBACK TO COMMON PATTERNS
    // ==========================================================================

    return this.normalizeCommonSelection(name, marketType);
  }
}

// Export singleton instance
export const superbetNormalizer = new SuperbetNormalizer();
