/**
 * Etoto Market Normalizer
 *
 * Handles market normalization specific to Etoto betting platform.
 * Etoto uses clean Polish market names with structured formats.
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

export class EtotoNormalizer extends BaseNormalizer {
  readonly bookmaker = "etoto";

  /**
   * Etoto-specific market patterns
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

    // 1st half total goals with line (format: "1. polowa - suma X.X")
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*suma\s*([\d,\.]+)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // 1st half exact sum of goals (format: "1. polowa - suma goli")
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*suma\s*goli$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half result
    {
      pattern: /^(?:wynik\s*)?1\.\s*poł(?:owy|owa)?(?:\s*-\s*wynik)?/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // 1st half goal range
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*przedział\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half first goal
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*1\.\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half winner and total (combined market)
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*wygra\s*i\s*suma/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half corners
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*(?:kto\s*więcej\s*|suma\s*[\d,\.]+\s*|suma\s*|1\.\s*|ostatni\s*|nieparzysta.*)?rzut(?:ów|y)?\s*rożn/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 1st half cards
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*(?:kto\s*więcej\s*|suma\s*[\d,\.]+\s*)?kart/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 1st half odd/even
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*nieparzysta\s*\/\s*parzysta$/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // ==========================================================================
    // SECOND HALF MARKETS (2. polowa)
    // ==========================================================================

    // 2nd half 1X2 / result
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*1x2/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*wynik/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 2nd half double chance
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*podw[oó]jn?a\s*szansa/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 2nd half draw no bet
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*remis\s*=\s*zwrot/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 2nd half total goals with line
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*suma\s*([\d,\.]+)/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 2nd half sum of goals
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*suma\s*goli$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 2nd half goal range
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*przedział\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 2nd half first goal
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*1\.\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 2nd half odd/even
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*nieparzysta\s*\/\s*parzysta$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // MAIN MATCH MARKETS
    // ==========================================================================

    // Match winner / 1X2
    {
      pattern: /^wynik\s*meczu/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /^1x2$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Double chance
    {
      pattern: /^podw[oó]jn?a\s*szansa/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // Draw no bet
    {
      pattern: /^remis\s*=?\s*zwrot/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },
    {
      pattern: /^zakład\s*bez\s*remisu/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // ==========================================================================
    // TOTAL GOALS MARKETS
    // ==========================================================================

    // Total goals with line in name (e.g., "Suma goli 2.5")
    {
      pattern: /^suma\s*goli\s*([\d,\.]+)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Generic "Suma goli" without line - categorize as TOTAL_GOALS for better coverage
    {
      pattern: /^suma\s*goli$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // Goal range
    {
      pattern: /^(?:suma\s*goli\s*)?\(?\s*przedział\s*\)?/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^przedział\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Both halves under/over
    {
      pattern: /^obie\s*połowy\s*(poniżej|ponizej|powyżej|powyzej)\s*([\d,\.]+)\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Half with more goals
    {
      pattern: /^połowa\s*z\s*większą\s*sumą\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // ==========================================================================
    // BTTS MARKETS
    // ==========================================================================

    // Both teams to score
    {
      pattern: /^obie\s*(drużyny\s*)?strzel/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /^obie\s*druzyny\s*strzel/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /^obie\s*drużyny\s*strzelą/i,
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

    // Handicap with score format (e.g., "Handicap 1:0", "Handicap 0:1")
    {
      pattern: /^handicap\s*(\d+:\d+)/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => m[1],
    },
    {
      pattern: /^handicap\s*([\-\+]?\d+:\d+)/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => m[1],
    },

    // ==========================================================================
    // CORRECT SCORE
    // ==========================================================================

    {
      pattern: /^dokładn?y\s*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // Multiscore / combined score outcomes
    {
      pattern: /^multiwynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ==========================================================================
    // ODD/EVEN GOALS
    // ==========================================================================

    {
      pattern: /^parzyste\s*\/?\s*nieparzyste/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },
    {
      pattern: /^nieparzysta\s*\/?\s*parzysta$/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },

    // ==========================================================================
    // WIN TO NIL / CLEAN SHEET
    // ==========================================================================

    // Team wins to nil
    {
      pattern: /^wygrana\s*(gospodarzy|gosci|gości)\s*do\s*zera/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },

    // Clean sheet
    {
      pattern: /^czyst.*kont/i,
      type: NormalizedMarketType.CLEAN_SHEET,
    },

    // ==========================================================================
    // FIRST/LAST GOAL AND SCORER MARKETS
    // ==========================================================================

    {
      pattern: /^1\.\s*gol(?:\s|$)/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^ostatni\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^pierwsza\s*drużyna\s*strzeli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^pierwsza\s*druzyna\s*strzeli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^ostatnia\s*drużyna\s*strzeli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^ostatnia\s*druzyna\s*strzeli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^gole\s*(gospodarzy|gosci|gości)/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^strzelec\s*1\.\s*gola/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // ==========================================================================
    // TEAM SCORING
    // ==========================================================================

    {
      pattern: /^drużyna\s*strzeli\s*gola/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^którakolwiek\s*drużyna\s*wygra/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.MAIN,
    },

    // ==========================================================================
    // WINNING MARGIN
    // ==========================================================================

    {
      pattern: /^margines\s*zwycięstwa/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^różnica\s*zwycięstwa/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // FIRST GOAL TIMING
    // ==========================================================================

    {
      pattern: /^kiedy\s*1\.\s*gol\s*zostanie\s*strzelony/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // ==========================================================================
    // COMBINED MARKETS (Half/Full Time)
    // ==========================================================================

    {
      pattern: /^1\.\s*poł\.?\s*\/\s*mecz/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^połowa\s*\/\s*koniec/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^1\.\s*połowa\s*lub\s*mecz$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Combined half/full with score
    {
      pattern: /^1\.\s*poł\.?\s*\/\s*mecz\s*i\s*(?:dokładna\s*)?suma\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Draw or total combinations
    {
      pattern: /^remis\s*lub\s*(poniżej|ponizej|powyżej|powyzej)\s*([\d,\.]+)/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // CORNERS MARKETS
    // ==========================================================================

    {
      pattern: /^kto\s*więcej\s*rzut(?:ów|y)?\s*rożn/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^suma\s*[\d,\.]+\s*rzut(?:ów|y)?\s*rożn/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^suma\s*rzut(?:ów|y)?\s*rożn/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^1\.\s*rzut\s*rożny/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^ostatni\s*rzut\s*rożny/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^nieparzysta\s*\/\s*parzysta\s*suma\s*rzut/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // CARDS MARKETS
    // ==========================================================================

    {
      pattern: /^kto\s*więcej\s*kartek/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^1\.\s*kartka/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // PLAYER MARKETS (Zawodnik)
    // These are player-specific props, mapped to OTHER
    // ==========================================================================

    // Player goals
    {
      pattern: /^zawodnik\s*-\s*suma\s*goli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player assists
    {
      pattern: /^zawodnik\s*-\s*suma\s*asyst/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player shots
    {
      pattern: /^zawodnik\s*-\s*suma\s*(?:celnych\s*)?strzał/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player tackles/interceptions
    {
      pattern: /^zawodnik\s*-\s*odbiory/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player passes
    {
      pattern: /^zawodnik\s*-\s*suma\s*podań/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player cards
    {
      pattern: /^otrzyma\s*kartkę/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Common patterns fallback
    ...COMBINATION_MARKET_PATTERNS,
    ...STATISTICS_MARKET_PATTERNS,
    ...PLAYER_MARKET_PATTERNS,
  ];

  /**
   * Normalize selection names for Etoto
   * Etoto uses Polish names with some specific patterns
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
    // ETOTO-SPECIFIC: Handle handicap and coded selections
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
    // BTTS-specific: Etoto uses Polish "Tak"/"Nie"
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
    if (/^1x$|^1\/x$|^10$/i.test(name)) return NormalizedSelection.HOME_OR_DRAW;
    if (/^x2$|^x\/2$|^02$/i.test(name)) return NormalizedSelection.DRAW_OR_AWAY;
    if (/^12$|^1\/2$/i.test(name)) return NormalizedSelection.HOME_OR_AWAY;

    // Enhanced Over/Under - match at start to handle "Powyżej 2.5" etc. (Polish + English + Portuguese)
    if (/^(powy[żz]ej|powyzej|poni|ponad|over|mais)/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    if (/^(poni[żz]ej|ponizej|under|menos)/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Enhanced Yes/No for BTTS and similar (Polish + English + variants)
    if (/^(tak|yes|y|gg|sim|gol)/i.test(name)) return NormalizedSelection.YES;
    if (/^(nie|no|n|ng|n[ão]o|brak)/i.test(name)) return NormalizedSelection.NO;

    // Enhanced Odd/Even patterns - Etoto uses "Nieparzysta" and "Parzysta"
    if (/^nieparzyst[ea]?$/i.test(name)) return NormalizedSelection.ODD;
    if (/^parzyst[ea]?$/i.test(name)) return NormalizedSelection.EVEN;

    // Use common patterns as fallback
    return this.normalizeCommonSelection(name, marketType);
  }
}

// Export singleton instance
export const etotoNormalizer = new EtotoNormalizer();
