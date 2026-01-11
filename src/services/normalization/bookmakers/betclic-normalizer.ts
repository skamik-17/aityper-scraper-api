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
  "wynik 2 polowy": "SECOND_HALF_RESULT",
  "remis bez zakladu": "DRAW_NO_BET",
};

const BETCLIC_MARKET_PATTERNS: Array<{
  pattern: RegExp;
  code: NormalizedMarketType;
}> = [
  { pattern: /^liczba goli\s+\d+/i, code: "TOTAL_GOALS" },
  { pattern: /^liczba goli\b/i, code: "TOTAL_GOALS" },
  { pattern: /^obie druzyny strzela/i, code: "BTTS" },
  { pattern: /^strzelec:/i, code: "OTHER" },
];

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function resolveMarketCode(raw: RawBookmakerMarket): {
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
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "DOUBLE_CHANCE":
      return normalizeBetclicDoubleChance(trimmed, ctx);

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
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

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
    const { marketCode, matchedBy } = resolveMarketCode(raw);

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

  normalizeMarkets(markets: RawBookmakerMarket[], ctx: NormalizationContext): NormalizedMarketOutput[] {
    return markets
      .map((market) => this.normalizeMarket(market, ctx))
      .filter((market): market is NormalizedMarketOutput => market !== null);
  },
};

export default betclicNormalizer;
