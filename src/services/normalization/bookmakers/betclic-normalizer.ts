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

const BETCLIC_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {};

const BETCLIC_MARKET_NAME_TO_CODE: Record<string, NormalizedMarketType> = {
  "wynik meczu": "MATCH_WINNER",
  "podwojna szansa": "DOUBLE_CHANCE",
  "obie druzyny strzela": "BTTS",
  "dokladny wynik": "CORRECT_SCORE",
  "wynik 1 polowy": "HALF_TIME_RESULT",
  "1. polowa wynik": "HALF_TIME_RESULT",
  "wynik 2 polowy": "SECOND_HALF_RESULT",
  "remis bez zakladu": "DRAW_NO_BET",
  "1. polowa - pierwszy gol": "HALF_TIME_FIRST_GOAL",
  "1. polowa - rzuty rozne": "HALF_TIME_CORNERS_TOTAL",
};

const BETCLIC_MARKET_PATTERNS: Array<{
  pattern: RegExp;
  code: NormalizedMarketType;
}> = [
  { pattern: /^liczba goli\s+\d+/i, code: "TOTAL_GOALS" },
  { pattern: /^liczba goli\b/i, code: "TOTAL_GOALS" },
  { pattern: /^obie druzyny strzela/i, code: "BTTS" },
  { pattern: /^1\. polowa - nastepny \d+ rzut rozny$/i, code: "NEXT_CORNER_1H" },
  { pattern: /^1\. polowa - ostatni rzut rozny$/i, code: "HALF_TIME_LAST_CORNER" },
  { pattern: /^1x2 rzuty rozne/i, code: "CORNERS_RACE" },
  { pattern: /^1x2 strzaly/i, code: "MOST_SHOTS" },
  { pattern: /^strzelec:/i, code: "OTHER" },
  { pattern: /^\d+\s+graczy\s+strzeli\s+pow\.\s*\d+[,.]?\d*\s+gol/i, code: "TWO_PLAYERS_COMBINED_GOALS" },
];

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

function resolveHalfTeamGoalsMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^(\d)\. polowa gole - (.+)$/i);
  if (!match) return null;

  const half = match[1];
  const teamPart = match[2].trim();

  const isHome = home && teamPart.includes(home);
  const isAway = away && teamPart.includes(away);

  if (half === "1") {
    if (isHome) return "HALF_TIME_HOME_TEAM_TOTAL_GOALS";
    if (isAway) return "HALF_TIME_AWAY_TEAM_TOTAL_GOALS";
  } else if (half === "2") {
    if (isHome) return "SECOND_HALF_HOME_TEAM_TOTAL_GOALS";
    if (isAway) return "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS";
  }

  return null;
}

function resolveMarketCode(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): {
  marketCode: NormalizedMarketType;
  matchedBy: "id" | "name" | "pattern";
} {
  if (raw.bookmakerMarketId !== undefined && raw.bookmakerMarketId !== null) {
    const rawId = Number(raw.bookmakerMarketId);
    const marketCode = BETCLIC_MARKET_ID_TO_CODE[rawId];
    if (marketCode) {
      return { marketCode, matchedBy: "id" };
    }
  }

  const normalizedName = normalizeName(raw.name);
  const direct = BETCLIC_MARKET_NAME_TO_CODE[normalizedName];
  if (direct) {
    return { marketCode: direct, matchedBy: "name" };
  }

  const halfTeamGoals = resolveHalfTeamGoalsMarket(normalizedName, ctx);
  if (halfTeamGoals) {
    return { marketCode: halfTeamGoals, matchedBy: "pattern" };
  }

  for (const entry of BETCLIC_MARKET_PATTERNS) {
    if (entry.pattern.test(normalizedName)) {
      return { marketCode: entry.code, matchedBy: "pattern" };
    }
  }

  return { marketCode: "OTHER", matchedBy: "pattern" };
}

function normalizeBetclicDoubleChance(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const normalizedSelection = normalizeName(selectionName);
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  if (normalizedSelection.includes("remis")) {
    if (home && normalizedSelection.includes(home)) return "HOME_OR_DRAW";
    if (away && normalizedSelection.includes(away)) return "DRAW_OR_AWAY";
  }

  if (home && away && normalizedSelection.includes(home) && normalizedSelection.includes(away)) {
    return "HOME_OR_AWAY";
  }

  return normalizeDoubleChanceSelection(selectionName);
}

function normalizeNextCornerSelection(
  selectionName: string,
  homeTeam: string,
  awayTeam: string
): NormalizedSelection {
  const normalized = normalizeName(selectionName);
  const home = normalizeName(homeTeam);
  const away = normalizeName(awayTeam);

  if (normalized.includes("brak") && normalized.includes("rozn")) {
    return "NONE";
  }

  if (home && normalized.includes(home)) {
    return "HOME";
  }
  if (away && normalized.includes(away)) {
    return "AWAY";
  }

  return normalize1x2Selection(selectionName, homeTeam, awayTeam);
}

function normalizeFirstGoalSelection(
  selectionName: string,
  homeTeam: string,
  awayTeam: string
): NormalizedSelection {
  const normalized = normalizeName(selectionName);
  const home = normalizeName(homeTeam);
  const away = normalizeName(awayTeam);

  if (normalized.includes("brak") && normalized.includes("gol")) {
    return "NONE";
  }

  if (home && normalized.includes(home)) {
    return "HOME";
  }
  if (away && normalized.includes(away)) {
    return "AWAY";
  }

  return normalize1x2Selection(selectionName, homeTeam, awayTeam);
}

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selName.trim();

  if (marketCode === "OTHER") {
    return trimmed as NormalizedSelection;
  }

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
    case "MOST_SHOTS":
    case "MOST_SHOTS_ON_TARGET":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "NEXT_CORNER_1H":
    case "HALF_TIME_LAST_CORNER":
      return normalizeNextCornerSelection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "HALF_TIME_FIRST_GOAL":
      return normalizeFirstGoalSelection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "DOUBLE_CHANCE":
      return normalizeBetclicDoubleChance(trimmed, ctx);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS":
    case "HALF_TIME_HOME_TEAM_TOTAL_GOALS":
    case "HALF_TIME_AWAY_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_HOME_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS":
    case "CORNERS_TOTAL":
    case "CARDS_TOTAL":
    case "HALF_TIME_CORNERS_TOTAL":
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

    case "TWO_PLAYERS_COMBINED_GOALS":
      return trimmed as NormalizedSelection;

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);
  }
}

function extractNextCornerParam(marketName: string): string | undefined {
  const match = marketName.match(/nastepny\s+(\d+)\s+rzut\s+rozny/i);
  return match ? match[1] : undefined;
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): string | undefined {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  if (marketCode === "NEXT_CORNER_1H") {
    return extractNextCornerParam(normalizeName(raw.name));
  }

  const selectionNames = raw.selections.map((s) => s.name);
  const fromSelections = parseOverUnderLine(selectionNames);

  switch (metadata.parameterType) {
    case "handicap":
      return (
        parseHandicapLine(raw.name) ??
        parseHandicapLine(selectionNames.join(" ")) ??
        fromSelections
      );
    case "integer":
      return (
        parseIntegerLine(raw.name) ??
        parseIntegerLine(selectionNames.join(" ")) ??
        fromSelections
      );
    case "decimal":
    default:
      return parseDecimalLine(raw.name) ?? fromSelections;
  }
}

export const betclicNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "betclic",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { marketCode, matchedBy } = resolveMarketCode(raw, ctx);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[betclic] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const paramValue = extractParamValue(marketCode, raw);
    const marketKey = buildMarketKey(marketCode, paramValue);

    const selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode, ctx),
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
        rawId: raw.bookmakerMarketId ?? undefined,
        matchedBy,
      },
    };
  },
};

export default betclicNormalizer;
