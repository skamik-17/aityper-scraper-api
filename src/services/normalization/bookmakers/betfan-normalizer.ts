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
import { GAME_TYPES } from "../../../scrapers/bookmakers/betfan/constants.js";

const BETFAN_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "MATCH_WINNER",
  [GAME_TYPES.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [GAME_TYPES.DRAW_NO_BET]: "DRAW_NO_BET",
  [GAME_TYPES.OVER_UNDER]: "TOTAL_GOALS",
  [GAME_TYPES.BTTS]: "BTTS",
  [GAME_TYPES.ODD_EVEN]: "ODD_EVEN_GOALS",
  [GAME_TYPES.HANDICAP]: "ASIAN_HANDICAP",
  [GAME_TYPES.HALF_TIME_RESULT]: "HALF_TIME_RESULT",
  [GAME_TYPES.HALF_TIME_OVER_UNDER]: "HALF_TIME_TOTAL_GOALS",
  [GAME_TYPES.HALF_TIME_BTTS]: "HALF_TIME_BTTS",
  [GAME_TYPES.CORRECT_SCORE]: "CORRECT_SCORE",
  [GAME_TYPES.CORNERS_TOTAL]: "CORNERS_TOTAL",
  [GAME_TYPES.CARDS_TOTAL]: "CARDS_TOTAL",
  [GAME_TYPES.TEAM_GOALS]: "TEAM_TOTAL_GOALS",
  [GAME_TYPES.HOME_TEAM_OVER_UNDER]: "TEAM_TOTAL_GOALS",
  [GAME_TYPES.AWAY_TEAM_OVER_UNDER]: "TEAM_TOTAL_GOALS",
  [GAME_TYPES.CLEAN_SHEET]: "CLEAN_SHEET",
  [GAME_TYPES.WIN_MARGIN]: "WINNING_MARGIN",
  [GAME_TYPES.HALFTIME_FULLTIME]: "HALFTIME_FULLTIME",
  [GAME_TYPES.EXACT_GOALS]: "GOAL_RANGE",
};

const BETFAN_MARKET_TYPE_TO_CODE: Record<string, NormalizedMarketType> = {
  "1x2": "MATCH_WINNER",
  double_chance: "DOUBLE_CHANCE",
  draw_no_bet: "DRAW_NO_BET",
  over_under: "TOTAL_GOALS",
  btts: "BTTS",
  odd_even: "ODD_EVEN_GOALS",
  handicap: "ASIAN_HANDICAP",
  half_time_1x2: "HALF_TIME_RESULT",
  half_time_over_under: "HALF_TIME_TOTAL_GOALS",
  half_time_btts: "HALF_TIME_BTTS",
  correct_score: "CORRECT_SCORE",
  team_goals: "TEAM_TOTAL_GOALS",
  home_team_over_under: "TEAM_TOTAL_GOALS",
  away_team_over_under: "TEAM_TOTAL_GOALS",
  clean_sheet: "CLEAN_SHEET",
  win_margin: "WINNING_MARGIN",
  halftime_fulltime: "HALFTIME_FULLTIME",
  exact_goals: "GOAL_RANGE",
  corners: "CORNERS_TOTAL",
  cards: "CARDS_TOTAL",
};

const BETFAN_MARKET_NAME_OVERRIDES: Record<string, NormalizedMarketType> = {
  mecz: "MATCH_WINNER",
  "1x2": "MATCH_WINNER",
  "podwojna szansa": "DOUBLE_CHANCE",
  "zaklad bez remisu (remis=zwrot)": "DRAW_NO_BET",
  "obie druzyny strzela gola": "BTTS",
  "dokladny wynik": "CORRECT_SCORE",
  multiwynik: "CORRECT_SCORE",
  "liczba goli - przedzial bramkowy": "GOAL_RANGE",
  "liczba goli": "GOAL_RANGE",
  "roznica zwyciestwa": "WINNING_MARGIN",
  "strzelec 1. gola": "GOALSCORER_FIRST",
  "zawodnik strzeli gola": "GOALSCORER_ANYTIME",
  "1. gol": "FIRST_TEAM_TO_SCORE",
  "1. gol i wynik meczu": "FIRST_GOAL_AND_RESULT",
  "kiedy zostanie strzelony 1. gol (przedzial 10 minutowy)": "FIRST_GOAL_TIME",
  "kiedy zostanie strzelony 1. gol (przedzial 15 minutowy)": "FIRST_GOAL_TIME",
  "10 minut - wynik od 1 do 10 (00:00-09:59)": "TIME_PERIOD_RESULT",
  "1. polowa/wynik koncowy - dokladny wynik": "OTHER",
};

const BETFAN_MARKET_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /^1\.?\s*polow.*podwojna szansa/, code: "DOUBLE_CHANCE" },
  { pattern: /^2\.?\s*polow.*podwojna szansa/, code: "DOUBLE_CHANCE" },
  { pattern: /^1\.?\s*polow.*zaklad bez remisu/, code: "DRAW_NO_BET" },
  { pattern: /^2\.?\s*polow.*zaklad bez remisu/, code: "DRAW_NO_BET" },
  { pattern: /^1\.?\s*polow.*obie.*strzela/, code: "HALF_TIME_BTTS" },
  { pattern: /^2\.?\s*polow.*obie.*strzela/, code: "BTTS" },
  { pattern: /^1\.?\s*polow.*wynik/, code: "HALF_TIME_RESULT" },
  { pattern: /^2\.?\s*polow.*wynik/, code: "SECOND_HALF_RESULT" },
  { pattern: /^1\.?\s*polow.*liczba goli/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /^2\.?\s*polow.*liczba goli/, code: "SECOND_HALF_TOTAL_GOALS" },
  { pattern: /^1\.?\s*polow.*handicap/, code: "ASIAN_HANDICAP" },
  { pattern: /^2\.?\s*polow.*handicap/, code: "ASIAN_HANDICAP" },
  { pattern: /handicap/, code: "ASIAN_HANDICAP" },
  { pattern: /czyste konto/, code: "CLEAN_SHEET" },
  { pattern: /wygr[a-z]+ do zera/, code: "WIN_TO_NIL" },
  { pattern: /strzeli gola w obu polowach/, code: "BOTH_HALVES_GOALS" },
  { pattern: /obie polowy (ponizej|powyzej)/, code: "BOTH_HALVES_GOALS" },
  { pattern: /- liczba goli$/, code: "TEAM_TOTAL_GOALS" },
  { pattern: /kiedy zostanie strzelony 1\. gol/, code: "FIRST_GOAL_TIME" },
  { pattern: /1\. gol i wynik/, code: "FIRST_GOAL_AND_RESULT" },
  { pattern: /1\. gol/, code: "FIRST_TEAM_TO_SCORE" },
  { pattern: /dokladny wynik/, code: "CORRECT_SCORE" },
  { pattern: /parzyste\/?nieparzyste/, code: "ODD_EVEN_GOALS" },
  { pattern: /rzuty rozne/, code: "CORNERS_TOTAL" },
  { pattern: /liczba kartek/, code: "CARDS_TOTAL" },
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[łŁ]/g, "l")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveMarketCode(raw: RawBookmakerMarket): {
  marketCode: NormalizedMarketType;
  matchedBy: "id" | "name" | "pattern";
  rawId?: string | number;
} {
  const rawId = raw.bookmakerMarketId;

  if (rawId !== undefined && rawId !== null) {
    if (typeof rawId === "number" || /^\d+$/.test(String(rawId))) {
      const numericId = Number(rawId);
      const byId = BETFAN_MARKET_ID_TO_CODE[numericId];
      if (byId) {
        return { marketCode: byId, matchedBy: "id", rawId: numericId };
      }
    } else {
      const normalizedType = normalizeText(String(rawId)).replace(/\s+/g, "_");
      const byType = BETFAN_MARKET_TYPE_TO_CODE[normalizedType];
      if (byType) {
        return { marketCode: byType, matchedBy: "id", rawId: String(rawId) };
      }
    }
  }

  const normalizedName = normalizeText(raw.name);
  const direct = BETFAN_MARKET_NAME_OVERRIDES[normalizedName];
  if (direct) {
    return { marketCode: direct, matchedBy: "name", rawId: rawId ?? undefined };
  }

  for (const entry of BETFAN_MARKET_PATTERNS) {
    if (entry.pattern.test(normalizedName)) {
      return { marketCode: entry.code, matchedBy: "pattern", rawId: rawId ?? undefined };
    }
  }

  return { marketCode: "OTHER", matchedBy: "pattern", rawId: rawId ?? undefined };
}

function resolveHandicapCode(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): NormalizedMarketType {
  if (marketCode !== "ASIAN_HANDICAP" && marketCode !== "EUROPEAN_HANDICAP") {
    return marketCode;
  }

  const hasDrawSelection = raw.selections.some((sel) => {
    const normalized = normalizeText(sel.name);
    return normalized === "x" || normalized.startsWith("x ") || normalized.includes("remis");
  });

  if (hasDrawSelection || raw.selections.length === 3) {
    return "EUROPEAN_HANDICAP";
  }

  return "ASIAN_HANDICAP";
}

function normalizeBetfanDoubleChance(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const base = normalizeDoubleChanceSelection(selectionName);
  if (base !== "UNKNOWN") return base;

  const normalizedSelection = normalizeText(selectionName.replace(/[\/]/g, " "));
  const home = normalizeText(ctx.homeTeam ?? "");
  const away = normalizeText(ctx.awayTeam ?? "");

  if (normalizedSelection.includes("remis") || normalizedSelection.includes("x")) {
    if (home && normalizedSelection.includes(home)) return "HOME_OR_DRAW";
    if (away && normalizedSelection.includes(away)) return "DRAW_OR_AWAY";
  }

  if (home && away && normalizedSelection.includes(home) && normalizedSelection.includes(away)) {
    return "HOME_OR_AWAY";
  }

  return "UNKNOWN";
}

function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "FIRST_TEAM_TO_SCORE":
    case "TIME_PERIOD_RESULT":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "DOUBLE_CHANCE":
      return normalizeBetfanDoubleChance(trimmed, ctx);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS":
    case "CORNERS_TOTAL":
    case "CARDS_TOTAL": {
      const overUnder = normalizeOverUnderSelection(trimmed);
      return overUnder === "UNKNOWN" ? (trimmed as NormalizedSelection) : overUnder;
    }

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "BOTH_HALVES_GOALS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
      return normalizeYesNoSelection(trimmed);

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
      return trimmed.replace(/^\d+\.\s*/, "").trim() as NormalizedSelection;

    case "WIN_TO_NIL":
    case "CLEAN_SHEET": {
      const yesNo = normalizeYesNoSelection(trimmed);
      return yesNo === "UNKNOWN"
        ? normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam)
        : yesNo;
    }

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_AND_RESULT":
    case "WINNING_MARGIN":
    case "GOAL_RANGE":
      return trimmed as NormalizedSelection;

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);
  }
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): string | undefined {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);
  const groupName = raw.groupName ?? "";

  switch (metadata.parameterType) {
    case "handicap":
      return (
        parseHandicapLine(raw.name) ??
        parseHandicapLine(selectionNames.join(" ")) ??
        parseHandicapLine(groupName)
      );
    case "integer":
      return (
        parseIntegerLine(raw.name) ??
        parseIntegerLine(groupName) ??
        parseOverUnderLine(selectionNames)
      );
    case "decimal":
    default:
      return (
        parseDecimalLine(raw.name) ??
        parseDecimalLine(groupName) ??
        parseOverUnderLine(selectionNames)
      );
  }
}

export const betfanNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "betfan",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { marketCode, matchedBy, rawId } = resolveMarketCode(raw);
    const resolvedCode = resolveHandicapCode(marketCode, raw);

    if (!isValidMarketCode(resolvedCode)) {
      console.error(`[betfan] Market code "${resolvedCode}" not in catalog`);
      return null;
    }

    const paramValue = extractParamValue(resolvedCode, raw);
    const marketKey = buildMarketKey(resolvedCode, paramValue);

    const selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, resolvedCode, ctx),
      label: sel.name,
      odds: sel.odds,
    }));

    return {
      marketCode: resolvedCode,
      paramValue,
      marketKey,
      selections,
      debug: {
        rawName: raw.name,
        rawId: rawId ?? undefined,
        matchedBy,
      },
    };
  },
};

export default betfanNormalizer;
