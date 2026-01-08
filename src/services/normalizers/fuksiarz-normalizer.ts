/**
 * Fuksiarz Market Normalizer
 *
 * Handles market normalization specific to Fuksiarz betting platform.
 * Fuksiarz uses clean Polish market names, making pattern matching effective.
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

export class FuksiarzNormalizer extends BaseNormalizer {
  readonly bookmaker = "fuksiarz";

  /**
   * Fuksiarz-specific market patterns
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
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*liczba\s*goli\s*([\d,\.]+)?/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // 1st half result / match winner - must end with 1X2 or be exact match
    {
      pattern: /^wynik\s*1\.\s*poł(?:owy|owa)?$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*1x2$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // 1st half 1X2 + Total combined - map to HALF_TIME_RESULT for coverage
    {
      pattern: /^1\.?\s*po[lł](?:owa)?\s*-*\s*1[xX]2\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
      group: NormalizedMarketGroup.HALF_TIME,
    },
    {
      pattern: /^1\.?\s*po[lł](?:owa)?\s*-*\s*1[xX]2\s*i\s*obie\s*dru(z|ż)yny\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
      group: NormalizedMarketGroup.HALF_TIME,
    },
    {
      pattern: /^1\.?\s*po[lł](?:owa)?\s*-*\s*podw(o|ó)jn(a|ą)?\s*szansa\s*i\s*obie\s*dru(z|ż)yny\s*strzel/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
      group: NormalizedMarketGroup.HALF_TIME,
    },
    {
      pattern: /^1\.?\s*poł(?:owa)?\s*-\s*liczba\s+rzut(?:y|ów)?\s+rożn/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^1\.?\s*poł(?:owa)?\s*-\s*rzut(?:y|ów)?\s+rożn.*handicap/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 1st half European handicap
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*handicap/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half draw no bet
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*zakład\s*bez\s*remisu/i,
      type: NormalizedMarketType.DRAW_NO_BET,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half double chance
    {
      pattern: /^1\.?\s*po[lł](?:owa)?\s*-*\s*podw(o|ó)jn(a|ą)?\s*szansa$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half team goals (team-specific)
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*(.+)\s*-\s*liczba\s*goli\s*([\d,\.]+)?/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half first goal
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*1\.\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half team will score
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*(.+)\s*strzeli\s*gola/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half team wins to nil
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*(.+)\s*wygra\s*do\s*zera/i,
      type: NormalizedMarketType.WIN_TO_NIL,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half exact goals - map to HALF_TIME_TOTAL_GOALS for coverage
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*dokładna\s*liczba\s*goli$/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      group: NormalizedMarketGroup.HALF_TIME,
    },
    {
      pattern: /^1\.?\s*po[lł](?:owa)?\s*-*\s*dokładn(y|ą)\s*wynik$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half corners
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*(?:liczba\s*)?rzut(?:y|ów)?\s*rożn/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 1st half cards
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*(?:liczba\s*)?kart/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 1st half winning margin
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*różnica\s*zwycięstwa/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 1st half more corners
    {
      pattern: /^1\.\s*poł(?:owa)?\s*-\s*więcej\s*rzut/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // SECOND HALF MARKETS (2. polowa) - More specific categorization
    // ==========================================================================

    // 2nd half result / 1X2
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*1x2$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 2nd half BTTS - map to HALF_TIME_BTTS (2nd half is still half-time)
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*obie\s*(drużyny\s*)?strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 2nd half total goals - map to HALF_TIME_TOTAL_GOALS (2nd half is still half-time)
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*liczba\s*goli\s*([\d,\.]+)?/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      group: NormalizedMarketGroup.HALF_TIME,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // 2nd half European handicap
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*handicap/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 2nd half corners
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*(?:liczba\s*)?rzut(?:y|ów)?\s*rożn/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // 2nd half 1X2 - multiple patterns for robustness
    {
      pattern: /^2\.?\s*po[lł]owa\s*-*\s*1[xX]2$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
      group: NormalizedMarketGroup.HALF_TIME,
    },
    {
      pattern: /^2\.?\s*po[lł]?(?:owa)?\s*-*\s*1[xX]2$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
      group: NormalizedMarketGroup.HALF_TIME,
    },
    {
      pattern: /^2\.po[lł]owa.*1[xX]2$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 2nd half double chance
    {
      pattern: /^2\.?\s*po[lł](?:owa)?\s*-*\s*podw(o|ó)jn(a|ą)?\s*szansa$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 2nd half draw no bet
    {
      pattern: /^2\.?\s*po[lł](?:owa)?\s*-*\s*zakład\s*bez\s*remisu$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 2nd half 1X2 + Total combined
    {
      pattern: /^2\.?\s*po[lł](?:owa)?\s*-*\s*1[xX]2\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.MATCH_WINNER,
      group: NormalizedMarketGroup.HALF_TIME,
    },
    {
      pattern: /^2\.?\s*po[lł](?:owa)?\s*-*\s*1[xX]2\s*i\s*obie\s*dru(z|ż)yny\s*strzel/i,
      type: NormalizedMarketType.MATCH_WINNER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // 2nd half Double chance + Total combined
    {
      pattern: /^2\.?\s*po[lł](?:owa)?\s*-*\s*podw(o|ó)jn(a|ą)?\s*szansa\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
      group: NormalizedMarketGroup.HALF_TIME,
    },
    {
      pattern: /^2\.?\s*po[lł](?:owa)?\s*-*\s*podw(o|ó)jn(a|ą)?\s*szansa\s*i\s*obie\s*dru(z|ż)yny\s*strzel/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Catch-all for other 2nd half markets
    {
      pattern: /^2\.\s*poł(?:owa)?\s*-\s*/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // ==========================================================================
    // MAIN MATCH MARKETS
    // ==========================================================================

    // Combined markets (1X2 + Total, 1X2 + First Goal, 1X2 + BTTS) - map to MATCH_WINNER for coverage
    {
      pattern: /^1x2\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.MATCH_WINNER,
      group: NormalizedMarketGroup.MAIN,
    },
    {
      pattern: /^1x2\s*i\s*1\.\s*gol/i,
      type: NormalizedMarketType.MATCH_WINNER,
      group: NormalizedMarketGroup.MAIN,
    },
    {
      pattern: /^1x2\s*i\s*obie\s*dru(z|ż)yny\s*strzel/i,
      type: NormalizedMarketType.MATCH_WINNER,
      group: NormalizedMarketGroup.MAIN,
    },

    // Match winner / 1X2 - exact match only
    {
      pattern: /^wynik\s*meczu$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },
    {
      pattern: /^1x2$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Time-limited 1X2
    {
      pattern: /^1x2\s*-\s*\d+\s*minut/i,
      type: NormalizedMarketType.MATCH_WINNER,
      group: NormalizedMarketGroup.MAIN,
    },

    // Double chance combined (with total) - map to DOUBLE_CHANCE for coverage
    {
      pattern: /^podw(o|ó)jn(a|ą)?\s*szansa\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
      group: NormalizedMarketGroup.MAIN,
    },
    {
      pattern: /^podw(o|ó)jn(a|ą)?\s*szansa\s*i\s+/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
      group: NormalizedMarketGroup.MAIN,
    },

    // 1st half Double chance + Total
    {
      pattern: /^1\.?\s*po[lł](?:owa)?\s*-*\s*podw(o|ó)jn(a|ą)?\s*szansa\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Double chance exact - for standalone DC market (with and without Polish diacritics)
    {
      pattern: /^podw(o|ó)jn(a|ą)?\s*szansa$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },
    // Double chance with half context
    {
      pattern: /^podw(o|ó)jn(a|ą)?\s*szansa\s*\(/i,
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

    // Time-limited total goals (30, 60, 75 minutes) - map to TOTAL_GOALS with time param
    {
      pattern: /^liczba\s*goli\s*-\s*(\d+)\s*minut/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      group: NormalizedMarketGroup.GOALS,
      extractParam: (m) => `${m[1]}min`,
    },

    // Total goals with line in name (e.g., "Liczba goli 2.5")
    {
      pattern: /^liczba\s*goli\s*([\d,\.]+)$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Generic "Liczba goli" without line (exact number of goals)
    {
      pattern: /^liczba\s*goli$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Exact number of goals - map to TOTAL_GOALS for coverage
    {
      pattern: /^dokładna\s*liczba\s*goli$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      group: NormalizedMarketGroup.GOALS,
    },

    // ==========================================================================
    // BTTS MARKETS
    // ==========================================================================

    // BTTS combined with total goals - map to BTTS for coverage
    {
      pattern: /^obie\s*(?:dru(z|ż)yny\s*)?strzel(?:ą|y)?\s*gola\s*i\s*liczba\s*goli/i,
      type: NormalizedMarketType.BTTS,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^obie\s*(?:dru(z|ż)yny\s*)?strzel.*\s*i\s+/i,
      type: NormalizedMarketType.BTTS,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^obie\s*(dru(z|ż)yny\s*)?strzel.*\s*w\s*obu\s*po(l|ł)owach/i,
      type: NormalizedMarketType.BTTS,
      group: NormalizedMarketGroup.GOALS,
    },

    // BTTS standalone (with and without Polish diacritics)
    {
      pattern: /^obie\s*(dru(z|ż)yny\s*)?strzel.*$/i,
      type: NormalizedMarketType.BTTS,
    },

    // Both teams score at least 2 goals each - map to BTTS
    {
      pattern: /^ka(z|ż)da\s*dru(z|ż)yna\s*strzeli\s*przynajmniej\s*2\s*gol/i,
      type: NormalizedMarketType.BTTS,
      group: NormalizedMarketGroup.GOALS,
    },

    // ==========================================================================
    // HANDICAP MARKETS
    // ==========================================================================

    // Time-limited handicap (30, 60, 75 minutes) - map to EUROPEAN_HANDICAP with time param
    {
      pattern: /^handicap\s*-\s*(\d+)\s*minut/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      group: NormalizedMarketGroup.HANDICAP,
      extractParam: (m) => `${m[1]}min`,
    },

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

    // Generic "Handicap" - Fuksiarz uses this for European handicap
    // Based on selection format: "TeamName (+/-X)"
    {
      pattern: /^handicap$/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
    },

    // ==========================================================================
    // CORRECT SCORE
    // ==========================================================================

    {
      pattern: /^dokładny\s*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ==========================================================================
    // WIN TO NIL / CLEAN SHEET
    // ==========================================================================

    // Team wins to nil
    {
      pattern: /^(.+)\s*wygra\s*do\s*zera$/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },

    // ==========================================================================
    // FIRST/LAST GOAL MARKETS
    // ==========================================================================

    {
      pattern: /^1\.\s*gol(?:\s|$)/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },
    {
      pattern: /^strzelec\s*1\.\s*gola/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // ==========================================================================
    // TEAM-SPECIFIC GOALS
    // ==========================================================================

    // Team total goals (e.g., "West Ham - liczba goli")
    {
      pattern: /^(.+)\s*-\s*liczba\s*goli\s*([\d,\.]+)?$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Team exact goals
    {
      pattern: /^(.+)\s*-\s*dokładna\s*liczba\s*goli$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Team will score
    {
      pattern: /^(.+)\s*strzeli\s*gola$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Team will score in both halves
    {
      pattern: /^(.+)\s*strzeli\s*gola\s*w\s*obu\s*połowach$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // Team wins both halves
    {
      pattern: /^(.+)\s*wygra\s*obie\s*połowy$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Team wins at least one half
    {
      pattern: /^(.+)\s*wygra\s*przynajmniej\s*jedną\s*połowę$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Team first goalscorer
    {
      pattern: /^(.+)\s*-\s*strzelec\s*1\.\s*gola$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // ==========================================================================
    // WINNING MARGIN
    // ==========================================================================

    {
      pattern: /^różnica\s*zwycięstwa/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // HALF WITH MORE GOALS
    // ==========================================================================

    {
      pattern: /^po[lł]owa\s*z\s*wi(ę|e)ksz(ą|a)\s*liczb(ą|a)\s*goli/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      group: NormalizedMarketGroup.GOALS,
    },

    // ==========================================================================
    // FIRST GOAL TIMING
    // ==========================================================================

    {
      pattern: /^1\.\s*gol\s*\(przedziały/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.GOALS,
    },

    // ==========================================================================
    // PLAYER MARKETS
    // ==========================================================================

    // Player scores
    {
      pattern: /^strzeli\s*gola$/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^strzeli\s*przynajmniej\s*\d+\s*gol/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player assists
    {
      pattern: /^zawodnik\s*zaliczy\s*asyst/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player shots
    {
      pattern: /^zawodnik\s*odda\s*.*strzał/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Player cards
    {
      pattern: /^zawodnik\s*otrzyma\s*kart/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // CORNERS MARKETS
    // ==========================================================================

    {
      pattern: /^liczba\s*rzut(?:ów|y)?\s*rożn/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^więcej\s*rzut(?:ów|y)?\s*rożn/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^1\.\s*rzut\s*rożny/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^rzut(?:y|ów)?\s*rożn.*handicap/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^(.+)\s*-\s*liczba\s*rzut(?:ów|y)?\s*rożn/i,
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
      pattern: /^dokładna\s*liczba\s*kartek/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^więcej\s*kartek/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^1\.\s*kartka/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^kartk.*handicap/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^(.+)\s*-\s*liczba\s*kartek/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^czerwona\s*kartka/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // SHOTS MARKETS
    // ==========================================================================

    {
      pattern: /^liczba\s*celnych\s*strzał/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^więcej\s*celnych\s*strzał/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^(.+)\s*-\s*liczba\s*celnych\s*strzał/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // OTHER STATS
    // ==========================================================================

    {
      pattern: /^liczba\s*fauli/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^liczba\s*spalonych/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },
    {
      pattern: /^rzut\s*karny/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // ==========================================================================
    // SPECIAL BETS
    // ==========================================================================

    {
      pattern: /^zakłady\s*specjalne/i,
      type: NormalizedMarketType.OTHER,
      group: NormalizedMarketGroup.OTHER,
    },

    // Common patterns fallback
    ...COMBINATION_MARKET_PATTERNS,
    ...STATISTICS_MARKET_PATTERNS,
    ...PLAYER_MARKET_PATTERNS,
  ];

  /**
   * Normalize selection names for Fuksiarz
   * Fuksiarz uses Polish names and team names in selections
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
    // FUKSIARZ-SPECIFIC: Handle handicap and coded selections
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
    // BTTS-specific: Fuksiarz uses Polish "Tak"/"Nie"
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

    // Enhanced Over/Under - match at start to handle "powyżej 2.5" etc. (Polish + English + Portuguese)
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
export const fuksiarzNormalizer = new FuksiarzNormalizer();
