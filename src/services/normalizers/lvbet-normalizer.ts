/**
 * LVBet Market Normalizer
 *
 * Handles market normalization specific to LVBet betting platform.
 * LVBet uses Polish language market names with distinctive patterns:
 * - Half periods: "1. Polowa", "2. Polowa" (with various diacritic forms)
 * - Team totals: "Arsenal - Suma goli 1.5"
 * - Asian totals: "Azjatycka suma goli 2.75"
 * - Period markets: "1-15 min.", "1-30 min.", "1-60 min.", "1-75 min."
 * - English market names for some markets (e.g., "1st Half...")
 *
 * Base coverage before normalizer: ~51%
 * Target coverage: >=90%
 */

import {
  NormalizedMarketType,
  NormalizedSelection,
  NormalizedMarketGroup,
} from "../../types/normalization.js";
import { BaseNormalizer, type MarketPattern } from "./base-normalizer.js";

export class LVBetNormalizer extends BaseNormalizer {
  readonly bookmaker = "lvbet";

  /**
   * Bookmaker-specific market patterns
   * Priority: matched in order, more specific patterns first
   */
  protected readonly patterns: MarketPattern[] = [
    // ========================================================================
    // PERIOD-SPECIFIC MARKETS (1-15 min, 1-30 min, etc.) - must match first
    // ========================================================================

    // Period BTTS
    {
      pattern: /^1-\d+\s*min\.?\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.BTTS,
    },

    // Period total goals with line
    {
      pattern: /^1-\d+\s*min\.?\s*-?\s*liczba\s*goli?\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Period team totals
    {
      pattern: /^1-\d+\s*min\.?\s*-?\s*dru[żz]yna\s*\d\.?\s*liczba\s*goli?\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Period handicap
    {
      pattern: /^1-\d+\s*min\.?\s*handicap\s*([-+]?\d+[.,]?\d*)?/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Period winner (1X2)
    {
      pattern: /^zwyci[ęe][żz]ca\s*1-\d+\s*min/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // ========================================================================
    // HALF-TIME MARKETS (Polish format: "1. Polowa", "2. Polowa")
    // ========================================================================

    // Half-time BTTS
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // Half-time total goals with line
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*liczba\s*(bramek|goli?)\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[3]?.replace(",", "."),
    },

    // Half-time Asian total goals
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*azjatycka\s*(liczba|suma)\s*goli?\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[3]?.replace(",", "."),
    },

    // Half-time team Asian totals (e.g., "1. Polowa - Arsenal Azjatycka suma goli 0.75")
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*.+\s*azjatycka\s*suma\s*goli?\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[2]?.replace(",", "."),
    },

    // Half-time team totals
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*dru[żz]yna\s*\d\.?\s*(liczba\s*goli?|suma\s*goli?)\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[3]?.replace(",", "."),
    },

    // Half-time result (1X2)
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*wynik$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // Half-time Double Chance
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*podw[oó]jn.*szans/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time handicap (Asian)
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*handicap\s*azjatycki?\s*([-+]?\d+[.,]?\d*)/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
      extractParam: (m) => m[2]?.replace(",", "."),
    },

    // Half-time handicap (3-way / European)
    {
      pattern: /^(1|2)\s*po[lł]ow[aąe]?\s*-?\s*handicap\s*3-drogowy\s*([-+]?\d+)?/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
      extractParam: (m) => m[2],
    },

    // Half-time handicap (generic - treat as Asian)
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*handicap\s*([-+]?\d+[.,]?\d*)?/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      group: NormalizedMarketGroup.HALF_TIME,
      extractParam: (m) => m[2]?.replace(",", "."),
    },

    // Half-time Correct Score
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*dok[lł]adn.*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time team exact goals
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*dru[żz]yna\s*\d\.?\s*dok[lł]adn.*liczba\s*goli?/i,
      type: NormalizedMarketType.CORRECT_SCORE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time exact goal count
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*dok[lł]adn.*liczba\s*(bramek|goli?)/i,
      type: NormalizedMarketType.CORRECT_SCORE,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time win to nil
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*dru[żz]yna\s*\d\.?\s*wygra\s*do\s*(0|zera)/i,
      type: NormalizedMarketType.WIN_TO_NIL,
      group: NormalizedMarketGroup.HALF_TIME,
    },

    // Half-time result and BTTS combo
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*wynik\s*(i|oraz)\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // Half-time first/last team to score
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*(pierwsza|ostatnia)\s*dru[żz]yna.*strzeli\s*gola/i,
      type: NormalizedMarketType.OTHER,
    },

    // English half-time patterns (e.g., "1st Half Arsenal Total Goals Asian 0.75")
    {
      pattern: /^1st\s*half\s*.+\s*total\s*goals?\s*asian\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ========================================================================
    // ASIAN TOTAL GOALS (match-level)
    // ========================================================================

    {
      pattern: /^azjatycka\s*suma\s*goli?\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    {
      pattern: /^azjatycka\s*liczba\s*goli?\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Standalone total goals (e.g., "Suma goli 2.5", "Liczba goli 3.5")
    {
      pattern: /^suma\s*goli?\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    {
      pattern: /^liczba\s*goli?\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },
    {
      pattern: /^liczba\s*bramek\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ========================================================================
    // TEAM-SPECIFIC TOTAL GOALS
    // ========================================================================

    // Team Asian total (e.g., "Arsenal - Azjatycka suma goli 1.75")
    {
      pattern: /^.+\s*-\s*azjatycka\s*suma\s*goli?\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Team total goals (e.g., "Arsenal - Suma goli 1.5")
    {
      pattern: /^.+\s*-\s*suma\s*goli?\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Team exact goals (e.g., "Arsenal - Dokladna liczba goli")
    {
      pattern: /^.+\s*-\s*dok[lł]adn.*liczba\s*goli?/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ========================================================================
    // WIN TO NIL / CLEAN SHEET
    // ========================================================================

    // Win to nil (team-specific)
    {
      pattern: /wygra\s*do\s*zera$/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },

    // Win by exact margin (e.g., "Arsenal wygra dokladnie 2.0 golami")
    {
      pattern: /wygra\s*dok[lł]adnie\s*(\d+[.,]?\d*)\s*gol/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },

    // Win one goal or draw
    {
      pattern: /wygra\s*jednym\s*golem\s*lub\s*zremisuje/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // ========================================================================
    // BTTS VARIANTS
    // ========================================================================

    {
      pattern: /obie\s*dru[żz]yny\s*strzel.*gola?/i,
      type: NormalizedMarketType.BTTS,
    },

    {
      pattern: /oba\s*zespo[lł]y\s*strzel/i,
      type: NormalizedMarketType.BTTS,
    },

    // BTTS with result combo
    {
      pattern: /wynik\s*(i|oraz)\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.BTTS,
    },

    // Goal in half
    {
      pattern: /^gol\s*w\s*(1|2)\.\s*po[lł]owie$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: () => "0.5",
    },

    // Goals in both halves
    {
      pattern: /^gole\s*w\s*obu\s*po[lł]owach$/i,
      type: NormalizedMarketType.BTTS,
    },

    // Both halves under X.5
    {
      pattern: /^obie\s*po[lł]owy\s*poni[żz]ej\s*(\d+[.,]?\d*)\s*gola?$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ========================================================================
    // TOTAL GOALS VARIANTS
    // ========================================================================

    // Exactly N goals
    {
      pattern: /^dok[lł]adnie\s*(\d+)\s*gol[eia]?\s*w\s*meczu$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // Total goals range
    {
      pattern: /^suma\s*goli?\s*\(przedzia[lł]\)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },
    {
      pattern: /^dok[lł]adn.*liczba\s*goli?\s*\(przedzia[lł]\)/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // Score combinations
    {
      pattern: /^wynik\s*-?\s*kombinacje$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ========================================================================
    // DOUBLE CHANCE VARIANTS
    // ========================================================================

    {
      pattern: /podw[oó]jn.*szans/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // ========================================================================
    // HANDICAP VARIANTS
    // ========================================================================

    // 3-way handicap (European) - standalone or with value
    {
      pattern: /^handicap\s*\(3-drogowy\)\s*([-+]?\d+)?/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => m[1],
    },
    {
      pattern: /handicap\s*3-drogowy\s*([-+]?\d+)?/i,
      type: NormalizedMarketType.EUROPEAN_HANDICAP,
      extractParam: (m) => m[1],
    },

    // Asian handicap with value
    {
      pattern: /handicap\s*azjatycki?\s*([-+]?\d+[.,]?\d*)/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Generic handicap with value
    {
      pattern: /^handicap\s*([-+]?\d+[.,]?\d*)$/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // Standalone "Handicap" without value (generic Asian)
    {
      pattern: /^handicap$/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
    },

    // ========================================================================
    // MATCH WINNER / 1X2 VARIANTS
    // ========================================================================

    {
      pattern: /^1x2$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    {
      pattern: /wynik\s*meczu/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    {
      pattern: /zwyci[ęe][żz]ca\s*meczu/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    {
      pattern: /ko[nń]cowy\s*wynik/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Half-time/Full-time
    {
      pattern: /^do\s*przerwy\s*\/?\s*koniec\s*meczu/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Half-time or match winner
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*(lub|or)\s*zwyci[ęe][żz]ca\s*meczu/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Team wins both halves
    {
      pattern: /wygra\s*obie\s*po[lł]owy$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Team wins at least one half
    {
      pattern: /wygra\s*przynajmniej\s*jedn.*po[lł]ow/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // ========================================================================
    // COMBO MARKETS (Result + Goals)
    // ========================================================================

    // Result and total goals combo (e.g., "Wynik i liczba bramek w meczu 2.5")
    {
      pattern: /^wynik\s*(i|oraz)\s*liczba\s*bramek\s*w\s*meczu\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Result and exact goals combo (e.g., "Wynik i liczba bramek (dokładna liczba)")
    {
      pattern: /^wynik\s*(i|oraz)\s*liczba\s*bramek\s*\(dokładna\s*liczba\)/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Result and goals range combo (e.g., "Wynik i suma goli (przedział)")
    {
      pattern: /^wynik\s*(i|oraz)\s*suma\s*goli\s*\(przedzial\)/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Result or goals combo (e.g., "Rezultat lub ilość bramek (2.5)")
    {
      pattern: /^rezultat\s*lub\s*ilość\s*bramek\s*\(?\d+[.,]?\d*\)?/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Result and correct score combo (e.g., "Rezultat i dokładny wynik")
    {
      pattern: /^rezultat\s*(i|oraz)\s*dokładny\s*wynik/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // ========================================================================
    // FIRST/LAST TEAM TO SCORE
    // ========================================================================

    // First team to score
    {
      pattern: /^pierwsza\s*drużyna.*zdobędzie\s*gola/i,
      type: NormalizedMarketType.OTHER,
    },
    {
      pattern: /^pierwsza\s*drużyna.*strzeli\s*gola$/i,
      type: NormalizedMarketType.OTHER,
    },

    // Last team to score
    {
      pattern: /^ostatnia\s*drużyna.*zdobędzie\s*gola/i,
      type: NormalizedMarketType.OTHER,
    },
    {
      pattern: /^ostatnia\s*drużyna.*strzeli\s*gola$/i,
      type: NormalizedMarketType.OTHER,
    },

    // Half-time first/last to score
    {
      pattern: /^(1|2)\.\s*po[lł]owa\s*-?\s*pierwsza\s*drużyna.*strzeli\s*gola/i,
      type: NormalizedMarketType.OTHER,
    },
    {
      pattern: /^(1|2)\.\s*po[lł]owa\s*-?\s*ostatnia\s*drużyna.*strzeli\s*gola/i,
      type: NormalizedMarketType.OTHER,
    },

    // ========================================================================
    // CORRECT SCORE
    // ========================================================================

    {
      pattern: /^dok[lł]adn.*wynik$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    {
      pattern: /^dok[lł]adn.*liczba\s*(bramek|goli?)$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ========================================================================
    // DRAW NO BET
    // ========================================================================

    {
      pattern: /remis\s*zwraca\s*stawk[ęe]/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // "Remis = zwrot" format
    {
      pattern: /^remis\s*=\s*zwrot$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    {
      pattern: /draw\s*no\s*bet/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // ========================================================================
    // ODD/EVEN
    // ========================================================================

    {
      pattern: /parzyste\s*\/?\s*nieparzyste/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },

    {
      pattern: /nieparzyste\s*\/?\s*parzyste/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },

    // ========================================================================
    // TEAM-SPECIFIC SCORING MARKETS
    // ========================================================================

    // Team to score (e.g., "Arsenal strzeli gola")
    {
      pattern: /strzeli\s*gola?$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: () => "0.5",
    },

    // Team to score in half
    {
      pattern: /strzeli\s*w\s*(pierwszej|drugiej)\s*po[lł]owie$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: () => "0.5",
    },

    // Team to score in both halves
    {
      pattern: /strzeli\s*w\s*obu\s*po[lł]owach$/i,
      type: NormalizedMarketType.BTTS,
    },

    // Team to score with winner combo
    {
      pattern: /strzeli\s*gola?\s*\/\s*zwyci[ęe][żz]ca\s*meczu/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // ========================================================================
    // SPECIAL/OTHER MARKETS (categorized but less common)
    // ========================================================================

    // Red card
    {
      pattern: /^(1|2)?\s*po[lł]ow[aąe]?\s*-?\s*czerwona\s*kartka/i,
      type: NormalizedMarketType.OTHER,
    },

    {
      pattern: /^czerwona\s*kartka/i,
      type: NormalizedMarketType.OTHER,
    },

    // Penalty
    {
      pattern: /rzut\s*karny/i,
      type: NormalizedMarketType.OTHER,
    },

    // Own goal
    {
      pattern: /bramka\s*samob[oó]jcza/i,
      type: NormalizedMarketType.OTHER,
    },

    // Throw-ins (Auty)
    {
      pattern: /^auty:/i,
      type: NormalizedMarketType.OTHER,
    },

    // First goal time
    {
      pattern: /czas\s*zdobycia\s*(pierwsz|ostatni).*bramk/i,
      type: NormalizedMarketType.OTHER,
    },

    // Which half more goals
    {
      pattern: /po[lł]ow[aąe]?\s*z\s*wi[ęe]ksz.*liczb.*gol/i,
      type: NormalizedMarketType.OTHER,
    },

    // Margin of victory
    {
      pattern: /margines\s*zwyci[ęe]stwa/i,
      type: NormalizedMarketType.OTHER,
    },

    // Mix chances (combo markets)
    {
      pattern: /^mix\s*szans$/i,
      type: NormalizedMarketType.OTHER,
    },

    // Draw in at least one half
    {
      pattern: /^remis\s*przynajmniej\s*w\s*jednej\s*z\s*po[lł]ow/i,
      type: NormalizedMarketType.OTHER,
    },

    // Which half more goals
    {
      pattern: /^po[lł]owa\s*z\s*wi[ęe]ksz.*liczb.*gol/i,
      type: NormalizedMarketType.OTHER,
    },

    // Win first half / win second half
    {
      pattern: /^wygra\s*pierwsz.*po[lł]ow.*\/\s*wygra\s*drug.*po[lł]ow/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // BTTS per half
    {
      pattern: /^obydwie\s*dru[żz]yny\s*strzel.*-\s*1\.\s*po[lł]owa/i,
      type: NormalizedMarketType.OTHER,
    },

    // Goals in each half (range)
    {
      pattern: /^suma\s*goli\s*w\s*każdej\s*z\s*po[lł]ow\s*\(przedzia[lł]\)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // LV Zaliczka (special promo market)
    {
      pattern: /\(lv\s*zaliczka\)/i,
      type: NormalizedMarketType.OTHER,
    },

    // Team will be losing and win
    {
      pattern: /b[ęe]dzie\s*przegrywa.*wygra\s*mecz/i,
      type: NormalizedMarketType.OTHER,
    },

    // Comeback / lead scenarios - score will occur during match
    {
      pattern: /^b[ęe]dzie\s*wynik\s*w\s*trakcie\s*meczu$/i,
      type: NormalizedMarketType.OTHER,
    },

    // Player shots markets
    {
      pattern: /total\s*shots/i,
      type: NormalizedMarketType.OTHER,
    },
  ];

  /**
   * Selection normalization patterns specific to LVBet
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

    // LVBet-specific selection patterns

    // Over selections with line (e.g., "Powyzej (2.5)")
    if (/^powy[żz]ej\s*\(?[\d,\.]+\)?/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    // Under selections with line
    if (/^poni[żz]ej\s*\(?[\d,\.]+\)?/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Remis (draw)
    if (/^remis$/i.test(name)) {
      return NormalizedSelection.DRAW;
    }

    // "Bez goli" (no goals) - for first team to score markets
    if (/^bez\s*goli?$/i.test(name)) {
      return NormalizedSelection.NO;
    }

    // Selections with handicap format "Team (X.X)"
    if (/\([-+]?\d+[.,]?\d*\)\s*$/.test(name)) {
      const teamPart = name.replace(/\s*\([-+]?\d+[.,]?\d*\)\s*$/, "").trim();
      if (homeTeam && this.matchesTeam(teamPart, homeTeam)) {
        return NormalizedSelection.HOME;
      }
      if (awayTeam && this.matchesTeam(teamPart, awayTeam)) {
        return NormalizedSelection.AWAY;
      }
    }

    // Double Chance specific
    if (/^1x$|^1\s*lub\s*x$/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (/^x2$|^x\s*lub\s*2$/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (/^12$|^1\s*lub\s*2$/i.test(name)) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    // Odd/Even
    if (/nieparzyste?/i.test(name)) {
      return NormalizedSelection.ODD;
    }
    if (/parzyste?/i.test(name)) {
      return NormalizedSelection.EVEN;
    }

    return NormalizedSelection.UNKNOWN;
  }
}

// Export singleton instance
export const lvbetNormalizer = new LVBetNormalizer();
