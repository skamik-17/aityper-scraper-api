/**
 * Unified Market Registry
 *
 * Single source of truth for ALL market definitions.
 * Combines UI metadata (viewType, displayOrder, descriptions) with
 * normalization metadata (patterns, extractParam, bookmakerData).
 *
 * Each market is defined once with all its properties.
 */

import {
  MarketCategory,
  ViewType,
  NormalizedMarketType,
  ParameterType,
  NormalizedSelection,
} from "../services/normalization/types.js";

// ============================================================================
// Interfaces
// ============================================================================




/**
 * Bookmaker-specific market data
 */
export interface BookmakerMarketData {
  /** ID mappings for "Rynek XX" format (STS-style) */
  idMappings?: number[];
  /** Additional patterns specific to this bookmaker */
  additionalPatterns?: RegExp[];
  /** Different display name for this bookmaker */
  displayName?: string;
}

/**
 * Unified Market Definition
 *
 * Complete specification combining:
 * - Database identifiers (numericId for FK, code for type)
 * - UI metadata (viewType, displayOrder, descriptions)
 * - Normalization metadata (patterns, extractParam, bookmakerData)
 */
export interface UnifiedMarketDefinition {
  // ===== Identification =====
  /** Numeric ID for database foreign key (1-40) */
  numericId: number;
  /** Canonical type code: "MATCH_WINNER", "TOTAL_GOALS", etc. */
  code: NormalizedMarketType;
  /** Human-readable slug: "match-winner", "total-goals" */
  slug: string;

  // ===== Category =====
  /** Category for UI organization */
  category: MarketCategory;
  /** Optional sub-category for finer grouping */
  subCategory?: string;

  // ===== Labels & Descriptions =====
  /** Display labels */
  labels: {
    pl: string;
    en: string;
  };
  /** Descriptions for tooltips/help */
  descriptions: {
    pl: string;
    en: string;
  };

  // ===== Parameters =====
  /** Has parameter (line value like 2.5, +1, etc.) */
  hasParameter: boolean;
  /** Parameter type if applicable */
  parameterType?: ParameterType;
  /** Valid parameter values */
  validParameters?: string[];

  // ===== Selections =====
  /** Expected selection types */
  selections: string[];

  // ===== UI =====
  /** View type for UI rendering */
  viewType: ViewType;
  /** Display order within category */
  displayOrder: number;

  // ===== Pattern Matching (for normalization) =====
  /** Patterns to match market names (ordered by specificity) */
  patterns: RegExp[];
  /** Extract parameter from pattern match */
  extractParam?: (match: RegExpMatchArray) => string | undefined;

  // ===== Bookmaker-specific data =====
  /** Bookmaker-specific overrides and mappings */
  bookmakerData?: Record<string, BookmakerMarketData>;
}

// ============================================================================
// MARKET DEFINITIONS
// ============================================================================

// Helper for extracting decimal parameters from regex match
const extractDecimalParam = (m: RegExpMatchArray): string | undefined => {
  for (let i = 1; i < m.length; i++) {
    const num = m[i]?.replace(",", ".");
    if (num && /^\d+[.,]?\d*$/.test(num)) {
      return num;
    }
  }
  return undefined;
};

// -----------------------------------------------------------------------------
// WYNIK MECZU (Match Result) - 3 markets
// -----------------------------------------------------------------------------

const MAIN_MARKETS: UnifiedMarketDefinition[] = [
  {
    numericId: 1,
    code: "MATCH_WINNER",
    slug: "match-winner",
    category: MarketCategory.WYNIK_MECZU,
    labels: { pl: "Wynik meczu", en: "Match Result" },
    descriptions: {
      pl: "Obstawiasz kto wygra mecz (1X2)",
      en: "Bet on match result (1X2)",
    },
    hasParameter: false,
    selections: ["HOME", "DRAW", "AWAY"],
    viewType: ViewType.TRIPLE_BUTTONS,
    displayOrder: 1,
    patterns: [
      /^wynik\s*mecz(u)?$/iu,
      /^1x2$/iu,
      /^match\s*(result|winner)?$/iu,
      /^ko[ņń]cowy\s*wynik$/iu,
      /^zwyci[eę]zca\s*meczu?$/iu,
      /^mecz$/iu,
    ],
    bookmakerData: {
      sts: {
        idMappings: [1, 40, 41, 42, 63, 64, 65, 66, 71, 94, 102, 106, 119, 1244],
      },
    },
  },
  {
    numericId: 2,
    code: "DOUBLE_CHANCE",
    slug: "double-chance",
    category: MarketCategory.WYNIK_MECZU,
    labels: { pl: "Podwójna szansa", en: "Double Chance" },
    descriptions: {
      pl: "Obstawiasz dwa możliwe wyniki (1X, X2, 12)",
      en: "Bet on two possible outcomes",
    },
    hasParameter: false,
    selections: ["HOME_OR_DRAW", "DRAW_OR_AWAY", "HOME_OR_AWAY"],
    viewType: ViewType.TRIPLE_BUTTONS,
    displayOrder: 2,
    patterns: [
      /^podw[oó]jna\s*szans/iu,
      /^double\s*chance/iu,
      /^dc$/iu,
      /^szans[ay]\s*podw[oó]jn/iu,
      /^dw[oó]jtyp$/iu,
      /szansa$/iu,
      /dw[oó]jtyp$/iu,
      /podw[oó]jna\s*szans/iu,
      /^mecz.*podw[oó]jna\s*szans/iu,
      /^mecz.*dw[oó]jtyp/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [10] },
    },
  },
  {
    numericId: 3,
    code: "DRAW_NO_BET",
    slug: "draw-no-bet",
    category: MarketCategory.WYNIK_MECZU,
    labels: { pl: "Remis bez zakładu", en: "Draw No Bet" },
    descriptions: {
      pl: "Przy remisie zwrot stawki",
      en: "Stake returned if draw",
    },
    hasParameter: false,
    selections: ["HOME", "AWAY"],
    viewType: ViewType.BINARY_BUTTONS,
    displayOrder: 3,
    patterns: [
      /^remis\s*=\s*zwrot/iu,
      /^draw\s*no\s*bet/iu,
      /^dnb$/iu,
      /^bez\s*remisu$/iu,
      /^level\s*handicap$/iu,
      /^zak[łl]ad\s*bez\s*remisu$/iu,
    ],
    bookmakerData: {
      // Market 20 = "Zakład bez remisu", Market 77 = "1. połowa - zakład bez remisu"
      // Markets 259, 314, 368 = "Zwycięzca walki"/"Zwycięzca meczu" (2-way winner)
      sts: { idMappings: [20, 77, 259, 314, 368] },
    },
  },
];

// -----------------------------------------------------------------------------
// GOLE (Goals) - 11 markets
// -----------------------------------------------------------------------------

const GOALS_MARKETS: UnifiedMarketDefinition[] = [
  {
    numericId: 4,
    code: "TOTAL_GOALS",
    slug: "total-goals",
    category: MarketCategory.GOLE,
    labels: { pl: "Liczba goli", en: "Total Goals" },
    descriptions: {
      pl: "Obstawiasz czy padnie więcej/mniej goli niż linia",
      en: "Bet on total goals over/under a line",
    },
    hasParameter: true,
    parameterType: "decimal",
    validParameters: ["0.5", "1.5", "2.5", "3.5", "4.5", "5.5", "6.5", "7.5"],
    selections: ["OVER", "UNDER"],
    viewType: ViewType.PARAMETER_SLIDER,
    displayOrder: 10,
    patterns: [
      /^liczba\s*(gol[ioó]w?|bramek)\s*[-:]?\s*(\d+[.,]?\d*)?$/iu,
      /^(suma\s*)?(gol[ioówae]*|bramek)\s*[-:]?\s*(\d+[.,]?\d*)?$/iu,
      /^total\s*goals?\s*[-:]?\s*(\d+[.,]?\d*)?$/iu,
      /^(powyżej|poniżej|powyzej|ponizej|over|under)\s*[\/]?\s*(powyżej|poniżej|powyzej|ponizej|over|under)?\s*(\d+[.,]?\d*)\s*(gol[ioó]w?|bramek)?/iu,
      /^(over|under)\s*\/\s*(over|under)\s*(\d+[.,]?\d*)/iu,
      /^o\/?u\s*(\d+[.,]?\d*)/iu,
      /^gole?\s*[-:]?\s*(\d+[.,]?\d*)?$/iu,
    ],
    extractParam: extractDecimalParam,
    bookmakerData: {
      sts: {
        idMappings: [25, 8, 11, 23, 28, 73, 74, 75, 80, 103, 104, 105],
      },
    },
  },
  {
    numericId: 5,
    code: "BTTS",
    slug: "btts",
    category: MarketCategory.GOLE,
    labels: { pl: "Obie strzelą", en: "Both Teams To Score" },
    descriptions: {
      pl: "Czy obie drużyny strzelą gola?",
      en: "Will both teams score?",
    },
    hasParameter: false,
    selections: ["YES", "NO"],
    viewType: ViewType.BINARY_BUTTONS,
    displayOrder: 11,
    patterns: [
      /^(obie|obobie|dru[żz]yny)\s*(strzel[ąa]|gola|bramk)/iu,
      /^(btts|both\s*teams\s*to\s*score)$/iu,
      /^(gg|ng)(\s*\/\s*(gg|ng))?$/iu,
      /^obie\s*dru[żz]yny\s*strzel[ąa]\s*gola?$/iu,
      /^czy\s*obie.*strzel/iu,
      /^obie\s*dru[żz]yny\s*strzel/iu,
      /^mecz.*obie.*strzel/iu,
    ],
    bookmakerData: {
      // Core BTTS markets and team-specific variants
      sts: {
        idMappings: [
          43, 47, 48, 59, 60, 61, 62, 67, 68, 69, 70, 95, 107, 109, 110,
          112, 115, 118, 120, 121, 1232, 1233, 1234, 1235, 1224, 1229,
        ],
      },
    },
  },
  {
    numericId: 6,
    code: "ODD_EVEN_GOALS",
    slug: "odd-even-goals",
    category: MarketCategory.GOLE,
    labels: { pl: "Parzyste/Nieparzyste", en: "Odd/Even Goals" },
    descriptions: {
      pl: "Czy łączna liczba goli będzie parzysta czy nieparzysta?",
      en: "Will total goals be odd or even?",
    },
    hasParameter: false,
    selections: ["ODD", "EVEN"],
    viewType: ViewType.BINARY_BUTTONS,
    displayOrder: 12,
    patterns: [
      /^(parzyst[ea]?\s*\/?\s*nieparzyst[ea]?|nieparzyst[ea]?\s*\/?\s*parzyst[ea]?)/iu,
      /^odd\s*\/?\s*even$/iu,
    ],
  },
  {
    numericId: 7,
    code: "WIN_TO_NIL",
    slug: "win-to-nil",
    category: MarketCategory.GOLE,
    labels: { pl: "Wygrana do zera", en: "Win To Nil" },
    descriptions: {
      pl: "Drużyna wygra nie tracąc gola",
      en: "Team wins without conceding",
    },
    hasParameter: false,
    selections: ["HOME", "AWAY"],
    viewType: ViewType.BINARY_BUTTONS,
    displayOrder: 13,
    patterns: [
      /^(wygran.*zer|win.*nil|to.*nil)/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [35, 90] },
    },
  },
  {
    numericId: 8,
    code: "CLEAN_SHEET",
    slug: "clean-sheet",
    category: MarketCategory.GOLE,
    labels: { pl: "Czyste konto", en: "Clean Sheet" },
    descriptions: {
      pl: "Drużyna nie straci gola",
      en: "Team keeps clean sheet",
    },
    hasParameter: false,
    selections: ["HOME", "AWAY"],
    viewType: ViewType.BINARY_BUTTONS,
    displayOrder: 14,
    patterns: [
      /^(czyst.*kont|clean.*sheet)/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [36] },
    },
  },
  {
    numericId: 9,
    code: "HOME_TEAM_TO_SCORE",
    slug: "home-team-to-score",
    category: MarketCategory.GOLE,
    subCategory: "team-goals",
    labels: { pl: "Gospodarz strzeli", en: "Home Team To Score" },
    descriptions: {
      pl: "Czy drużyna gospodarzy strzeli gola?",
      en: "Will home team score?",
    },
    hasParameter: false,
    selections: ["YES", "NO"],
    viewType: ViewType.BINARY_BUTTONS,
    displayOrder: 15,
    patterns: [
      /^gospodarz\s+strzeli\s+gola?$/iu,
      /^([\w\s\u0100-\u017F]+)\s+strzeli\s+gola?$/iu,
      /^([\w\s\u0100-\u017F]+)\s+to\s+score$/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [1229] }, // Market 1229 = "1. drużyna - strzeli gola"
    },
  },
  {
    numericId: 10,
    code: "AWAY_TEAM_TO_SCORE",
    slug: "away-team-to-score",
    category: MarketCategory.GOLE,
    subCategory: "team-goals",
    labels: { pl: "Gość strzeli", en: "Away Team To Score" },
    descriptions: {
      pl: "Czy drużyna gości strzeli gola?",
      en: "Will away team score?",
    },
    hasParameter: false,
    selections: ["YES", "NO"],
    viewType: ViewType.BINARY_BUTTONS,
    displayOrder: 16,
    patterns: [
      /^go[śćś]cie\s+strzel[ąa]\s+gola?$/iu,
      /^([\w\s\u0100-\u017F]+)\s+won['\u2019]t\s+score$/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [1224] }, // Market 1224 = "2. drużyna - strzeli gola"
    },
  },
  {
    numericId: 11,
    code: "TEAM_TOTAL_GOALS",
    slug: "team-total-goals",
    category: MarketCategory.GOLE,
    subCategory: "team-goals",
    labels: { pl: "Gole drużyny", en: "Team Total Goals" },
    descriptions: {
      pl: "Liczba goli konkretnej drużyny",
      en: "Goals scored by specific team",
    },
    hasParameter: true,
    parameterType: "decimal",
    validParameters: ["0.5", "1.5", "2.5", "3.5"],
    selections: ["HOME_OVER", "HOME_UNDER", "AWAY_OVER", "AWAY_UNDER"],
    viewType: ViewType.PARAMETER_SLIDER,
    displayOrder: 17,
    patterns: [
      /^gole?\s*(gospodarzy?|go[śs]ci)\s*[-:]?\s*(\d+[.,]?\d*)/iu,
      /^(home|away)\s*team\s*(total\s*)?goals?\s*[-:]?\s*(\d+[.,]?\d*)/iu,
      /^(gospodarze?|go[śs]cie?)\s*(strzel[ąa])?\s*(over|under|o\/?u)\s*(\d+[.,]?\d*)/iu,
    ],
    extractParam: extractDecimalParam,
    bookmakerData: {
      // Market 28 = "1. drużyna - liczba goli", Market 31 = "2. drużyna - liczba goli"
      sts: { idMappings: [28, 31, 35, 36, 85, 88, 115, 118] },
    },
  },
  {
    numericId: 12,
    code: "GOAL_RANGE",
    slug: "goal-range",
    category: MarketCategory.GOLE,
    labels: { pl: "Przedział goli", en: "Goal Range" },
    descriptions: {
      pl: "W jakim przedziale będzie liczba goli?",
      en: "Goal range bracket",
    },
    hasParameter: false,
    selections: ["0-1", "2-3", "4-5", "6+"],
    viewType: ViewType.TRIPLE_BUTTONS,
    displayOrder: 18,
    patterns: [
      /^multigol/iu,
      /^goal\s*range/iu,
      /^przedzia[łl]\s*gol/iu,
      /^(\d+)\s*-\s*(\d+)\s*gol/iu,
    ],
    bookmakerData: {
      // Market 813 = "Liczba goli - przedziały", Market 816 = "Multiwynik"
      sts: { idMappings: [813, 814, 815, 816, 817, 818, 33] },
    },
  },
  {
    numericId: 13,
    code: "BOTH_HALVES_GOALS",
    slug: "both-halves-goals",
    category: MarketCategory.GOLE,
    labels: { pl: "Gole w obu połowach", en: "Goals In Both Halves" },
    descriptions: {
      pl: "Czy padnie gol w obu połowach?",
      en: "Will there be goals in both halves?",
    },
    hasParameter: false,
    selections: ["YES", "NO"],
    viewType: ViewType.BINARY_BUTTONS,
    displayOrder: 19,
    patterns: [
      /^gol\s*(w\s*)?(obu|obydw[uó]ch)\s*po[łl]o?w/iu,
      /^(score|goal)\s*in\s*both\s*halves/iu,
      /^obie\s*po[łl]o?wy\s*gol/iu,
    ],
    bookmakerData: {
      // Market 69 = "Obie połowy powyżej 1.5 gola", Market 70 = "Obie połowy poniżej 1.5 gola"
      sts: { idMappings: [66, 69, 70] },
    },
  },
  {
    numericId: 14,
    code: "WINNING_MARGIN",
    slug: "winning-margin",
    category: MarketCategory.GOLE,
    labels: { pl: "Margines zwycięstwa", en: "Winning Margin" },
    descriptions: {
      pl: "Różnica bramek zwycięzcy",
      en: "Winner's goal difference",
    },
    hasParameter: true,
    parameterType: "integer",
    selections: ["HOME", "AWAY", "DRAW"],
    viewType: ViewType.PARAMETER_SLIDER,
    displayOrder: 20,
    patterns: [
      /^r[oó][żz]nica\s*(zwyci[eę]stwa|gol)/iu,
      /^winning\s*margin/iu,
      /^margines\s*(zwyci[eę]stwa|wygranej)/iu,
    ],
    bookmakerData: {
      // Market 17 = "Różnica zwycięstwa"
      sts: { idMappings: [17] },
    },
  },
  {
    numericId: 46,
    code: "FIRST_TEAM_TO_SCORE",
    slug: "first-team-to-score",
    category: MarketCategory.GOLE,
    labels: { pl: "Która drużyna strzeli gola", en: "First Team To Score" },
    descriptions: {
      pl: "Która drużyna strzeli pierwszego/ostatniego gola?",
      en: "Which team will score first/last?",
    },
    hasParameter: false,
    selections: ["HOME", "AWAY", "NONE", "BOTH"],
    viewType: ViewType.TRIPLE_BUTTONS,
    displayOrder: 21,
    patterns: [
      /^kt[oó]ra\s*dru[zż]yn[ay]?\s*strzeli\s*gola/iu,
      /^first\s*team\s*to\s*score/iu,
      /^last\s*team\s*to\s*score/iu,
    ],
    bookmakerData: {
      // Market 44 = "Która drużyna strzeli gola"
      sts: { idMappings: [44] },
    },
  },
  {
    numericId: 47,
    code: "FIRST_GOAL_TIME",
    slug: "first-goal-time",
    category: MarketCategory.GOLE,
    labels: { pl: "Czas pierwszego gola", en: "First Goal Time" },
    descriptions: {
      pl: "W którym przedziale czasowym padnie pierwszy gol?",
      en: "In which time period will the first goal be scored?",
    },
    hasParameter: false,
    selections: ["0-15", "16-30", "31-45", "46-60", "61-75", "76-90", "NONE"],
    viewType: ViewType.TRIPLE_BUTTONS,
    displayOrder: 22,
    patterns: [
      /^1\.\s*gol\s*-?\s*przedzia[łl]/iu,
      /^pierwszy\s*gol\s*-?\s*przedzia[łl]/iu,
      /first\s*goal\s*time/iu,
    ],
    bookmakerData: {
      // Market 125 = "1. gol - przedziały 15-minutowe"
      // Market 126 = "1. gol - przedziały 10-minutowe"
      sts: { idMappings: [125, 126] },
    },
  },
  {
    numericId: 48,
    code: "TIME_PERIOD_RESULT",
    slug: "time-period-result",
    category: MarketCategory.GOLE,
    labels: { pl: "Wynik w przedziale czasowym", en: "Time Period Result" },
    descriptions: {
      pl: "Jaki będzie wynik w określonym przedziale czasowym?",
      en: "What will be the result in a specific time period?",
    },
    hasParameter: true,
    parameterType: "integer",
    selections: ["HOME", "DRAW", "AWAY"],
    viewType: ViewType.TRIPLE_BUTTONS,
    displayOrder: 23,
    patterns: [
      /^wynik\s*(od|w)\s*\d+\.\s*(do\s*\d+\.?)?\s*minut/iu,
      /time\s*period\s*result/iu,
    ],
    bookmakerData: {
      // Market 132 = "Wynik od 1. do 10. minuty"
      sts: { idMappings: [132] },
    },
  },
];

// -----------------------------------------------------------------------------
// HANDICAP - 2 markets
// -----------------------------------------------------------------------------

const HANDICAP_MARKETS: UnifiedMarketDefinition[] = [
  {
    numericId: 15,
    code: "ASIAN_HANDICAP",
    slug: "asian-handicap",
    category: MarketCategory.HANDICAP,
    labels: { pl: "Handicap azjatycki", en: "Asian Handicap" },
    descriptions: {
      pl: "Wynik z uwzględnieniem przewagi/straty bramkowej",
      en: "Result with goal advantage/disadvantage",
    },
    hasParameter: true,
    parameterType: "handicap",
    validParameters: [
      "-2.5", "-2.25", "-2", "-1.75", "-1.5", "-1.25", "-1", "-0.75",
      "-0.5", "-0.25", "0", "+0.25", "+0.5", "+0.75", "+1", "+1.25",
      "+1.5", "+1.75", "+2", "+2.25", "+2.5",
    ],
    selections: ["HOME", "AWAY"],
    viewType: ViewType.HANDICAP_SELECTOR,
    displayOrder: 30,
    patterns: [
      /^handicap\s*azjatyck/iu,
      /^asian\s*handicap/iu,
      /^ah\s*([-+]?\d+[.,]?\d*)?$/iu,
      /^azj[a]?\s*hand/iu,
    ],
    extractParam: (m) => {
      const lineMatch = m[0]?.match(/([-+]?\d+[.,]?\d*)/);
      return lineMatch?.[1]?.replace(",", ".");
    },
  },
  {
    numericId: 16,
    code: "EUROPEAN_HANDICAP",
    slug: "european-handicap",
    category: MarketCategory.HANDICAP,
    labels: { pl: "Handicap europejski", en: "European Handicap" },
    descriptions: {
      pl: "Handicap z możliwością remisu",
      en: "Handicap with draw option",
    },
    hasParameter: true,
    parameterType: "handicap",
    validParameters: ["-3", "-2", "-1", "0", "+1", "+2", "+3"],
    selections: ["HOME", "DRAW", "AWAY"],
    viewType: ViewType.HANDICAP_SELECTOR,
    displayOrder: 31,
    patterns: [
      /^handicap\s*europejsk/iu,
      /^european\s*handicap/iu,
      /^eh\s*([-+]?\d+)?$/iu,
      /^handicap\s*([-+]?\d+)/iu,
      /^eur[o]?\s*hand/iu,
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

// -----------------------------------------------------------------------------
// PIERWSZA POŁOWA (Half Time) - 5 markets
// -----------------------------------------------------------------------------

const HALF_TIME_MARKETS: UnifiedMarketDefinition[] = [
  {
    numericId: 17,
    code: "HALF_TIME_RESULT",
    slug: "half-time-result",
    category: MarketCategory.PIERWSZA_POLOWA,
    labels: { pl: "Wynik 1. połowy", en: "Half Time Result" },
    descriptions: {
      pl: "Wynik po pierwszej połowie",
      en: "Result at half time",
    },
    hasParameter: false,
    selections: ["HOME", "DRAW", "AWAY"],
    viewType: ViewType.TRIPLE_BUTTONS,
    displayOrder: 40,
    patterns: [
      /^wynik\s*1\.?\s*po[łl]o?w/iu,
      /^1\.?\s*po[łl]o?w.*wynik$/iu,
      /^half\s*time.*result$/iu,
      /^ht\s*(1x2|result|wynik)/iu,
      /^pierwsz[ay]\s*po[łl]ow[ay]\s*(1x2|wynik)?$/iu,
    ],
    bookmakerData: {
      sts: { idMappings: [71] }, // Market 71 = "1. połowa" (1X2)
    },
  },
  {
    numericId: 18,
    code: "HALF_TIME_TOTAL_GOALS",
    slug: "half-time-total-goals",
    category: MarketCategory.PIERWSZA_POLOWA,
    labels: { pl: "Gole 1. połowy", en: "Half Time Goals" },
    descriptions: {
      pl: "Liczba goli w pierwszej połowie",
      en: "Goals in first half",
    },
    hasParameter: true,
    parameterType: "decimal",
    validParameters: ["0.5", "1.5", "2.5"],
    selections: ["OVER", "UNDER"],
    viewType: ViewType.PARAMETER_SLIDER,
    displayOrder: 41,
    patterns: [
      /^1\.?\s*po[łl]o?w.*liczba\s*gol/iu,
      /^liczba\s*gol.*1\.?\s*po[łl]o?w/iu,
      /^half\s*time\s*(total\s*)?goals?/iu,
      /^1\.?\s*po[łl]o?w.*(gol|bramk).*\s*(\d+[.,]?\d*)/iu,
      /^ht\s*(over|under|o\/?u)\s*(\d+[.,]?\d*)?/iu,
      /^pierwsz[ay]\s*po[łl]ow[ay]\s*(gol|o\/?u)/iu,
    ],
    extractParam: (m) => {
      const lineMatch = m[0]?.match(/(\d+[.,]?\d*)/);
      return lineMatch?.[1]?.replace(",", ".");
    },
    bookmakerData: {
      // Market 82 = "1. połowa - liczba goli", Market 31/85/88 = team-specific
      sts: { idMappings: [31, 82, 85, 88] },
    },
  },
  {
    numericId: 19,
    code: "HALF_TIME_BTTS",
    slug: "half-time-btts",
    category: MarketCategory.PIERWSZA_POLOWA,
    labels: { pl: "BTTS 1. połowa", en: "Half Time BTTS" },
    descriptions: {
      pl: "Obie strzelą w pierwszej połowie",
      en: "Both teams score in first half",
    },
    hasParameter: false,
    selections: ["YES", "NO"],
    viewType: ViewType.BINARY_BUTTONS,
    displayOrder: 42,
    patterns: [
      /^1\.?\s*po[łl]o?w.*obie\s*strzel/iu,
      /^obie\s*strzel.*1\.?\s*po[łl]o?w/iu,
      /^1\.?\s*po[łl]o?w.*(btts|gg)/iu,
      /^ht\s*(btts|gg|obie)/iu,
      /^pierwsz[ay]\s*po[łl]ow[ay]\s*(btts|gg|obie)/iu,
    ],
    bookmakerData: {
      // Market 95 = "1. połowa - obie drużyny - strzelą gola"
      sts: { idMappings: [95, 98] },
    },
  },
  {
    numericId: 20,
    code: "SECOND_HALF_RESULT",
    slug: "second-half-result",
    category: MarketCategory.PIERWSZA_POLOWA,
    labels: { pl: "Wynik 2. połowy", en: "Second Half Result" },
    descriptions: {
      pl: "Wynik drugiej połowy",
      en: "Result of second half",
    },
    hasParameter: false,
    selections: ["HOME", "DRAW", "AWAY"],
    viewType: ViewType.TRIPLE_BUTTONS,
    displayOrder: 43,
    patterns: [
      /^wynik\s*2\.?\s*po[łl]o?w/iu,
      /^2\.?\s*po[łl]o?w.*wynik/iu,
      /^second\s*half\s*result/iu,
      /^drug[aiej]\s*po[łl]ow[ay]\s*(wynik|1x2)?/iu,
    ],
    bookmakerData: {
      // Market 102 = "2. połowa" (1X2)
      sts: { idMappings: [102] },
    },
  },
  {
    numericId: 21,
    code: "SECOND_HALF_TOTAL_GOALS",
    slug: "second-half-total-goals",
    category: MarketCategory.PIERWSZA_POLOWA,
    labels: { pl: "Gole 2. połowy", en: "Second Half Goals" },
    descriptions: {
      pl: "Liczba goli w drugiej połowie",
      en: "Goals in second half",
    },
    hasParameter: true,
    parameterType: "decimal",
    validParameters: ["0.5", "1.5", "2.5"],
    selections: ["OVER", "UNDER"],
    viewType: ViewType.PARAMETER_SLIDER,
    displayOrder: 44,
    patterns: [
      /^2\.?\s*po[łl]o?w.*liczba\s*gol/iu,
      /^liczba\s*gol.*2\.?\s*po[łl]o?w/iu,
      /^second\s*half\s*(total\s*)?goals?/iu,
      /^drug[aiej]\s*po[łl]ow[ay]\s*(gol|o\/?u)/iu,
    ],
    extractParam: (m) => {
      const lineMatch = m[0]?.match(/(\d+[.,]?\d*)/);
      return lineMatch?.[1]?.replace(",", ".");
    },
    bookmakerData: {
      // Market 112 = "2. połowa - liczba goli", Market 115/118 = team-specific
      sts: { idMappings: [112, 115, 118] },
    },
  },
];

// -----------------------------------------------------------------------------
// DOKŁADNY WYNIK (Correct Score) - 1 market
// -----------------------------------------------------------------------------

const CORRECT_SCORE_MARKETS: UnifiedMarketDefinition[] = [
  {
    numericId: 22,
    code: "CORRECT_SCORE",
    slug: "correct-score",
    category: MarketCategory.DOKLADNY_WYNIK,
    labels: { pl: "Dokładny wynik", en: "Correct Score" },
    descriptions: {
      pl: "Przewidywany dokładny wynik meczu",
      en: "Exact final score prediction",
    },
    hasParameter: false,
    selections: ["SCORE"],
    viewType: ViewType.SCORE_GRID,
    displayOrder: 50,
    patterns: [
      /^dok[łl]adn.*wynik/iu,
      /^correct\s*score/iu,
      /^exact\s*score/iu,
      /^wynik\s*dok[łl]adn/iu,
      /^cs$/iu,
    ],
    bookmakerData: {
      // Market 283 = main Correct Score (35 outcomes with IDs 1783-1817)
      // Market 101 = 1st Half Correct Score, Market 124 = 2nd Half Correct Score
      // Note: Market 9 is "Ostatni gol" (Last Goal), NOT Correct Score!
      sts: { idMappings: [283, 101, 124, 57] },
    },
  },
];

// -----------------------------------------------------------------------------
// ZAWODNICY (Players) - 6 markets
// -----------------------------------------------------------------------------

const PLAYER_MARKETS: UnifiedMarketDefinition[] = [
  {
    numericId: 23,
    code: "GOALSCORER_FIRST",
    slug: "goalscorer-first",
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Pierwszy strzelec", en: "First Goalscorer" },
    descriptions: {
      pl: "Który zawodnik strzeli pierwszego gola?",
      en: "Which player scores first?",
    },
    hasParameter: true,
    parameterType: "player",
    selections: ["PLAYER"],
    viewType: ViewType.PLAYER_DROPDOWN,
    displayOrder: 60,
    patterns: [
      /^(pierwszy|1\.?)\s*(strzelec|gol)/iu,
      /first\s*goal\s*scorer/iu,
    ],
    bookmakerData: {
      // Market 52 = "Strzelec pierwszego gola"
      sts: { idMappings: [52] },
    },
  },
  {
    numericId: 24,
    code: "GOALSCORER_LAST",
    slug: "goalscorer-last",
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Ostatni strzelec", en: "Last Goalscorer" },
    descriptions: {
      pl: "Który zawodnik strzeli ostatniego gola?",
      en: "Which player scores last?",
    },
    hasParameter: true,
    parameterType: "player",
    selections: ["PLAYER"],
    viewType: ViewType.PLAYER_DROPDOWN,
    displayOrder: 61,
    patterns: [
      /^ostatni\s*(strzelec|gol)/iu,
      /last\s*goal\s*scorer/iu,
    ],
    bookmakerData: {
      // Market 9 = "Ostatni gol" (Last Goal)
      sts: { idMappings: [9] },
    },
  },
  {
    numericId: 25,
    code: "GOALSCORER_ANYTIME",
    slug: "goalscorer-anytime",
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Strzelec w meczu", en: "Anytime Goalscorer" },
    descriptions: {
      pl: "Zawodnik strzeli gola w meczu",
      en: "Player scores anytime in match",
    },
    hasParameter: true,
    parameterType: "player",
    selections: ["PLAYER"],
    viewType: ViewType.PLAYER_DROPDOWN,
    displayOrder: 62,
    patterns: [
      /^strzel[ei]\s*gola?$/iu,
      /^(zawodnik|gracz).*strzel/iu,
      /strzelec.*(bramki|gola)/iu,
      /anytime.*goal.*scorer/iu,
      /goalscorer.*anytime/iu,
    ],
    bookmakerData: {
      // Market 52 = basic goalscorer, Market 1850 = player goals with thresholds (1+, 2+, 3+)
      sts: { idMappings: [52, 1850] },
    },
  },
  {
    numericId: 26,
    code: "PLAYER_SHOTS",
    slug: "player-shots",
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Strzały zawodnika", en: "Player Shots" },
    descriptions: {
      pl: "Liczba strzałów zawodnika",
      en: "Player shot count",
    },
    hasParameter: true,
    parameterType: "player",
    selections: ["OVER", "UNDER"],
    viewType: ViewType.PLAYER_DROPDOWN,
    displayOrder: 63,
    patterns: [
      /^(strza[łl]y|shots?)\s*(zawodnik|na\s*bramk)/iu,
      /zawodnik.*(strza[łl]|shot)/iu,
      /player.*shots/iu,
    ],
    bookmakerData: {
      // Market 53 = basic shots, Market 1851 = player shots with thresholds
      sts: { idMappings: [53, 1851] },
    },
  },
  {
    numericId: 27,
    code: "PLAYER_CARDS",
    slug: "player-cards",
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Kartki zawodnika", en: "Player Cards" },
    descriptions: {
      pl: "Zawodnik otrzyma kartkę",
      en: "Player receives card",
    },
    hasParameter: true,
    parameterType: "player",
    selections: ["YES", "NO"],
    viewType: ViewType.PLAYER_DROPDOWN,
    displayOrder: 64,
    patterns: [
      /^(kartk[ai]|card)\s*(zawodnik|dla)/iu,
      /zawodnik.*(kartk[aię]|card)/iu,
      /player.*(to\s*(receive|get)\s*)?card/iu,
    ],
    bookmakerData: {
      // Market 54 = basic player cards, Market 1855 = player cards with extra time
      sts: { idMappings: [54, 1855] },
    },
  },
  {
    numericId: 28,
    code: "PLAYER_ASSISTS",
    slug: "player-assists",
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Asysty zawodnika", en: "Player Assists" },
    descriptions: {
      pl: "Zawodnik zaliczy asystę",
      en: "Player provides assist",
    },
    hasParameter: true,
    parameterType: "player",
    selections: ["YES", "NO"],
    viewType: ViewType.PLAYER_DROPDOWN,
    displayOrder: 65,
    patterns: [
      /^asyst[ay]?\s*(zawodnik)?/iu,
      /player.*assist/iu,
    ],
    bookmakerData: {
      // Market 1845 = player assists with thresholds (1+, 2+)
      sts: { idMappings: [1845] },
    },
  },
  {
    numericId: 50,
    code: "PLAYER_GOAL_AND_RESULT",
    slug: "player-goal-and-result",
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Gol zawodnika i wynik", en: "Player Goal & Result" },
    descriptions: {
      pl: "Zawodnik strzeli gola i jaki będzie wynik meczu?",
      en: "Player scores and what will be the match result?",
    },
    hasParameter: true,
    parameterType: "player",
    selections: ["PLAYER_HOME", "PLAYER_DRAW", "PLAYER_AWAY"],
    viewType: ViewType.PLAYER_DROPDOWN,
    displayOrder: 66,
    patterns: [
      /zawodnik.*strzeli.*gol[ay]?\s*(i|[+&])\s*wynik/iu,
      /player.*goal.*result/iu,
    ],
    bookmakerData: {
      // Market 1051 = "Zawodnik - strzeli gola i wynik końcowy"
      sts: { idMappings: [1051] },
    },
  },
  {
    numericId: 51,
    code: "PLAYER_SHOTS_ON_TARGET",
    slug: "player-shots-on-target",
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Celne strzały zawodnika", en: "Player Shots On Target" },
    descriptions: {
      pl: "Liczba celnych strzałów zawodnika",
      en: "Player shots on target count",
    },
    hasParameter: true,
    parameterType: "player",
    selections: ["OVER", "UNDER"],
    viewType: ViewType.PLAYER_DROPDOWN,
    displayOrder: 67,
    patterns: [
      /celne\s*strza[łl]/iu,
      /shots?\s*on\s*target/iu,
    ],
    bookmakerData: {
      // Market 1852 = "celne strzały"
      sts: { idMappings: [1852] },
    },
  },
  {
    numericId: 52,
    code: "PLAYER_PASSES",
    slug: "player-passes",
    category: MarketCategory.ZAWODNICY,
    labels: { pl: "Podania zawodnika", en: "Player Passes" },
    descriptions: {
      pl: "Liczba podań zawodnika",
      en: "Player pass count",
    },
    hasParameter: true,
    parameterType: "player",
    selections: ["OVER", "UNDER"],
    viewType: ViewType.PLAYER_DROPDOWN,
    displayOrder: 68,
    patterns: [
      /podan[ie]a?\s*(zawodnik)?/iu,
      /player.*pass/iu,
    ],
    bookmakerData: {
      // Market 1853 = "podania"
      sts: { idMappings: [1853] },
    },
  },
];

// -----------------------------------------------------------------------------
// STATYSTYKI (Statistics) - 6 markets
// -----------------------------------------------------------------------------

const STATISTICS_MARKETS: UnifiedMarketDefinition[] = [
  {
    numericId: 29,
    code: "CORNERS_TOTAL",
    slug: "corners-total",
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Rzuty rożne", en: "Total Corners" },
    descriptions: {
      pl: "Łączna liczba rzutów rożnych",
      en: "Total corners in match",
    },
    hasParameter: true,
    parameterType: "decimal",
    validParameters: ["7.5", "8.5", "9.5", "10.5", "11.5", "12.5"],
    selections: ["OVER", "UNDER"],
    viewType: ViewType.STAT_RANGE,
    displayOrder: 70,
    patterns: [
      /^(rzuty?\s*ro[żz]n[ey]?|corners?)\s*[-:]?\s*(\d+[.,]?\d*)/iu,
      /^liczba\s*(rzut[oó]w?\s*ro[żz]n|corner)/iu,
      /^(suma\s*)?(rzuty?\s*ro[żz]n[ey]?|corners?)$/iu,
      /total\s*corners?\s*[-:]?\s*(\d+[.,]?\d*)/iu,
      /^ro[żz]ne\s*(o\/?u|over|under)?\s*(\d+[.,]?\d*)?/iu,
    ],
    extractParam: (m) => m[2]?.replace(",", "."),
    bookmakerData: {
      // Market 228 = "Liczba rzutów rożnych", Market 247 = "1. połowa - liczba rzutów rożnych"
      // Market 235 = "Liczba rzutów rożnych - przedziały"
      sts: { idMappings: [228, 235, 247, 256] },
    },
  },
  {
    numericId: 30,
    code: "CORNERS_TEAM",
    slug: "corners-team",
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Rożne drużyny", en: "Team Corners" },
    descriptions: {
      pl: "Rzuty rożne konkretnej drużyny",
      en: "Corners for specific team",
    },
    hasParameter: true,
    parameterType: "decimal",
    selections: ["HOME_OVER", "HOME_UNDER", "AWAY_OVER", "AWAY_UNDER"],
    viewType: ViewType.STAT_RANGE,
    displayOrder: 71,
    patterns: [
      /(rzuty?\s*ro[żz]n[ey]?|corners?).*dru[żz]yn/iu,
      /dru[żz]yn.*(rzuty?\s*ro[żz]n|corner)/iu,
      /team.*corners?/iu,
    ],
    bookmakerData: {
      // Market 236 = "1. drużyna - liczba rzutów rożnych - przedziały"
      // Market 237 = "2. drużyna - liczba rzutów rożnych - przedziały"
      // Market 254/255 = "1. połowa - drużyna - dokładna liczba rzutów rożnych"
      sts: { idMappings: [236, 237, 254, 255] },
    },
  },
  {
    numericId: 41,
    code: "CORNERS_RACE",
    slug: "corners-race",
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Więcej rzutów rożnych", en: "Corners Race" },
    descriptions: {
      pl: "Która drużyna wykona więcej rzutów rożnych?",
      en: "Which team will have more corners?",
    },
    hasParameter: false,
    selections: ["HOME", "DRAW", "AWAY"],
    viewType: ViewType.TRIPLE_BUTTONS,
    displayOrder: 72,
    patterns: [
      /^wi[ęe]cej\s*(rzut[óo]w\s*)?ro[żz]n/iu,
      /ro[żz]n[eyaych]*\s*-?\s*wi[ęe]cej/iu,
      /more\s*corners/iu,
      /corners?\s*race/iu,
    ],
    bookmakerData: {
      // Market 220 = "Więcej rzutów rożnych"
      // Market 239 = "1. połowa - więcej rzutów rożnych"
      sts: { idMappings: [220, 239] },
    },
  },
  {
    numericId: 42,
    code: "FIRST_CORNER",
    slug: "first-corner",
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Pierwszy rzut rożny", en: "First Corner" },
    descriptions: {
      pl: "Która drużyna wykona pierwszy rzut rożny?",
      en: "Which team will take the first corner?",
    },
    hasParameter: false,
    selections: ["HOME", "NONE", "AWAY"],
    viewType: ViewType.TRIPLE_BUTTONS,
    displayOrder: 73,
    patterns: [
      /^1\.\s*(rzut\s*)?ro[żz]n/iu,
      /^pierwszy\s*(rzut\s*)?ro[żz]n/iu,
      /first\s*corner/iu,
    ],
    bookmakerData: {
      // Market 221 = "1. rzut rożny"
      sts: { idMappings: [221] },
    },
  },
  {
    numericId: 43,
    code: "CORNERS_HANDICAP",
    slug: "corners-handicap",
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Rzuty rożne - handicap", en: "Corners Handicap" },
    descriptions: {
      pl: "Handicap na liczbę rzutów rożnych",
      en: "Handicap on total corners",
    },
    hasParameter: true,
    parameterType: "handicap",
    selections: ["HOME", "AWAY"],
    viewType: ViewType.HANDICAP_SELECTOR,
    displayOrder: 74,
    patterns: [
      /ro[żz]n[eyaych]*\s*-?\s*handicap/iu,
      /corners?\s*handicap/iu,
    ],
    bookmakerData: {
      // Market 225 = "Rzuty rożne - handicap"
      // Market 244 = "1. połowa - rzuty rożne - handicap"
      sts: { idMappings: [225, 244] },
    },
  },
  {
    numericId: 31,
    code: "CARDS_TOTAL",
    slug: "cards-total",
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Kartki w meczu", en: "Total Cards" },
    descriptions: {
      pl: "Łączna liczba kartek",
      en: "Total cards in match",
    },
    hasParameter: true,
    parameterType: "decimal",
    validParameters: ["3.5", "4.5", "5.5", "6.5", "7.5"],
    selections: ["OVER", "UNDER"],
    viewType: ViewType.STAT_RANGE,
    displayOrder: 72,
    patterns: [
      /^(kartk[ai]|cards?)\s*[-:]?\s*(\d+[.,]?\d*)/iu,
      /^liczba\s*kartek/iu,
      /^(suma\s*)?(kartk[ai]|cards?)$/iu,
      /total\s*(booking|card)s?\s*[-:]?\s*(\d+[.,]?\d*)/iu,
      /^[żzó][oó][łl]te\s*kartki?\s*(\d+[.,]?\d*)?/iu,
      /^booking(s)?\s*(o\/?u|over|under)?\s*(\d+[.,]?\d*)?/iu,
    ],
    extractParam: (m) => m[2]?.replace(",", "."),
    bookmakerData: {
      // Market 185 = "Liczba kartek", Market 192 = "Dokładna liczba kartek"
      // Market 206 = "1. połowa - liczba kartek", Market 196 = "Czerwona kartka"
      sts: { idMappings: [185, 192, 206, 196, 197, 198, 217] },
    },
  },
  {
    numericId: 32,
    code: "CARDS_TEAM",
    slug: "cards-team",
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Kartki drużyny", en: "Team Cards" },
    descriptions: {
      pl: "Kartki dla konkretnej drużyny",
      en: "Cards for specific team",
    },
    hasParameter: true,
    parameterType: "decimal",
    selections: ["HOME_OVER", "HOME_UNDER", "AWAY_OVER", "AWAY_UNDER"],
    viewType: ViewType.STAT_RANGE,
    displayOrder: 73,
    patterns: [
      /(kartk[ai]|cards?).*dru[żz]yn/iu,
      /dru[żz]yn.*(kartk|card)/iu,
      /team.*(booking|card)s?/iu,
    ],
    bookmakerData: {
      // Market 193 = "1. drużyna - dokładna liczba kartek"
      // Market 194 = "2. drużyna - dokładna liczba kartek"
      sts: { idMappings: [193, 194] },
    },
  },
  {
    numericId: 44,
    code: "CARDS_RACE",
    slug: "cards-race",
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Więcej kartek", en: "Cards Race" },
    descriptions: {
      pl: "Która drużyna otrzyma więcej kartek?",
      en: "Which team will receive more cards?",
    },
    hasParameter: false,
    selections: ["HOME", "DRAW", "AWAY"],
    viewType: ViewType.TRIPLE_BUTTONS,
    displayOrder: 75,
    patterns: [
      /^wi[ęe]cej\s*kartek/iu,
      /kartk[ai]\s*-?\s*wi[ęe]cej/iu,
      /more\s*cards/iu,
      /cards?\s*race/iu,
    ],
    bookmakerData: {
      // Market 178 = "Więcej kartek"
      // Market 199 = "1. połowa - więcej kartek"
      sts: { idMappings: [178, 199] },
    },
  },
  {
    numericId: 45,
    code: "FIRST_CARD",
    slug: "first-card",
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Pierwsza kartka", en: "First Card" },
    descriptions: {
      pl: "Która drużyna otrzyma pierwszą kartkę?",
      en: "Which team will receive the first card?",
    },
    hasParameter: false,
    selections: ["HOME", "NONE", "AWAY"],
    viewType: ViewType.TRIPLE_BUTTONS,
    displayOrder: 76,
    patterns: [
      /^1\.\s*kartk/iu,
      /^pierwsz[ay]\s*kartk/iu,
      /first\s*(booking|card)/iu,
    ],
    bookmakerData: {
      // Market 179 = "1. kartka"
      sts: { idMappings: [179] },
    },
  },
  {
    numericId: 33,
    code: "FOULS_TOTAL",
    slug: "fouls-total",
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Faule w meczu", en: "Total Fouls" },
    descriptions: {
      pl: "Łączna liczba fauli",
      en: "Total fouls in match",
    },
    hasParameter: true,
    parameterType: "decimal",
    selections: ["OVER", "UNDER"],
    viewType: ViewType.STAT_RANGE,
    displayOrder: 74,
    patterns: [
      /^faul[eiy]?\s*[-:]?\s*(\d+)?/iu,
      /^liczba\s*faul/iu,
      /total\s*fouls?/iu,
    ],
  },
  {
    numericId: 34,
    code: "OFFSIDES_TOTAL",
    slug: "offsides-total",
    category: MarketCategory.STATYSTYKI,
    labels: { pl: "Spalone w meczu", en: "Total Offsides" },
    descriptions: {
      pl: "Łączna liczba spalonych",
      en: "Total offsides in match",
    },
    hasParameter: true,
    parameterType: "decimal",
    selections: ["OVER", "UNDER"],
    viewType: ViewType.STAT_RANGE,
    displayOrder: 75,
    patterns: [
      /^(spalon[ey]|offside)/iu,
      /^liczba\s*(spalon|offside)/iu,
      /total\s*offside/iu,
    ],
  },
];

// -----------------------------------------------------------------------------
// KOMBINACJE (Combinations) - 6 markets
// -----------------------------------------------------------------------------

const COMBINATION_MARKETS: UnifiedMarketDefinition[] = [
  {
    numericId: 35,
    code: "RESULT_AND_BTTS",
    slug: "result-and-btts",
    category: MarketCategory.KOMBINACJE,
    labels: { pl: "Wynik + BTTS", en: "Result & BTTS" },
    descriptions: {
      pl: "Wynik meczu i czy obie strzelą",
      en: "Match result and both teams score",
    },
    hasParameter: false,
    selections: ["HOME_YES", "HOME_NO", "DRAW_YES", "DRAW_NO", "AWAY_YES", "AWAY_NO"],
    viewType: ViewType.COMBINATION,
    displayOrder: 80,
    patterns: [
      /^(wynik|1x2)\s*[+&i]\s*(obie|btts|gg)/iu,
      /^(obie|btts|gg)\s*[+&i]\s*(wynik|1x2)/iu,
      /wynik.*obie.*strzel/iu,
      /obie.*strzel.*wynik/iu,
      /match\s*result.*btts/iu,
    ],
    bookmakerData: {
      // Market 49 = "Wynik końcowy i obie drużyny strzelą gola", Market 50 = standard
      sts: { idMappings: [49, 50] },
    },
  },
  {
    numericId: 36,
    code: "RESULT_AND_TOTAL",
    slug: "result-and-total",
    category: MarketCategory.KOMBINACJE,
    labels: { pl: "Wynik + Gole", en: "Result & Total" },
    descriptions: {
      pl: "Wynik meczu i liczba goli",
      en: "Match result and total goals",
    },
    hasParameter: true,
    parameterType: "decimal",
    selections: ["HOME_OVER", "HOME_UNDER", "DRAW_OVER", "DRAW_UNDER", "AWAY_OVER", "AWAY_UNDER"],
    viewType: ViewType.COMBINATION,
    displayOrder: 81,
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
    numericId: 37,
    code: "HALFTIME_FULLTIME",
    slug: "halftime-fulltime",
    category: MarketCategory.KOMBINACJE,
    labels: { pl: "Przerwa/Koniec", en: "HT/FT" },
    descriptions: {
      pl: "Wynik w przerwie i na koniec meczu",
      en: "Half time and full time result",
    },
    hasParameter: false,
    selections: ["1/1", "1/X", "1/2", "X/1", "X/X", "X/2", "2/1", "2/X", "2/2"],
    viewType: ViewType.HALFTIME_FULLTIME,
    displayOrder: 82,
    patterns: [
      /^(1\.?\s*po[łl]o?w|ht)\s*[\/\-]\s*(2\.?\s*po[łl]o?w|ft|wynik|mecz)/iu,
      /^po[łl]o?w[ay]?\s*[\/\-]\s*(mecz|koniec|wynik)/iu,
      /^ht\s*[\/\-]?\s*ft$/iu,
      /half\s*time.*full\s*time/iu,
      /^half\s*[\/\-]\s*match$/iu,
      /^wynik\s*1\.?\s*i\s*2\.?\s*po[łl]/iu,
    ],
    bookmakerData: {
      // Market 1012 = "Połowa/Koniec", Market 58 = "1. połowa / wynik końcowy"
      sts: { idMappings: [1012, 58] },
    },
  },
  {
    numericId: 38,
    code: "DOUBLE_RESULT",
    slug: "double-result",
    category: MarketCategory.KOMBINACJE,
    labels: { pl: "Podwójny wynik", en: "Double Result" },
    descriptions: {
      pl: "Kto prowadzi w dwóch punktach czasowych",
      en: "Who leads at two time points",
    },
    hasParameter: false,
    selections: ["1/1", "1/X", "1/2", "X/1", "X/X", "X/2", "2/1", "2/X", "2/2"],
    viewType: ViewType.HALFTIME_FULLTIME,
    displayOrder: 83,
    patterns: [
      /^podw[oó]jny\s*wynik/iu,
      /double\s*result/iu,
    ],
  },
  {
    numericId: 39,
    code: "DOUBLE_CHANCE_BTTS",
    slug: "double-chance-btts",
    category: MarketCategory.KOMBINACJE,
    labels: { pl: "Podwójna szansa + BTTS", en: "Double Chance & BTTS" },
    descriptions: {
      pl: "Podwójna szansa i obie strzelą",
      en: "Double chance and both teams score",
    },
    hasParameter: false,
    selections: ["1X_YES", "1X_NO", "X2_YES", "X2_NO", "12_YES", "12_NO"],
    viewType: ViewType.COMBINATION,
    displayOrder: 84,
    patterns: [
      /^podw[oó]jna\s*szans.*[+&i]\s*(obie|btts|gg)/iu,
      /^(obie|btts|gg)\s*[+&i]\s*podw[oó]jna\s*szans/iu,
      /^dc\s*[+&i]\s*(btts|gg|obie)/iu,
      /double\s*chance.*btts/iu,
    ],
  },
  {
    numericId: 40,
    code: "DOUBLE_CHANCE_TOTAL",
    slug: "double-chance-total",
    category: MarketCategory.KOMBINACJE,
    labels: { pl: "Podwójna szansa + Gole", en: "Double Chance & Total" },
    descriptions: {
      pl: "Podwójna szansa i liczba goli",
      en: "Double chance and total goals",
    },
    hasParameter: true,
    parameterType: "decimal",
    selections: ["1X_OVER", "1X_UNDER", "X2_OVER", "X2_UNDER", "12_OVER", "12_UNDER"],
    viewType: ViewType.COMBINATION,
    displayOrder: 85,
    patterns: [
      /^podw[oó]jna\s*szans.*[+&i]\s*(liczba|over|under|o\/u|\d)/iu,
      /^(liczba|over|under|o\/u).*[+&i]\s*podw[oó]jna\s*szans/iu,
      /^dc\s*[+&i]\s*(o\/?u|over|under|\d)/iu,
      /double\s*chance.*(over|under|total)/iu,
    ],
  },
  {
    numericId: 49,
    code: "FIRST_GOAL_AND_RESULT",
    slug: "first-goal-and-result",
    category: MarketCategory.KOMBINACJE,
    labels: { pl: "Pierwszy gol i wynik", en: "First Goal & Result" },
    descriptions: {
      pl: "Która drużyna strzeli pierwszego gola i jaki będzie wynik?",
      en: "Which team scores first and what will be the result?",
    },
    hasParameter: false,
    selections: ["HOME_HOME", "HOME_DRAW", "HOME_AWAY", "AWAY_HOME", "AWAY_DRAW", "AWAY_AWAY", "NONE"],
    viewType: ViewType.COMBINATION,
    displayOrder: 86,
    patterns: [
      /^1\.\s*gol\s*(i|[+&])\s*wynik/iu,
      /^pierwszy\s*gol\s*(i|[+&])\s*wynik/iu,
      /first\s*goal.*result/iu,
    ],
    bookmakerData: {
      // Market 258 = "1. gol i wynik końcowy"
      sts: { idMappings: [258] },
    },
  },
];

// ============================================================================
// COMPLETE REGISTRY
// ============================================================================

/**
 * Complete unified market registry
 * Contains all 40 market definitions with complete data
 */
export const UNIFIED_MARKET_REGISTRY: UnifiedMarketDefinition[] = [
  ...MAIN_MARKETS,
  ...GOALS_MARKETS,
  ...HANDICAP_MARKETS,
  ...HALF_TIME_MARKETS,
  ...CORRECT_SCORE_MARKETS,
  ...PLAYER_MARKETS,
  ...STATISTICS_MARKETS,
  ...COMBINATION_MARKETS,
];

// ============================================================================
// LOOKUP MAPS
// ============================================================================

/** Map by canonical code (MATCH_WINNER, TOTAL_GOALS, etc.) */
export const MARKET_BY_CODE = new Map<string, UnifiedMarketDefinition>(
  UNIFIED_MARKET_REGISTRY.map((m) => [m.code, m])
);

/** Map by numeric ID (1-40) for database FK */
export const MARKET_BY_NUMERIC_ID = new Map<number, UnifiedMarketDefinition>(
  UNIFIED_MARKET_REGISTRY.map((m) => [m.numericId, m])
);

/** Map by slug (match-winner, total-goals, etc.) */
export const MARKET_BY_SLUG = new Map<string, UnifiedMarketDefinition>(
  UNIFIED_MARKET_REGISTRY.map((m) => [m.slug, m])
);

/** Set of all canonical market codes */
export const CANONICAL_MARKET_CODES = new Set<string>(
  UNIFIED_MARKET_REGISTRY.map((m) => m.code)
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get market definition by canonical code
 */
export function getMarketByCode(code: string): UnifiedMarketDefinition | undefined {
  return MARKET_BY_CODE.get(code);
}

/**
 * Get market definition by numeric ID
 */
export function getMarketByNumericId(id: number): UnifiedMarketDefinition | undefined {
  return MARKET_BY_NUMERIC_ID.get(id);
}

/**
 * Get market definition by slug
 */
export function getMarketBySlug(slug: string): UnifiedMarketDefinition | undefined {
  return MARKET_BY_SLUG.get(slug);
}

/**
 * Get numeric ID for a market code
 */
export function getNumericIdForCode(code: string): number | undefined {
  return MARKET_BY_CODE.get(code)?.numericId;
}

/**
 * Get all markets in a category
 */
export function getMarketsByCategory(category: MarketCategory): UnifiedMarketDefinition[] {
  return UNIFIED_MARKET_REGISTRY.filter((m) => m.category === category);
}

/**
 * Check if a code is a canonical market
 */
export function isCanonicalMarket(code: string | undefined): boolean {
  if (!code) return false;
  return CANONICAL_MARKET_CODES.has(code);
}

/**
 * Get market definition by type (alias for getMarketByCode)
 * @deprecated Use getMarketByCode instead
 */
export function getMarketByType(type: NormalizedMarketType): UnifiedMarketDefinition | undefined {
  return MARKET_BY_CODE.get(type);
}

/**
 * Get market definition by slug (id field in old system)
 */
export function getMarketById(slug: string): UnifiedMarketDefinition | undefined {
  return MARKET_BY_SLUG.get(slug);
}

// ============================================================================
// LEGACY COMPATIBILITY - Re-exports for easier migration
// ============================================================================

/** @deprecated Use UNIFIED_MARKET_REGISTRY instead */
export const CANONICAL_MARKETS = UNIFIED_MARKET_REGISTRY;

/** @deprecated Use UNIFIED_MARKET_REGISTRY instead */
export const MARKET_REGISTRY = UNIFIED_MARKET_REGISTRY;

/**
 * Legacy interface for compatibility during migration
 * @deprecated Use UnifiedMarketDefinition instead
 */
export type MarketDefinition = UnifiedMarketDefinition;

/**
 * Legacy interface for compatibility during migration
 * @deprecated Use UnifiedMarketDefinition instead
 */
export type MarketDefinitionCanonical = UnifiedMarketDefinition;
