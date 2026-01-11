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

const STS_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  1: "MATCH_WINNER",
  10: "DOUBLE_CHANCE",
  4: "DRAW_NO_BET",
  11: "DRAW_NO_BET",
  259: "DRAW_NO_BET",
  314: "DRAW_NO_BET",
  368: "DRAW_NO_BET",

  25: "TOTAL_GOALS",
  28: "TEAM_TOTAL_GOALS",
  31: "TEAM_TOTAL_GOALS",
  23: "TOTAL_GOALS_ASIAN",

  43: "BTTS",
  121: "SECOND_HALF_BTTS",

  8: "FIRST_TEAM_TO_SCORE",
  9: "FIRST_TEAM_TO_SCORE",
  44: "FIRST_TEAM_TO_SCORE",

  35: "TEAM_GOAL_RANGE",
  36: "TEAM_GOAL_RANGE",
  47: "WIN_TO_NIL",
  48: "WIN_TO_NIL",
  57: "OTHER",

  14: "EUROPEAN_HANDICAP",
  22: "EUROPEAN_HANDICAP",
  20: "ASIAN_HANDICAP",
  77: "ASIAN_HANDICAP",
  76: "EUROPEAN_HANDICAP",
  79: "EUROPEAN_HANDICAP",
  106: "EUROPEAN_HANDICAP",
  107: "ASIAN_HANDICAP",
  109: "EUROPEAN_HANDICAP",

  71: "HALF_TIME_RESULT",
  74: "DOUBLE_CHANCE",
  75: "DRAW_NO_BET",
  80: "HALF_TIME_TOTAL_GOALS",
  26: "HALF_TIME_TOTAL_GOALS",
  82: "HALF_TIME_TOTAL_GOALS",
  85: "HALF_TIME_TOTAL_GOALS",
  88: "HALF_TIME_TOTAL_GOALS",
  95: "HALF_TIME_BTTS",

  102: "SECOND_HALF_RESULT",
  110: "SECOND_HALF_TOTAL_GOALS",
  112: "SECOND_HALF_TOTAL_GOALS",

  283: "CORRECT_SCORE",
  101: "CORRECT_SCORE",
  124: "CORRECT_SCORE",

  52: "GOALSCORER_FIRST",
  53: "GOALSCORER_LAST",
  54: "GOALSCORER_ANYTIME",
  1850: "GOALSCORER_ANYTIME",
  1851: "PLAYER_SHOTS",
  1845: "PLAYER_ASSISTS",
  1051: "PLAYER_GOAL_AND_RESULT",
  1852: "PLAYER_SHOTS_ON_TARGET",
  1853: "PLAYER_PASSES",
  2004: "PLAYER_2_OR_MORE_GOALS",
  2005: "PLAYER_3_OR_MORE_GOALS",
  2006: "PLAYER_HAT_TRICK",
  1855: "PLAYER_CARDS",
  2011: "TEAM_TOTAL_SCORERS",
  2153: "PLAYER_CARDS",

  17: "WINNING_MARGIN",
  33: "GOAL_RANGE",

  220: "CORNERS_RACE",
  239: "CORNERS_RACE",
  221: "FIRST_CORNER",
  225: "CORNERS_HANDICAP",
  244: "CORNERS_HANDICAP",
  228: "CORNERS_TOTAL",
  247: "CORNERS_TOTAL",
  235: "HALF_TIME_CORNERS_TOTAL",
  236: "CORNERS_TEAM",
  237: "CORNERS_TEAM",
  231: "CORNERS_TEAM",
  234: "CORNERS_TEAM",
  254: "HALF_TIME_CORNERS_TEAM",
  255: "HALF_TIME_CORNERS_TEAM",
  256: "HALF_TIME_CORNERS_RACE",
  2097: "OTHER",
  807: "DOUBLE_CHANCE_BTTS",
  808: "RESULT_AND_BTTS",
  809: "SECOND_HALF_RESULT_AND_TOTAL",
  810: "DOUBLE_CHANCE_BTTS",
  811: "DOUBLE_CHANCE_BTTS",
  812: "DOUBLE_CHANCE_TOTAL",
  813: "GOAL_RANGE",
  814: "TEAM_GOAL_RANGE",
  815: "TEAM_GOAL_RANGE",
  816: "OTHER",
  817: "HALF_TIME_GOAL_RANGE",
  818: "SECOND_HALF_GOAL_RANGE",

  178: "CARDS_RACE",
  199: "CARDS_RACE",
  179: "FIRST_CARD",
  185: "CARDS_TOTAL",
  192: "CARDS_TOTAL",
  206: "CARDS_TOTAL",
  188: "CARDS_TEAM",
  191: "CARDS_TEAM",
  193: "CARDS_TEAM",
  194: "CARDS_TEAM",
  196: "OTHER",
  197: "OTHER",
  198: "OTHER",
  217: "OTHER",
  2098: "OTHER",

  125: "FIRST_GOAL_TIME",
  126: "FIRST_GOAL_TIME",
  132: "TIME_PERIOD_RESULT",

  49: "RESULT_AND_BTTS",
  50: "RESULT_AND_BTTS",
  51: "RESULT_AND_TOTAL",
  99: "RESULT_AND_TOTAL",
  58: "HALFTIME_FULLTIME",
  258: "FIRST_GOAL_AND_RESULT",

  1229: "HOME_TEAM_TO_SCORE",
  1224: "AWAY_TEAM_TO_SCORE",

  40: "ODD_EVEN_GOALS",
  41: "ODD_EVEN_GOALS",
  42: "ODD_EVEN_GOALS",

  59: "BOTH_HALVES_GOALS",
  60: "BOTH_HALVES_GOALS",
  61: "BOTH_HALVES_GOALS",
  62: "BOTH_HALVES_GOALS",
  63: "BOTH_HALVES_GOALS",
  64: "BOTH_HALVES_GOALS",
  65: "BOTH_HALVES_GOALS",
  66: "BOTH_HALVES_GOALS",
  67: "BOTH_HALVES_GOALS",
  68: "BOTH_HALVES_GOALS",
  69: "BOTH_HALVES_GOALS",
  70: "BOTH_HALVES_GOALS",

  73: "FIRST_TEAM_TO_SCORE",

  90: "GOAL_RANGE",
  94: "GOAL_RANGE",
  98: "GOAL_RANGE",

  103: "FIRST_TEAM_TO_SCORE",
  104: "DOUBLE_CHANCE",
  105: "DRAW_NO_BET",

  115: "TEAM_TOTAL_GOALS",
  118: "TEAM_TOTAL_GOALS",
  119: "TEAM_GOAL_RANGE",
  120: "ODD_EVEN_GOALS",

  1012: "WINNING_MARGIN",
  1232: "WINNING_MARGIN",
  1233: "WINNING_MARGIN",
  1234: "WINNING_MARGIN",
  1235: "WINNING_MARGIN",
  1244: "WINNING_MARGIN",

  1413: "OTHER",
  1561: "OTHER",
  1562: "OTHER",
  1897: "OTHER",
  1898: "OTHER",
  1899: "OTHER",
  2111: "FOULS_TOTAL",
  2112: "OTHER",
  2113: "OTHER",
  2114: "OTHER",
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

  // Correct score
  { pattern: /^dok[lł]adny\s+wynik$/i, code: "CORRECT_SCORE" },

  // Handicap markets
  { pattern: /^handicap\s+azjatycki/i, code: "ASIAN_HANDICAP" },
  { pattern: /^handicap\s+europejski/i, code: "EUROPEAN_HANDICAP" },

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

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selName.trim();
  const lower = trimmed.toLowerCase();

  const override = STS_SELECTION_OVERRIDES[trimmed];
  if (override) return override;

  if (/^1\s*\([+-]/.test(trimmed)) return "HOME";
  if (/^2\s*\([+-]/.test(trimmed)) return "AWAY";
  if (/^x\s*\(/i.test(trimmed)) return "DRAW";

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "CORNERS_RACE":
    case "CARDS_RACE":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "FIRST_CARD":
      if (lower === "bez gola" || lower === "brak" || lower === "żaden" || lower === "bez kartek") return "NONE" as NormalizedSelection;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "HALF_TIME_CORNERS_RACE":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "FIRST_TEAM_TO_SCORE":
    case "FIRST_CORNER":
      if (lower === "bez gola" || lower === "brak gola" || lower === "żaden" || lower === "brak") return "NONE" as NormalizedSelection;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS":
    case "CORNERS_TOTAL":
      return normalizeOverUnderSelection(trimmed);

    case "CARDS_TOTAL":
    case "FOULS_TOTAL":
    case "CARDS_TEAM":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return normalizeOverUnderSelection(trimmed);

    case "HALF_TIME_CORNERS_TOTAL":
    case "HALF_TIME_CORNERS_TEAM":
    case "CORNERS_TEAM":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
    case "WIN_TO_NIL":
    case "CLEAN_SHEET":
      return normalizeYesNoSelection(trimmed);

    case "BOTH_HALVES_GOALS":
      if (lower === "tak" || lower === "yes") return "YES";
      if (lower === "nie" || lower === "no") return "NO";
      if (lower === "remis" || lower === "równo") return "DRAW" as NormalizedSelection;
      if (lower.includes("1. połowa") || lower.includes("1 polowa")) return "FIRST_HALF" as NormalizedSelection;
      if (lower.includes("2. połowa") || lower.includes("2 polowa")) return "SECOND_HALF" as NormalizedSelection;
      if (lower === "bez goli" || lower === "brak goli") return "NONE" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "CORNERS_HANDICAP":
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed)) return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

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
      return trimmed.replace(/^\d+\.\s*/, "").trim() as NormalizedSelection;

    case "PLAYER_GOAL_AND_RESULT": {
      const match = trimmed.match(/^(.+?)\s+i\s+([1X2])$/i);
      if (match) {
        const result = match[2].toUpperCase();
        const playerName = match[1].trim();
        const resultCode = result === "1" ? "HOME" : result === "X" ? "DRAW" : "AWAY";
        return `${playerName}_${resultCode}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "TEAM_TOTAL_SCORERS":
      if (/^\d+\+$/.test(trimmed)) return "OVER";
      if (/^\d+-$/.test(trimmed)) return "UNDER";
      return normalizeOverUnderSelection(trimmed);

    case "DOUBLE_CHANCE_BTTS": {
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
      const lower = trimmed.toLowerCase();
      if (lower.includes("1") && lower.includes("i") && lower.includes("-")) return "HOME_OVER" as NormalizedSelection;
      if (lower.includes("1") && lower.includes("i") && lower.includes("+")) return "HOME_UNDER" as NormalizedSelection;
      if (lower.includes("x") && lower.includes("i") && lower.includes("-")) return "DRAW_OVER" as NormalizedSelection;
      if (lower.includes("x") && lower.includes("i") && lower.includes("+")) return "DRAW_UNDER" as NormalizedSelection;
      if (lower.includes("2") && lower.includes("i") && lower.includes("-")) return "AWAY_OVER" as NormalizedSelection;
      if (lower.includes("2") && lower.includes("i") && lower.includes("+")) return "AWAY_UNDER" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "GOAL_RANGE":
    case "TEAM_GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
    case "WINNING_MARGIN":
    case "TIME_PERIOD_RESULT":
      return trimmed as NormalizedSelection;

    case "RESULT_AND_BTTS": {
      const l = lower;
      if (l.includes("1") && l.includes("tak")) return "HOME_YES" as NormalizedSelection;
      if (l.includes("1") && l.includes("nie")) return "HOME_NO" as NormalizedSelection;
      if (l.includes("x") && l.includes("tak")) return "DRAW_YES" as NormalizedSelection;
      if (l.includes("x") && l.includes("nie")) return "DRAW_NO" as NormalizedSelection;
      if (l.includes("2") && l.includes("tak")) return "AWAY_YES" as NormalizedSelection;
      if (l.includes("2") && l.includes("nie")) return "AWAY_NO" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "RESULT_AND_TOTAL":
    case "DOUBLE_CHANCE_TOTAL":
    case "FIRST_GOAL_AND_RESULT":
    case "FIRST_GOAL_TIME":
      return trimmed as NormalizedSelection;

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);
  }
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): string | undefined {
  const parameterizedMarkets = [
    "TOTAL_GOALS", "TOTAL_GOALS_ASIAN", "HALF_TIME_TOTAL_GOALS",
    "SECOND_HALF_TOTAL_GOALS", "TEAM_TOTAL_GOALS", "ASIAN_HANDICAP",
    "EUROPEAN_HANDICAP", "CORNERS_TOTAL", "CARDS_TOTAL", "CORNERS_HANDICAP",
    "RESULT_AND_TOTAL", "DOUBLE_CHANCE_TOTAL",
    "HALF_TIME_CORNERS_TOTAL", "HALF_TIME_CORNERS_TEAM", "SECOND_HALF_RESULT_AND_TOTAL",
    "TEAM_GOAL_RANGE",
    "TEAM_TOTAL_SCORERS",
  ];

  if (!parameterizedMarkets.includes(marketCode)) return undefined;

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

    const stsId = raw.bookmakerMarketId
      ? Number(raw.bookmakerMarketId)
      : extractStsMarketId(marketName);

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
      code: normalizeSelectionForMarket(sel.name, marketCode!, ctx),
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

  normalizeMarkets(
    markets: RawBookmakerMarket[],
    ctx: NormalizationContext
  ): NormalizedMarketOutput[] {
    return markets
      .map((m) => this.normalizeMarket(m, ctx))
      .filter((m): m is NormalizedMarketOutput => m !== null);
  },
};

export default stsNormalizer;
