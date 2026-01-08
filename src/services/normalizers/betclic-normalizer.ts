/**
 * Betclic Market Normalizer
 *
 * Handles market normalization specific to Betclic betting platform.
 * Betclic uses Polish market names with distinctive patterns:
 * - "Zwyciezca meczu" for match winner
 * - "Liczba goli: powyzej/poniżej X.5" for over/under
 * - "Strzelec: X - Y" format for correct score/goalscorer markets
 * - "Obie druzyny strzelą" for BTTS
 * - Handicap formats with values in parentheses
 *
 * Analysis showed:
 * - Coverage before normalizer: ~5.5%
 * - Main uncategorized markets: "Strzelec: X - Y" (correct score format)
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

export class BetclicNormalizer extends BaseNormalizer {
  readonly bookmaker = "betclic";

  /**
   * Bookmaker-specific market patterns
   * Priority: matched before generic patterns
   */
  protected readonly patterns: MarketPattern[] = [
    // ==========================================================================
    // CORRECT SCORE PATTERNS
    // ==========================================================================
    // Note: Betclic uses "Strzelec:" (Polish for "Scorer") as a label for
    // correct score markets. So "Strzelec: 2 - 1" means correct score 2-1.

    // "Strzelec: X - Y" format - Betclic's correct score market
    {
      pattern: /^strzelec:\s*(\d+)\s*-\s*(\d+)$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },
    // "Strzelec: Inny" - Any other correct score (maps to correct score type)
    {
      pattern: /^strzelec:\s*inny$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },
    // "Strzelec: Brak Gola" - No goal (0-0 correct score)
    {
      pattern: /^strzelec:\s*brak\s*gola/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // "Dokładny wynik" - standard Polish correct score label
    {
      pattern: /^dok[łł]adny\s*wynik$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },
    // Plain score format "X - Y"
    {
      pattern: /^\d+\s*-\s*\d+$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ==========================================================================
    // GOALSCORER / PLAYER PROP MARKETS
    // ==========================================================================
    // Note: Other "Strzelec:" patterns that don't match correct score are
    // player props: individual player goals, team goalscorer handicap, etc.
    // These are categorized as OTHER since they are not core match markets.

    // "Strzelec: Player Name Powyżej X.X" - Individual player goal over/under
    {
      pattern: /^strzelec:\s*.+?\s+powy[żż]ej\s+/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    // "Strzelec: Team Name (+/-X)" - Team goalscorer handicap
    {
      pattern: /^strzelec:\s*.+?\s*[+-]\d+$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    // "Strzelec: Team Name" - Team goalscorer (without handicap)
    {
      pattern: /^strzelec:\s*[a-ząćęłńóśźż\s]+$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // HALF-TIME MARKETS
    // ==========================================================================

    // Half-time BTTS
    {
      pattern: /^1\.\s*po[lł]ow[aäe]\s*-?\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },
    {
      pattern: /^obie\s*dru[żz]yny\s*strzel[aą]\s*1\.\s*po[lł]/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // Half-time total goals with line
    {
      pattern: /^1\.\s*po[lł]ow[aäe]\s*-?\s*liczba\s*goli\s*[:\s]+(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Half-time result
    {
      pattern: /^wynik\s*1\.\s*po[lł]ow/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^1\.\s*po[lł]ow[aäe]\s*-?\s*wynik\s*meczu$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^1\.\s*po[lł]ow[aäe]\s*-?\s*1x2$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // ==========================================================================
    // TOTAL GOALS / OVER UNDER MARKETS
    // ==========================================================================

    // "Liczba goli: powyżej/poniżej X.5" format (explicit Betclic format)
    {
      pattern: /^liczba\s*goli\s*[:\s]+powy[żż]ej\s*[\/]?\s*poni[żż]ej\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // "Gole X.5" format
    {
      pattern: /^gole\s*[:\s]+(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // "Liczba goli X.5" standalone format (most important)
    {
      pattern: /^liczba\s*goli\s+(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Over/Under with line (Polish "powyżej/poniżej")
    {
      pattern: /^(powy[żż]ej|poni[żż]ej)\s*(\d+[.,]?\d*)\s*gol/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[2]?.replace(",", "."),
    },

    // ==========================================================================
    // BOTH TEAMS TO SCORE (BTTS)
    // ==========================================================================

    // "Obie druzyny strzelą" (with and without diacritics)
    {
      pattern: /^obie\s*dru[żz]yny\s*strzel[ąa]\s*(gola)?$/i,
      type: NormalizedMarketType.BTTS,
    },

    // ==========================================================================
    // MATCH WINNER / 1X2
    // ==========================================================================

    {
      pattern: /^zwyci[ęe][żz]ca\s*meczu$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /^wynik\s*meczu$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /^1x2$/i,
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
    // HANDICAP MARKETS
    // ==========================================================================

    // Asian handicap with value in parentheses
    {
      pattern: /^handicap\s*azjatycki\s*\(([-+]?\d+[.,]?\d*)\)/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // European handicap with value in parentheses
    {
      pattern: /^handicap\s*europejski\s*\(([-+]?\d+[.,]?\d*)\)/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Generic handicap (treat as Asian)
    {
      pattern: /^handicap\s*\(([-+]?\d+[.,]?\d*)\)/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ==========================================================================
    // DRAW NO BET
    // ==========================================================================

    {
      pattern: /^remis\s*bez\s*zak[łł]adu$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
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

    // Common patterns fallback
    ...COMBINATION_MARKET_PATTERNS,
    ...STATISTICS_MARKET_PATTERNS,
    ...PLAYER_MARKET_PATTERNS,
  ];

  /**
   * Selection normalization patterns specific to Betclic
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

    // Use common selection patterns from base class
    const common = this.normalizeCommonSelection(name, marketType);
    if (common !== NormalizedSelection.UNKNOWN) {
      return common;
    }

    // Betclic-specific selection patterns

    // Enhanced Over/Under selections (Polish + English + Portuguese)
    if (/^powy[żż]ej\s*[\d.,,]+/i.test(name) || /^(powy[żz]ej|powyzej|poni|ponad|over|mais)/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    if (/^poni[żż]ej\s*[\d.,,]+/i.test(name) || /^(poni[żz]ej|ponizej|under|menos)/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Remis (draw)
    if (/^remis$/i.test(name)) {
      return NormalizedSelection.DRAW;
    }

    // Enhanced Yes/No patterns (Polish + English + variants)
    if (/^(tak|yes|y|gg|sim|gol)/i.test(name)) {
      return NormalizedSelection.YES;
    }
    if (/^(nie|no|n|ng|n[ão]o|brak)/i.test(name)) {
      return NormalizedSelection.NO;
    }

    // Enhanced Double Chance patterns
    if (/^1x$|^1\/x$/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (/^x2$|^x\/2$/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (/^12$|^1\/2$/i.test(name)) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Double Chance with team names
    // Format: "Team1 lub Remis", "Remis lub Team2", "Team1 lub Team2"
    if (homeTeam && (name.includes(`${homeTeam.toLowerCase()} lub remis`) ||
                      name.includes(`remis lub ${homeTeam.toLowerCase()}`))) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (awayTeam && (name.includes(`${awayTeam.toLowerCase()} lub remis`) ||
                      name.includes(`remis lub ${awayTeam.toLowerCase()}`))) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (homeTeam && awayTeam &&
        (name.includes(`${homeTeam.toLowerCase()} lub ${awayTeam.toLowerCase()}`) ||
         name.includes(`${awayTeam.toLowerCase()} lub ${homeTeam.toLowerCase()}`))) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Enhanced Odd/Even patterns
    if (/nieparzyst[ea]?/i.test(name)) {
      return NormalizedSelection.ODD;
    }
    if (/parzyst[ea]?/i.test(name)) {
      return NormalizedSelection.EVEN;
    }

    return NormalizedSelection.UNKNOWN;
  }
}

// Export singleton instance
export const betclicNormalizer = new BetclicNormalizer();
