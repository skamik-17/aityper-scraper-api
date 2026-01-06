/**
 * BetFan Market Normalizer
 *
 * Handles market normalization specific to BetFan betting platform.
 * BetFan uses clean Polish market names provided via API.
 *
 * Key patterns identified:
 * - "Wynik meczu" -> MATCH_WINNER
 * - "Podwojna szansa" -> DOUBLE_CHANCE
 * - "Remis = zwrot" -> DRAW_NO_BET
 * - "Obie druzyny strzelą" -> BTTS
 * - "Liczba goli X.X" -> TOTAL_GOALS (with param)
 * - "Handicap azjatycki X.X" -> ASIAN_HANDICAP (with param)
 * - "Handicap" (no qualifier) -> EUROPEAN_HANDICAP
 * - "Czyste konto" -> CLEAN_SHEET
 * - "1. polowa - wynik" -> HALF_TIME_RESULT
 * - "1. polowa - liczba goli" -> HALF_TIME_TOTAL_GOALS
 * - "1. polowa - obie strzelą" -> HALF_TIME_BTTS
 * - "Dokladny wynik" -> CORRECT_SCORE
 *
 * Coverage target: >= 90%
 */

import {
  NormalizedMarketType,
  NormalizedSelection,
  NormalizedMarketGroup,
} from "../../types/normalization.js";
import { BaseNormalizer, type MarketPattern } from "./base-normalizer.js";

export class BetfanNormalizer extends BaseNormalizer {
  readonly bookmaker = "betfan";

  /**
   * BetFan-specific market patterns
   * Priority: matched in order, more specific patterns first
   */
  protected readonly patterns: MarketPattern[] = [
    // ==========================================================================
    // PLAYER MARKETS - Check first as they are very specific and should be OTHER
    // ==========================================================================

    // Player cards
    {
      pattern: /zawodnik\s*otrzyma\s*kartk/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player assists
    {
      pattern: /liczba\s*asyst\s*zawodnika/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player tackles
    {
      pattern: /liczba\s*udanych\s*odbior[oó]w\s*zawodnika/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player shots on target
    {
      pattern: /liczba\s*strza[lł][oó]w\s*celnych\s*zawodnika/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player shots
    {
      pattern: /liczba\s*strza[lł][oó]w\s*zawodnika/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player passes
    {
      pattern: /liczba\s*poda[nń]\s*zawodnika/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // HALF-TIME MARKETS (1. polowa) - Check before full match markets
    // ==========================================================================

    // 1st half first goal
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*1\.\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half BTTS
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*obie\s*(dru[żz]yny\s*)?strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // 1st half total goals with line
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*liczba\s*goli\s*([\d,\.]+)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // 1st half total goals (exact number - different market)
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*liczba\s*goli$/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },

    // 1st half result / 1X2
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*wynik$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*1x2$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // 1st half corners
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*(?:liczba\s*)?rzut(?:y|[oó]w)?\s*ro[żz]n/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 1st half cards
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*liczba\s*kartek/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 1st half exact number of goals
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*dok[lł]adna\s*liczba\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half handicap
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*handicap/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // ==========================================================================
    // SECOND HALF MARKETS (2. polowa) - All go to OTHER
    // ==========================================================================

    // 2nd half result
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*wynik$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 2nd half exact number of goals
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*dok[lł]adna\s*liczba\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 2nd half total goals
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*liczba\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Catch-all for 2nd half markets
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // MAIN MATCH MARKETS
    // ==========================================================================

    // Match winner / 1X2 - exact match
    {
      pattern: /^wynik\s*meczu$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /^1x2$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Double chance
    {
      pattern: /^podw[oó]jn?a\s*szansa$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },
    {
      pattern: /^podwojna\s*szansa$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // Draw no bet
    {
      pattern: /^remis\s*=\s*zwrot$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },
    {
      pattern: /^zak[lł]ad\s*bez\s*remisu$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // ==========================================================================
    // TOTAL GOALS MARKETS
    // ==========================================================================

    // Total goals with line in name (e.g., "Liczba goli 2.5")
    {
      pattern: /^liczba\s*goli\s*([\d,\.]+)$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    {
      pattern: /^liczba\s*goli\s+[\-\+]?([\d,\.]+)$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Generic "Liczba goli" without line (exact number - goes to OTHER)
    {
      pattern: /^liczba\s*goli$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Exact number of goals
    {
      pattern: /^dok[lł]adna\s*liczba\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // "2. polowa - liczba goli"
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*liczba\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // COMBO MARKETS
    // ==========================================================================

    // "Podwojna szansa i liczba goli" - double chance + total goals
    {
      pattern: /podw[oó]jna?\s*szansa\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // "Wynik meczu i liczba goli" - result + total goals
    {
      pattern: /wynik\s*meczu\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // BTTS MARKETS
    // ==========================================================================

    // BTTS standalone
    {
      pattern: /^obie\s*(dru[żz]yny\s*)?strzel.*$/i,
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

    // Generic "Handicap" - BetFan uses this for European handicap
    {
      pattern: /^handicap$/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
    },

    // Handicap with line value (e.g., "Handicap -1.5")
    {
      pattern: /^handicap\s*([\-\+]?[\d,\.]+)$/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ==========================================================================
    // CORRECT SCORE
    // ==========================================================================

    {
      pattern: /^dok[lł]adny\s*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ==========================================================================
    // CLEAN SHEET / WIN TO NIL
    // ==========================================================================

    {
      pattern: /^czyste\s*konto$/i,
      type: NormalizedMarketType.CLEAN_SHEET,
    },

    {
      pattern: /wygra\s*do\s*zera$/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },

    // ==========================================================================
    // ODD/EVEN
    // ==========================================================================

    {
      pattern: /^parzyste\s*\/?\s*nieparzyste$/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },
    {
      pattern: /^nieparzyste\s*\/?\s*parzyste$/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },

    // ==========================================================================
    // CORNERS MARKETS
    // ==========================================================================

    {
      pattern: /^liczba\s*rzut[oó]w\s*ro[żz]nych$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^rzuty?\s*ro[żz]n/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // CARDS MARKETS
    // ==========================================================================

    {
      pattern: /^liczba\s*kartek/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /kartk/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // TEAM TOTAL GOALS
    // ==========================================================================

    // Team specific goal markets (Gole gospodarzy, Gole gosci)
    {
      pattern: /^gole\s*gospodarzy$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^gole\s*go[sś]ci$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // ==========================================================================
    // TEAM-SPECIFIC MARKETS (Gole gospodarzy, Gole gosci)
    // ==========================================================================

    {
      pattern: /^gole\s*gospodarzy\s*([\d,\.]+)?$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    {
      pattern: /^gole\s*go[sś]ci\s*([\d,\.]+)?$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ==========================================================================
    // OTHER SPECIAL MARKETS
    // ==========================================================================

    // Half-time / Full-time
    {
      pattern: /^po[lł]owa\s*\/?\s*koniec$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Win margin
    {
      pattern: /^margines\s*zwyci[ęe]stwa$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Goal in first/last X minutes
    {
      pattern: /^gol\s*w\s*pierwszych\s*\d+\s*minut/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^gol\s*w\s*ostatnich\s*\d+\s*minut/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
  ];

  /**
   * Normalize selection names for BetFan
   * BetFan uses Polish names and team names in selections
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
    if (/^1x$|^1\/x$/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (/^x2$|^x\/2$/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (/^12$|^1\/2$/i.test(name)) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Over/Under - BetFan uses "Powyzej" and "Ponizej" (without diacritics in API)
    if (/^(powy[żz]ej|powyzej|ponad|over)/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    if (/^(poni[żz]ej|ponizej|under)/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Yes/No (BTTS and similar)
    if (/^tak$/i.test(name)) return NormalizedSelection.YES;
    if (/^nie$/i.test(name)) return NormalizedSelection.NO;

    // Odd/Even
    if (/^nieparzyste$/i.test(name)) return NormalizedSelection.ODD;
    if (/^parzyste$/i.test(name)) return NormalizedSelection.EVEN;

    // Handle handicap selections with line: "Team (+/-X)"
    if (/\([-+]?\d+[.,]?\d*\)\s*$/.test(name)) {
      const teamPart = name.replace(/\s*\([-+]?\d+[.,]?\d*\)\s*$/, "").trim();
      if (homeTeam && this.matchesTeam(teamPart, homeTeam)) {
        return NormalizedSelection.HOME;
      }
      if (awayTeam && this.matchesTeam(teamPart, awayTeam)) {
        return NormalizedSelection.AWAY;
      }
    }

    // Use common patterns as fallback
    return this.normalizeCommonSelection(name, marketType);
  }
}

// Export singleton instance
export const betfanNormalizer = new BetfanNormalizer();
