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
  normalizeMarketName,
  parseDecimalLine,
  parseHandicapLine,
  parseIntegerLine,
  parseOverUnderLine,
  normalize1x2Selection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  parseScoreSelection,
  parseHtFtSelection,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";

const BETTERS_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  1: "MATCH_WINNER",
  2: "ASIAN_HANDICAP",
  3: "TOTAL_GOALS",
  4: "HALFTIME_FULLTIME",
  5: "CORRECT_SCORE",
  11: "HALF_TIME_RESULT",
  12: "HALF_TIME_TOTAL_GOALS",
  26: "BTTS",
  27: "HOME_TEAM_TO_SCORE",
  28: "AWAY_TEAM_TO_SCORE",
  32: "BOTH_HALVES_GOALS",
  36: "DRAW_NO_BET",
  37: "DOUBLE_CHANCE",
  38: "FIRST_GOAL_TIME",
  274556: "DRAW_NO_BET",
  40390: "ONE_TEAM_TO_SCORE",
  333649: "LAST_TEAM_TO_SCORE",
  618: "TOTAL_GOALS_3WAY",
  5699564: "DOUBLE_CHANCE_GOAL_RANGE",
  5774433: "TOTAL_GOALS_AND_BTTS",
  40495: "HALFTIME_FULLTIME",
  40498: "HALFTIME_FULLTIME_DOUBLE_CHANCE",
  607: "HT_OR_FT_RESULT",
  8: "PENALTY_AWARDED",
  39593: "RED_CARD_AND_PENALTY",
  39594: "PENALTY_OR_RED_CARD",
  310988: "HALF_TIME_PENALTY_AWARDED",
  310989: "SECOND_HALF_PENALTY_AWARDED",
  314168: "TEAM_MISSES_PENALTY",
  314169: "PENALTY_GOAL",
  5755153: "PENALTY_MISSED",
  175100: "RED_CARD_TEAM",
  175105: "RED_CARD_TEAM",
  310990: "HALF_TIME_RED_CARD",
  310991: "SECOND_HALF_RED_CARD",
  350214: "BOTH_TEAMS_RED_CARD",
  39506: "OWN_GOAL",
  39507: "BRACE_IN_MATCH",
  39508: "HAT_TRICK",
  66: "SUBSTITUTE_GOAL",
  682: "CORRECT_SCORE",
  40421: "CORRECT_SCORE_COMBINATION",
  332816: "BTTS_AT_LEAST_ONE_HALF",
  262063: "BTTS_BOTH_HALVES",
  332818: "BTTS_2PLUS_GOALS",
  332819: "TOTAL_GOALS",
  40414: "AWAY_WIN_BOTH_HALVES",
  40415: "HOME_WIN_BOTH_HALVES",
  39504: "AWAY_WIN_AT_LEAST_ONE_HALF",
  39505: "TEAM_WIN_AT_LEAST_ONE_HALF",
  30: "HALF_TIME_GOAL",
  332813: "BOTH_HALVES_OVER_GOALS",
  7: "HALF_WITH_MORE_GOALS",
  424467: "HALF_WITH_MORE_GOALS_DOUBLE_CHANCE",
  583: "FIRST_GOAL_TIME_ALT",
  655: "FIRST_GOAL_TIME",
  40317: "SECOND_GOAL_TIME",
  329307: "GOAL_IN_TIME_WINDOW",
  40380: "GOAL_IN_TIME_PERIOD",
  40381: "GOAL_IN_TIME_PERIOD",
  40382: "GOAL_IN_TIME_PERIOD",
  40385: "GOAL_IN_TIME_PERIOD",
  40383: "GOAL_IN_TIME_PERIOD",
  40386: "GOAL_IN_TIME_PERIOD",
  40387: "GOAL_IN_TIME_PERIOD",
  40388: "GOAL_IN_TIME_PERIOD",
  40493: "GOAL_IN_TIME_PERIOD",
  40494: "GOAL_IN_TIME_PERIOD",
  40389: "GOAL_IN_TIME_PERIOD",
  299442: "GOAL_IN_90_PLUS",
  290: "SCORING_DRAW",
  647: "DRAW_IN_AT_LEAST_ONE_HALF",
  5685188: "BOTH_TEAMS_TO_LEAD",
  40393: "HOME_WIN_TO_NIL",
  40394: "HOME_WIN_TO_NIL",
  650: "ANY_TEAM_WINNING_MARGIN",
  651: "ANY_TEAM_EXACT_WINNING_MARGIN",
  652: "ANY_TEAM_WINNING_MARGIN",
  653: "ANY_TEAM_WINNING_MARGIN_2PLUS",
  654: "ANY_TEAM_WIN_BY_3PLUS",
  543: "HOME_WIN_BY_1_OR_DRAW",
  673: "TEAM_FIRST_GOAL_PERIOD",
  261965: "GOAL_RACE",
  40497: "TOTAL_GOAL_MINUTES",
  5685189: "TEAM_GOAL_MINUTES_SUM",
  670: "TEAM_MINUTES_IN_LEAD",
  671: "DRAW_MINUTES_TOTAL",
  270586: "TIME_PERIOD_TOTAL_GOALS",
  270588: "TIME_PERIOD_TOTAL_GOALS",
  270590: "TIME_PERIOD_TOTAL_GOALS",
  270591: "TIME_PERIOD_TOTAL_GOALS",
  175092: "TIME_PERIOD_RESULT",
  270619: "TIME_PERIOD_RESULT",
  175095: "TIME_PERIOD_RESULT",
  270825: "TIME_PERIOD_TOTAL_GOALS",
  270826: "TIME_PERIOD_TOTAL_GOALS",
  270827: "TIME_PERIOD_TOTAL_GOALS",
  270828: "TIME_PERIOD_TOTAL_GOALS",
  270829: "TIME_PERIOD_TOTAL_GOALS",
  270830: "TIME_PERIOD_TOTAL_GOALS",
  270832: "TIME_PERIOD_TOTAL_GOALS",
  270833: "TIME_PERIOD_TOTAL_GOALS",
};

const BETTERS_MARKET_NAME_TO_CODE: Record<string, NormalizedMarketType> = {
  "wynik meczu": "MATCH_WINNER",
  "podwojna szansa": "DOUBLE_CHANCE",
  "remis = zwrot": "DRAW_NO_BET",
  "dokladny wynik": "CORRECT_SCORE",
  "obie druzyny strzela": "BTTS",
  "wynik 1. polowy": "HALF_TIME_RESULT",
  "wynik 2. polowy": "SECOND_HALF_RESULT",
  "czas pierwszego gola": "FIRST_GOAL_TIME",
  "parzyste/nieparzyste": "ODD_EVEN_GOALS",
  "wygrana do zera": "WIN_TO_NIL",
  "czyste konto": "CLEAN_SHEET",
};

const BETTERS_MARKET_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /wynik\s*meczu\s*i\s*suma/, code: "RESULT_AND_TOTAL" },
  { pattern: /wynik\s*meczu\s*i\s*obie\s*druzyny\s*strzela/, code: "RESULT_AND_BTTS" },
  { pattern: /podwojna\s*szansa\s*i\s*obie\s*druzyny\s*strzela/, code: "DOUBLE_CHANCE_BTTS" },
  { pattern: /podwojna\s*szansa\s*i\s*suma\s*goli/, code: "DOUBLE_CHANCE_TOTAL" },
  { pattern: /wynik\s*1\.?\s*polow/, code: "HALF_TIME_RESULT" },
  { pattern: /wynik\s*2\.?\s*polow/, code: "SECOND_HALF_RESULT" },
  { pattern: /obie\s*druzyny\s*strzela.*1\.?\s*polow/, code: "HALF_TIME_BTTS" },
  { pattern: /liczba\s*goli.*1\.?\s*polow/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /liczba\s*goli.*2\.?\s*polow/, code: "SECOND_HALF_TOTAL_GOALS" },
  { pattern: /wynik\s*meczu\s*w\s*przedziale/, code: "TIME_PERIOD_RESULT" },
  { pattern: /handicap\s*3[-\s]?drogowy|handicap\s*europej/, code: "EUROPEAN_HANDICAP" },
  { pattern: /handicap/, code: "ASIAN_HANDICAP" },
  { pattern: /parzyste|nieparzyst/, code: "ODD_EVEN_GOALS" },
  { pattern: /wygrana\s*do\s*zera/, code: "WIN_TO_NIL" },
  { pattern: /czyste\s*konto/, code: "CLEAN_SHEET" },
  { pattern: /pierwszy\s*strzelec/, code: "GOALSCORER_FIRST" },
  { pattern: /ostatni\s*strzelec/, code: "GOALSCORER_LAST" },
  { pattern: /strzelec/, code: "GOALSCORER_ANYTIME" },
];

function extractTimePeriodParam(name: string): string | undefined {
  const normalized = normalizeMarketName(name);
  const rangeMatch = normalized.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) return rangeMatch[2];

  const minuteMatch = normalized.match(/\b(\d+)\b/);
  return minuteMatch ? minuteMatch[1] : undefined;
}

function resolveMarketCode(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): { marketCode: NormalizedMarketType; matchedBy: "id" | "name" | "pattern"; rawId?: number } {
  const normalizedName = normalizeMarketName(raw.name);
  const direct = BETTERS_MARKET_NAME_TO_CODE[normalizedName];
  if (direct) {
    return { marketCode: direct, matchedBy: "name" };
  }

  const home = ctx.homeTeam ? normalizeMarketName(ctx.homeTeam) : "";
  const away = ctx.awayTeam ? normalizeMarketName(ctx.awayTeam) : "";

  const isGoalRange = /suma\s*goli[:\s]+\d+\s*[-–]\s*\d+/i.test(normalizedName);
  if (isGoalRange) {
    return { marketCode: "GOAL_RANGE", matchedBy: "pattern" };
  }

  if (/suma\s*goli/.test(normalizedName)) {
    if ((home && normalizedName.includes(home)) || (away && normalizedName.includes(away))) {
      return { marketCode: "TEAM_TOTAL_GOALS", matchedBy: "pattern" };
    }
    return { marketCode: "TOTAL_GOALS", matchedBy: "pattern" };
  }

  if (/liczba\s*goli/.test(normalizedName)) {
    const lineMatch = normalizedName.match(/liczba\s*goli\s*(\d+(?:[.,]\d+)?)/);
    if (lineMatch) {
      const line = lineMatch[1].replace(",", ".");
      if (line.endsWith(".0") || /^\d+$/.test(line)) {
        return { marketCode: "TOTAL_GOALS_ASIAN", matchedBy: "pattern" };
      }
    }
    return { marketCode: "TOTAL_GOALS", matchedBy: "pattern" };
  }

  for (const entry of BETTERS_MARKET_PATTERNS) {
    if (entry.pattern.test(normalizedName)) {
      return { marketCode: entry.code, matchedBy: "pattern" };
    }
  }

  const rawId = raw.bookmakerMarketId ? Number(raw.bookmakerMarketId) : undefined;
  if (rawId !== undefined && !Number.isNaN(rawId)) {
    const mapped = BETTERS_MARKET_ID_TO_CODE[rawId];
    if (mapped) {
      return { marketCode: mapped, matchedBy: "id", rawId };
    }
  }

  return { marketCode: "OTHER", matchedBy: "pattern", rawId };
}

function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();
  const normalized = normalizeMarketName(trimmed);

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "WIN_TO_NIL":
    case "CLEAN_SHEET":
    case "FIRST_TEAM_TO_SCORE":
    case "TIME_PERIOD_RESULT":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

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
    case "BOTH_HALVES_GOALS":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "CORNERS_HANDICAP":
      if (/handicap\s*1/.test(normalized)) return "HOME";
      if (/handicap\s*2/.test(normalized)) return "AWAY";
      if (/handicap\s*x/.test(normalized)) return "DRAW";
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed)) return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

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

    case "FIRST_GOAL_TIME":
    case "RESULT_AND_TOTAL":
    case "RESULT_AND_BTTS":
    case "DOUBLE_CHANCE_BTTS":
    case "DOUBLE_CHANCE_TOTAL":
    case "FIRST_GOAL_AND_RESULT":
      return trimmed as NormalizedSelection;

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

function extractParamValue(marketCode: NormalizedMarketType, raw: RawBookmakerMarket): string | undefined {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  if (marketCode === "TIME_PERIOD_RESULT") {
    return extractTimePeriodParam(raw.name);
  }

  const selectionNames = raw.selections.map((s) => s.name);
  const groupName = raw.groupName ?? "";

  switch (metadata.parameterType) {
    case "handicap":
      return (
        parseHandicapLine(raw.name) ??
        selectionNames.map((name) => parseHandicapLine(name)).find(Boolean) ??
        parseHandicapLine(groupName)
      );
    case "integer": {
      const integerLine = parseIntegerLine(raw.name) ?? parseIntegerLine(groupName);
      if (integerLine) return integerLine;

      const decimalLine = parseDecimalLine(raw.name) ?? parseDecimalLine(groupName);
      if (decimalLine?.endsWith(".0")) return decimalLine.replace(/\.0$/, "");

      const fromSelections = parseOverUnderLine(selectionNames);
      if (fromSelections?.endsWith(".0")) return fromSelections.replace(/\.0$/, "");

      return fromSelections;
    }
    case "decimal":
    default:
      return (
        parseDecimalLine(raw.name) ??
        parseOverUnderLine(selectionNames) ??
        parseDecimalLine(groupName)
      );
  }
}

export const bettersNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "betters",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { marketCode, matchedBy, rawId } = resolveMarketCode(raw, ctx);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[betters] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const marketMetadata = getMarketMetadata(marketCode);
    const marketName = marketMetadata?.labels.pl ?? raw.name;

    const paramValue = extractParamValue(marketCode, raw);
    const marketKey = buildMarketKey(marketCode, paramValue);

    const selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode, ctx),
      label: sel.name,
      odds: sel.odds,
    }));

    if (marketCode === "OTHER") {
      console.warn(`[betters] Unmapped market "${raw.name}" (id: ${rawId ?? "none"})`);
    }

    return {
      marketCode,
      marketName,
      paramValue,
      marketKey,
      selections,
      debug: {
        rawName: raw.name,
        rawId: rawId ?? raw.bookmakerMarketId,
        matchedBy,
      },
    } as NormalizedMarketOutput;
  },

};

export default bettersNormalizer;
