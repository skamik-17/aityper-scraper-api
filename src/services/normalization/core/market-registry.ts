/**
 * Market Registry - Hybrid Architecture
 *
 * Single source of truth for ALL market definitions.
 * Each market is defined once with patterns, parameters, and metadata.
 *
 * Markets are organized by category for easy navigation and maintenance.
 */

import type { MarketDefinition } from "../types.js";
import { MarketCategory } from "../types.js";

// Type aliases for cleaner code
type NormalizedMarketType = import("../types.js").NormalizedMarketType;
type NormalizedSelection = import("../types.js").NormalizedSelection;

// ==========================================================================
// MAIN MARKETS (WYNIK_MECZU)
// ==========================================================================

/**
 * Main result markets - match winner, double chance, draw no bet
 */
export const MAIN_MARKETS: MarketDefinition[] = [
  {
    id: "match-winner",
    type: "MATCH_WINNER" as const,
    category: MarketCategory.WYNIK_MECZU,
    labels: { pl: "Wynik meczu", en: "Match Winner" },
    hasParameter: false,
    selections: [
      "HOME" as const,
      "DRAW" as const,
      "AWAY" as const,
    ],
    patterns: [
      /^wynik\s*mecz(u)?$/iu,
      /^1x2$/iu,
      /^match\s*(result|winner)?$/iu,
      /^ko[ņń]cowy\s*wynik$/iu,
    ],
    bookmakerData: {
      sts: {
        idMappings: [1, 40, 41, 42, 63, 64, 65, 66, 71, 94, 102, 106, 119, 1244],
      },
    },
  },
  {
    id: "double-chance",
    type: "DOUBLE_CHANCE" as const,
    category: MarketCategory.WYNIK_MECZU,
    labels: { pl: "Podwójna szansa", en: "Double Chance" },
    hasParameter: false,
    selections: [
      "HOME_OR_DRAW" as const,
      "DRAW_OR_AWAY" as const,
      "HOME_OR_AWAY" as const,
    ],
    patterns: [
      /^podw[oó]jna\s*szans/iu,
      /^double\s*chance/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [10] },
    },
  },
  {
    id: "draw-no-bet",
    type: "DRAW_NO_BET" as const,
    category: MarketCategory.WYNIK_MECZU,
    labels: { pl: "Remis = zwrot", en: "Draw No Bet" },
    hasParameter: false,
    selections: ["HOME" as const, "AWAY" as const],
    patterns: [
      /^remis\s*=\s*zwrot/iu,
      /^draw\s*no\s*bet/iu,
      /^dnb$/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [4, 20, 77] },
    },
  },
];

// ==========================================================================
// GOALS MARKETS (GOLE)
// ==========================================================================

/**
 * Goals-related markets
 */
export const GOALS_MARKETS: MarketDefinition[] = [
  {
    id: "total-goals",
    type: "TOTAL_GOALS" as const,
    category: MarketCategory.GOLE,
    labels: { pl: "Liczba goli", en: "Total Goals" },
    hasParameter: true,
    parameterType: "decimal-line",
    validParameters: ["0.5", "1.5", "2.5", "3.5", "4.5", "5.5", "6.5", "7.5"],
    selections: ["OVER" as const, "UNDER" as const],
    patterns: [
      /^liczba\s*(gol[ioó]w?|bramek)\s*[-:]?\s*(\d+[.,]?\d*)/iu,
      /^(suma\s*)?(gol[ioów]s*|bramek)\s*[-:]?\s*(\d+[.,]?\d*)/iu,
      /^total\s*goals?\s*[-:]?\s*(\d+[.,]?\d*)/iu,
      /^(powyżej|poniżej|over|under)\s*(\d+[.,]?\d*)\s*(gol[ioó]w?|bramek)?/iu,
      /^(over|under)\s*\/\s*(over|under)\s*(\d+[.,]?\d*)/iu,
    ],
    extractParam: (m) => {
      // Try to find the number in different capture groups
      for (let i = 1; i < m.length; i++) {
        const num = m[i]?.replace(",", ".");
        if (num && /^\d+[.,]?\d*$/.test(num)) {
          return num;
        }
      }
      return undefined;
    },
    bookmakerData: {
      sts: {
        idMappings: [25, 8, 11, 23, 28, 73, 74, 75, 80, 103, 104, 105],
      },
    },
  },
  {
    id: "btts",
    type: "BTTS" as const,
    category: MarketCategory.GOLE,
    labels: { pl: "Obie strzelą", en: "Both Teams to Score" },
    hasParameter: false,
    selections: ["YES" as const, "NO" as const],
    patterns: [
      /^(obie|obobie|dru[żz]yny)\s*(strzel[ąa]|gola|bramk)/iu,
      /^(btts|gg|both\s*teams\s*to\s*score)/iu,
      /^(obie|both).*(strzel[ąa]|score)/iu,
    ],
    bookmakerData: {
      sts: {
        idMappings: [
          43, 47, 48, 59, 60, 61, 62, 67, 68, 69, 70, 95, 107, 109, 110,
          112, 115, 118, 120, 121, 1232, 1233, 1234, 1235, 1224, 1229, 1855,
          196, 197, 198, 217,
        ],
      },
    },
  },
  {
    id: "home-team-to-score",
    type: "HOME_TEAM_TO_SCORE" as const,
    category: MarketCategory.GOLE,
    subCategory: "team-goals",
    labels: { pl: "Gospodarz strzeli gola", en: "Home Team to Score" },
    hasParameter: false,
    selections: ["HOME" as const, "AWAY" as const], // HOME=will score, AWAY=won't score
    patterns: [
      /^gospodarz\s+strzeli\s+gola?$/iu,
      /^([\w\s\u0100-\u017F]+)\s+strzeli\s+gola?$/iu, // Team name captured
      /^([\w\s\u0100-\u017F]+)\s+to\s+score$/iu,
    ],
  },
  {
    id: "away-team-to-score",
    type: "AWAY_TEAM_TO_SCORE" as const,
    category: MarketCategory.GOLE,
    subCategory: "team-goals",
    labels: { pl: "Goście strzelą gola", en: "Away Team to Score" },
    hasParameter: false,
    selections: ["AWAY" as const, "HOME" as const], // AWAY=will score, HOME=won't score
    patterns: [
      /^go[śćś]cie\s+strzel[ąa]\s+gola?$/iu,
      /^([\w\s\u0100-\u017F]+)\s+won['\u2019]t\s+score$/iu,
    ],
  },
  {
    id: "win-to-nil",
    type: "WIN_TO_NIL" as const,
    category: MarketCategory.GOLE,
    labels: { pl: "Wygrana do zera", en: "Win to Nil" },
    hasParameter: false,
    selections: ["HOME" as const, "AWAY" as const],
    patterns: [
      /^(wygran.*zer|win.*nil|to.*nil)/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [35, 90] },
    },
  },
  {
    id: "clean-sheet",
    type: "CLEAN_SHEET" as const,
    category: MarketCategory.GOLE,
    labels: { pl: "Czyste konto", en: "Clean Sheet" },
    hasParameter: false,
    selections: ["HOME" as const, "AWAY" as const],
    patterns: [
      /^(czyst.*kont|clean.*sheet)/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [36] },
    },
  },
  {
    id: "odd-even-goals",
    type: "ODD_EVEN_GOALS" as const,
    category: MarketCategory.GOLE,
    labels: { pl: "Parzyste/Nieparzyste", en: "Odd/Even Goals" },
    hasParameter: false,
    selections: ["ODD" as const, "EVEN" as const],
    patterns: [
      /^(parzyst[ea]?\s*\/?\s*nieparzyst[ea]?|nieparzyst[ea]?\s*\/?\s*parzyst[ea]?)/iu,
      /^odd\s*\/?\s*even$/iu,
    ],
  },
];

// ==========================================================================
// HANDICAP MARKETS
// ==========================================================================

/**
 * Handicap markets
 */
export const HANDICAP_MARKETS: MarketDefinition[] = [
  {
    id: "asian-handicap",
    type: "ASIAN_HANDICAP" as const,
    category: MarketCategory.HANDICAP,
    labels: { pl: "Handicap azjatycki", en: "Asian Handicap" },
    hasParameter: true,
    parameterType: "handicap",
    validParameters: [
      "-2.5", "-2.25", "-2", "-1.75", "-1.5", "-1.25", "-1", "-0.75",
      "-0.5", "-0.25", "0", "+0.25", "+0.5", "+0.75", "+1", "+1.25",
      "+1.5", "+1.75", "+2", "+2.25", "+2.5",
    ],
    selections: ["HOME" as const, "AWAY" as const],
    patterns: [
      /^handicap\s*azjatyck/iu,
      /^asian\s*handicap/iu,
    ],
    extractParam: (m) => {
      const lineMatch = m[0]?.match(/([-+]?\d+[.,]?\d*)/);
      return lineMatch?.[1]?.replace(",", ".");
    },
  },
  {
    id: "european-handicap",
    type: "EUROPEAN_HANDICAP" as const,
    category: MarketCategory.HANDICAP,
    labels: { pl: "Handicap europejski", en: "European Handicap" },
    hasParameter: true,
    parameterType: "handicap",
    validParameters: ["-3", "-2", "-1", "0", "+1", "+2", "+3"],
    selections: [
      "HOME" as const,
      "DRAW" as const,
      "AWAY" as const,
    ],
    patterns: [
      /^handicap\s*europejsk/iu,
      /^european\s*handicap/iu,
    ],
    extractParam: (m) => {
      const lineMatch = m[0]?.match(/([-+]?\d+)/);
      return lineMatch?.[1];
    },
    bookmakerData: {
      sts: { idMappings: [14, 22, 76, 79] },
    },
  },
];

// ==========================================================================
// HALF-TIME MARKETS
// ==========================================================================

/**
 * First half markets
 */
export const HALF_TIME_MARKETS: MarketDefinition[] = [
  {
    id: "half-time-result",
    type: "HALF_TIME_RESULT" as const,
    category: MarketCategory.PIERWSZA_POLOWA,
    labels: { pl: "Wynik 1. połowy", en: "Half Time Result" },
    hasParameter: false,
    selections: [
      "HOME" as const,
      "DRAW" as const,
      "AWAY" as const,
    ],
    patterns: [
      /^wynik\s*1\.?\s*po[łł]/iu,
      /^1\.?\s*po[łł].*wynik$/iu,
      /^half\s*time.*result$/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [5] },
    },
  },
  {
    id: "half-time-total-goals",
    type: "HALF_TIME_TOTAL_GOALS" as const,
    category: MarketCategory.PIERWSZA_POLOWA,
    labels: { pl: "Gole 1. połowy", en: "Half Time Total Goals" },
    hasParameter: true,
    parameterType: "decimal-line",
    validParameters: ["0.5", "1.5", "2.5"],
    selections: ["OVER" as const, "UNDER" as const],
    patterns: [
      /^1\.?\s*po[łł].*liczba\s*gol/iu,
      /^liczba\s*gol.*1\.?\s*po[łł]/iu,
      /^half\s*time\s*total\s*goals/iu,
      /^1\.?\s*po[łł].*(gol|bramk).*\s*(\d+[.,]?\d*)/iu,
    ],
    extractParam: (m) => {
      const lineMatch = m[0]?.match(/(\d+[.,]?\d*)/);
      return lineMatch?.[1]?.replace(",", ".");
    },
    bookmakerData: {
      sts: { idMappings: [26, 31, 82, 85, 88] },
    },
  },
  {
    id: "half-time-btts",
    type: "HALF_TIME_BTTS" as const,
    category: MarketCategory.PIERWSZA_POLOWA,
    labels: { pl: "Obie strzelą w 1. połowie", en: "Half Time BTTS" },
    hasParameter: false,
    selections: ["YES" as const, "NO" as const],
    patterns: [
      /^1\.?\s*po[łł].*obie\s*strzel/iu,
      /^obie\s*strzel.*1\.?\s*po[łł]/iu,
      /^1\.?\s*po[łł].*(btts|gg)/iu,
    ],
  },
];

// ==========================================================================
// CORRECT SCORE MARKETS
// ==========================================================================

/**
 * Correct score markets
 */
export const CORRECT_SCORE_MARKETS: MarketDefinition[] = [
  {
    id: "correct-score",
    type: "CORRECT_SCORE" as const,
    category: MarketCategory.DOKLADNY_WYNIK,
    labels: { pl: "Dokładny wynik", en: "Correct Score" },
    hasParameter: false,
    selections: ["HOME" as const, "DRAW" as const, "AWAY" as const],
    patterns: [
      /^dok[lł]adn.*wynik/iu,
      /^correct\s*score/iu,
      /^exact\s*score/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [9, 17, 33, 49, 57, 98, 101, 124, 125, 126] },
    },
  },
];

// ==========================================================================
// PLAYER MARKETS (ZAWODNICY)
// ==========================================================================

/**
 * Player-specific markets
 */
export const PLAYER_MARKETS: MarketDefinition[] = [
  {
    id: "goalscorer-anytime",
    type: "GOALSCORER_ANYTIME" as const,
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Strzelec bramki", en: "Goalscorer Anytime" },
    hasParameter: false,
    selections: ["HOME" as const, "AWAY" as const],
    patterns: [
      /^strzel[ei]\s*gola?$/iu,
      /^(zawodnik|gracz).*strzel/iu,
      /strzelec.*(bramki|gola)/iu,
      /anytime.*goal.*scorer/iu,
      /goalscorer.*anytime/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [52] },
    },
  },
  {
    id: "goalscorer-first",
    type: "GOALSCORER_FIRST" as const,
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Pierwszy strzelec", en: "First Goalscorer" },
    hasParameter: false,
    selections: ["HOME" as const, "AWAY" as const],
    patterns: [
      /^(pierwszy|1\.?)\s*(strzelec|gol)/iu,
      /first\s*goal\s*scorer/iu,
    ],
  },
  {
    id: "goalscorer-last",
    type: "GOALSCORER_LAST" as const,
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Ostatni strzelec", en: "Last Goalscorer" },
    hasParameter: false,
    selections: ["HOME" as const, "AWAY" as const],
    patterns: [
      /^ostatni\s*(strzelec|gol)/iu,
      /last\s*goal\s*scorer/iu,
    ],
  },
  {
    id: "player-shots",
    type: "PLAYER_SHOTS" as const,
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Strzały zawodnika", en: "Player Shots" },
    hasParameter: false,
    selections: ["HOME" as const, "AWAY" as const],
    patterns: [
      /^(strza[łl]y|shots?)\s*(zawodnik|na\s*bramk)/iu,
      /zawodnik.*(strza[łl]|shot)/iu,
      /player.*shots/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [53] },
    },
  },
  {
    id: "player-cards",
    type: "PLAYER_CARDS" as const,
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Kartki zawodnika", en: "Player Cards" },
    hasParameter: false,
    selections: ["HOME" as const, "AWAY" as const],
    patterns: [
      /^(kartk[ai]|card)\s*(zawodnik|dla)/iu,
      /zawodnik.*(kartk[aię]|card)/iu,
      /player.*(to\s*(receive|get)\s*)?card/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [54] },
    },
  },
  {
    id: "player-assists",
    type: "PLAYER_ASSISTS" as const,
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Asysty zawodnika", en: "Player Assists" },
    hasParameter: false,
    selections: ["HOME" as const, "AWAY" as const],
    patterns: [
      /^asyst[ay]?\s*(zawodnik)?/iu,
      /player.*assist/iu,
    ],
  },
];

// ==========================================================================
// STATISTICS MARKETS (STATYSTYKI)
// ==========================================================================

/**
 * Statistics markets - corners, cards, fouls, etc.
 */
export const STATISTICS_MARKETS: MarketDefinition[] = [
  {
    id: "corners-total",
    type: "CORNERS_TOTAL" as const,
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Rzuty rożne", en: "Corners" },
    hasParameter: true,
    parameterType: "decimal-line",
    validParameters: ["7.5", "8.5", "9.5", "10.5", "11.5", "12.5"],
    selections: ["OVER" as const, "UNDER" as const],
    patterns: [
      /^(rzuty?\s*ro[żz]n[ey]?|corners?)\s*[-:]?\s*(\d+[.,]?\d*)/iu,
      /^liczba\s*(rzut[oó]w?\s*ro[żz]n|corner)/iu,
      /^(suma\s*)?(rzuty?\s*ro[żz]n[ey]?|corners?)$/iu,
      /total\s*corners?\s*[-:]?\s*(\d+[.,]?\d*)/iu,
    ],
    extractParam: (m) => m[2]?.replace(",", "."),
  },
  {
    id: "corners-team",
    type: "CORNERS_TEAM" as const,
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Rzuty rożne drużyny", en: "Team Corners" },
    hasParameter: true,
    parameterType: "decimal-line",
    selections: ["OVER" as const, "UNDER" as const],
    patterns: [
      /(rzuty?\s*ro[żz]n[ey]?|corners?).*dru[żz]yn/iu,
      /dru[żz]yn.*(rzuty?\s*ro[żz]n|corner)/iu,
      /team.*corners?/iu,
    ],
  },
  {
    id: "cards-total",
    type: "CARDS_TOTAL" as const,
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Liczba kartek", en: "Total Cards" },
    hasParameter: true,
    parameterType: "decimal-line",
    validParameters: ["3.5", "4.5", "5.5", "6.5", "7.5"],
    selections: ["OVER" as const, "UNDER" as const],
    patterns: [
      /^(kartk[ai]|cards?)\s*[-:]?\s*(\d+[.,]?\d*)/iu,
      /^liczba\s*kartek/iu,
      /^(suma\s*)?(kartk[ai]|cards?)$/iu,
      /total\s*(booking|card)s?\s*[-:]?\s*(\d+[.,]?\d*)/iu,
    ],
    extractParam: (m) => m[2]?.replace(",", "."),
  },
  {
    id: "cards-team",
    type: "CARDS_TEAM" as const,
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Kartki drużyny", en: "Team Cards" },
    hasParameter: false,
    selections: ["HOME" as const, "AWAY" as const],
    patterns: [
      /(kartk[ai]|cards?).*dru[żz]yn/iu,
      /dru[żz]yn.*(kartk|card)/iu,
      /team.*(booking|card)s?/iu,
    ],
  },
  {
    id: "fouls-total",
    type: "FOULS_TOTAL" as const,
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Faule", en: "Fouls" },
    hasParameter: true,
    parameterType: "decimal-line",
    selections: ["OVER" as const, "UNDER" as const],
    patterns: [
      /^faul[eiy]?\s*[-:]?\s*(\d+)?/iu,
      /^liczba\s*faul/iu,
      /total\s*fouls?/iu,
    ],
  },
  {
    id: "offsides-total",
    type: "OFFSIDES_TOTAL" as const,
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Spalone", en: "Offsides" },
    hasParameter: true,
    parameterType: "decimal-line",
    selections: ["OVER" as const, "UNDER" as const],
    patterns: [
      /^(spalon[ey]|offside)/iu,
      /^liczba\s*(spalon|offside)/iu,
      /total\s*offside/iu,
    ],
  },
];

// ==========================================================================
// COMBINATION MARKETS (KOMBINACJE)
// ==========================================================================

/**
 * Combination markets - Result + BTTS, Result + O/U, HT/FT
 */
export const COMBINATION_MARKETS: MarketDefinition[] = [
  {
    id: "result-and-btts",
    type: "RESULT_AND_BTTS" as const,
    category: MarketCategory.KOMBINACJE,
    labels: { pl: "Wynik + obie strzelą", en: "Result & BTTS" },
    hasParameter: false,
    selections: [
      "HOME" as const,
      "DRAW" as const,
      "AWAY" as const,
    ],
    patterns: [
      /^(wynik|1x2)\s*[+&i]\s*(obie|btts|gg)/iu,
      /^(obie|btts|gg)\s*[+&i]\s*(wynik|1x2)/iu,
      /wynik.*obie.*strzel/iu,
      /obie.*strzel.*wynik/iu,
      /match\s*result.*btts/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [50] },
    },
  },
  {
    id: "result-and-total",
    type: "RESULT_AND_TOTAL" as const,
    category: MarketCategory.KOMBINACJE,
    labels: { pl: "Wynik + gole", en: "Result & Total" },
    hasParameter: true,
    selections: [
      "HOME" as const,
      "DRAW" as const,
      "AWAY" as const,
    ],
    patterns: [
      /^(wynik|1x2)\s*[+&i]\s*(liczba|over|under|o\/iu|\d)/iu,
      /^(liczba|over|under|o\/iu).*[+&i]\s*(wynik|1x2)/iu,
      /wynik.*liczba\s*(gol|bramek)/iu,
      /match\s*result.*(over|under|total)/iu,
    ],
    bookmakerData: {
      sts: {
        idMappings: [
          51, 99, 807, 808, 809, 810, 811, 812, 813, 814, 815, 816,
          817, 818,
        ],
      },
    },
  },
  {
    id: "halftime-fulltime",
    type: "HALFTIME_FULLTIME" as const,
    category: MarketCategory.KOMBINACJE,
    labels: { pl: "Połowa/Mecz", en: "Half Time / Full Time" },
    hasParameter: false,
    selections: [
      "HOME" as const,
      "DRAW" as const,
      "AWAY" as const,
    ],
    patterns: [
      /^(1\.?\s*po[łł]|ht)\s*[\/\-]\s*(2\.?\s*po[łł]|ft|wynik|mecz)/iu,
      /^po[łł][oó]wa\s*[\/\-]\s*(mecz|koniec|wynik)/iu,
      /^ht\s*[\/\-]\s*ft$/iu,
      /half\s*time.*full\s*time/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [1012] },
    },
  },
  {
    id: "double-result",
    type: "DOUBLE_RESULT" as const,
    category: MarketCategory.KOMBINACJE,
    labels: { pl: "Podwójny wynik", en: "Double Result" },
    hasParameter: false,
    selections: [
      "HOME" as const,
      "DRAW" as const,
      "AWAY" as const,
    ],
    patterns: [
      /^podw[oó]jny\s*wynik/iu,
      /double\s*result/iu,
    ],
  },
];

// ==========================================================================
// COMPLETE REGISTRY
// ==========================================================================

/**
 * Complete market registry
 * Contains all market definitions organized by category
 */
export const MARKET_REGISTRY: MarketDefinition[] = [
  ...MAIN_MARKETS,
  ...GOALS_MARKETS,
  ...HANDICAP_MARKETS,
  ...HALF_TIME_MARKETS,
  ...CORRECT_SCORE_MARKETS,
  ...PLAYER_MARKETS,
  ...STATISTICS_MARKETS,
  ...COMBINATION_MARKETS,
];

// ==========================================================================
// Helper Functions
// ==========================================================================

/**
 * Get market definition by ID
 */
export function getMarketById(id: string): MarketDefinition | undefined {
  return MARKET_REGISTRY.find((m) => m.id === id);
}

/**
 * Get markets by category
 */
export function getMarketsByCategory(
  category: MarketCategory
): MarketDefinition[] {
  return MARKET_REGISTRY.filter((m) => m.category === category);
}

/**
 * Get market definition by type
 */
export function getMarketByType(
  type: NormalizedMarketType
): MarketDefinition | undefined {
  return MARKET_REGISTRY.find((m) => m.type === type);
}
