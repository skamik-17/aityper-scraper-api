import type {
  BookmakerMarketNormalizer,
  NormalizationContext,
  NormalizedMarketOutput,
  NormalizedMarketType,
  NormalizedSelection,
  RawBookmakerMarket,
} from "../types.js";
import {
  buildMarketKey,
  normalize1x2Selection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  parseDecimalLine,
  parseHandicapLine,
  parseHtFtSelection,
  parseIntegerLine,
  parseOverUnderLine,
  parseScoreSelection,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";

const SUPERBET_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  547: "MATCH_WINNER",
  548: "DOUBLE_CHANCE",
  531: "DOUBLE_CHANCE",
  539: "BTTS",
  559: "BTTS",
  200734: "TOTAL_GOALS",
  551: "TOTAL_GOALS",
  552: "TOTAL_GOALS",
  549: "ASIAN_HANDICAP",
  550: "EUROPEAN_HANDICAP",
  553: "HALF_TIME_RESULT",
  554: "HALF_TIME_TOTAL_GOALS",
  557: "HALF_TIME_BTTS",
  556: "CORRECT_SCORE",
  600: "GOALSCORER_ANYTIME",
  601: "GOALSCORER_FIRST",
  558: "ODD_EVEN_GOALS",
  560: "DRAW_NO_BET",
  561: "WIN_TO_NIL",
  562: "CLEAN_SHEET",
};

const SUPERBET_SELECTION_OVERRIDES: Record<string, NormalizedSelection> = {
  "1x": "HOME_OR_DRAW",
  "x2": "DRAW_OR_AWAY",
  "12": "HOME_OR_AWAY",
  gg: "YES",
  ng: "NO",
  "0": "DRAW",
};

const SUPERBET_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /wynik meczu|koncowy wynik|1x2|zwyciezca meczu/, code: "MATCH_WINNER" },
  { pattern: /podwojna szansa|double chance/, code: "DOUBLE_CHANCE" },
  { pattern: /remis\s*=\s*zwrot|draw no bet|zaklad bez remisu/, code: "DRAW_NO_BET" },
  { pattern: /obie.*strzela.*1\.?\s*polow|1\.?\s*polow.*obie.*strzela/, code: "HALF_TIME_BTTS" },
  { pattern: /wynik\s*1\.?\s*polow|1\.?\s*polow.*wynik/, code: "HALF_TIME_RESULT" },
  { pattern: /liczba goli.*1\.?\s*polow|1\.?\s*polow.*liczba goli/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /obie.*strzela|btts|gg\/?ng/, code: "BTTS" },
  { pattern: /liczba goli|suma goli|over\/?under|o\/?u/, code: "TOTAL_GOALS" },
  { pattern: /handicap azjatycki|asian handicap/, code: "ASIAN_HANDICAP" },
  { pattern: /handicap europejski|european handicap/, code: "EUROPEAN_HANDICAP" },
  { pattern: /dokladny wynik|correct score/, code: "CORRECT_SCORE" },
  { pattern: /parzyste\/?nieparzyste|odd\/?even/, code: "ODD_EVEN_GOALS" },
  { pattern: /wygrana do zera|win to nil/, code: "WIN_TO_NIL" },
  { pattern: /czyste konto|clean sheet/, code: "CLEAN_SHEET" },
  { pattern: /pierwszy strzelec|first goalscorer/, code: "GOALSCORER_FIRST" },
  { pattern: /strzelec|goalscorer/, code: "GOALSCORER_ANYTIME" },
];

const PARAMETERIZED_MARKETS = new Set<NormalizedMarketType>([
  "TOTAL_GOALS",
  "TOTAL_GOALS_ASIAN",
  "HALF_TIME_TOTAL_GOALS",
  "SECOND_HALF_TOTAL_GOALS",
  "TEAM_TOTAL_GOALS",
  "ASIAN_HANDICAP",
  "EUROPEAN_HANDICAP",
  "CORNERS_TOTAL",
  "CARDS_TOTAL",
  "CORNERS_HANDICAP",
]);

function normalizeMarketName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSuperbetMarketId(marketName: string): number | null {
  const match = marketName.match(/^Rynek\s+(\d+)$/iu);
  return match ? Number(match[1]) : null;
}

function resolveMarketCode(raw: RawBookmakerMarket): {
  marketCode: NormalizedMarketType;
  matchedBy: "id" | "name" | "pattern";
  rawId?: number;
} {
  const marketId = raw.bookmakerMarketId
    ? Number(raw.bookmakerMarketId)
    : extractSuperbetMarketId(raw.name);

  if (marketId && SUPERBET_MARKET_ID_TO_CODE[marketId]) {
    return {
      marketCode: SUPERBET_MARKET_ID_TO_CODE[marketId],
      matchedBy: "id",
      rawId: marketId,
    };
  }

  const normalizedName = normalizeMarketName(raw.name);
  for (const { pattern, code } of SUPERBET_NAME_PATTERNS) {
    if (pattern.test(normalizedName)) {
      return { marketCode: code, matchedBy: "pattern", rawId: marketId ?? undefined };
    }
  }

  return {
    marketCode: "OTHER",
    matchedBy: "name",
    rawId: marketId ?? undefined,
  };
}

function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();
  const lower = trimmed.toLowerCase();

  const override = SUPERBET_SELECTION_OVERRIDES[lower];
  if (override) return override;

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "WIN_TO_NIL":
    case "CLEAN_SHEET":
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

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

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
    case "GOALSCORER_ANYTIME":
    case "GOALSCORER_LAST":
    case "PLAYER_SHOTS":
    case "PLAYER_CARDS":
    case "PLAYER_ASSISTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_PASSES":
      return trimmed.replace(/^\d+\.\s*/, "").trim() as NormalizedSelection;

    case "OTHER":
      return "UNKNOWN";

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);
  }
}

function extractParamValue(marketCode: NormalizedMarketType, raw: RawBookmakerMarket): string | undefined {
  if (!PARAMETERIZED_MARKETS.has(marketCode)) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);

  if (marketCode === "ASIAN_HANDICAP" || marketCode === "EUROPEAN_HANDICAP") {
    for (const name of selectionNames) {
      const handicap = parseHandicapLine(name);
      if (handicap) return handicap;
    }
    const handicapFromName = parseHandicapLine(raw.name);
    if (handicapFromName) return handicapFromName;
  }

  const paramFromSelections = parseOverUnderLine(selectionNames);
  if (paramFromSelections) return paramFromSelections;

  const decimalLine = parseDecimalLine(raw.name);
  if (decimalLine) return decimalLine;

  const integerLine = parseIntegerLine(raw.name);
  if (integerLine) return integerLine;

  return undefined;
}

export const superbetNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "superbet",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { marketCode, matchedBy, rawId } = resolveMarketCode(raw);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[superbet] Market code "${marketCode}" not in catalog`);
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
      console.warn(`[superbet] Unmapped market "${raw.name}" (id: ${rawId ?? "none"})`);
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

export default superbetNormalizer;
