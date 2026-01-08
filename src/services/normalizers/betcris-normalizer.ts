/**
 * Betcris Market Normalizer
 *
 * Handles market normalization specific to Betcris betting platform.
 * Betcris uses a Swarm WebSocket API with Polish market names.
 *
 * Key patterns identified:
 * - "Wynik meczu" -> MATCH_WINNER
 * - "Podwojna szansa" -> DOUBLE_CHANCE
 * - "Remis = zwrot" -> DRAW_NO_BET
 * - "Obie druzyny strzela" -> BTTS
 * - "Liczba goli X.X" -> TOTAL_GOALS (with param)
 * - "Handicap azjatycki X.X" -> ASIAN_HANDICAP (with param)
 * - "Handicap europejski X.X" -> EUROPEAN_HANDICAP (with param)
 * - "Wynik 1. polowy" -> HALF_TIME_RESULT
 * - "Gole 1. polowa X.X" -> HALF_TIME_TOTAL_GOALS (with param)
 * - "1. polowa. Obie strzela" / "Obie strzela 1. polowa" -> HALF_TIME_BTTS
 * - "Dokladny wynik" -> CORRECT_SCORE
 *
 * Special patterns:
 * - "1. polowa. Handicap azjatycki" -> ASIAN_HANDICAP (half-time group)
 * - "1. polowa. Azjatycka suma goli X.X" -> HALF_TIME_TOTAL_GOALS
 * - "Team 1/2. Liczba rzutow roznych" -> OTHER (corners)
 * - "Zawodnik.*" -> OTHER (player props)
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

export class BetcrisNormalizer extends BaseNormalizer {
  readonly bookmaker = "betcris";

  /**
   * Betcris-specific market patterns
   * Priority: matched in order, more specific patterns first
   */
  protected readonly patterns: MarketPattern[] = [
    // ==========================================================================
    // PLAYER MARKETS - Check first as they are very specific and should be OTHER
    // ==========================================================================

    // Player shots
    {
      pattern: /zawodnik\.\s*liczba\s*strza[lł][oó]w/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player tackles
    {
      pattern: /zawodnik\.\s*liczba\s*odbior[oó]w/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player fouls
    {
      pattern: /zawodnik\.\s*liczba\s*pope[lł]nionych\s*fauli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Any player market
    {
      pattern: /^zawodnik\./i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // HALF-TIME MARKETS (1. polowa) - Check before full match markets
    // ==========================================================================

    // 1st half Asian handicap
    {
      pattern: /^1\.\s*po[lł]owa\.\s*handicap\s*azjatycki\s*([\-\+]?[\d,\.]+)?/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // 1st half European handicap (3-way)
    {
      pattern: /^1\.\s*po[lł]owa\.\s*handicap\s*([\-\+]?[\d,\.]+)?/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // 1st half Asian total goals
    {
      pattern: /^1\.\s*po[lł]owa\.\s*azjatycka\s*suma\s*goli\s*([\d,\.]+)?/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // 1st half total goals with line
    {
      pattern: /^1\.\s*po[lł]owa\.\s*liczba\s*goli\s*([\d,\.]+)?/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // 1st half corners
    {
      pattern: /^1\.\s*po[lł]owa\.\s*liczba\s*rzut[oó]w\s*ro[żz]nych/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 1st half result
    {
      pattern: /^wynik\s*1\.\s*po[lł]owy$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^1\.\s*po[lł]owa\.\s*1x2$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^1\.\s*po[lł]owa\.\s*wynik$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // 1st half BTTS
    {
      pattern: /^1\.\s*po[lł]owa\.\s*obie\s*(dru[żz]yny\s*)?strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },
    {
      pattern: /^obie\s*(dru[żz]yny\s*)?strzel.*1\.\s*po[lł]ow/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // Catch-all for 1st half markets not already matched
    {
      pattern: /^1\.\s*po[lł]owa\./i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // ==========================================================================
    // SECOND HALF MARKETS (2. polowa) - All go to OTHER
    // ==========================================================================

    // 2nd half total goals
    {
      pattern: /^2\.\s*po[lł]owa\.\s*liczba\s*goli\s*([\d,\.]+)?/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 2nd half handicap
    {
      pattern: /^2\.\s*po[lł]owa\.\s*handicap/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Catch-all for 2nd half markets
    {
      pattern: /^2\.\s*po[lł]owa\./i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // HALF-TIME/FULL-TIME COMBO
    // ==========================================================================

    {
      pattern: /^1\.\s*po[lł]owa\s*\/\s*ca[lł]y\s*mecz/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // CORNERS MARKETS
    // ==========================================================================

    // Team corners
    {
      pattern: /^team\s*[12]\.\s*liczba\s*rzut[oó]w\s*ro[żz]nych/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Total corners
    {
      pattern: /^liczba\s*rzut[oó]w\s*ro[żz]nych/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Corners handicap
    {
      pattern: /^rzuty?\s*ro[żz]n.*handicap/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Corners 3-way
    {
      pattern: /^rzuty?\s*ro[żz]n.*\(3-drogowo\)/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
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
      pattern: /^wynik$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Double chance
    {
      pattern: /^podw[oó]jn?a\s*szansa$/i,
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

    // Asian total goals (main market) - with optional text after line
    {
      pattern: /^azjatycka\s*suma\s*goli\s*([\d,\.]+)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Total goals with line in name - with optional text after line
    {
      pattern: /^liczba\s*goli\s*([\d,\.]+)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // "Liczba goli 3-drogowo" - 3-way total goals (exact number, not Over/Under)
    {
      pattern: /^liczba\s*goli\s*3-drogow/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Generic "Liczba goli" without line (goes to OTHER as exact number)
    {
      pattern: /^liczba\s*goli$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // "2. polowa. Liczba goli"
    {
      pattern: /^2\.\s*po[lł]owa\.\s*liczba\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // "1. polowa liczba goli"
    {
      pattern: /^1\.\s*polowa\s+liczba\s+goli/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },
    {
      pattern: /^1\.\s*po[lł]owa\.\s*liczba\s*goli/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
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

    // Generic "Handicap" - Betcris uses this for European handicap (3-way)
    {
      pattern: /^handicap$/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
    },

    // Handicap with line value (e.g., "Handicap -1")
    {
      pattern: /^handicap\s*([\-\+]?[\d,\.]+)$/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
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
      pattern: /wygra.*do\s*zera$/i,
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
    // TEAM-SPECIFIC TOTAL GOALS
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
    {
      pattern: /^team\s*[12]\.\s*suma\s*goli\s*([\d,\.]+)?$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    {
      pattern: /^team\s*[12]\.\s*liczba\s*goli\s*([\d,\.]+)?$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // "2. połowa. Team 1/2. Liczba goli"
    {
      pattern: /^2\.\s*po[lł]owa\.\s*team\s*[12]\.\s*liczba\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // "1. polowa/calny mecz i liczba goli" - half/full-time + goals combo
    {
      pattern: /^1\.\s*polowa\s*[\/\.]\s*ca[lł]y\s*mecz\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // "Liczba goli 3-drogowo" - 3-way total goals
    {
      pattern: /^liczba\s*goli\s*3-drogow/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // "Team 1. Azjatycka suma goli"
    {
      pattern: /^team\s*[12]\.\s*azjatycka\s*suma\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // "2. polowa. Handicap"
    {
      pattern: /^2\.\s*po[lł]owa\.\s*handicap/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // OTHER SPECIAL MARKETS
    // ==========================================================================

    // Half-time / Full-time result combo
    {
      pattern: /^wynik\s*po[lł]owa\s*\/?\s*mecz$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Win margin
    {
      pattern: /^margines\s*zwyci[ęe]stwa$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // First goal / Last goal
    {
      pattern: /^pierwsz[yae]\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^ostatni[ae]?\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Common patterns fallback
    ...COMBINATION_MARKET_PATTERNS,
    ...STATISTICS_MARKET_PATTERNS,
    ...PLAYER_MARKET_PATTERNS,
  ];

  /**
   * Normalize selection names for Betcris
   * Betcris uses Polish names and team names in selections
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
    // BETCRIS-SPECIFIC: Handle handicap and coded selections
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
    // BTTS-specific: Betcris uses Polish "Tak"/"Nie"
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

    // Enhanced Double Chance - Betcris specific formats (including numeric codes)
    if (/^1x$|^1\/x$|^w1\s*lub\s*x|^10$/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (/^x2$|^x\/2$|^x\s*lub\s*w2|^02$/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (/^12$|^1\/2$|^w1\s*lub\s*w2$/i.test(name)) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Enhanced Over/Under - Betcris uses "Powyzej" and "Ponizej" (Polish + English + Portuguese)
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
export const betcrisNormalizer = new BetcrisNormalizer();
