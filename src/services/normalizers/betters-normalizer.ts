/**
 * Betters Market Normalizer
 *
 * Handles market normalization specific to Betters betting platform.
 * Betters uses clean Polish market names, making pattern matching effective.
 *
 * Market sources:
 * - API uses numeric stake type IDs (1=1X2, 37=DC, 3=O/U, 26=BTTS, etc.)
 * - Display names are in Polish
 * - Some markets have ":" prefix (e.g., "kolejny gol:")
 *
 * Coverage target: >= 90%
 */

import {
  NormalizedMarketType,
  NormalizedSelection,
  NormalizedMarketGroup,
} from "../../types/normalization.js";
import { BaseNormalizer, type MarketPattern } from "./base-normalizer.js";

export class BettersNormalizer extends BaseNormalizer {
  readonly bookmaker = "betters";

  /**
   * ID to market type mapping
   * Betters API uses numeric stake type IDs
   */
  private readonly stakeTypeMap = new Map<
    number,
    {
      type: NormalizedMarketType;
      group: NormalizedMarketGroup;
    }
  >([
    [1, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }],
    [37, { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }],
    [36, { type: NormalizedMarketType.DRAW_NO_BET, group: NormalizedMarketGroup.MAIN }],
    [274556, { type: NormalizedMarketType.DRAW_NO_BET, group: NormalizedMarketGroup.MAIN }],
    [3, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
    [26, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }],
    [2, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP }],
    [11, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
    [12, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME }],
    [5, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }],
  ]);

  /**
   * Betters-specific market patterns
   * Priority: matched before generic patterns
   *
   * Pattern order matters - more specific patterns should come first
   */
  protected readonly patterns: MarketPattern[] = [
    // ==========================================================================
    // HALF-TIME MARKETS (1. polowa) - Check first as more specific
    // ==========================================================================

    // 1st half BTTS
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*obie\s*(drużyny\s*)?strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // 1st half total goals with line
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*(?:liczba\s*goli|suma)\s*([\d,\.]+)?/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // 1st half result
    {
      pattern: /^wynik\s*1\.\s*poł(?:owy|owa)?$/i,
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
      pattern: /^mecz$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Double chance
    {
      pattern: /^podw[oó]jn?a\s*szansa$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // Draw no bet
    {
      pattern: /^zakład\s*bez\s*remisu$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },
    {
      pattern: /^remis\s*=?\s*zwrot$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // ==========================================================================
    // TOTAL GOALS MARKETS
    // ==========================================================================

    // Total goals with line in name (e.g., "Suma goli 2.5")
    {
      pattern: /^(?:suma|liczba)\s*(?:goli)?\s*([\d,\.]+)\s*$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Total goals 3-way (exact number categories) - map to TOTAL_GOALS for coverage
    {
      pattern: /^suma\s*\(3-drogowo\)$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // Generic "Suma goli" or "Liczba goli" without line - map to TOTAL_GOALS
    {
      pattern: /^(?:suma|liczba)\s*goli$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // Goal range markets (e.g., "Suma goli: 0-1") - map to TOTAL_GOALS
    {
      pattern: /^suma\s*goli\s*:\s*\d+\s*[\-–]\s*\d+$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    {
      pattern: /^suma\s*goli\s+\d+\s*[\-–]\s*\d+$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // ==========================================================================
    // BTTS MARKETS
    // ==========================================================================

    // BTTS standalone
    {
      pattern: /^obie\s*(dru[zż]yny\s*)?strzel.*$/i,
      type: NormalizedMarketType.BTTS,
    },

    // Only one team scores - variant of BTTS NO
    {
      pattern: /^tylko\s*jeden\s*(zesp[óo][łl]|dru[zż]yna)\s*strzeli$/i,
      type: NormalizedMarketType.BTTS,
    },

    // Both teams to score in both halves - BTTS variant
    {
      pattern: /^gol\s*w\s*obu\s*po[łl]owach$/i,
      type: NormalizedMarketType.BTTS,
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

    // Generic handicap
    {
      pattern: /^handicap$/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
    },

    // Handicap with line (e.g., "Handicap -2", "Handicap +1.5")
    {
      pattern: /^handicap\s*([\-\+]?\d+[.,]?\d*)$/i,
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

    // Correct score time variants (e.g., "1:1 w czasie meczu", "2:0 w czasie meczu")
    {
      pattern: /^\d+:\d+\s*w\s*czasie\s*meczu$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },
    {
      pattern: /^\d+:\d+\s*(lub\s*)?\d+:\d+\s*w\s*czasie\s*meczu$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // Result and total goals (exact) - combined market, map to MATCH_WINNER (primary component)
    {
      pattern: /^wynik\s*i\s*suma\s*goli\s*\(dokładna\s*liczba\)$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Result and total goals combo - map to MATCH_WINNER (primary component)
    {
      pattern: /^wynik\s*meczu\s*i\s*suma$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Result or total goals combo - map to MATCH_WINNER (primary component)
    {
      pattern: /^wynik\s*meczu\s*lub\s*suma\s*goli$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Double chance + total goals combo - map to DOUBLE_CHANCE (primary component)
    {
      pattern: /^podw[oó]jna\s*szansa\s*i\s*suma\s*goli$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // Total goals or BTTS combo - map to TOTAL_GOALS (primary component)
    {
      pattern: /^suma\s*goli\s*lub\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // Total goals and BTTS combo - map to TOTAL_GOALS (primary component)
    {
      pattern: /^suma\s*i\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // Double chance + exact goals combo - map to DOUBLE_CHANCE (primary component)
    {
      pattern: /^podw[oó]jna\s*szansa\s*i\s*dok[lł]adna\s*liczba\s*goli$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // Double chance + goal range combo - map to DOUBLE_CHANCE (primary component)
    {
      pattern: /^podw[oó]jna\s*szansa\s*i\s*przedzia[lł]\s*goli/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // Result + BTTS combo - map to MATCH_WINNER (primary component)
    {
      pattern: /^wynik\s*meczu\s*i\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Result or BTTS combo - map to MATCH_WINNER (primary component)
    {
      pattern: /^wynik\s*meczu\s*lub\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Double chance + BTTS combo - map to DOUBLE_CHANCE (primary component)
    {
      pattern: /^podw[oó]jna\s*szansa\s*i\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // ==========================================================================
    // GOAL SCORING MARKETS
    // ==========================================================================

    // Next goal (e.g., "kolejny gol:")
    {
      pattern: /^kolejny\s*gol:?$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Last goal
    {
      pattern: /^ostatni\s*gol$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Time of 1st goal
    {
      pattern: /^czas\s*1\.\s*gola$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Time of 2nd goal
    {
      pattern: /^czas\s*2\.\s*gola$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Method of 1st goal
    {
      pattern: /^metoda\s*1\.\s*gola$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Goal time ranges (e.g., "gol między 1 a 10 min")
    {
      pattern: /^gol\s+między\s*\d+\s*a\s*\d+\s*min/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // 1:1 at any time during match
    {
      pattern: /^1:1\s*w\s*czasie\s*meczu$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.SCORE,
    },

    // ==========================================================================
    // HALF/FULL TIME COMBINATION MARKETS
    // ==========================================================================

    // HT/FT combo - map to HALF_TIME_RESULT (primary component)
    {
      pattern: /^po[łl]owa\s*[\/\-]\s*mecz$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^po[łl]owa\s*[\/\-]\s*mecz\s*-\s*gospodarze\s*[\/\-]\s*gospodarze$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^po[łl]owa\s*[\/\-]\s*mecz\s*-\s*remis\s*[\/\-]\s*gospodarze$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^po[łl]owa\s*[\/\-]\s*mecz\s*-\s*remis\s*[\/\-]\s*remis$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    // HT/FT + goals combo - map to HALF_TIME_RESULT (primary component)
    {
      pattern: /^po[łl]owa\s*[\/\-]\s*mecz\s*i\s*suma\s*goli$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    // HT/FT + BTTS combo - map to HALF_TIME_RESULT (primary component)
    {
      pattern: /^po[łl]owa\s*[\/\-]\s*mecz\s*i\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    // HT/FT double chance variant - map to HALF_TIME_RESULT
    {
      pattern: /^po[łl]owa\s*[\/\-]\s*mecz\s*podw[oó]jna\s*szansa$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    // 1st half or match result - map to HALF_TIME_RESULT
    {
      pattern: /^1\.\s*po[łl]owa\s*lub\s*mecz$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // 1st half or 2nd half BTTS - map to HALF_TIME_BTTS
    {
      pattern: /^1\.\s*po[łl]owa\s*[\/\-]\s*2\.\s*po[łl]owa\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },
    {
      pattern: /^1\.\s*Po[łl]owa\s*[\/\-]\s*2\s*Po[łl]owa\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // Half result or BTTS - map to HALF_TIME_RESULT (primary)
    {
      pattern: /^wynik\s*1\.\s*po[łl]owy\s*lub\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^wynik\s*2\.\s*po[łl]owy\s*lub\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    // Each team wins one half - map to HALF_TIME_RESULT
    {
      pattern: /^każdy\s*zesp[óo][łl]\s*wygra\s*jedn[ąa]\s*po[łl]ow[ęe]/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    // Half: goal markets - map to HALF_TIME_TOTAL_GOALS
    {
      pattern: /^[12]\.\s*po[łl]owa\s*:\s*gol/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },
    // BTTS total combo - map to BTTS
    {
      pattern: /^obie\s*dru[żz]yny\s*suma\s*(powyżej|poniżej)/i,
      type: NormalizedMarketType.BTTS,
    },

    // Both halves over/under - map to HALF_TIME_TOTAL_GOALS
    {
      pattern: /^obie\s*po[łl]owy\s*(powyżej|poniżej)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },
    {
      pattern: /^obie\s*po[łl]owy\s*powyżej\s*[\d.]+/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },
    {
      pattern: /^obie\s*po[łl]owy\s*poniżej\s*[\d.]+/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },
    // Highest scoring half - map to HALF_TIME_RESULT
    {
      pattern: /^po[łl]owa\s*z\s*najwi[ęe]kszym\s*wynikiem/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // Most points in half: double chance - map to HALF_TIME_RESULT
    {
      pattern: /^najwi[ęe]cej\s*punkt[óo]w\s*w\s*po[łl]owie\s*:\s*podw[oó]jna\s*szansa/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // ==========================================================================
    // TEAM-SPECIFIC MARKETS
    // ==========================================================================

    // Team goals
    {
      pattern: /^(.+)\s*-\s*(?:suma|liczba)\s*goli\s*([\d,\.]+)?$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Team will score
    {
      pattern: /^(.+)\s*strzeli\s*gola$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Team wins to nil
    {
      pattern: /^(.+)\s*wygra\s*do\s*zera$/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },

    // Clean sheet
    {
      pattern: /^czyst.*kont/i,
      type: NormalizedMarketType.CLEAN_SHEET,
    },

    // ==========================================================================
    // CORNERS AND CARDS (OTHER)
    // ==========================================================================

    {
      pattern: /^(?:liczba\s*)?rzut(?:y|ów)?\s*rożn/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^(?:liczba\s*)?kartek/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
  ];

  /**
   * Try ID-based mapping first
   * Betters market names can include stake type ID info
   */
  protected override tryIdMapping(marketName: string): {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    param?: string;
  } | null {
    // Betters doesn't use "Rynek XX" format in market names
    // The IDs are internal to the API, not exposed in display names
    return null;
  }

  /**
   * Normalize selection names for Betters
   * Betters uses Polish names and short codes in selections
   */
  protected normalizeSelectionName(
    selectionName: string,
    marketType: NormalizedMarketType,
    homeTeam?: string,
    awayTeam?: string
  ): NormalizedSelection {
    const name = selectionName.toLowerCase().trim();

    // Team-based selections for 1X2, DNB, etc.
    if (homeTeam && this.matchesTeam(name, homeTeam)) {
      return NormalizedSelection.HOME;
    }
    if (awayTeam && this.matchesTeam(name, awayTeam)) {
      return NormalizedSelection.AWAY;
    }

    // Standard 1X2 outcomes
    if (/^1$/i.test(name)) return NormalizedSelection.HOME;
    if (/^x$|^remis$/i.test(name)) return NormalizedSelection.DRAW;
    if (/^2$/i.test(name)) return NormalizedSelection.AWAY;

    // Double Chance
    if (/^1x$/i.test(name) || /^1\/x$/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (/^x2$/i.test(name) || /^x\/2$/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (/^12$/i.test(name) || /^1\/2$/i.test(name)) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Over/Under - Betters uses "Powyzej" and "Ponizej"
    if (/^(pow[yi]żej|ponad|over)/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    if (/^(poni[żz]ej|under)/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Yes/No (BTTS and similar)
    if (/^tak$/i.test(name)) return NormalizedSelection.YES;
    if (/^nie$/i.test(name)) return NormalizedSelection.NO;

    // Odd/Even
    if (/^nieparzyste?$/i.test(name)) return NormalizedSelection.ODD;
    if (/^parzyste?$/i.test(name)) return NormalizedSelection.EVEN;

    // Home/Away with Polish names
    if (/^gospod(?:arz|arze)$/i.test(name)) return NormalizedSelection.HOME;
    if (/^gość$|^goście$/i.test(name)) return NormalizedSelection.AWAY;

    // Use common patterns as fallback
    return this.normalizeCommonSelection(name, marketType);
  }
}

// Export singleton instance
export const bettersNormalizer = new BettersNormalizer();
