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
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // 1st half draw no bet
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*zak[lł]ad\s*bez\s*remisu/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
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

    // 1st half double chance
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*podw[oó]jna?\s*szansa/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // 1st half handicap
    {
      pattern: /^1\.\s*po[lł]owa\s*-\s*handicap/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
    },

    // ==========================================================================
    // SECOND HALF MARKETS (2. polowa) - Most go to OTHER, but capture some
    // ==========================================================================

    // 2nd half result - could map to HALF_TIME_RESULT for coverage
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*wynik$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // 2nd half 1X2
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*1x2$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // 2nd half double chance
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*podw[oó]jna?\s*szansa/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // 2nd half draw no bet
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*zak[lł]ad\s*bez\s*remisu/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // 2nd half total goals - map to HALF_TIME_TOTAL_GOALS for coverage
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*liczba\s*goli/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },

    // 2nd half exact number of goals
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*dok[lł]adna\s*liczba\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 2nd half total goals - map to HALF_TIME_TOTAL_GOALS for coverage
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*liczba\s*goli/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },

    // 2nd half exact number of goals
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*dok[lł]adna\s*liczba\s*goli/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },

    // 2nd half BTTS
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*obie.*strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // 2nd half handicap (with specific value like "1:0")
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*handicap\s*[\d:]+/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
    },

    // 2nd half handicap generic
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*handicap/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
    },

    // 2nd half first goal
    {
      pattern: /^2\.\s*po[lł]owa\s*-\s*1\.\s*gol/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
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
    {
      pattern: /^wynik$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /^rezultat$/i,
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
    {
      pattern: /^zak[lł]ad\s*bez\s*remisu\s*\(remis[=\s]*zwrot\)$/i,
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

    // Generic "Liczba goli" without line - map to TOTAL_GOALS for coverage
    // This handles markets that are categorized as total goals but don't show line
    {
      pattern: /^liczba\s*goli$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
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
    // COMBO MARKETS - Map to primary component for better coverage
    // ==========================================================================

    // "Podwojna szansa i liczba goli" - double chance + total goals
    // Map to DOUBLE_CHANCE (primary component)
    {
      pattern: /podw[oó]jna?\s*szansa\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // "Wynik meczu i liczba goli" - result + total goals
    // Map to MATCH_WINNER (primary component)
    {
      pattern: /wynik\s*meczu\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // "Wynik meczu i obie drużyny strzelą" - result + BTTS
    {
      pattern: /wynik\s*meczu\s*i\s*obie.*strzel/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // "Podwojna szansa i obie drużyny strzelą" - double chance + BTTS
    {
      pattern: /podw[oó]jna?\s*szansa\s*i\s*obie.*strzel/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
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

    // Multi-result / combo bet
    {
      pattern: /^multiwynik$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // First goal timing
    {
      pattern: /^kiedy\s*ostanie\s*strzelony\s*1\.\s*gol/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    {
      pattern: /^czas\s*1\.\s*gola/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // Half-time / Full-time
    {
      pattern: /^po[lł]owa\s*\/?\s*koniec$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // Half-time / Full-time with result detail
    {
      pattern: /^po[lł]owa\s*[\/\-]\s*mecz/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // Win margin
    {
      pattern: /^margines\s*zwyci[ęe]stwa$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Goal in first/last X minutes - map to GOALS group for coverage
    {
      pattern: /^gol\s*w\s*pierwszych\s*\d+\s*minut/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    {
      pattern: /^gol\s*w\s*ostatnich\s*\d+\s*minut/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // First/Last goal - map to GOALS group
    {
      pattern: /^pierwszy\s*gol/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    {
      pattern: /^1\.\s*gol$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    {
      pattern: /^ostatni\s*gol/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    {
      pattern: /^ostatni[ae]?\s*gol/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // Draw no bet variants
    {
      pattern: /^remis\s*bez\s*zakladu/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },
    {
      pattern: /^bez\s*remisu/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // Both teams to score variants
    {
      pattern: /^obie\s*dru[żz]yny\s*strzel.*gol/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /^gol\s*obu\s*dru[żz]yn/i,
      type: NormalizedMarketType.BTTS,
    },

    // Team to score
    {
      pattern: /^dru[żz]yna\s*strzeli\s*gola/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Highest scoring half
    {
      pattern: /^po[lł]owa\s*z\s*najwi[ęe]cej\s*goli/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
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
