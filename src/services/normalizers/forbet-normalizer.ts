/**
 * Forbet Market Normalizer
 *
 * Handles market normalization specific to Forbet betting platform.
 * Uses Polish language patterns with distinctive formatting:
 * - Half periods: "1. polowa", "2. polowa"
 * - BTTS: "obie druzyny strzela gola"
 * - Total goals: "ponizej/powyzej X.5 goli"
 * - Draw No Bet: "remis nie ma zakladu"
 * - Handicap: "handicap X:Y"
 *
 * Coverage target: >=90%
 */

import {
  NormalizedMarketType,
  NormalizedSelection,
  NormalizedMarketGroup,
} from "../../types/normalization.js";
import { BaseNormalizer, type MarketPattern } from "./base-normalizer.js";

export class ForbetNormalizer extends BaseNormalizer {
  readonly bookmaker = "forbet";

  /**
   * Bookmaker-specific market patterns
   * Priority: matched in order, more specific patterns first
   */
  protected readonly patterns: MarketPattern[] = [
    // ========================================================================
    // HALF-TIME MARKETS (must be matched before full-time variants)
    // ========================================================================

    // Half-time BTTS
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*obie.*strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // Half-time Total Goals with parameter
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*poni(ż|z)ej.*powy(ż|z)ej.*(\d+[.,]?\d*).*gol/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[2]?.replace(",", "."),
    },
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*gol.*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[2]?.replace(",", "."),
    },
    // "1. polowa - liczba goli" without explicit line
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe]\s*-\s*liczba\s*gol/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },

    // Half-time Result (1X2)
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*1x2/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe]\s*-\s*1x2$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // Half-time Double Chance
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*podw(o|ó)jn.*szans/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time Draw No Bet
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*remis.*nie.*ma.*zak(l|ł)ad/i,
      type: NormalizedMarketType.DRAW_NO_BET,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time Correct Score
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*dok(l|ł)adn.*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
      group: NormalizedMarketGroup.HALF_TIME,
    },
    // "1. polowa dokladny wynik / dokladny wynik koncowy"
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe]\s*dok(l|ł)adn.*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time Odd/Even
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*liczba.*gol.*nieparzysta.*parzysta/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
      group: NormalizedMarketGroup.HALF_TIME,
    },
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*nieparzysta.*parzysta/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time Handicap with parameter
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*handicap\s*(\d+:\d+)/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
      extractParam: (m) => m[2],
    },
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*handicap\s*([+-]?\d+[.,]?\d*)/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
      extractParam: (m) => m[2]?.replace(",", "."),
    },
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*handicap$/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time Clean Sheet (team-specific)
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*czyst.*konto/i,
      type: NormalizedMarketType.CLEAN_SHEET,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // ========================================================================
    // BTTS MARKETS (Both Teams To Score)
    // ========================================================================

    // BTTS with various Polish phrasings
    {
      pattern: /obie.*dru(ż|z)yny.*strzel.*gola?/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /czy.*obie.*dru(ż|z)yny.*strzel/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /^btts$/i,
      type: NormalizedMarketType.BTTS,
    },
    // "1X2 i obie druzyny strzela"
    {
      pattern: /1x2.*i.*obie.*strzel/i,
      type: NormalizedMarketType.BTTS,
    },
    // "1./2.Polowa - Obie druzyny strzela gola"
    {
      pattern: /1\..*2\.\s*po(l|ł)ow.*obie.*strzel/i,
      type: NormalizedMarketType.BTTS,
    },

    // ========================================================================
    // TOTAL GOALS MARKETS
    // ========================================================================

    // "ponizej/powyzej X.5 goli" format
    {
      pattern: /poni(ż|z)ej.*powy(ż|z)ej.*(\d+[.,]?\d*).*gol/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    {
      pattern: /powy(ż|z)ej.*poni(ż|z)ej.*(\d+[.,]?\d*).*gol/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    // "1X2 i ponizej/powyzej X.5 goli"
    {
      pattern: /1x2.*i.*poni(ż|z)ej.*powy(ż|z)ej.*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    // "Liczba goli" without specific line (exact goals)
    {
      pattern: /^liczba\s*gol[ióiw]?$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    // Team-specific total goals
    {
      pattern: /poni(ż|z)ej.*powy(ż|z)ej.*(\d+[.,]?\d*)\s*gol/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    // "Team - liczba goli"
    {
      pattern: /- liczba\s*gol/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    // "Team ponizej/powyzej X.5 goli"
    {
      pattern: /poni(ż|z)ej.*powy(ż|z)ej.*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    // "multi-gole"
    {
      pattern: /multi.*gol/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    // Gole with numbers
    {
      pattern: /gol[ieaó]?\s*.*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ========================================================================
    // HANDICAP MARKETS
    // ========================================================================

    // European Handicap with score format (e.g., "handicap 0:1")
    {
      pattern: /handicap\s*(\d+:\d+)/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => m[1],
    },
    // Asian Handicap with decimal line
    {
      pattern: /handicap\s*([+-]?\d+[.,]?\d*)/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    // Generic Handicap
    {
      pattern: /^handicap$/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
    },
    // Corners handicap (still track as handicap)
    {
      pattern: /rzuty\s*ro(ż|z)ne\s*handicap\s*([+-]?\d+[.,]?\d*)/i,
      type: NormalizedMarketType.OTHER, // Corners handicap - not standard
    },

    // ========================================================================
    // DOUBLE CHANCE MARKETS
    // ========================================================================

    {
      pattern: /podw(o|ó)jn.*szans/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },
    {
      pattern: /double.*chance/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // ========================================================================
    // DRAW NO BET MARKETS
    // ========================================================================

    {
      pattern: /remis.*nie.*ma.*zak(l|ł)ad/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },
    {
      pattern: /remis.*zwrot/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },
    {
      pattern: /draw.*no.*bet/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },
    {
      pattern: /^dnb$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // ========================================================================
    // MATCH WINNER / 1X2 MARKETS
    // ========================================================================

    {
      pattern: /^1x2$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /wynik.*mecz/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /wynik.*ko[nń]cow/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /ko[nń]cowy.*wynik/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /rezultat.*mecz/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    // "Ktorakolwiek z druzyn wygra mecz" - home or away wins
    {
      pattern: /kt(o|ó)rakolwiek.*dru(ż|z)yn.*wygra/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    // "Team wygra mecz"
    {
      pattern: /wygra\s*mecz/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    // "1x2 - do przerwy lub koncowy"
    {
      pattern: /1x2.*do.*przerw.*lub.*ko[nń]cow/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    // "1. polowa/mecz" - half-time/full-time
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow[aąe].*mecz$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // ========================================================================
    // TIME-SPECIFIC AND COMBO MARKETS
    // ========================================================================

    // "10 minut - 1X2 od 1 do 10" type markets
    {
      pattern: /^\d+\s*minut.*1x2.*od\s*\d+\s*do\s*\d+/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^\d+\s*min.*1x2/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // "multi-wyniki" - multi score/correct score variants
    {
      pattern: /multi.?wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // "Wydarzy się min. jedno z: remis w meczu lub powyżej/poniżej 2.5 goli"
    {
      pattern: /wydarzy\s*si(ę|e)\s*min\s*jedno\s*z.*remis.*lub/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // "Połowa z większą liczbą goli" / "Połowa z wieksza liczba bramek"
    {
      pattern: /po(l|ł)ow.*z\s*wi(ę|e)ksz[ąa].*liczb.*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /po(l|ł)ow.*z\s*wi(ę|e)ksz[ąa].*liczb.*bram/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // "Różnica zwycięstwa" / "Rozmiar zwycięstwa"
    {
      pattern: /r(o|ó)(ż|z)nica\s*zwyci(ę|e)stwa/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /margines\s*zwyci(ę|e)stwa/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // "Obie połowy powyżej/poniżej 1.5 goli"
    {
      pattern: /obie\s*po(l|ł)ow.*powy[żej]+\s*([\d,\.]+)/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /obie\s*po(l|ł)ow.*poni[żej]+\s*([\d,\.]+)/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // "1. połowa - 1. gol" / "2. Połowa - 1. gol"
    {
      pattern: /^(1|2)\.\s*po(l|ł)ow.*1\.\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // "Która drużyna zdobędzie gola" / "Ktory zespol zdobędzie gola"
    {
      pattern: /kt(o|ó)ra\s*dru(ż|z)yna\s*zdob[yędzie]+\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // "Zdobędzie gola w meczu" - team to score yes/no
    {
      pattern: /zdob[yędzie]+\s*gol[a]?\s*w\s*mecz/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // "Więcej rzutów rożnych"
    {
      pattern: /wi(ę|e)cej\s*rzut(o|ó)w\s*ro(ż|z)nych/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Corners markets
    {
      pattern: /rzut[yó]?.*ro(ż|z)n/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Cards markets
    {
      pattern: /kartk/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ========================================================================
    // CORRECT SCORE MARKETS
    // ========================================================================

    {
      pattern: /dok(l|ł)adn.*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },
    {
      pattern: /correct.*score/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ========================================================================
    // ODD/EVEN GOALS MARKETS
    // ========================================================================

    {
      pattern: /liczba.*gol.*nieparzysta.*parzysta/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },
    {
      pattern: /nieparzysta.*parzysta/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },
    {
      pattern: /odd.*even/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },

    // ========================================================================
    // WIN TO NIL / CLEAN SHEET MARKETS
    // ========================================================================

    // Win to nil
    {
      pattern: /wygra.*do.*zera/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },
    {
      pattern: /win.*nil/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },

    // Clean sheet
    {
      pattern: /czyst.*konto/i,
      type: NormalizedMarketType.CLEAN_SHEET,
    },
    {
      pattern: /clean.*sheet/i,
      type: NormalizedMarketType.CLEAN_SHEET,
    },

    // ========================================================================
    // TEAM-SPECIFIC GOAL MARKETS
    // ========================================================================

    // "Team strzeli gola" - team to score
    {
      pattern: /- strzeli.*gol[a]?$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    {
      pattern: /strzeli.*gola?.*obu.*po(l|ł)ow/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    // "Team wygra obie polowy"
    {
      pattern: /wygra.*obie.*po(l|ł)ow/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    // "Team wygra przynajmniej jedna polowe"
    {
      pattern: /wygra.*przynajmniej.*jedn.*po(l|ł)ow/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    // "Team otrzyma czerwona kartke"
    {
      pattern: /otrzyma.*czerwon.*kartk/i,
      type: NormalizedMarketType.OTHER,
    },

    // ========================================================================
    // OTHER SPECIFIC MARKETS
    // ========================================================================

    // "1. gol" / "Ostatni gol"
    {
      pattern: /^1\.\s*gol$/i,
      type: NormalizedMarketType.OTHER,
    },
    {
      pattern: /ostatni.*gol/i,
      type: NormalizedMarketType.OTHER,
    },
    // "polowa z wieksza liczba goli"
    {
      pattern: /po(l|ł)ow.*wi(ę|e)ksz.*liczb.*gol/i,
      type: NormalizedMarketType.OTHER,
    },
    // Corners markets
    {
      pattern: /rzut.*ro(ż|z)n/i,
      type: NormalizedMarketType.OTHER,
    },
    // Cards markets
    {
      pattern: /kartk/i,
      type: NormalizedMarketType.OTHER,
    },
  ];

  /**
   * Selection normalization patterns specific to Forbet
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

    // Forbet-specific selection patterns

    // Over selections with Polish variants
    if (/^powy(ż|z)ej\s*\d/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    if (/^ponad\s*\d/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    // Under selections with Polish variants
    if (/^poni(ż|z)ej\s*\d/i.test(name)) {
      return NormalizedSelection.UNDER;
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

    // "Brak gola" - no goal (for first/last goal markets)
    if (/brak\s*gol/i.test(name)) {
      return NormalizedSelection.NO;
    }

    return NormalizedSelection.UNKNOWN;
  }
}

// Export singleton instance
export const forbetNormalizer = new ForbetNormalizer();
