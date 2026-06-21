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
  parseOverUnderLine,
  parseDecimalLine,
  parseIntegerLine,
  parseHandicapLine,
  normalize1x2Selection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  parseScoreSelection,
  parseHtFtSelection,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";

const LVBET_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {};

const LVBET_MARKET_NAME_TO_CODE: Record<string, NormalizedMarketType> = {
  "zwyciezca meczu": "MATCH_WINNER",
  "wynik meczu": "MATCH_WINNER",
  "podwojna szansa": "DOUBLE_CHANCE",
  "remis = zwrot": "DRAW_NO_BET",
  "dokladny wynik": "CORRECT_SCORE",
  "obie druzyny strzela gola": "BTTS",
  "obie druzyny strzela": "BTTS",
  "parzyste / nieparzyste": "ODD_EVEN_GOALS",
  "suma goli": "TOTAL_GOALS",
  "liczba goli": "TOTAL_GOALS",
  "azjatycka suma goli": "TOTAL_GOALS_ASIAN",
  "1. polowa - wynik": "HALF_TIME_RESULT",
  "2. polowa - wynik": "SECOND_HALF_RESULT",
};

const LVBET_MARKET_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /dokladny wynik/, code: "CORRECT_SCORE" },
  { pattern: /podwojna szansa|dwojtyp|mix szans/, code: "DOUBLE_CHANCE" },
  { pattern: /remis = zwrot|zaklad bez/, code: "DRAW_NO_BET" },
  { pattern: /obie druzyny strzela/, code: "BTTS" },
  { pattern: /parzyste|nieparzyst/, code: "ODD_EVEN_GOALS" },
  { pattern: /zwyciezca meczu|wynik meczu|zwyciezca/, code: "MATCH_WINNER" },
  { pattern: /suma goli|liczba goli|dokladna liczba goli|gole|bramek/, code: "TOTAL_GOALS" },
];

const HALF_TIME_PATTERN = /(1\.?\s*polowa|1st half)/i;
const SECOND_HALF_PATTERN = /(2\.?\s*polowa|2nd half)/i;
const GOAL_TOTAL_PATTERN = /(suma goli|liczba goli|gole|bramek|azjatycka liczba goli|azjatycka suma goli)/i;
const BTTS_PATTERN = /obie druzyny strzela/i;
const HANDICAP_PATTERN = /handicap/i;
const EUROPEAN_HANDICAP_PATTERN = /(3[-\s]?drogowy|3[-\s]?drogowo)/i;

function resolveMarketCode(
  raw: RawBookmakerMarket
): { code: NormalizedMarketType; matchedBy: "id" | "name" | "pattern" } {
  const rawId = raw.bookmakerMarketId ? Number(raw.bookmakerMarketId) : null;
  if (rawId !== null && !Number.isNaN(rawId)) {
    const idMatch = LVBET_MARKET_ID_TO_CODE[rawId];
    if (idMatch) {
      return { code: idMatch, matchedBy: "id" };
    }
  }

  const normalizedName = normalizeMarketName(raw.name);
  const nameMatch = LVBET_MARKET_NAME_TO_CODE[normalizedName];
  if (nameMatch) {
    return { code: nameMatch, matchedBy: "name" };
  }

  if (HALF_TIME_PATTERN.test(normalizedName)) {
    if (/wynik/.test(normalizedName)) {
      return { code: "HALF_TIME_RESULT", matchedBy: "pattern" };
    }
    if (BTTS_PATTERN.test(normalizedName)) {
      return { code: "HALF_TIME_BTTS", matchedBy: "pattern" };
    }
    if (GOAL_TOTAL_PATTERN.test(normalizedName)) {
      return { code: "HALF_TIME_TOTAL_GOALS", matchedBy: "pattern" };
    }
  }

  if (SECOND_HALF_PATTERN.test(normalizedName)) {
    if (/wynik/.test(normalizedName)) {
      return { code: "SECOND_HALF_RESULT", matchedBy: "pattern" };
    }
    if (GOAL_TOTAL_PATTERN.test(normalizedName)) {
      return { code: "SECOND_HALF_TOTAL_GOALS", matchedBy: "pattern" };
    }
  }

  if (HANDICAP_PATTERN.test(normalizedName)) {
    const code = EUROPEAN_HANDICAP_PATTERN.test(normalizedName)
      ? "EUROPEAN_HANDICAP"
      : "ASIAN_HANDICAP";
    return { code, matchedBy: "pattern" };
  }

  if (/azjatycka/.test(normalizedName)) {
    return { code: "TOTAL_GOALS_ASIAN", matchedBy: "pattern" };
  }

  for (const { pattern, code } of LVBET_MARKET_NAME_PATTERNS) {
    if (pattern.test(normalizedName)) {
      return { code, matchedBy: "pattern" };
    }
  }

  return { code: "OTHER", matchedBy: "pattern" };
}

function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();

  if (/^1\s*\(/.test(trimmed)) return "HOME";
  if (/^2\s*\(/.test(trimmed)) return "AWAY";
  if (/^x\s*\(/i.test(trimmed)) return "DRAW";

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed) || /remis/i.test(trimmed)) return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

function extractParamValue(marketCode: NormalizedMarketType, raw: RawBookmakerMarket): string | undefined {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);
  const marketName = raw.name;

  switch (metadata.parameterType) {
    case "handicap":
      return parseHandicapLine(marketName) ?? parseOverUnderLine(selectionNames);
    case "integer":
      return parseIntegerLine(marketName) ?? parseOverUnderLine(selectionNames);
    case "decimal":
      return parseDecimalLine(marketName) ?? parseOverUnderLine(selectionNames);
    default:
      return parseOverUnderLine(selectionNames);
  }
}

export const lvbetNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "lvbet",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { code: marketCode, matchedBy } = resolveMarketCode(raw);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[lvbet] Market code "${marketCode}" not in catalog`);
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
      marketKey,
      paramValue,
      selections,
      debug: {
        rawName: raw.name,
        rawId: raw.bookmakerMarketId,
        matchedBy,
      },
    };
  },

};

export default lvbetNormalizer;
