/**
 * PZBuk Market Normalizer
 *
 * Handles market normalization specific to PZBuk betting platform.
 * PZBuk uses "Rynek XX" format for unknown markets but also has Polish market names.
 *
 * Key challenges:
 * - Uses "Rynek XX" IDs when market name is not known (Rynek 62, 82, 1974, etc.)
 * - Polish market names: "Wynik meczu", "Podwojna szansa", "Liczba goli X.5"
 * - Has defined market types in MARKET_TYPES constant (1-42)
 *
 * Analysis showed:
 * - Coverage before normalizer: ~20.7%
 * - Main uncategorized markets: "Rynek 62", "Rynek 82", "Rynek 1974", "Przedzialy goli"
 * - Target coverage: >=90%
 */

import {
  NormalizedMarketType,
  NormalizedSelection,
  NormalizedMarketGroup,
} from "../../types/normalization.js";
import { BaseNormalizer, type MarketPattern } from "./base-normalizer.js";
import {
  PLAYER_MARKET_PATTERNS,
  STATISTICS_MARKET_PATTERNS,
  COMBINATION_MARKET_PATTERNS,
} from "./common-patterns.js";

/**
 * PZBuk market ID mappings from MARKET_TYPES constant
 * Maps "Rynek XX" format to normalized types
 */
const PZBUK_ID_MAPPINGS: Map<
  string,
  {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    hasParam?: boolean;
  }
> = new Map([
  // ==========================================================================
  // CORE MARKETS (from MARKET_TYPES constant)
  // ==========================================================================

  ["1", { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }],
  ["2", { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  ["3", { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  ["4", { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // HT/FT
  ["5", { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  ["8", { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }],
  ["10", { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }],
  ["11", { type: NormalizedMarketType.DRAW_NO_BET, group: NormalizedMarketGroup.MAIN }],
  ["12", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // First Goal Scorer
  ["13", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Last Goal Scorer
  ["14", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Anytime Scorer
  ["17", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  ["18", { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  ["19", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Home goals
  ["20", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Away goals
  ["21", { type: NormalizedMarketType.ODD_EVEN_GOALS, group: NormalizedMarketGroup.GOALS }],
  ["22", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.HALF_TIME }], // Second Half Result
  ["23", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }], // Second Half O/U
  ["24", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.HALF_TIME }], // Home Win Both Halves
  ["25", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.HALF_TIME }], // Away Win Both Halves
  ["26", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.HALF_TIME }], // Home Win Either Half
  ["27", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }],
  ["28", { type: NormalizedMarketType.WIN_TO_NIL, group: NormalizedMarketGroup.GOALS }],
  ["29", { type: NormalizedMarketType.HALF_TIME_BTTS, group: NormalizedMarketGroup.HALF_TIME }],
  ["30", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.HALF_TIME }], // Second Half BTTS
  ["31", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.HALF_TIME }], // Away Win Either Half
  ["32", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // Goals in Both Halves
  ["33", { type: NormalizedMarketType.CLEAN_SHEET, group: NormalizedMarketGroup.GOALS }], // Home Clean Sheet
  ["34", { type: NormalizedMarketType.CLEAN_SHEET, group: NormalizedMarketGroup.GOALS }], // Away Clean Sheet
  ["35", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.GOALS }], // Goal Ranges
  ["36", { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Total Exact Goals
  ["37", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.GOALS }], // Home Exact Goals
  ["38", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.GOALS }], // Away Exact Goals
  ["39", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + BTTS
  ["40", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + O/U
  ["41", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // DC + BTTS
  ["42", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // DC + O/U

  // ==========================================================================
  // ADDITIONAL IDs FOUND IN ANALYSIS
  // ==========================================================================

  ["62", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.HALF_TIME }], // HT/FT combo
  ["82", { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }], // Alternative 1X2
  ["61", { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }], // Alternative HT result
  ["156", { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }], // HT result variant
  ["1974", { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }], // HT O/U variant
  ["1975", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U variant
  ["83", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // O/U variant
  ["63", { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }], // BTTS variant
  ["84", { type: NormalizedMarketType.HALF_TIME_BTTS, group: NormalizedMarketGroup.HALF_TIME }], // HT BTTS variant
  ["64", { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }], // DC variant
  ["167", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Team goals
  ["155", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Team goals variant
  ["129", { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }], // Score variant

  // ==========================================================================
  // MORE IDs FROM EXTENDED ANALYSIS (2024)
  // ==========================================================================

  ["81", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Scorer market
  ["166", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special combo
  ["55", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + BTTS combo
  ["500", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Complex combo
  ["75", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Another combo
  ["58", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Another combo
  ["59", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Another combo
  ["69", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Another combo
  ["65", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Another combo
  ["68", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Another combo
  ["57", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Another combo
  ["70", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Another combo

  // ==========================================================================
  // HIGH-FREQUENCY COMBO MARKET IDs (from 2026 analysis)
  // ==========================================================================

  // Result + Goals combo markets (DC + Goals, 1X2 + Goals)
  ["55", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + BTTS combo (duplicate, confirmed)
  ["500", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Complex combo (duplicate)
  ["75", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // HT/FT variant (duplicate)
  ["58", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Win both halves
  ["59", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Score in both halves
  ["69", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Result + O/U combo
  ["65", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // HT result + FT result
  ["68", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Time of first goal
  ["57", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Win to nil variant
  ["70", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Highest scoring half

  // ==========================================================================
  // NEW IDs FROM 2026 ANALYSIS
  // ==========================================================================

  ["43", { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }], // HT result
  ["45", { type: NormalizedMarketType.WIN_TO_NIL, group: NormalizedMarketGroup.GOALS }], // Win to nil
  ["46", { type: NormalizedMarketType.CLEAN_SHEET, group: NormalizedMarketGroup.GOALS }], // Clean sheet
  ["53", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Home goals O/U
  ["54", { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }], // Away goals O/U
  ["80", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Special market
  ["503", { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }], // Complex combo
]);

// Half-time/full-time combo type (not in standard enum but useful for categorization)
const HALF_TIME_FULL_TIME = "HALF_TIME_FULL_TIME" as const;

export class PZBukNormalizer extends BaseNormalizer {
  readonly bookmaker = "pzbuk";

  /**
   * Bookmaker-specific market patterns
   * Priority: matched before generic patterns
   */
  protected readonly patterns: MarketPattern[] = [
    // ==========================================================================
    // HALF-TIME/FULL-TIME AND SPECIAL COMBO MARKETS
    // ==========================================================================

    // HT/FT (Half-time/Full-time result)
    {
      pattern: /^ht\/ft$/i,
      type: NormalizedMarketType.OTHER,
    },
    {
      pattern: /^wynik\s*(do\s*przerwy\s*\/\s*)?koniec\s*meczu$/i,
      type: NormalizedMarketType.OTHER,
    },

    // ==========================================================================
    // GOALSCORER MARKETS
    // ==========================================================================

    {
      pattern: /^strzelec\s*bramki/i,
      type: NormalizedMarketType.OTHER,
    },

    // ==========================================================================
    // HALF-TIME MARKETS (check before full match markets)
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
      pattern: /^1\.\s*pol.*liczba\s*goli\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
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
    // SECOND HALF MARKETS
    // ==========================================================================

    // Second half BTTS
    {
      pattern: /^obie\s*strzel[aą]\s*2\.\s*pol/i,
      type: NormalizedMarketType.OTHER,
    },

    // Second half total goals
    {
      pattern: /^liczba\s*goli\s*2\.\s*pol.*[:\s]+(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.OTHER,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Second half result
    {
      pattern: /^wynik\s*2\.\s*pol/i,
      type: NormalizedMarketType.OTHER,
    },

    // ==========================================================================
    // TOTAL GOALS MARKETS
    // ==========================================================================

    // "Liczba goli X.5" format
    {
      pattern: /^liczba\s*goli\s*[:\s]+(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // "Gole X.5" shorter format
    {
      pattern: /^gole\s*[:\s]+(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ==========================================================================
    // BOTH TEAMS TO SCORE
    // ==========================================================================

    {
      pattern: /^obie\s*dru[żz]yny\s*strzel[ąa]/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /^obie\s*strzel/i,
      type: NormalizedMarketType.BTTS,
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

    // Goals in both halves
    {
      pattern: /^gole\s*w\s*obu\s*pol/i,
      type: NormalizedMarketType.BTTS,
    },

    // ==========================================================================
    // TEAM-SPECIFIC GOAL MARKETS
    // ==========================================================================

    // Home team goals
    {
      pattern: /^gole\s*gospodarzy\s*(\d+[.,]?\d*)?/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Away team goals
    {
      pattern: /^gole\s*g[oó][sś]ci\s*(\d+[.,]?\d*)?/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
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
    {
      pattern: /^ko[ńń]cowy\s*wynik$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // ==========================================================================
    // DOUBLE CHANCE
    // ==========================================================================

    {
      pattern: /^podw[oó]jna\s*szansa$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // ==========================================================================
    // COMBO MARKETS (DC + Goals, Result + BTTS, etc.)
    // ==========================================================================

    // Double chance + goals combo
    {
      pattern: /^podw[oó]jna\s*szansa\s*\+\s*gole\s*\d/i,
      type: NormalizedMarketType.OTHER,
    },

    // ==========================================================================
    // DRAW NO BET
    // ==========================================================================

    {
      pattern: /^remis\s*=\s*zwrot$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },
    {
      pattern: /^remis\s*zwraca/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // ==========================================================================
    // HANDICAP MARKETS
    // ==========================================================================

    // Asian handicap with line
    {
      pattern: /^handicap\s*azjatycki\s*([-+]?\d+[.,]?\d*)/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // European handicap with line
    {
      pattern: /^handicap\s*europejski\s*([-+]?\d+[.,]?\d*)/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Generic handicap (treat as Asian)
    {
      pattern: /^handicap\s*([-+]?\d+[.,]?\d*)/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ==========================================================================
    // CORRECT SCORE
    // ==========================================================================

    {
      pattern: /^dok[łł]adny\s*wynik$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },
    {
      pattern: /^dokladny\s*wynik$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },
    {
      pattern: /^dok[łł]adn.*liczba\s*gol/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ==========================================================================
    // GOAL RANGES (Przedzialy goli)
    // ==========================================================================

    {
      pattern: /^przedzia[lł]y\s*gol/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },
    {
      pattern: /^zakres\s*gol/i,
      type: NormalizedMarketType.CORRECT_SCORE,
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
    // SPECIAL HALF MARKETS (win both halves, either half)
    // ==========================================================================

    {
      pattern: /^gospodarze\s*wygr[ąa]\s*obie\s*pol/i,
      type: NormalizedMarketType.OTHER,
    },
    {
      pattern: /^g[oó][sś]cie\s*wygr[ąa]\s*obie\s*pol/i,
      type: NormalizedMarketType.OTHER,
    },
    {
      pattern: /^gospodarze\s*wygr[ąa]\s*kt[oó]r[ąa]\s*kolwiek\s*pol/i,
      type: NormalizedMarketType.OTHER,
    },
    {
      pattern: /^g[oó][sś]cie\s*wygr[ąa]\s*kt[oó]r[ąa]\s*kolwiek\s*pol/i,
      type: NormalizedMarketType.OTHER,
    },

    // Common patterns fallback
    ...COMBINATION_MARKET_PATTERNS,
    ...STATISTICS_MARKET_PATTERNS,
    ...PLAYER_MARKET_PATTERNS,
  ];

  /**
   * Override tryIdMapping to handle PZBuk's "Rynek XX" format
   */
  protected tryIdMapping(marketName: string): {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    param?: string;
  } | null {
    // Match "Rynek XX" format
    const rynekMatch = marketName.match(/^Rynek\s+(\d+)$/i);
    if (rynekMatch) {
      const marketId = rynekMatch[1];
      const mapping = PZBUK_ID_MAPPINGS.get(marketId);

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
   * Selection normalization patterns specific to PZBuk
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

    // Polish home/away team names (gospodarz/goście)
    if (/^gospodarz(?:arze|y)?$/i.test(name)) return NormalizedSelection.HOME;
    if (/^go[ść]cie|go[śś]ci$/i.test(name)) return NormalizedSelection.AWAY;

    // ==========================================================================
    // PZBUK-SPECIFIC: BTTS uses OVER/UNDER instead of YES/NO
    // This is a known quirk of PZBuk's data format
    // ==========================================================================

    if (marketType === NormalizedMarketType.BTTS || marketType === NormalizedMarketType.HALF_TIME_BTTS) {
      // For BTTS markets, PZBuk uses OVER/UNDER indicators
      // OVER = YES (both teams score), UNDER = NO (at least one team doesn't score)
      if (/^powy/i.test(name) || /^(powy[żz]ej|powyzej|poni|ponad|over|mais|\+|above)/i.test(name)) {
        return NormalizedSelection.YES;
      }
      if (/^pon/i.test(name) || /^(poni[żz]ej|ponizej|under|menos|\-|below)/i.test(name)) {
        return NormalizedSelection.NO;
      }
      // Also check for + and - prefixes (numeric format)
      if (/^\+/i.test(name)) {
        return NormalizedSelection.YES;
      }
      if (/^\-/i.test(name) && !name.includes("remis")) {
        return NormalizedSelection.NO;
      }
    }

    // Use common selection patterns from base class
    const common = this.normalizeCommonSelection(name, marketType);
    if (common !== NormalizedSelection.UNKNOWN) {
      return common;
    }

    // PZBuk-specific selection patterns

    // "Gospodarze" = Home (enhanced pattern)
    if (/^gospodarz/i.test(name)) {
      return NormalizedSelection.HOME;
    }

    // "Goscie" = Away (enhanced pattern)
    if (/^g[óo][śs]c/i.test(name) && !name.includes("dom")) {
      return NormalizedSelection.AWAY;
    }

    // Enhanced Over/Under selections (Polish + English + Portuguese)
    if (/^powy/i.test(name) || /^(powy[żz]ej|powyzej|poni|ponad|over|mais)/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    if (/^pon/i.test(name) || /^(poni[żz]ej|ponizej|under|menos)/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Remis (draw)
    if (/^remis$/i.test(name)) {
      return NormalizedSelection.DRAW;
    }

    // Enhanced Yes/No for BTTS and similar (Polish + English + variants)
    if (/^(tak|yes|y|gg|sim|gol)/i.test(name)) {
      return NormalizedSelection.YES;
    }
    if (/^(nie|no|n|ng|n[ão]o|brak)/i.test(name)) {
      return NormalizedSelection.NO;
    }

    // Enhanced Double Chance patterns
    if (/^1x$|^1\/x$|^1\s*lub\s*x/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (/^x2$|^x\/2$|^x\s*lub\s*2/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (/^12$|^1\/2$|^1\s*lub\s*2/i.test(name)) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Double Chance with team names
    if (homeTeam && name.includes(`${homeTeam.toLowerCase()} lub remis`)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (awayTeam && name.includes(`remis lub ${awayTeam.toLowerCase()}`)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (homeTeam && awayTeam && name.includes(" lub ") &&
        (name.includes(homeTeam.toLowerCase()) || name.includes(awayTeam.toLowerCase()))) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Enhanced Odd/Even patterns
    if (/nieparzy/i.test(name) || /nieparzyst[ea]?/i.test(name)) {
      return NormalizedSelection.ODD;
    }
    if (/parzy/i.test(name) && !name.includes("nie") || /parzyst[ea]?/i.test(name)) {
      return NormalizedSelection.EVEN;
    }

    return NormalizedSelection.UNKNOWN;
  }
}

// Export singleton instance
export const pzbukNormalizer = new PZBukNormalizer();
