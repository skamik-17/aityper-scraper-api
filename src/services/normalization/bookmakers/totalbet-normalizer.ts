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
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";

const TOTALBET_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  1: "MATCH_WINNER",
  2: "HALF_TIME_RESULT",
  3: "CORRECT_SCORE",
  4: "DOUBLE_CHANCE",
  5: "EUROPEAN_HANDICAP",
  6: "ASIAN_HANDICAP",
  7: "DRAW_NO_BET",
  8: "TOTAL_GOALS",
  9: "HALF_TIME_TOTAL_GOALS",
  10: "ODD_EVEN_GOALS",
  98: "BTTS",
};

const TOTALBET_MARKET_NAME_TO_CODE: Record<string, NormalizedMarketType> = {
  "wynik meczu": "MATCH_WINNER",
  "podwojna szansa": "DOUBLE_CHANCE",
  "obie druzyny strzela": "BTTS",
  "dokladny wynik": "CORRECT_SCORE",
  "wynik 1 polowy": "HALF_TIME_RESULT",
  "parzyste/nieparzyste": "ODD_EVEN_GOALS",
  "remis = zwrot": "DRAW_NO_BET",
};

const TOTALBET_MARKET_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /liczba goli\s*1\.?\s*polow/i, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /liczba goli|suma goli|over\s*\/\s*under/i, code: "TOTAL_GOALS" },
  { pattern: /handicap azjatycki/i, code: "ASIAN_HANDICAP" },
  { pattern: /handicap europejski/i, code: "EUROPEAN_HANDICAP" },
  { pattern: /wynik\s*1\.?\s*polow/i, code: "HALF_TIME_RESULT" },
];

function normalizeMarketName(value: string): string {
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
  rawId?: number;
} {
  if (raw.bookmakerMarketId !== undefined && raw.bookmakerMarketId !== null) {
    const rawId = Number(raw.bookmakerMarketId);
    const marketCode = TOTALBET_MARKET_ID_TO_CODE[rawId];
    if (marketCode) {
      return { marketCode, matchedBy: "id", rawId };
    }
  }

  const normalizedName = normalizeMarketName(raw.name);
  const direct = TOTALBET_MARKET_NAME_TO_CODE[normalizedName];
  if (direct) {
    return { marketCode: direct, matchedBy: "name" };
  }

  for (const entry of TOTALBET_MARKET_PATTERNS) {
    if (entry.pattern.test(normalizedName)) {
      return { marketCode: entry.code, matchedBy: "pattern" };
    }
  }

  return { marketCode: "OTHER", matchedBy: "pattern" };
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
    case "DRAW_NO_BET":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed)) return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

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
        selectionNames.map((name) => parseHandicapLine(name)).find(Boolean) ??
        parseHandicapLine(groupName)
      );
    case "integer":
      return (
        parseOverUnderLine(selectionNames) ??
        parseIntegerLine(raw.name) ??
        parseIntegerLine(groupName)
      );
    case "decimal":
    default:
      return (
        parseOverUnderLine(selectionNames) ??
        parseDecimalLine(raw.name) ??
        parseDecimalLine(groupName)
      );
  }
}

export const totalbetNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "totalbet",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { marketCode, matchedBy, rawId } = resolveMarketCode(raw);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[totalbet] Market code "${marketCode}" not in catalog`);
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
      console.warn(`[totalbet] Unmapped market "${raw.name}" (id: ${rawId ?? "none"})`);
    }

    return {
      marketCode,
      paramValue,
      marketKey,
      marketName,
      selections,
      debug: {
        rawName: raw.name,
        rawId: rawId ?? undefined,
        matchedBy,
      },
    } as NormalizedMarketOutput;
  },

  normalizeMarkets(markets: RawBookmakerMarket[], ctx: NormalizationContext): NormalizedMarketOutput[] {
    return markets
      .map((market) => this.normalizeMarket(market, ctx))
      .filter((market): market is NormalizedMarketOutput => market !== null);
  },
};

export default totalbetNormalizer;
