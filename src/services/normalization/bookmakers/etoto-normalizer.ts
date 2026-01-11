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
import { GAME_TYPES } from "../../../scrapers/bookmakers/etoto/constants.js";

const ETOTO_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "MATCH_WINNER",
  [GAME_TYPES.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [GAME_TYPES.BTTS]: "BTTS",
  [GAME_TYPES.TOTAL_GOALS]: "TOTAL_GOALS",
  [GAME_TYPES.EUROPEAN_HANDICAP]: "EUROPEAN_HANDICAP",
  [GAME_TYPES.HALF_TIME_RESULT]: "HALF_TIME_RESULT",
  [GAME_TYPES.HALF_TIME_TOTAL]: "HALF_TIME_TOTAL_GOALS",
  [GAME_TYPES.CORRECT_SCORE]: "CORRECT_SCORE",
  [GAME_TYPES.DRAW_NO_BET]: "DRAW_NO_BET",
  [GAME_TYPES.FIRST_TEAM_TO_SCORE]: "FIRST_TEAM_TO_SCORE",
  [GAME_TYPES.LAST_TEAM_TO_SCORE]: "FIRST_TEAM_TO_SCORE",
  [GAME_TYPES.HALF_FULL_TIME]: "HALFTIME_FULLTIME",
  [GAME_TYPES.ODD_EVEN_GOALS]: "ODD_EVEN_GOALS",
  [GAME_TYPES.TOTAL_HOME_GOALS]: "TEAM_TOTAL_GOALS",
  [GAME_TYPES.TOTAL_AWAY_GOALS]: "TEAM_TOTAL_GOALS",
  [GAME_TYPES.EXACT_GOALS]: "GOAL_RANGE",
  [GAME_TYPES.WINNING_MARGIN]: "WINNING_MARGIN",
  [GAME_TYPES.HOME_WIN_TO_NIL]: "WIN_TO_NIL",
  [GAME_TYPES.AWAY_WIN_TO_NIL]: "WIN_TO_NIL",
  [GAME_TYPES.HOME_NO_BET]: "DRAW_NO_BET",
  [GAME_TYPES.AWAY_NO_BET]: "DRAW_NO_BET",
  [GAME_TYPES.GOAL_RANGE]: "GOAL_RANGE",
};

const ETOTO_SELECTION_OVERRIDES: Record<string, NormalizedSelection> = {
  "brak gola": "DRAW",
  "brak goli": "DRAW",
  "brak bramek": "DRAW",
};

const ETOTO_MARKET_NAME_TO_CODE: Record<string, NormalizedMarketType> = {
  "wynik meczu": "MATCH_WINNER",
  "podwojna szansa": "DOUBLE_CHANCE",
  "remis = zwrot": "DRAW_NO_BET",
  "obie druzyny strzela": "BTTS",
  "suma goli": "TOTAL_GOALS",
  "handicap europejski": "EUROPEAN_HANDICAP",
  "wynik 1 polowy": "HALF_TIME_RESULT",
  "suma goli 1 polowa": "HALF_TIME_TOTAL_GOALS",
  "dokladny wynik": "CORRECT_SCORE",
  "pierwsza druzyna strzeli": "FIRST_TEAM_TO_SCORE",
  "ostatnia druzyna strzeli": "FIRST_TEAM_TO_SCORE",
  "polowa/koniec": "HALFTIME_FULLTIME",
  "parzyste/nieparzyste": "ODD_EVEN_GOALS",
  "gole gospodarzy": "TEAM_TOTAL_GOALS",
  "gole gosci": "TEAM_TOTAL_GOALS",
  "dokladna liczba goli": "GOAL_RANGE",
  "roznica goli": "WINNING_MARGIN",
};

const ETOTO_MARKET_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /^suma goli\b/, code: "TOTAL_GOALS" },
  { pattern: /^gole gospodarzy\b/, code: "TEAM_TOTAL_GOALS" },
  { pattern: /^gole gosci\b/, code: "TEAM_TOTAL_GOALS" },
  { pattern: /^handicap europejski\b/, code: "EUROPEAN_HANDICAP" },
  { pattern: /^handicap azjatycki\b/, code: "ASIAN_HANDICAP" },
  { pattern: /^wynik\s*1\.?\s*polow/, code: "HALF_TIME_RESULT" },
  { pattern: /^suma goli\s*1\.?\s*polow/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /^1\.?\s*polowa\s*-\s*1x2/, code: "HALF_TIME_RESULT" },
  { pattern: /^2\.?\s*polowa\s*-\s*1x2/, code: "SECOND_HALF_RESULT" },
  { pattern: /^1\.?\s*polowa\s*-\s*podwojna szansa/, code: "DOUBLE_CHANCE" },
  { pattern: /^2\.?\s*polowa\s*-\s*podwojna szansa/, code: "DOUBLE_CHANCE" },
  { pattern: /^1\.?\s*polowa.*suma goli/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /^2\.?\s*polowa.*suma goli/, code: "SECOND_HALF_TOTAL_GOALS" },
  { pattern: /^1\.?\s*polowa.*obie\s*strzel/, code: "HALF_TIME_BTTS" },
  { pattern: /^2\.?\s*polowa.*obie\s*strzel/, code: "BTTS" },
  { pattern: /polowa\s*\/\s*koniec/, code: "HALFTIME_FULLTIME" },
  { pattern: /strzeli w obu polowach|gole w obu polowach/, code: "BOTH_HALVES_GOALS" },
  { pattern: /wygr(a|y)na.*do zera/, code: "WIN_TO_NIL" },
  { pattern: /zachowa czyste konto/, code: "CLEAN_SHEET" },
  { pattern: /roznica goli/, code: "WINNING_MARGIN" },
  { pattern: /dokladna liczba goli|dokladny przedzial goli/, code: "GOAL_RANGE" },
];

function normalizeEtotoName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveMarketCodeFromName(rawName: string): {
  marketCode: NormalizedMarketType;
  matchedBy: "name" | "pattern";
} {
  const normalized = normalizeEtotoName(rawName);
  const direct = ETOTO_MARKET_NAME_TO_CODE[normalized];
  if (direct) {
    return { marketCode: direct, matchedBy: "name" };
  }

  for (const { pattern, code } of ETOTO_MARKET_PATTERNS) {
    if (pattern.test(normalized)) {
      return { marketCode: code, matchedBy: "pattern" };
    }
  }

  return { marketCode: "OTHER", matchedBy: "name" };
}

function normalizeEtotoDoubleChance(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const basic = normalizeDoubleChanceSelection(selectionName);
  if (basic !== "UNKNOWN") return basic;

  const normalized = normalizeEtotoName(selectionName);
  const home = ctx.homeTeam ? normalizeEtotoName(ctx.homeTeam) : "";
  const away = ctx.awayTeam ? normalizeEtotoName(ctx.awayTeam) : "";
  const hasDraw = /\b(x|remis)\b/.test(normalized);
  const hasHome = home && normalized.includes(home);
  const hasAway = away && normalized.includes(away);

  if (hasHome && hasDraw) return "HOME_OR_DRAW";
  if (hasAway && hasDraw) return "DRAW_OR_AWAY";
  if (hasHome && hasAway) return "HOME_OR_AWAY";

  return "UNKNOWN";
}

function parseTeamBasedHtFt(
  selectionName: string,
  ctx: NormalizationContext
): string | null {
  const parts = selectionName.split("/").map((part) => part.trim());
  if (parts.length !== 2) return null;

  const [htRaw, ftRaw] = parts;
  const ht = normalize1x2Selection(htRaw, ctx.homeTeam, ctx.awayTeam);
  const ft = normalize1x2Selection(ftRaw, ctx.homeTeam, ctx.awayTeam);

  if (ht === "UNKNOWN" || ft === "UNKNOWN") return null;
  return `${ht}_${ft}`;
}

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selName.trim();
  const normalized = normalizeEtotoName(trimmed);

  const override = ETOTO_SELECTION_OVERRIDES[normalized];
  if (override) return override;

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "FIRST_TEAM_TO_SCORE":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "DOUBLE_CHANCE":
      return normalizeEtotoDoubleChance(trimmed, ctx);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS":
    case "CORNERS_TOTAL":
    case "CARDS_TOTAL":
    case "RESULT_AND_TOTAL":
    case "DOUBLE_CHANCE_TOTAL":
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

    case "WIN_TO_NIL":
    case "CLEAN_SHEET": {
      const yesNo = normalizeYesNoSelection(trimmed);
      if (yesNo !== "UNKNOWN") return yesNo;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);
    }

    case "CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME":
    case "DOUBLE_RESULT": {
      const htft = parseHtFtSelection(trimmed) ?? parseTeamBasedHtFt(trimmed, ctx);
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

  const selectionNames = raw.selections.map((s: { name: string }) => s.name);
  const fromSelections = parseOverUnderLine(selectionNames);
  const groupName = raw.groupName ?? "";

  switch (metadata.parameterType) {
    case "handicap":
      return (
        selectionNames.map((name: string) => parseHandicapLine(name)).find(Boolean) ??
        parseHandicapLine(raw.name) ??
        parseHandicapLine(groupName) ??
        fromSelections
      );

    case "integer":
      return (
        parseIntegerLine(raw.name) ??
        parseIntegerLine(groupName) ??
        parseIntegerLine(selectionNames.join(" ")) ??
        fromSelections
      );

    case "decimal":
    default:
      return (
        parseDecimalLine(raw.name) ??
        parseDecimalLine(groupName) ??
        fromSelections
      );
  }
}

export const etotoNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "etoto",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const rawId = raw.bookmakerMarketId !== undefined ? Number(raw.bookmakerMarketId) : null;
    const marketId = Number.isNaN(rawId as number) ? null : (rawId as number);

    let marketCode: NormalizedMarketType | null = null;
    let matchedBy: "id" | "name" | "pattern" = "id";

    if (marketId !== null) {
      marketCode = ETOTO_MARKET_ID_TO_CODE[marketId] ?? null;
    }

    if (!marketCode) {
      const resolved = resolveMarketCodeFromName(raw.name);
      marketCode = resolved.marketCode;
      matchedBy = resolved.matchedBy;
    }

    if (!marketCode) {
      console.warn(`[etoto] Unknown market: "${raw.name}" (id: ${marketId ?? "none"})`);
      return null;
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[etoto] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const paramValue = extractParamValue(marketCode, raw);
    const marketKey = buildMarketKey(marketCode, paramValue);
    const marketMetadata = getMarketMetadata(marketCode);
    const marketName = marketMetadata?.labels.pl ?? raw.name;

    const selections = raw.selections.map((sel: { name: string; odds: number }) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode!, ctx),
      label: sel.name,
      odds: sel.odds,
    }));

    if (marketCode === "OTHER") {
      console.warn(`[etoto] Unmapped market "${raw.name}" (id: ${marketId ?? "none"})`);
    }

    return {
      marketCode,
      paramValue,
      marketKey,
      marketName,
      selections,
      debug: {
        rawName: raw.name,
        rawId: marketId ?? undefined,
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

export default etotoNormalizer;
