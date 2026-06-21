import type {
  BookmakerMarketNormalizer,
  RawBookmakerMarket,
  NormalizationContext,
  NormalizedMarketOutput,
  NormalizedMarketType,
  NormalizedSelection,
} from "../types.js";
import {
  buildMarketKey,
  parseOverUnderLine,
  normalize1x2Selection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  parseScoreSelection,
  parseHtFtSelection,
} from "../helpers/index.js";
import { isValidMarketCode, getCategoryForMarket } from "../../../data/market-catalog.js";

export const STS_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  1: "MATCH_WINNER",
  10: "DOUBLE_CHANCE",
  4: "DRAW_NO_BET",
  11: "DRAW_NO_BET",
  259: "DRAW_NO_BET",
  314: "DRAW_NO_BET",
  368: "DRAW_NO_BET",

  14: "EUROPEAN_HANDICAP",
  17: "WINNING_MARGIN",
  20: "ASIAN_HANDICAP_PUSH",
  22: "ASIAN_HANDICAP",
  33: "EXACT_GOALS",
  52: "GOALSCORER_FIRST",
  53: "GOALSCORER_LAST",
  54: "GOALSCORER_ANYTIME",
  57: "HT_FT_CORRECT_SCORE",
  74: "HALF_TIME_DOUBLE_CHANCE",
  75: "HALF_TIME_DRAW_NO_BET",
  76: "FIRST_HALF_EUROPEAN_HANDICAP",
  77: "FIRST_HALF_ASIAN_HANDICAP_PUSH",
  79: "FIRST_HALF_ASIAN_HANDICAP",
  80: "HALF_TIME_TOTAL_GOALS",
  82: "HALF_TIME_TOTAL_GOALS",
  85: "HALF_TIME_HOME_TEAM_TOTAL_GOALS",
  88: "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
  95: "HALF_TIME_BTTS",
  101: "HALF_TIME_CORRECT_SCORE",
  102: "SECOND_HALF_RESULT",
  106: "SECOND_HALF_EUROPEAN_HANDICAP",
  107: "SECOND_HALF_ASIAN_HANDICAP_PUSH",
  109: "SECOND_HALF_ASIAN_HANDICAP",
  110: "SECOND_HALF_TOTAL_GOALS",
  112: "SECOND_HALF_TOTAL_GOALS",
  124: "SECOND_HALF_CORRECT_SCORE",
  1051: "PLAYER_GOAL_AND_RESULT",

  1851: "PLAYER_SHOTS",
  1263: "PLAYER_SHOTS",
  1852: "PLAYER_SHOTS_ON_TARGET",
  1264: "PLAYER_SHOTS_ON_TARGET",
  1853: "PLAYER_PASSES",
  1855: "PLAYER_CARDS",

  25: "TOTAL_GOALS",
  28: "HOME_TEAM_TOTAL_GOALS",
  31: "AWAY_TEAM_TOTAL_GOALS",
  23: "TOTAL_GOALS_ASIAN",

  43: "BTTS",
  121: "SECOND_HALF_BTTS",

  8: "FIRST_TEAM_TO_SCORE",
  9: "LAST_TEAM_TO_SCORE",
  71: "HALF_TIME_RESULT",
  283: "CORRECT_SCORE",
  44: "TEAMS_TO_SCORE",
  35: "HOME_EXACT_GOALS",
  36: "AWAY_EXACT_GOALS",
  47: "HOME_WIN_TO_NIL",
  48: "AWAY_WIN_TO_NIL",
  236: "HOME_CORNERS_RANGE",
  237: "AWAY_CORNERS_RANGE",
  814: "HOME_GOAL_RANGE",
  815: "AWAY_GOAL_RANGE",

  220: "CORNERS_RACE",
  221: "FIRST_CORNER",
  225: "CORNERS_HANDICAP",
  228: "CORNERS_TOTAL",
  235: "CORNERS_RANGE",
  239: "HALF_TIME_CORNERS_RACE",
  244: "HALF_TIME_CORNERS_HANDICAP",
  247: "HALF_TIME_CORNERS_TOTAL",

  238: "CORNERS_ODD_EVEN",

  231: "CORNERS_TEAM",
  234: "CORNERS_TEAM",
  254: "HALF_TIME_HOME_EXACT_CORNERS",
  255: "HALF_TIME_AWAY_EXACT_CORNERS",
  256: "HALF_TIME_CORNERS_RANGE",
  807: "HALF_TIME_DOUBLE_CHANCE_BTTS",
  808: "SECOND_HALF_RESULT_AND_BTTS",
  809: "SECOND_HALF_RESULT_AND_TOTAL",
  810: "SECOND_HALF_DOUBLE_CHANCE_BTTS",
  811: "DOUBLE_CHANCE_BTTS",
  812: "DOUBLE_CHANCE_TOTAL",
  813: "GOAL_RANGE",
  816: "MULTI_RESULT",
  817: "HALF_TIME_GOAL_RANGE",
  818: "SECOND_HALF_GOAL_RANGE",

  178: "CARDS_RACE",
  199: "CARDS_RACE",
  179: "FIRST_CARD",
  185: "CARDS_TOTAL",
  192: "CARDS_EXACT_RANGE",
  206: "HALF_TIME_CARDS_TOTAL",
  188: "CARDS_TEAM",
  191: "CARDS_TEAM",
  193: "CARDS_TEAM",
  194: "CARDS_TEAM",
  196: "OTHER",
  197: "OTHER",
  198: "OTHER",
  217: "HALF_TIME_RED_CARD",
  2098: "EACH_TEAM_TOTAL_CARDS_OVER",

  125: "FIRST_GOAL_TIME_ALT",
  126: "FIRST_GOAL_TIME",
  132: "TIME_PERIOD_RESULT",

  49: "RESULT_AND_BTTS",
  50: "TOTAL_GOALS_AND_BTTS",
  51: "RESULT_AND_TOTAL",
  99: "HALF_TIME_RESULT_AND_TOTAL",
  58: "HALFTIME_FULLTIME",
  258: "FIRST_GOAL_AND_RESULT",

   1229: "HOME_TEAM_TO_SCORE",
  1224: "AWAY_TEAM_TO_SCORE",

  40: "ODD_EVEN_GOALS",
  41: "HOME_TEAM_ODD_EVEN_GOALS",
  42: "AWAY_TEAM_ODD_EVEN_GOALS",

  59: "HOME_WIN_BOTH_HALVES",
  60: "AWAY_WIN_BOTH_HALVES",
  61: "HOME_WIN_AT_LEAST_ONE_HALF",
  62: "AWAY_WIN_AT_LEAST_ONE_HALF",
  63: "HALF_WITH_MORE_GOALS",
  64: "HOME_HALF_WITH_MOST_GOALS",
  65: "AWAY_HALF_WITH_MOST_GOALS",
  66: "BTTS_BY_HALF",
  67: "HOME_SCORE_BOTH_HALVES",
  68: "AWAY_SCORE_BOTH_HALVES",
  69: "BOTH_HALVES_OVER_GOALS",
  70: "BOTH_HALVES_UNDER_GOALS",

  73: "HALF_TIME_FIRST_GOAL",

  90: "HALF_TIME_EXACT_GOALS",
  94: "HALF_TIME_ODD_EVEN_GOALS",
  98: "HALF_TIME_RESULT_AND_BTTS",

  103: "SECOND_HALF_FIRST_GOAL",
  104: "SECOND_HALF_DOUBLE_CHANCE",
  105: "SECOND_HALF_DRAW_NO_BET",

  115: "SECOND_HALF_HOME_TEAM_TOTAL_GOALS",
  118: "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
  119: "SECOND_HALF_EXACT_GOALS",
  120: "SECOND_HALF_ODD_EVEN_GOALS",

  1012: "HALFTIME_FULLTIME_AND_TOTAL",
  1232: "HALF_TIME_AWAY_TO_SCORE",
  1233: "HALF_TIME_HOME_TO_SCORE",
  1234: "SECOND_HALF_AWAY_TO_SCORE",
  1235: "SECOND_HALF_HOME_TO_SCORE",
  1244: "HT_OR_FT_RESULT",

  1413: "PENALTY_AWARDED",
  1561: "MOST_SHOTS_ON_TARGET",
  1562: "OTHER",
  1897: "PLAYER_TACKLES",
  2006: "PLAYER_INTERCEPTIONS",
  2004: "PLAYER_FOULS_WON",
  2005: "PLAYER_FOULS",
  2011: "PLAYER_SAVES",
  1898: "OTHER",
  1899: "RED_CARD_AND_PENALTY",
  1845: "PLAYER_ASSISTS",
  1850: "PLAYER_GOALS",
  2111: "FOULS_TOTAL",
  2112: "OTHER",
  2113: "OTHER",
  2114: "OWN_GOAL",
  2097: "EACH_TEAM_TOTAL_CORNERS_OVER",
  2153: "PLAYER_RED_CARD",
};

const STS_SELECTION_OVERRIDES: Record<string, NormalizedSelection> = {
  "3": "DRAW",
  "26": "YES",
  "27": "NO",
  "4": "HOME",
  "5": "AWAY",
};

// Name-based fallback patterns for when ID is not available
const STS_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType; extractParam?: (match: RegExpMatchArray) => string | undefined }> = [
  // Main markets
  { pattern: /^wynik\s+meczu$/i, code: "MATCH_WINNER" },
  { pattern: /^podw[oó]jna\s+szansa$/i, code: "DOUBLE_CHANCE" },
  { pattern: /^remis\s*=\s*zwrot$/i, code: "DRAW_NO_BET" },

  // Goals markets - with parameter extraction
  { pattern: /^liczba\s+goli\s+(\d+[.,]\d+)$/i, code: "TOTAL_GOALS", extractParam: (m) => m[1]?.replace(",", ".") },
  { pattern: /^liczba\s+goli\s+\(zwrot\)\s*(\d+)$/i, code: "TOTAL_GOALS_ASIAN", extractParam: (m) => m[1] },
  { pattern: /^obie\s+dru[zż]yny\s+strzel[aą]$/i, code: "BTTS" },

  // Half-time markets
  { pattern: /^wynik\s+1\.\s*po[lł]owy$/i, code: "HALF_TIME_RESULT" },
  { pattern: /^liczba\s+goli\s+1\.\s*po[lł]ow[ay]$/i, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /^obie\s+strzel[aą]\s+1\.\s*po[lł]ow[ay]$/i, code: "HALF_TIME_BTTS" },

  // Second half markets  
  { pattern: /^wynik\s+2\.\s*po[lł]owy$/i, code: "SECOND_HALF_RESULT" },
  { pattern: /^liczba\s+goli\s+2\.\s*po[lł]ow[ay]$/i, code: "SECOND_HALF_TOTAL_GOALS" },
  { pattern: /^2\.?\s*po[lł]ow.*zak[lł]ad\s+bez\s+remisu/i, code: "SECOND_HALF_DRAW_NO_BET" },
  { pattern: /^2\.?\s*po[lł]ow.*podw[oó]jna\s+szansa$/i, code: "SECOND_HALF_DOUBLE_CHANCE" },

  // Correct score
  { pattern: /^dok[lł]adny\s+wynik$/i, code: "CORRECT_SCORE" },

  // Handicap markets
  { pattern: /^handicap\s+azjatycki\s+1\.?\s*po[lł]/i, code: "ASIAN_HANDICAP" },
  { pattern: /^handicap\s+europejski\s+1\.?\s*po[lł]/i, code: "EUROPEAN_HANDICAP" },
  { pattern: /^handicap\s+azjatycki\s+2\.?\s*po[lł]/i, code: "SECOND_HALF_ASIAN_HANDICAP" },
  { pattern: /^handicap\s+europejski\s+2\.?\s*po[lł]/i, code: "EUROPEAN_HANDICAP" },

  // Special markets
  { pattern: /^parzyste.*nieparzyste|^nieparzyste.*parzyste/i, code: "ODD_EVEN_GOALS" },
  { pattern: /^wygrana\s+do\s+zera/i, code: "WIN_TO_NIL" },
  { pattern: /^czyste\s+konto/i, code: "CLEAN_SHEET" },

  // Combination markets
  { pattern: /^wynik.*i.*liczba\s+goli/i, code: "RESULT_AND_TOTAL" },
  { pattern: /^wynik.*i.*obie.*strzel/i, code: "RESULT_AND_BTTS" },
  { pattern: /^po[lł]owa.*koniec|^ht.*ft/i, code: "HALFTIME_FULLTIME" },

  // Goalscorer markets
  { pattern: /^pierwszy.*strzelec|^strzelec.*pierwsz/i, code: "GOALSCORER_FIRST" },
  { pattern: /^ostatni.*strzelec|^strzelec.*ostatni/i, code: "GOALSCORER_LAST" },
  { pattern: /^strzelec\s+gola|^gol.*kiedykolwiek/i, code: "GOALSCORER_ANYTIME" },

  // Corners
  { pattern: /^rz[uó]ty\s+ro[zż]ne.*suma|^suma.*rz[uó]t[oó]w\s+ro[zż]nych/i, code: "CORNERS_TOTAL" },
  { pattern: /^pierwszy\s+rz[uó]t\s+ro[zż]ny/i, code: "FIRST_CORNER" },

  // Cards
  { pattern: /^kartki.*suma|^suma.*kartek/i, code: "CARDS_TOTAL" },
  { pattern: /^pierwsza\s+kartka/i, code: "FIRST_CARD" },
  { pattern: /otrzyma\s+kartkę/i, code: "PLAYER_CARDS" },
  // Team scoring
  { pattern: /gospodarz.*strzeli|^dru[zż]yna\s+1.*strzeli/i, code: "HOME_TEAM_TO_SCORE" },
  { pattern: /go[sś][cć].*strzeli|^dru[zż]yna\s+2.*strzeli/i, code: "AWAY_TEAM_TO_SCORE" },

  // First team to score
  { pattern: /^kt[oó]ra.*pierwsz.*strzeli|^pierwsz.*gol/i, code: "FIRST_TEAM_TO_SCORE" },
];

function resolveMarketFromName(name: string): { code: NormalizedMarketType; param?: string } | null {
  const normalized = name.toLowerCase().trim();

  for (const { pattern, code, extractParam } of STS_NAME_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      const param = extractParam?.(match);
      return { code, param };
    }
  }

  return null;
}

function extractStsMarketId(marketName: string): number | null {
  const match = marketName.match(/^Rynek\s+(\d+)$/iu);
  return match ? Number(match[1]) : null;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isTeamInSelection(normalizedSelection: string, normalizedTeamName: string): boolean {
  if (normalizedSelection.includes(normalizedTeamName)) return true;
  
  const teamParts = normalizedTeamName.split(" ");
  const selectionParts = normalizedSelection.split(" ");

  if (teamParts.length >= 2) {
    const matchingParts = teamParts.filter(part => {
      if (selectionParts.includes(part)) return true;
      // Min 4 chars for substring matching to prevent "ham" matching "wolverhampton"
      if (part.length >= 4) {
        return selectionParts.some(selPart => selPart.includes(part) || part.includes(selPart));
      }
      return false;
    });
    if (matchingParts.length >= 1) return true;
  }

  return false;
}

function normalizeSts1x2Selection(selectionName: string, ctx: NormalizationContext): NormalizedSelection {
  const normalizedSelection = normalizeName(selectionName);
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  if (normalizedSelection === "remis" || normalizedSelection.includes("remis")) {
    return "DRAW";
  }

  if (home && isTeamInSelection(normalizedSelection, home)) {
    return "HOME";
  }
  if (away && isTeamInSelection(normalizedSelection, away)) {
    return "AWAY";
  }

  return normalize1x2Selection(selectionName, ctx.homeTeam, ctx.awayTeam, ctx.league);
}

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext,
  marketName?: string
): NormalizedSelection {
  const trimmed = selName.trim();
  const lower = trimmed.toLowerCase();

  const override = STS_SELECTION_OVERRIDES[trimmed];
  const goalRangeMarkets = [
    "GOAL_RANGE",
    "TEAM_GOAL_RANGE",
    "HALF_TIME_GOAL_RANGE",
    "SECOND_HALF_GOAL_RANGE",
    "EXACT_GOALS",
    "CORNERS_RANGE",
    "HALF_TIME_CORNERS_RANGE",
    "HALF_TIME_EXACT_GOALS",
    "CORNERS_TEAM_RANGE",
    "HALF_TIME_CORNERS_TEAM_RANGE",
    "HOME_EXACT_GOALS",
    "AWAY_EXACT_GOALS",
    "HOME_GOAL_RANGE",
    "AWAY_GOAL_RANGE",
    "HOME_CORNERS_RANGE",
    "AWAY_CORNERS_RANGE",
    "SECOND_HALF_HOME_EXACT_GOALS",
    "SECOND_HALF_EXACT_GOALS",
    "TEAM_TOTAL_SCORERS",
  ];
  if (override && !goalRangeMarkets.includes(marketCode)) return override;

  if (/^1\s*\([+-]/.test(trimmed)) return "HOME";
  if (/^2\s*\([+-]/.test(trimmed)) return "AWAY";
  if (/^x\s*\(/i.test(trimmed)) return "DRAW";

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "HT_OR_FT_RESULT":
    case "TIME_PERIOD_RESULT":
    case "DRAW_NO_BET":
    case "HALF_TIME_DRAW_NO_BET":
    case "SECOND_HALF_DRAW_NO_BET":
    case "CORNERS_RACE":
    case "CARDS_RACE":
    case "MOST_SHOTS_ON_TARGET":
      return normalizeSts1x2Selection(trimmed, ctx);

    case "FIRST_CARD":
      if (lower === "bez gola" || lower === "brak" || lower === "żaden" || lower === "bez kartek") return "NONE" as NormalizedSelection;
      return normalizeSts1x2Selection(trimmed, ctx);

    case "HALF_TIME_CORNERS_RACE":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return normalizeSts1x2Selection(trimmed, ctx);

    case "FIRST_TEAM_TO_SCORE":
    case "LAST_TEAM_TO_SCORE":
    case "HALF_TIME_FIRST_GOAL":
    case "SECOND_HALF_FIRST_GOAL":
    case "FIRST_CORNER":
      if (lower === "bez gola" || lower === "brak gola" || lower === "żaden" || lower === "brak" || lower === "remis") return "NONE" as NormalizedSelection;
      return normalizeSts1x2Selection(trimmed, ctx);

    case "DOUBLE_CHANCE":
    case "HALF_TIME_DOUBLE_CHANCE":
    case "SECOND_HALF_DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "CORNERS_TOTAL":
    case "HOME_TEAM_TOTAL_GOALS":
    case "AWAY_TEAM_TOTAL_GOALS":
    case "HALF_TIME_HOME_TEAM_TOTAL_GOALS":
    case "HALF_TIME_AWAY_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_HOME_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "TEAM_TOTAL_GOALS":
    case "HALF_TIME_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_TEAM_TOTAL_GOALS":
      if (marketName) {
        const mName = marketName.toLowerCase();
        const sel = normalizeOverUnderSelection(trimmed);
        if (sel === "OVER" || sel === "UNDER") {
          if (mName.includes("gosp") || mName.includes("home") || mName.includes("1")) {
            return `HOME_${sel}` as NormalizedSelection;
          }
          if (mName.includes("gość") || mName.includes("gosc") || mName.includes("away") || mName.includes("2")) {
            return `AWAY_${sel}` as NormalizedSelection;
          }
        }
      }
      return normalizeOverUnderSelection(trimmed);

    case "CARDS_TOTAL":
    case "HALF_TIME_CARDS_TOTAL":
    case "FOULS_TOTAL":
    case "CARDS_TEAM":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return normalizeOverUnderSelection(trimmed);

    case "CARDS_EXACT_RANGE":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;

    case "HALF_TIME_CORNERS_TOTAL":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return normalizeOverUnderSelection(trimmed);

    case "HALF_TIME_CORNERS_TEAM":
    case "CORNERS_TEAM":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      // Check market name to determine HOME or AWAY prefix
      if (marketName) {
        const mName = marketName.toLowerCase();
        const sel = normalizeOverUnderSelection(trimmed);
        if (sel === "OVER" || sel === "UNDER") {
          // "1. drużyna" = HOME team, "2. drużyna" = AWAY team
          if (mName.includes("1. drużyna") || mName.includes("1. dru") || mName.includes("gospodarz")) {
            return `HOME_${sel}` as NormalizedSelection;
          }
          if (mName.includes("2. drużyna") || mName.includes("2. dru") || mName.includes("gość") || mName.includes("gosc")) {
            return `AWAY_${sel}` as NormalizedSelection;
          }
        }
      }
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
    case "HALF_TIME_HOME_TO_SCORE":
    case "HALF_TIME_AWAY_TO_SCORE":
    case "SECOND_HALF_HOME_TO_SCORE":
    case "SECOND_HALF_AWAY_TO_SCORE":
    case "CLEAN_SHEET":
    case "TEAM_SCORES_BOTH_HALVES":
    case "TEAM_WIN_AT_LEAST_ONE_HALF":
    case "TEAM_WIN_BOTH_HALVES":
    case "HOME_WIN_AT_LEAST_ONE_HALF":
    case "AWAY_WIN_AT_LEAST_ONE_HALF":
    case "HOME_WIN_BOTH_HALVES":
    case "AWAY_WIN_BOTH_HALVES":
    case "HOME_WIN_TO_NIL":
    case "AWAY_WIN_TO_NIL":
    case "HALF_TIME_RED_CARD":
    case "PENALTY_AWARDED":
    case "RED_CARD_AND_PENALTY":
    case "OWN_GOAL":
    case "EACH_TEAM_TOTAL_CORNERS_OVER":
    case "EACH_TEAM_TOTAL_CARDS_OVER":
    case "PLAYER_RED_CARD":
      if ((marketCode === "EACH_TEAM_TOTAL_CORNERS_OVER" || marketCode === "EACH_TEAM_TOTAL_CARDS_OVER") && trimmed.startsWith("+")) return "OVER";
      return normalizeYesNoSelection(trimmed);
    
    case "WIN_TO_NIL":
      if (marketName) {
        const mName = marketName.toLowerCase();
        if (mName.includes("gosp") || mName.includes("home") || mName.includes("1")) {
          if (lower === "tak" || lower === "yes") return "HOME" as NormalizedSelection;
        }
        if (mName.includes("gość") || mName.includes("gosc") || mName.includes("away") || mName.includes("2")) {
          if (lower === "tak" || lower === "yes") return "AWAY" as NormalizedSelection;
        }
      }
      return normalizeYesNoSelection(trimmed);

    case "TEAMS_TO_SCORE":
      if (lower.includes("tylko 1.") || lower.includes("tylko gosp") || lower.includes("only home")) return "ONE_TEAM_HOME" as NormalizedSelection;
      if (lower.includes("tylko 2.") || lower.includes("tylko goś") || lower.includes("only away")) return "ONE_TEAM_AWAY" as NormalizedSelection;
      if (lower.includes("obie") || lower.includes("both")) return "TWO_TEAMS" as NormalizedSelection;
      if (lower.includes("brak") || lower.includes("bez") || lower.includes("no goal")) return "ZERO_TEAMS" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "BOTH_HALVES_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "BOTH_HALVES_UNDER_GOALS":
    case "BOTH_HALVES_OVER_GOALS":
      // Binary YES/NO market: "Obie połowy poniżej/powyżej X goli?"
      // "Tak/Yes" = YES, "Nie/No" = NO
      return normalizeYesNoSelection(trimmed);

    case "BOTH_HALVES_GOALS":
      if (lower === "tak" || lower === "yes") return "YES";
      if (lower === "nie" || lower === "no") return "NO";
      if (lower === "remis" || lower === "równo") return "DRAW" as NormalizedSelection;
      if (lower.includes("1. połowa") || lower.includes("1 polowa")) return "FIRST_HALF" as NormalizedSelection;
      if (lower.includes("2. połowa") || lower.includes("2 polowa")) return "SECOND_HALF" as NormalizedSelection;
      if (lower === "bez goli" || lower === "brak goli") return "NONE" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    
    case "BTTS_BY_HALF":
      if (lower === "tak / nie" || lower === "tak/nie") return "1st" as NormalizedSelection;
      if (lower === "nie / tak" || lower === "nie/tak") return "2nd" as NormalizedSelection;
      if (lower === "tak / tak" || lower === "tak/tak") return "Both" as NormalizedSelection;
      if (lower === "nie / nie" || lower === "nie/nie") return "None" as NormalizedSelection;
      if (lower.includes("1. połowa") || lower.includes("1 polowa")) return "1st" as NormalizedSelection;
      if (lower.includes("2. połowa") || lower.includes("2 polowa")) return "2nd" as NormalizedSelection;
      if (lower.includes("obie") || lower.includes("both") || lower === "równo") return "Both" as NormalizedSelection;
      if (lower.includes("żadna") || lower.includes("zadna") || lower.includes("none") || lower.includes("bez goli") || lower.includes("brak goli")) return "None" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    
    case "HALF_WITH_MORE_GOALS":
    case "TEAM_HALF_WITH_MORE_GOALS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS":
      if (lower.includes("1. połowa") || lower.includes("1 polowa")) return "1st" as NormalizedSelection;
      if (lower.includes("2. połowa") || lower.includes("2 polowa")) return "2nd" as NormalizedSelection;
      if (lower === "remis" || lower === "równo") return "Draw" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "HOME_SCORE_BOTH_HALVES":
    case "AWAY_SCORE_BOTH_HALVES":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
    case "SECOND_HALF_ODD_EVEN_GOALS":
    case "HALF_TIME_ODD_EVEN_GOALS":
    case "HOME_TEAM_ODD_EVEN_GOALS":
    case "AWAY_TEAM_ODD_EVEN_GOALS":
    case "CORNERS_ODD_EVEN":
    case "HALF_TIME_CORNERS_ODD_EVEN":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "ASIAN_HANDICAP_PUSH":
    case "EUROPEAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP_PUSH":
    case "FIRST_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP_PUSH":
    case "SECOND_HALF_EUROPEAN_HANDICAP":
    case "CORNERS_HANDICAP":
    case "HALF_TIME_CORNERS_HANDICAP":
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed)) return "DRAW";
      return normalizeSts1x2Selection(trimmed, ctx);

    case "CORRECT_SCORE":
    case "HALF_TIME_CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE": {
      // Handle "Inne" (STS) → "OTHER" for correct score markets
      if (lower === "inne" || lower === "inny" || lower === "other") {
        return "OTHER" as NormalizedSelection;
      }
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HT_FT_CORRECT_SCORE":
      return trimmed as NormalizedSelection;

    case "MULTI_RESULT":
    case "HALFTIME_FULLTIME_AND_TOTAL":
      return trimmed as NormalizedSelection;

    case "HALFTIME_FULLTIME":
    case "DOUBLE_RESULT": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
    case "PLAYER_SHOTS":
    case "PLAYER_CARDS":
    case "PLAYER_ASSISTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_PASSES":
    case "PLAYER_2_OR_MORE_GOALS":
    case "PLAYER_3_OR_MORE_GOALS":
    case "PLAYER_HAT_TRICK":
    case "PLAYER_TACKLES":
    case "PLAYER_INTERCEPTIONS":
      return trimmed.replace(/^\d+\.\s*/, "").trim() as NormalizedSelection;

    case "PLAYER_GOAL_AND_RESULT": {
      const match = trimmed.match(/^(.+?)\s+i\s+([1X2])$/i);
      if (match) {
        const result = match[2].toUpperCase();
        return (result === "1" ? "HOME" : result === "X" ? "DRAW" : "AWAY") as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "TEAM_TOTAL_SCORERS":
      if (/^\d+\+$/.test(trimmed)) return "OVER";
      if (/^\d+-$/.test(trimmed)) return "UNDER";
      return normalizeOverUnderSelection(trimmed);

    case "DOUBLE_CHANCE_BTTS":
    case "HALF_TIME_DOUBLE_CHANCE_BTTS":
    case "SECOND_HALF_DOUBLE_CHANCE_BTTS": {
      const lower = trimmed.toLowerCase();
      if (lower.includes("1x") && lower.includes("tak")) return "1X_YES" as NormalizedSelection;
      if (lower.includes("1x") && lower.includes("nie")) return "1X_NO" as NormalizedSelection;
      if (lower.includes("x2") && lower.includes("tak")) return "X2_YES" as NormalizedSelection;
      if (lower.includes("x2") && lower.includes("nie")) return "X2_NO" as NormalizedSelection;
      if (lower.includes("12") && lower.includes("tak")) return "12_YES" as NormalizedSelection;
      if (lower.includes("12") && lower.includes("nie")) return "12_NO" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "SECOND_HALF_RESULT_AND_TOTAL": {
      const match = trimmed.match(/^([1x2])\s*i\s*([+-])/i);
      if (match) {
        const result = match[1].toUpperCase();
        const overUnder = match[2] === "-" ? "OVER" : "UNDER";
        if (result === "1") return `HOME_${overUnder}` as NormalizedSelection;
        if (result === "X") return `DRAW_${overUnder}` as NormalizedSelection;
        if (result === "2") return `AWAY_${overUnder}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "WINNING_MARGIN": {
      // Map Polish STS selection names to canonical codes
      // "1 o 1" = Gospodarz wygra różnicą 1 gola
      // "1 o 2" = Gospodarz wygra różnicą 2 goli
      // "1 o 3+" = Gospodarz wygra różnicą 3+ goli
      // "Remis" = Remis
      // "2 o 1" = Gość wygra różnicą 1 gola
      // "2 o 2" = Gość wygra różnicą 2 goli
      // "2 o 3+" = Gość wygra różnicą 3+ goli
      if (lower === "1 o 1" || lower.includes("1 o 1")) return "HOME_BY_1" as NormalizedSelection;
      if (lower === "1 o 2" || lower.includes("1 o 2")) return "HOME_BY_2" as NormalizedSelection;
      if (lower === "1 o 3+" || lower.includes("1 o 3+") || lower.includes("1 o 3 lub więcej")) return "HOME_BY_3PLUS" as NormalizedSelection;
      if (lower === "remis" || lower === "x") return "DRAW";
      if (lower === "2 o 1" || lower.includes("2 o 1")) return "AWAY_BY_1" as NormalizedSelection;
      if (lower === "2 o 2" || lower.includes("2 o 2")) return "AWAY_BY_2" as NormalizedSelection;
      if (lower === "2 o 3+" || lower.includes("2 o 3+") || lower.includes("2 o 3 lub więcej")) return "AWAY_BY_3PLUS" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "GOAL_RANGE":
    case "TEAM_GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
    case "EXACT_GOALS":
    case "HOME_EXACT_GOALS":
    case "AWAY_EXACT_GOALS":
    case "HALF_TIME_EXACT_GOALS":
    case "SECOND_HALF_EXACT_GOALS":
    case "SECOND_HALF_HOME_EXACT_GOALS":
      // Map numeric selections to proper codes: 0, 1, 2, 3+
      if (trimmed === "0" || trimmed === "0 goli") return "0" as NormalizedSelection;
      if (trimmed === "1" || trimmed === "1 gol") return "1" as NormalizedSelection;
      if (trimmed === "2" || trimmed === "2 gole") return "2" as NormalizedSelection;
      if (trimmed === "3" || trimmed === "3 gole") return "3" as NormalizedSelection;
      if (trimmed === "3+" || trimmed === "3 lub więcej") return "3+" as NormalizedSelection;
      if (trimmed === "4" || trimmed === "4 gole") return "4" as NormalizedSelection;
      if (trimmed === "5" || trimmed === "5 gole") return "5" as NormalizedSelection;
      if (trimmed === "6+" || trimmed === "6 lub więcej") return "6+" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "HOME_GOAL_RANGE":
    case "AWAY_GOAL_RANGE":
      // Pass through range selections like "0-1", "2-3", "4-5", "6+", "3+"
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;

    case "CORNERS_RANGE":
    case "HOME_CORNERS_RANGE":
    case "AWAY_CORNERS_RANGE":
    case "HALF_TIME_CORNERS_RANGE":
    case "HALF_TIME_HOME_EXACT_CORNERS":
    case "HALF_TIME_AWAY_EXACT_CORNERS":
    case "PLAYER_GOALS":
    case "PLAYER_FOULS_WON":
    case "PLAYER_FOULS":
    case "PLAYER_SAVES":
      // Pass through numeric (0, 1, 2), range (0-2, 3-4), and plus (5+, 3+) selections
      if (/^\d+$/.test(trimmed) || /^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;

    case "RESULT_AND_BTTS":
    case "HALF_TIME_RESULT_AND_BTTS":
    case "SECOND_HALF_RESULT_AND_BTTS": {
      const l = lower;
      if (l.includes("1") && l.includes("tak")) return "HOME_YES" as NormalizedSelection;
      if (l.includes("1") && l.includes("nie")) return "HOME_NO" as NormalizedSelection;
      if (l.includes("x") && l.includes("tak")) return "DRAW_YES" as NormalizedSelection;
      if (l.includes("x") && l.includes("nie")) return "DRAW_NO" as NormalizedSelection;
      if (l.includes("2") && l.includes("tak")) return "AWAY_YES" as NormalizedSelection;
      if (l.includes("2") && l.includes("nie")) return "AWAY_NO" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "TOTAL_GOALS_AND_BTTS": {
      const l = lower;
      const isOver = l.includes("+") || l.includes("over") || l.includes("powyżej") || l.includes("powyzej");
      const isUnder = l.includes("-") || l.includes("under") || l.includes("poniżej") || l.includes("ponizej");
      const isYes = l.includes("tak") || l.includes("yes");
      const isNo = l.includes("nie") || l.includes("no");

      if (isOver && isYes) return "OVER_YES" as NormalizedSelection;
      if (isUnder && isYes) return "UNDER_YES" as NormalizedSelection;
      if (isOver && isNo) return "OVER_NO" as NormalizedSelection;
      if (isUnder && isNo) return "UNDER_NO" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "RESULT_AND_TOTAL":
    case "HALF_TIME_RESULT_AND_TOTAL": {
      const match = trimmed.match(/^([1x2])\s*i\s*([+-])/i);
      if (match) {
        const result = match[1].toUpperCase();
        const overUnder = match[2] === "+" ? "OVER" : "UNDER";
        if (result === "1") return `HOME_${overUnder}` as NormalizedSelection;
        if (result === "X") return `DRAW_${overUnder}` as NormalizedSelection;
        if (result === "2") return `AWAY_${overUnder}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "DOUBLE_CHANCE_TOTAL":
      return trimmed as NormalizedSelection;

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_TIME_ALT":
      if (lower === "bez gola" || lower === "brak gola") return "NONE" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "FIRST_GOAL_AND_RESULT": {
      // Map Polish STS selection names to canonical codes
      // "1 i 1" = Home scores first, Home wins
      // "1 i X" = Home scores first, Draw
      // "1 i 2" = Home scores first, Away wins
      // "2 i 1" = Away scores first, Home wins
      // "2 i X" = Away scores first, Draw
      // "2 i 2" = Away scores first, Away wins
      // "Bez gola" = No goal
      if (lower === "1 i 1") return "HOME_HOME" as NormalizedSelection;
      if (lower === "1 i x") return "HOME_DRAW" as NormalizedSelection;
      if (lower === "1 i 2") return "HOME_AWAY" as NormalizedSelection;
      if (lower === "2 i 1") return "AWAY_HOME" as NormalizedSelection;
      if (lower === "2 i x") return "AWAY_DRAW" as NormalizedSelection;
      if (lower === "2 i 2") return "AWAY_AWAY" as NormalizedSelection;
      if (lower === "bez gola") return "NONE" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "OTHER": {
      if (lower === "tak" || lower === "yes") return "YES";
      if (lower === "nie" || lower === "no") return "NO";
      return trimmed as NormalizedSelection;
    }

    default:
      return normalizeSts1x2Selection(trimmed, ctx);
  }
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): string | undefined {
  const parameterizedMarkets = [
    "TOTAL_GOALS", "TOTAL_GOALS_ASIAN", "HALF_TIME_TOTAL_GOALS",
    "SECOND_HALF_TOTAL_GOALS", "TEAM_TOTAL_GOALS", "ASIAN_HANDICAP", "ASIAN_HANDICAP_PUSH",
    "EUROPEAN_HANDICAP", "CORNERS_TOTAL", "CARDS_TOTAL", "HALF_TIME_CARDS_TOTAL", "CORNERS_HANDICAP",
    "RESULT_AND_TOTAL", "DOUBLE_CHANCE_TOTAL", "TOTAL_GOALS_AND_BTTS",
    "HALF_TIME_CORNERS_TOTAL", "HALF_TIME_CORNERS_TEAM", "SECOND_HALF_RESULT_AND_TOTAL",
    "HALF_TIME_GOAL_RANGE", "SECOND_HALF_GOAL_RANGE",
    "FIRST_HALF_ASIAN_HANDICAP", "FIRST_HALF_ASIAN_HANDICAP_PUSH", "FIRST_HALF_EUROPEAN_HANDICAP",
    "SECOND_HALF_ASIAN_HANDICAP", "SECOND_HALF_ASIAN_HANDICAP_PUSH", "SECOND_HALF_EUROPEAN_HANDICAP",
    "BOTH_HALVES_TOTAL_GOALS", "BOTH_HALVES_UNDER_GOALS", "BOTH_HALVES_OVER_GOALS", "HALF_TIME_TEAM_TOTAL_GOALS",
    "SECOND_HALF_TEAM_TOTAL_GOALS", "HALF_TIME_RESULT_AND_TOTAL",
    "TEAM_WIN_AT_LEAST_ONE_HALF", "TEAM_SCORES_BOTH_HALVES",
    "HOME_TEAM_TOTAL_GOALS", "AWAY_TEAM_TOTAL_GOALS",
    "HALF_TIME_HOME_TEAM_TOTAL_GOALS", "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
    "SECOND_HALF_HOME_TEAM_TOTAL_GOALS", "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
    "CARDS_TEAM",
    "CORNERS_TEAM",
    "HALF_TIME_CORNERS_HANDICAP",
    "PLAYER_GOAL_AND_RESULT",
    "EACH_TEAM_TOTAL_CORNERS_OVER",
    "EACH_TEAM_TOTAL_CARDS_OVER",
    "FIRST_GOAL_TIME",
  ];


  if (!parameterizedMarkets.includes(marketCode)) return undefined;

  // Extract interval type from raw market name (e.g., "1. gol - przedziały 15-minutowe" → "15min")
  if (marketCode === "FIRST_GOAL_TIME") {
    const intervalMatch = raw.name.match(/(\d+)-minutow/i);
    if (intervalMatch) return `${intervalMatch[1]}min`;
    // Fallback: infer from first selection
    const firstName = raw.selections[0]?.name;
    if (firstName?.match(/^\d+-15$/)) return "15min";
    if (firstName?.match(/^\d+-10$/)) return "10min";
    return "15min";
  }

  if (marketCode === "EACH_TEAM_TOTAL_CORNERS_OVER" || marketCode === "EACH_TEAM_TOTAL_CARDS_OVER") {
    for (const sel of raw.selections) {
      const match = sel.name.match(/^\+(\d+(?:[.,]\d+)?)$/);
      if (match) {
        return match[1].replace(",", ".");
      }
    }
  }

  // Extract Corners Handicap value from selection names (e.g., "1 (-2.5)", "2 (+2.5)")
  // Format: "1 (+X)" or "1 (-X)" where X is the handicap value for HOME team
  if (marketCode === "CORNERS_HANDICAP" ||
      marketCode === "HALF_TIME_CORNERS_HANDICAP") {
    // Find HOME selection (starts with "1")
    const homeSelection = raw.selections.find(s => /^1\s*\(/.test(s.name));
    if (homeSelection) {
      const handicapMatch = homeSelection.name.match(/\(([+-]?\d+(?:[.,]\d+)?)\)/);
      if (handicapMatch) {
        // Normalize: replace comma with dot and ensure sign prefix
        let value = handicapMatch[1].replace(",", ".");
        // Ensure positive values have + prefix for consistency
        if (!value.startsWith("+") && !value.startsWith("-")) {
          value = `+${value}`;
        }
        return value;
      }
    }
  }

  // Extract Asian Total Goals line from selection names (e.g., "+1", "+2", "-3")
  // The line value is an integer (1, 2, 3, etc.)
  if (marketCode === "TOTAL_GOALS_ASIAN") {
    // First try to extract from selection names like "+1", "-2"
    for (const sel of raw.selections) {
      const intMatch = sel.name.match(/^[+-](\d+)$/);
      if (intMatch) {
        return intMatch[1]; // Return integer without ".0"
      }
    }
    // Fallback: try to extract from market name like "Liczba goli (zwrot) 1"
    const nameMatch = raw.name.match(/\s(\d+)$/);
    if (nameMatch) {
      return nameMatch[1];
    }
  }

  if (marketCode === "BOTH_HALVES_UNDER_GOALS") {
    const match = raw.name.match(/poniżej\s+(\d+[.,]\d+)/i);
    if (match) return match[1].replace(",", ".");
  }

  if (marketCode === "BOTH_HALVES_OVER_GOALS") {
    const match = raw.name.match(/powyżej\s+(\d+[.,]\d+)/i);
    if (match) return match[1].replace(",", ".");
  }

  if (marketCode === "TEAM_WIN_AT_LEAST_ONE_HALF" || marketCode === "TEAM_SCORES_BOTH_HALVES") {
    const lower = raw.name.toLowerCase();
    if (lower.includes("1. drużyna") || lower.includes("gospodarz")) return "HOME";
    if (lower.includes("2. drużyna") || lower.includes("gość") || lower.includes("gosc")) return "AWAY";
  }

  // Extract European Handicap value from selection names (e.g., "1 (0:1)", "X (0:2)")
  if (marketCode === "EUROPEAN_HANDICAP" ||
      marketCode === "FIRST_HALF_EUROPEAN_HANDICAP" ||
      marketCode === "SECOND_HALF_EUROPEAN_HANDICAP") {
    const handicapMatch = raw.selections[0]?.name?.match(/\((\d+:\d+)\)/);
    if (handicapMatch) {
      return handicapMatch[1];
    }
  }

  if (marketCode === "ASIAN_HANDICAP" ||
      marketCode === "ASIAN_HANDICAP_PUSH" ||
      marketCode === "FIRST_HALF_ASIAN_HANDICAP" ||
      marketCode === "FIRST_HALF_ASIAN_HANDICAP_PUSH" ||
      marketCode === "SECOND_HALF_ASIAN_HANDICAP" ||
      marketCode === "SECOND_HALF_ASIAN_HANDICAP_PUSH") {
    const homeSelection = raw.selections.find(s => /^1\s*\(/.test(s.name));
    const awaySelection = raw.selections.find(s => /^2\s*\(/.test(s.name));
    if (homeSelection) {
      const homeMatch = homeSelection.name.match(/\(([+-]?\d+(?:[.,]\d+)?)\)/);
      if (homeMatch) {
        const homeValue = ensureSign(homeMatch[1].replace(",", "."));
        let awayValue: string;
        if (awaySelection) {
          const awayMatch = awaySelection.name.match(/\(([+-]?\d+(?:[.,]\d+)?)\)/);
          awayValue = awayMatch ? ensureSign(awayMatch[1].replace(",", ".")) : negateHandicap(homeValue);
        } else {
          awayValue = negateHandicap(homeValue);
        }
        return `${homeValue}/${awayValue}`;
      }
    }
  }

  if (marketCode === "PLAYER_GOAL_AND_RESULT") {
    for (const sel of raw.selections) {
      const match = sel.name.match(/^(.+?)\s+i\s+[1X2]$/i);
      if (match) {
        return match[1].trim();
      }
    }
  }

  const rawAny = raw as any;
  if (rawAny.lines && rawAny.lines[0]?.D) {
    return String(rawAny.lines[0].D);
  }

  const selectionNames = raw.selections.map((s) => s.name);
  return parseOverUnderLine(selectionNames);
}

export const stsNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "sts",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    let marketName = raw.name;
    let playerName: string | undefined;

    if (raw.name.includes("|")) {
      const parts = raw.name.split("|");
      marketName = parts[0];
      playerName = parts[1];
    }

    const rawId = raw.bookmakerMarketId;
    let stsId = rawId !== undefined && rawId !== null ? Number(rawId) : null;
    if (!Number.isFinite(stsId)) {
      stsId = extractStsMarketId(marketName);
    }

    if (stsId === 1845) {
      const suffix = ' - asysty (musi wyjść w "11", z dogrywką)';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 1850) {
      const suffix = ' - gole (musi wyjść w "11", z dogrywką)';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 1851 || stsId === 1263) {
      const suffixes = [
        ' - strzały (musi wyjść w "11", z dogrywką)',
        ' - liczba strzałów (musi wyjść w "11", z dogrywką)',
      ];
      for (const suffix of suffixes) {
        if (marketName.endsWith(suffix)) {
          playerName = marketName.replace(suffix, "").trim();
          break;
        }
      }
      if (!playerName && marketName.includes(" - strzały")) {
        playerName = marketName.split(" - strzały")[0].trim();
      }
      if (!playerName && marketName.includes(" - liczba strzałów")) {
        playerName = marketName.split(" - liczba strzałów")[0].trim();
      }
    }

    if (stsId === 1852 || stsId === 1264) {
      const suffixes = [
        ' - celne strzały (musi wyjść w "11", z dogrywką)',
        ' - liczba celnych strzałów (musi wyjść w "11", z dogrywką)',
      ];
      for (const suffix of suffixes) {
        if (marketName.endsWith(suffix)) {
          playerName = marketName.replace(suffix, "").trim();
          break;
        }
      }
      if (!playerName && marketName.includes(" - celne strzały")) {
        playerName = marketName.split(" - celne strzały")[0].trim();
      }
      if (!playerName && marketName.includes(" - liczba celnych strzałów")) {
        playerName = marketName.split(" - liczba celnych strzałów")[0].trim();
      }
    }

    if (stsId === 1853) {
      const suffix = ' - podania (musi wyjść w "11", z dogrywką)';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 1855) {
      const suffix = ' - otrzyma kartkę (musi wyjść w "11", z dogrywką)';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 1897) {
      const suffix = ' - odbiory (musi wyjść w "11", z dogrywką)';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      } else if (marketName.includes(" - odbiory")) {
        playerName = marketName.split(" - odbiory")[0].trim();
      }
    }

    if (stsId === 2004) {
      const suffix = ' - faule wywalczone';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 2005) {
      const suffix = ' - faule popełnione';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 2006) {
      if (marketName.includes(" - przechwyty")) {
        playerName = marketName.split(" - przechwyty")[0].trim();
      }
    }

    if (stsId === 2011) {
      const suffix = ' - obronione strzały';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 2153) {
      const suffix = ' - otrzyma czerwoną kartkę';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    let marketCode: NormalizedMarketType | null = null;
    let matchedBy: "id" | "name" = "id";

    if (stsId !== null) {
      marketCode = STS_MARKET_ID_TO_CODE[stsId] ?? null;
    }

    let nameParam: string | undefined;

    if (!marketCode) {
      matchedBy = "name";
      const nameResult = resolveMarketFromName(marketName);
      if (nameResult) {
        marketCode = nameResult.code;
        nameParam = nameResult.param;
      }
    }

    if (!marketCode) {
      console.warn(`[sts] Unknown market: "${raw.name}" (id: ${stsId ?? "none"})`);
      return null;
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[sts] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const paramValue = playerName ?? nameParam ?? extractParamValue(marketCode, raw);
    const marketKey = buildMarketKey(marketCode, paramValue);

    const selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode!, ctx, marketName),
      label: sel.name,
      odds: sel.odds,
    }));

    return {
      marketCode,
      paramValue,
      marketKey,
      selections,
      debug: {
        rawName: raw.name,
        rawId: stsId ?? undefined,
        matchedBy,
      },
    };
  },
};

function ensureSign(value: string): string {
  if (!value.startsWith("+") && !value.startsWith("-")) return `+${value}`;
  return value;
}

function negateHandicap(value: string): string {
  if (value.startsWith("+")) return `-${value.substring(1)}`;
  if (value.startsWith("-")) return `+${value.substring(1)}`;
  return value;
}

export default stsNormalizer;
