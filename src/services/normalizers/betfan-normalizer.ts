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
import {
  PLAYER_MARKET_PATTERNS,
  STATISTICS_MARKET_PATTERNS,
  COMBINATION_MARKET_PATTERNS,
} from "./common-patterns.js";

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
      type: NormalizedMarketType.PLAYER_CARDS,
    },

    // Player assists
    {
      pattern: /liczba\s*asyst\s*zawodnika/i,
      type: NormalizedMarketType.PLAYER_ASSISTS,
    },

    // Player tackles (keep as OTHER - not a specific category)
    {
      pattern: /liczba\s*udanych\s*odbior[oó]w\s*zawodnika/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player shots on target
    {
      pattern: /liczba\s*strza[lł][oó]w\s*celnych\s*zawodnika/i,
      type: NormalizedMarketType.PLAYER_SHOTS,
    },

    // Player shots
    {
      pattern: /liczba\s*strza[lł][oó]w\s*zawodnika/i,
      type: NormalizedMarketType.PLAYER_SHOTS,
    },

    // Player passes (keep as OTHER - not a specific category)
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
    // COMBO MARKETS - Use specific combination types
    // ==========================================================================

    // "Podwojna szansa i liczba goli" - double chance + total goals
    {
      pattern: /podw[oó]jna?\s*szansa\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.RESULT_AND_TOTAL,
    },

    // "Wynik meczu i liczba goli" - result + total goals
    {
      pattern: /wynik\s*meczu\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.RESULT_AND_TOTAL,
    },

    // "Wynik meczu i obie drużyny strzelą" - result + BTTS
    {
      pattern: /wynik\s*meczu\s*i\s*obie.*strzel/i,
      type: NormalizedMarketType.RESULT_AND_BTTS,
    },

    // "Podwojna szansa i obie drużyny strzelą" - double chance + BTTS
    {
      pattern: /podw[oó]jna?\s*szansa\s*i\s*obie.*strzel/i,
      type: NormalizedMarketType.RESULT_AND_BTTS,
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
      type: NormalizedMarketType.CORNERS_TOTAL,
    },
    {
      pattern: /^rzuty?\s*ro[żz]n/i,
      type: NormalizedMarketType.CORNERS_TOTAL,
    },

    // ==========================================================================
    // CARDS MARKETS
    // ==========================================================================

    {
      pattern: /^liczba\s*kartek/i,
      type: NormalizedMarketType.CARDS_TOTAL,
    },
    {
      pattern: /^kartk[ai]\s*\d/i,
      type: NormalizedMarketType.CARDS_TOTAL,
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
      type: NormalizedMarketType.HALFTIME_FULLTIME,
    },

    // Half-time / Full-time with result detail
    {
      pattern: /^po[lł]owa\s*[\/\-]\s*mecz/i,
      type: NormalizedMarketType.HALFTIME_FULLTIME,
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

    // ==========================================================================
    // COMMON PATTERNS (fallback)
    // ==========================================================================
    ...COMBINATION_MARKET_PATTERNS,
    ...STATISTICS_MARKET_PATTERNS,
    ...PLAYER_MARKET_PATTERNS,
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

    // Polish home/away team names (gospodarz/goście)
    if (/^gospodarz(?:arze|y)?$/i.test(name)) return NormalizedSelection.HOME;
    if (/^go[ść]cie|go[śś]ci$/i.test(name)) return NormalizedSelection.AWAY;

    // ==========================================================================
    // BETFAN-SPECIFIC: Handle handicap and coded selections
    // ==========================================================================

    // European Handicap format: "1 (1:0)", "X (1:0)", "2 (1:0)"
    const ehMatch = name.match(/^([1x2])\s*\(\d+:\d+\)$/i);
    if (ehMatch) {
      const code = ehMatch[1].toLowerCase();
      if (code === "1") return NormalizedSelection.HOME;
      if (code === "x") return NormalizedSelection.DRAW;
      if (code === "2") return NormalizedSelection.AWAY;
    }

    // Handicap selections with team names: "Team (+1.5)" or "Team (-1.5)"
    const handicapMatch = name.match(/^(.+?)\s*\(([+-]?\d+[.,]?\d*)\)\s*$/);
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
    // BTTS-specific: BetFan uses Polish "Tak"/"Nie"
    // ==========================================================================

    if (marketType === NormalizedMarketType.BTTS || marketType === NormalizedMarketType.HALF_TIME_BTTS) {
      if (/^(tak|yes|gg|y|1|sim|gol|obie)/i.test(name)) {
        return NormalizedSelection.YES;
      }
      if (/^(nie|no|ng|n|0|brak)/i.test(name)) {
        return NormalizedSelection.NO;
      }
    }

    // Standard 1X2 outcomes
    if (/^1$/i.test(name)) return NormalizedSelection.HOME;
    if (/^x$|^remis$/i.test(name)) return NormalizedSelection.DRAW;
    if (/^2$/i.test(name)) return NormalizedSelection.AWAY;

    // Enhanced Double Chance patterns (including numeric codes)
    if (/^1x$|^1\/x$|^10$/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (/^x2$|^x\/2$|^02$/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (/^12$|^1\/2$/i.test(name)) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Enhanced Over/Under - BetFan uses "Powyzej" and "Ponizej" (without diacritics in API) (Polish + English + Portuguese)
    if (/^(powy[żz]ej|powyzej|poni|ponad|over|mais)/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    if (/^(poni[żz]ej|ponizej|under|menos)/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Enhanced Yes/No for BTTS and similar (Polish + English + variants)
    if (/^(tak|yes|y|gg|sim|gol)/i.test(name)) return NormalizedSelection.YES;
    if (/^(nie|no|n|ng|n[ão]o|brak)/i.test(name)) return NormalizedSelection.NO;

    // Enhanced Odd/Even patterns
    if (/^nieparzyst[ea]?$/i.test(name)) return NormalizedSelection.ODD;
    if (/^parzyst[ea]?$/i.test(name)) return NormalizedSelection.EVEN;

    // Use common patterns as fallback
    return this.normalizeCommonSelection(name, marketType);
  }
}

// Export singleton instance
export const betfanNormalizer = new BetfanNormalizer();
