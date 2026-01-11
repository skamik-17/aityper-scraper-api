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
  parseScoreSelection,
  parseHtFtSelection,
} from "../helpers/index.js";
import { isValidMarketCode, getCategoryForMarket } from "../../../data/market-catalog.js";

const STS_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  1: "MATCH_WINNER",
  71: "HALF_TIME_RESULT",
  102: "SECOND_HALF_RESULT",
  10: "DOUBLE_CHANCE",
  4: "DRAW_NO_BET",
  11: "DRAW_NO_BET",
  20: "ASIAN_HANDICAP",
  77: "ASIAN_HANDICAP",
  259: "DRAW_NO_BET",
  314: "DRAW_NO_BET",
  368: "DRAW_NO_BET",

  25: "TOTAL_GOALS",
  28: "TEAM_TOTAL_GOALS",
  31: "TEAM_TOTAL_GOALS",
  23: "TOTAL_GOALS_ASIAN",
  80: "HALF_TIME_TOTAL_GOALS",
  110: "SECOND_HALF_TOTAL_GOALS",
  112: "SECOND_HALF_TOTAL_GOALS",

  43: "BTTS",
  95: "HALF_TIME_BTTS",
  121: "BTTS",

  35: "WIN_TO_NIL",
  47: "WIN_TO_NIL",
  48: "WIN_TO_NIL",
  36: "CLEAN_SHEET",

  14: "EUROPEAN_HANDICAP",
  22: "EUROPEAN_HANDICAP",
  76: "EUROPEAN_HANDICAP",
  79: "EUROPEAN_HANDICAP",
  106: "EUROPEAN_HANDICAP",
  107: "ASIAN_HANDICAP",
  109: "EUROPEAN_HANDICAP",

  26: "HALF_TIME_TOTAL_GOALS",
  82: "HALF_TIME_TOTAL_GOALS",
  85: "HALF_TIME_TOTAL_GOALS",
  88: "HALF_TIME_TOTAL_GOALS",

  283: "CORRECT_SCORE",
  101: "CORRECT_SCORE",
  124: "CORRECT_SCORE",

  9: "GOALSCORER_LAST",
  52: "GOALSCORER_FIRST",
  53: "GOALSCORER_LAST",
  54: "GOALSCORER_ANYTIME",
  1850: "GOALSCORER_ANYTIME",
  1851: "PLAYER_SHOTS",
  1845: "PLAYER_ASSISTS",
  1855: "PLAYER_CARDS",
  1051: "PLAYER_GOAL_AND_RESULT",
  1852: "PLAYER_SHOTS_ON_TARGET",
  1853: "PLAYER_PASSES",

  17: "WINNING_MARGIN",
  33: "GOAL_RANGE",

  220: "CORNERS_RACE",
  239: "CORNERS_RACE",
  221: "FIRST_CORNER",
  225: "CORNERS_HANDICAP",
  244: "CORNERS_HANDICAP",
  228: "CORNERS_TOTAL",
  247: "CORNERS_TOTAL",

  178: "CARDS_RACE",
  199: "CARDS_RACE",
  179: "FIRST_CARD",
  185: "CARDS_TOTAL",
  192: "CARDS_TOTAL",
  206: "CARDS_TOTAL",

  44: "FIRST_TEAM_TO_SCORE",
  125: "FIRST_GOAL_TIME",
  126: "FIRST_GOAL_TIME",
  132: "TIME_PERIOD_RESULT",

  51: "RESULT_AND_TOTAL",
  99: "RESULT_AND_TOTAL",
  58: "HALFTIME_FULLTIME",
  258: "FIRST_GOAL_AND_RESULT",

  1229: "HOME_TEAM_TO_SCORE",
  1224: "AWAY_TEAM_TO_SCORE",
};

const STS_SELECTION_OVERRIDES: Record<string, NormalizedSelection> = {
  "3": "DRAW",
  "26": "YES",
  "27": "NO",
  "4": "HOME",
  "5": "AWAY",
};

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
    case "WIN_TO_NIL":
    case "CLEAN_SHEET":
    case "FIRST_TEAM_TO_SCORE":
    case "CORNERS_RACE":
    case "CARDS_RACE":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS":
    case "CORNERS_TOTAL":
    case "CARDS_TOTAL":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
      return normalizeYesNoSelection(trimmed);

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
      return trimmed.replace(/^\d+\.\s*/, "").trim() as NormalizedSelection;

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
  ];

  if (!parameterizedMarkets.includes(marketCode)) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);
  return parseOverUnderLine(selectionNames);
}

export const stsNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "sts",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const stsId = raw.bookmakerMarketId
      ? Number(raw.bookmakerMarketId)
      : extractStsMarketId(raw.name);

    let marketCode: NormalizedMarketType | null = null;
    let matchedBy: "id" | "name" = "id";

    if (stsId !== null) {
      marketCode = STS_MARKET_ID_TO_CODE[stsId] ?? null;
    }

    if (!marketCode) {
      matchedBy = "name";
      marketCode = null;
    }

    if (!marketCode) {
      console.warn(`[sts] Unknown market: "${raw.name}" (id: ${stsId ?? "none"})`);
      return null;
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[sts] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const paramValue = extractParamValue(marketCode, raw);
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
