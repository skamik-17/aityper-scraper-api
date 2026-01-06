/**
 * Totalbet Market Normalizer
 *
 * Handles market normalization specific to Totalbet betting platform.
 * Uses Polish language patterns with distinctive formatting:
 * - Half periods: "1. Polowa", "2. Polowa"
 * - BTTS: "Obie druzyny strzela gola", "obie ekipy strzela"
 * - Total goals: "Total (suma)", various line formats
 * - Draw No Bet: "Remis - nie ma zakladu"
 *
 * Coverage target: >=90%
 */

import {
  NormalizedMarketType,
  NormalizedSelection,
  NormalizedMarketGroup,
} from "../../types/normalization.js";
import { BaseNormalizer, type MarketPattern } from "./base-normalizer.js";

export class TotalbetNormalizer extends BaseNormalizer {
  readonly bookmaker = "totalbet";

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
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*obie.*strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*btts/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // Half-time Total Goals with parameter
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*total.*suma.*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[2]?.replace(",", "."),
    },
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*poni[żz]ej.*powy[żz]ej.*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[2]?.replace(",", "."),
    },
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*gol.*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[2]?.replace(",", "."),
    },
    // Generic half-time total (suma) without explicit line - use as total goals
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]\s*[-–—]\s*total.*suma/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },

    // Half-time Result (1X2)
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*1x2/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]\s*[-–—]\s*wynik/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // Half-time Double Chance
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*podw[oó]jn.*szans/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time Draw No Bet
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*remis.*nie.*zak[lł]ad/i,
      type: NormalizedMarketType.DRAW_NO_BET,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time Correct Score
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*dok[lł]adn.*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time Odd/Even
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*parzysta.*nieparzysta/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
      group: NormalizedMarketGroup.HALF_TIME,
    },
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*suma.*goli.*parzysta/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time Handicap with parameter
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*handicap\s*(\d+:\d+)/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
      extractParam: (m) => m[2],
    },
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*handicap/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time Clean Sheet (team-specific)
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe].*czyst.*konto/i,
      type: NormalizedMarketType.CLEAN_SHEET,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // ========================================================================
    // BTTS MARKETS (Both Teams To Score)
    // ========================================================================

    // BTTS with various Polish phrasings
    {
      pattern: /obie.*dru[żz]yny.*strzel.*gola?/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /obie.*ekipy.*strzel/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /obie.*strzel/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /^btts$/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /1\..*2\.\s*po[lł]ow.*obie.*strzel/i,
      type: NormalizedMarketType.BTTS,
    },

    // ========================================================================
    // TOTAL GOALS MARKETS
    // ========================================================================

    // Total (suma) with explicit line
    {
      pattern: /total.*suma.*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    // Team total with line (e.g., "Arsenal - Total (suma)" or "Arsenal Total (suma)")
    {
      pattern: /total\s*\(suma\)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    // Ponad/ponizej (over/under) with line
    {
      pattern: /poni[żz]ej.*powy[żz]ej.*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    {
      pattern: /powy[żz]ej.*poni[żz]ej.*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    // "lub ponad X.5" / "lub ponizej X.5"
    {
      pattern: /lub\s*pon(ad|i[żz]ej)\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[2]?.replace(",", "."),
    },
    // Gole/bramki with line
    {
      pattern: /gol[ieaó]?\s*.*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    {
      pattern: /bramk[ia].*(\d+[.,]?\d*)/i,
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
    // European Handicap with score format (e.g., "handicap 1:0", "handicap 0:1")
    {
      pattern: /handicap\s*[-–]?\s*(\d+:\d+)/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => m[1],
    },
    {
      pattern: /handicap\s*(\d+:\d+)/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => m[1],
    },
    // Generic Handicap (without specific line - treat as Asian)
    {
      pattern: /^handicap$/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
    },
    // Asian Handicap with decimal line
    {
      pattern: /handicap.*azjat.*([+-]?\d+[.,]?\d*)/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    // European Handicap with decimal line
    {
      pattern: /handicap.*europ.*([+-]?\d+[.,]?\d*)/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ========================================================================
    // DOUBLE CHANCE MARKETS
    // ========================================================================

    {
      pattern: /podw[oó]jn.*szans/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },
    {
      pattern: /double.*chance/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },
    {
      pattern: /dwie.*szans/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // ========================================================================
    // DRAW NO BET MARKETS
    // ========================================================================

    {
      pattern: /remis.*nie.*ma.*zak[lł]ad/i,
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
      pattern: /ko[nń]cowy.*wynik/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /rezultat.*mecz/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /zwyci[ęe][żz]ca.*mecz/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    // "Team wygra" patterns
    {
      pattern: /wygra\s*$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    // "1X2 + Total" combo - still 1X2 base
    {
      pattern: /^1x2\s*\+\s*total/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    // "1X2 + Obie strzela" combo
    {
      pattern: /^1x2\s*\+\s*obie/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // ========================================================================
    // CORRECT SCORE MARKETS
    // ========================================================================

    {
      pattern: /dok[lł]adn.*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },
    {
      pattern: /correct.*score/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },
    {
      pattern: /dok[lł]adn.*liczba.*gol/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },
    // "Liczba goli w meczu (przedzialy)" - exact goals range
    {
      pattern: /liczba.*gol.*przedzia[lł]/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ========================================================================
    // ODD/EVEN GOALS MARKETS
    // ========================================================================

    {
      pattern: /parzysta.*nieparzysta/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },
    {
      pattern: /nieparzysta.*parzysta/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },
    {
      pattern: /suma.*goli.*parzysta/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },
    {
      pattern: /odd.*even/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },

    // ========================================================================
    // WIN TO NIL / CLEAN SHEET MARKETS
    // ========================================================================

    // Win to nil - team wins without conceding
    {
      pattern: /wygra.*do.*zera/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },
    {
      pattern: /win.*nil/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },
    {
      pattern: /wygra.*zer/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },

    // Clean sheet - team doesn't concede
    {
      pattern: /czyst.*konto/i,
      type: NormalizedMarketType.CLEAN_SHEET,
    },
    {
      pattern: /clean.*sheet/i,
      type: NormalizedMarketType.CLEAN_SHEET,
    },
    // "ktorykolwiek czyste konto"
    {
      pattern: /kt[oó]rykolwiek.*czyst/i,
      type: NormalizedMarketType.CLEAN_SHEET,
    },

    // ========================================================================
    // TEAM-SPECIFIC GOAL MARKETS (still categorizable)
    // ========================================================================

    // "Team strzeli gola" - team to score
    {
      pattern: /strzeli.*gol[a]?\s*$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    {
      pattern: /strzeli.*gola?.*obu.*po[lł]ow/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    // Team goals over/under
    {
      pattern: /- dok[lł]adn.*liczba.*gol/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // ========================================================================
    // COMBO/SPECIAL MARKETS (categorize by primary component)
    // ========================================================================

    // "1. gol" - first goal scorer
    {
      pattern: /^1\.\s*gol$/i,
      type: NormalizedMarketType.OTHER,
    },
    // "1. gol + 1X2" combo
    {
      pattern: /1\.\s*gol\s*\+\s*1x2/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    // "polowa z wieksza liczba goli" - which half more goals
    {
      pattern: /po[lł]ow.*wi[ęe]ksz.*liczb.*gol/i,
      type: NormalizedMarketType.OTHER,
    },
    // "wygra obie polowy" - win both halves
    {
      pattern: /wygra.*obie.*po[lł]ow/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    // "wygra przynajmniej jedna polowe"
    {
      pattern: /wygra.*przynajmniej.*jedn.*po[lł]ow/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // ========================================================================
    // TIME-SPECIFIC MARKETS
    // ========================================================================

    // "10 minut - 1X2 od 00:00 do 09:59" type markets
    {
      pattern: /^\d+\s*minut.*1x2/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^\d+\s*min.*1x2/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    // "10 minut - 1X2 od 1 do 10"
    {
      pattern: /^\d+\s*minut.*od\s*\d+\s*do\s*\d+/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // "1. polowa - 1. gol" / "2. Polowa - 1. gol"
    {
      pattern: /^(1|2)\.\s*po[lł]ow.*1\.\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // "ktory zespol zdobędzie gola" / "which team will score"
    {
      pattern: /kt[oó]ry\s*zesp[oó][łl]\s*zdob[yędzie]+\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // "obie połowy ponad 1.5" / "obie połowy poniżej 1.5"
    {
      pattern: /obie\s*po[lł]ow.*pon[iżej]+\s*([\d,\.]+)/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /obie\s*po[lł]ow.*powy[żej]+\s*([\d,\.]+)/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // "1. polowa/wynik końcowy" combo markets
    {
      pattern: /^1\.\s*po[lł]owa\s*[\/-]\s*wynik\s*ko[nń]cow/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // "rozmiar zwycięstwa" / "różnica zwycięstwa"
    {
      pattern: /rozmiar\s*zwyci[ęe]stwa/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /r[oó][żz]nica\s*zwyci[ęe]stwa/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Cards markets
    {
      pattern: /suma\s*kartek/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /kartk[ięę]/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    // Player cards
    {
      pattern: /otrzyma\s*kartk[ęe]/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Corners markets
    {
      pattern: /rzut[yó]?[\s-]*ro[żz]n/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
  ];

  /**
   * Selection normalization patterns specific to Totalbet
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

    // Totalbet-specific selection patterns

    // Over selections (with line numbers)
    if (/^(ponad|powy[żz]ej|over)\s*\d/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    // Under selections (with line numbers)
    if (/^(poni[żz]ej|under)\s*\d/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Yes/No for BTTS and similar markets
    if (/^(tak|yes|gg)$/i.test(name)) {
      return NormalizedSelection.YES;
    }
    if (/^(nie|no|ng)$/i.test(name)) {
      return NormalizedSelection.NO;
    }

    // Odd/Even
    if (/nieparzyste?/i.test(name)) {
      return NormalizedSelection.ODD;
    }
    if (/parzyste?/i.test(name)) {
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
      // Extract team part before the handicap
      const teamPart = name.replace(/\s*\([+-]?\d+[.,]?\d*\)\s*$/, "").trim();
      if (homeTeam && this.matchesTeam(teamPart, homeTeam)) {
        return NormalizedSelection.HOME;
      }
      if (awayTeam && this.matchesTeam(teamPart, awayTeam)) {
        return NormalizedSelection.AWAY;
      }
    }

    return NormalizedSelection.UNKNOWN;
  }
}

// Export singleton instance
export const totalbetNormalizer = new TotalbetNormalizer();
