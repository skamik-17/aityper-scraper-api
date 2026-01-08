/**
 * Common Market Patterns
 *
 * Shared regex patterns for market type detection across all bookmaker normalizers.
 * These patterns handle player markets, statistics, and combination markets.
 */

import { NormalizedMarketType } from "../../types/normalization.js";
import type { MarketPattern } from "./base-normalizer.js";

// ============================================================================
// ZAWODNICY (Player Markets) Patterns
// ============================================================================

/**
 * Patterns for player-related markets:
 * - Goalscorers (first, last, anytime)
 * - Player shots
 * - Player cards
 * - Player assists
 */
export const PLAYER_MARKET_PATTERNS: MarketPattern[] = [
  // First goalscorer
  {
    pattern: /^(pierwszy|1\.?)\s*(strzelec|gol)/i,
    type: NormalizedMarketType.GOALSCORER_FIRST,
  },
  {
    pattern: /first\s*goal\s*scorer/i,
    type: NormalizedMarketType.GOALSCORER_FIRST,
  },
  // Last goalscorer
  {
    pattern: /^ostatni\s*(strzelec|gol)/i,
    type: NormalizedMarketType.GOALSCORER_LAST,
  },
  {
    pattern: /last\s*goal\s*scorer/i,
    type: NormalizedMarketType.GOALSCORER_LAST,
  },
  // Anytime goalscorer
  {
    pattern: /^strzel[ei]\s*gola?$/i,
    type: NormalizedMarketType.GOALSCORER_ANYTIME,
  },
  {
    pattern: /^(zawodnik|gracz).*strzel/i,
    type: NormalizedMarketType.GOALSCORER_ANYTIME,
  },
  {
    pattern: /strzelec\s*(bramki|gola)/i,
    type: NormalizedMarketType.GOALSCORER_ANYTIME,
  },
  {
    pattern: /anytime\s*(goal\s*)?scorer/i,
    type: NormalizedMarketType.GOALSCORER_ANYTIME,
  },
  // Player shots
  {
    pattern: /^(strza[łl]y|shots?)\s*(zawodnik|na\s*bramk)/i,
    type: NormalizedMarketType.PLAYER_SHOTS,
  },
  {
    pattern: /zawodnik.*(strza[łl]|shot)/i,
    type: NormalizedMarketType.PLAYER_SHOTS,
  },
  {
    pattern: /player\s*shots/i,
    type: NormalizedMarketType.PLAYER_SHOTS,
  },
  // Player cards
  {
    pattern: /^(kartk[ai]|card)\s*(zawodnik|dla)/i,
    type: NormalizedMarketType.PLAYER_CARDS,
  },
  {
    pattern: /zawodnik.*(kartk[aię]|card)/i,
    type: NormalizedMarketType.PLAYER_CARDS,
  },
  {
    pattern: /player\s*(to\s*(receive|get)\s*)?(card|booking)/i,
    type: NormalizedMarketType.PLAYER_CARDS,
  },
  // Player assists
  {
    pattern: /^asyst[ay]?\s*(zawodnik)?/i,
    type: NormalizedMarketType.PLAYER_ASSISTS,
  },
  {
    pattern: /player\s*assist/i,
    type: NormalizedMarketType.PLAYER_ASSISTS,
  },
];

// ============================================================================
// STATYSTYKI (Statistics Markets) Patterns
// ============================================================================

/**
 * Patterns for statistics markets:
 * - Corners (total, team)
 * - Cards (total, team)
 * - Fouls
 * - Offsides
 */
export const STATISTICS_MARKET_PATTERNS: MarketPattern[] = [
  // Total corners with line
  {
    pattern: /^(rzuty?\s*ro[żz]n[ey]?|corners?)\s*[-:]?\s*(\d+[.,]?\d*)/i,
    type: NormalizedMarketType.CORNERS_TOTAL,
    extractParam: (m) => m[2]?.replace(",", "."),
  },
  {
    pattern: /^liczba\s*(rzut[oó]w?\s*ro[żz]n|corner)/i,
    type: NormalizedMarketType.CORNERS_TOTAL,
  },
  {
    pattern: /^(suma\s*)?(rzuty?\s*ro[żz]n[ey]?|corners?)$/i,
    type: NormalizedMarketType.CORNERS_TOTAL,
  },
  {
    pattern: /total\s*corners?/i,
    type: NormalizedMarketType.CORNERS_TOTAL,
  },
  // Team corners
  {
    pattern: /(rzuty?\s*ro[żz]n[ey]?|corners?).*dru[żz]yn/i,
    type: NormalizedMarketType.CORNERS_TEAM,
  },
  {
    pattern: /dru[żz]yn.*(rzuty?\s*ro[żz]n|corner)/i,
    type: NormalizedMarketType.CORNERS_TEAM,
  },
  {
    pattern: /team\s*corners?/i,
    type: NormalizedMarketType.CORNERS_TEAM,
  },
  // Total cards with line
  {
    pattern: /^(kartk[ai]|cards?)\s*[-:]?\s*(\d+[.,]?\d*)/i,
    type: NormalizedMarketType.CARDS_TOTAL,
    extractParam: (m) => m[2]?.replace(",", "."),
  },
  {
    pattern: /^liczba\s*kartek/i,
    type: NormalizedMarketType.CARDS_TOTAL,
  },
  {
    pattern: /^(suma\s*)?(kartk[ai]|cards?)$/i,
    type: NormalizedMarketType.CARDS_TOTAL,
  },
  {
    pattern: /total\s*(booking|card)s?/i,
    type: NormalizedMarketType.CARDS_TOTAL,
  },
  // Team cards
  {
    pattern: /(kartk[ai]|cards?).*dru[żz]yn/i,
    type: NormalizedMarketType.CARDS_TEAM,
  },
  {
    pattern: /dru[żz]yn.*(kartk|card)/i,
    type: NormalizedMarketType.CARDS_TEAM,
  },
  {
    pattern: /team\s*(booking|card)s?/i,
    type: NormalizedMarketType.CARDS_TEAM,
  },
  // Fouls
  {
    pattern: /^faul[eiy]?\s*[-:]?\s*(\d+)?/i,
    type: NormalizedMarketType.FOULS_TOTAL,
  },
  {
    pattern: /^liczba\s*faul/i,
    type: NormalizedMarketType.FOULS_TOTAL,
  },
  {
    pattern: /total\s*fouls?/i,
    type: NormalizedMarketType.FOULS_TOTAL,
  },
  // Offsides
  {
    pattern: /^(spalon[ey]|offside)/i,
    type: NormalizedMarketType.OFFSIDES_TOTAL,
  },
  {
    pattern: /^liczba\s*(spalon|offside)/i,
    type: NormalizedMarketType.OFFSIDES_TOTAL,
  },
  {
    pattern: /total\s*offside/i,
    type: NormalizedMarketType.OFFSIDES_TOTAL,
  },
];

// ============================================================================
// KOMBINACJE (Combination Markets) Patterns
// ============================================================================

/**
 * Patterns for combination markets:
 * - Result + BTTS
 * - Result + Over/Under
 * - HT/FT (Halftime/Fulltime)
 * - Double Result
 */
export const COMBINATION_MARKET_PATTERNS: MarketPattern[] = [
  // Result + BTTS
  {
    pattern: /^(wynik|1x2)\s*[+&i]\s*(obie|btts|gg)/i,
    type: NormalizedMarketType.RESULT_AND_BTTS,
  },
  {
    pattern: /^(obie|btts|gg)\s*[+&i]\s*(wynik|1x2)/i,
    type: NormalizedMarketType.RESULT_AND_BTTS,
  },
  {
    pattern: /wynik.*obie.*strzel/i,
    type: NormalizedMarketType.RESULT_AND_BTTS,
  },
  {
    pattern: /obie.*strzel.*wynik/i,
    type: NormalizedMarketType.RESULT_AND_BTTS,
  },
  {
    pattern: /match\s*result.*btts/i,
    type: NormalizedMarketType.RESULT_AND_BTTS,
  },
  {
    pattern: /btts.*match\s*result/i,
    type: NormalizedMarketType.RESULT_AND_BTTS,
  },
  // Result + Over/Under
  {
    pattern: /^(wynik|1x2)\s*[+&i]\s*(liczba|over|under|o\/u|\d)/i,
    type: NormalizedMarketType.RESULT_AND_TOTAL,
  },
  {
    pattern: /^(liczba|over|under|o\/u).*[+&i]\s*(wynik|1x2)/i,
    type: NormalizedMarketType.RESULT_AND_TOTAL,
  },
  {
    pattern: /wynik.*liczba\s*(gol|bramek)/i,
    type: NormalizedMarketType.RESULT_AND_TOTAL,
  },
  {
    pattern: /match\s*result.*(over|under|total)/i,
    type: NormalizedMarketType.RESULT_AND_TOTAL,
  },
  // HT/FT (Halftime/Fulltime)
  {
    pattern: /^(1\.?\s*po[łl]|ht)\s*[\/\-]\s*(2\.?\s*po[łl]|ft|wynik|mecz)/i,
    type: NormalizedMarketType.HALFTIME_FULLTIME,
  },
  {
    pattern: /^po[łl][oó]wa\s*[\/\-]\s*(mecz|koniec|wynik)/i,
    type: NormalizedMarketType.HALFTIME_FULLTIME,
  },
  {
    pattern: /^ht\s*[\/\-]\s*ft$/i,
    type: NormalizedMarketType.HALFTIME_FULLTIME,
  },
  {
    pattern: /half\s*time.*full\s*time/i,
    type: NormalizedMarketType.HALFTIME_FULLTIME,
  },
  // Double Result
  {
    pattern: /^podw[oó]jny\s*wynik/i,
    type: NormalizedMarketType.DOUBLE_RESULT,
  },
  {
    pattern: /double\s*result/i,
    type: NormalizedMarketType.DOUBLE_RESULT,
  },
];

// ============================================================================
// GOALS MARKETS Patterns
// ============================================================================

/**
 * Patterns for goals-related markets:
 * - Both Teams To Score (BTTS)
 * - Total Goals (Over/Under)
 * - Half-time Total Goals
 * - Odd/Even Goals
 * - Win to Nil
 * - Clean Sheet
 */
export const GOALS_MARKET_PATTERNS: MarketPattern[] = [
  // Both Teams To Score (BTTS) - Check BEFORE Total Goals to avoid misclassification
  {
    pattern: /^(obie|obobie|dru[żz]yny)\s*(strzel[ąa]|gola|bramk)/i,
    type: NormalizedMarketType.BTTS,
  },
  {
    pattern: /^(btts|gg|both\s*teams\s*to\s*score)/i,
    type: NormalizedMarketType.BTTS,
  },
  {
    pattern: /strzel[ąa]\s*(obie|obobie)/i,
    type: NormalizedMarketType.BTTS,
  },
  // Total Goals with line parameter
  {
    pattern: /^liczba\s*(gol[ioó]w?|bramek)\s*[-:]?\s*(\d+[.,]?\d*)/i,
    type: NormalizedMarketType.TOTAL_GOALS,
    extractParam: (m) => m[2]?.replace(",", "."),
  },
  {
    pattern: /^(gole|goli|bramki|bramek|goals?)\s*[-:]?\s*(\d+[.,]?\d*)/i,
    type: NormalizedMarketType.TOTAL_GOALS,
    extractParam: (m) => m[2]?.replace(",", "."),
  },
  {
    pattern: /^(suma\s*)?(gol[ioów]s*|bramek)\s*[-:]?\s*(\d+[.,]?\d*)/i,
    type: NormalizedMarketType.TOTAL_GOALS,
    extractParam: (m) => m[3]?.replace(",", "."),
  },
  {
    pattern: /^total\s*(goals?|gols?|goli)\s*[-:]?\s*(\d+[.,]?\d*)/i,
    type: NormalizedMarketType.TOTAL_GOALS,
    extractParam: (m) => m[2]?.replace(",", "."),
  },
  // Total Goals generic (without line)
  {
    pattern: /^liczba\s*(gol[ioó]w?|bramek)/i,
    type: NormalizedMarketType.TOTAL_GOALS,
  },
  {
    pattern: /^(suma\s*)?(gol[ioów]s*|bramek)$/i,
    type: NormalizedMarketType.TOTAL_GOALS,
  },
  {
    pattern: /^total\s*(goals?|gols?|goli)$/i,
    type: NormalizedMarketType.TOTAL_GOALS,
  },
  // Half-time Total Goals with line parameter
  {
    pattern: /^(1\.?\s*po[łl][aoó]wa|1st\s*half|ht)\s*(liczba\s*)?(gol[ioó]w?|bramek)\s*[-:]?\s*(\d+[.,]?\d*)/i,
    type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    extractParam: (m) => m[4]?.replace(",", "."),
  },
  {
    pattern: /^(liczba\s*)?(gol[ioó]w?|bramek)\s*(1\.?\s*po[łl][aoó]wy|1st\s*half|ht)/i,
    type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
  },
  {
    pattern: /^half\s*time\s*total\s*goals?\s*[-:]?\s*(\d+[.,]?\d*)/i,
    type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    extractParam: (m) => m[1]?.replace(",", "."),
  },
  // Half-time BTTS
  {
    pattern: /^(1\.?\s*po[łl][aoó]wa|1st\s*half|ht)\s*(obie|btts|gg)/i,
    type: NormalizedMarketType.HALF_TIME_BTTS,
  },
  {
    pattern: /^(obie|btts|gg)\s*(1\.?\s*po[łl][aoó]wy|1st\s*half|ht)/i,
    type: NormalizedMarketType.HALF_TIME_BTTS,
  },
  // Odd/Even Goals
  {
    pattern: /^(parzyst[ea]?\s*\/?\s*nieparzyst[ea]?|nieparzyst[ea]?\s*\/?\s*parzyst[ea]?)$/i,
    type: NormalizedMarketType.ODD_EVEN_GOALS,
  },
  {
    pattern: /^odd\s*\/?\s*even$/i,
    type: NormalizedMarketType.ODD_EVEN_GOALS,
  },
  {
    pattern: /^even\s*\/?\s*odd$/i,
    type: NormalizedMarketType.ODD_EVEN_GOALS,
  },
  // Win to Nil
  {
    pattern: /^(wygrana\s*do\s*zera|win\s*to\s*nil)/i,
    type: NormalizedMarketType.WIN_TO_NIL,
  },
  // Clean Sheet
  {
    pattern: /^(czyste\s*konto|clean\s*sheet)/i,
    type: NormalizedMarketType.CLEAN_SHEET,
  },
];

// ============================================================================
// Combined export for easy import
// ============================================================================

/**
 * All common patterns combined in order of priority
 */
export const ALL_COMMON_PATTERNS: MarketPattern[] = [
  ...COMBINATION_MARKET_PATTERNS, // Check combos first (most specific)
  ...GOALS_MARKET_PATTERNS,       // Then goals markets (BTTS before Total Goals)
  ...STATISTICS_MARKET_PATTERNS,  // Then statistics
  ...PLAYER_MARKET_PATTERNS,      // Then player markets
];
