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
  parseDecimalLine,
  parseIntegerLine,
  parseHandicapLine,
  normalize1x2Selection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeDoubleChanceSelection,
  parseScoreSelection,
  parseHtFtSelection,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";

const FUKSIARZ_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  1: "MATCH_WINNER",
  2: "HALF_TIME_RESULT",
  4: "DOUBLE_CHANCE",
  5: "EUROPEAN_HANDICAP",
  6: "DRAW_NO_BET",
  7: "ASIAN_HANDICAP",
  8: "TOTAL_GOALS",
  9: "HALF_TIME_TOTAL_GOALS",
  10: "CORRECT_SCORE",
  98: "BTTS",
  99: "HALF_TIME_BTTS",
};

const DOUBLE_CHANCE_PREFIX: Partial<Record<NormalizedSelection, string>> = {
  HOME_OR_DRAW: "1X",
  DRAW_OR_AWAY: "X2",
  HOME_OR_AWAY: "12",
};

const TEAM_TO_SCORE_MARKETS = new Set<NormalizedMarketType>([
  "HOME_TEAM_TO_SCORE",
  "AWAY_TEAM_TO_SCORE",
]);

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .replace(/[().]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTeam(value: string | undefined): string | null {
  if (!value) return null;
  return normalizeText(value);
}

function resolveTeamSide(text: string, ctx: NormalizationContext): "HOME" | "AWAY" | null {
  const normalizedText = normalizeText(text);
  const home = normalizeTeam(ctx.homeTeam);
  const away = normalizeTeam(ctx.awayTeam);

  if (home && normalizedText.includes(home)) return "HOME";
  if (away && normalizedText.includes(away)) return "AWAY";
  return null;
}

function resolveMarketCode(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): { code: NormalizedMarketType; matchedBy: "id" | "name" | "pattern" } {
  const rawId = raw.bookmakerMarketId ? Number(raw.bookmakerMarketId) : null;
  if (rawId !== null && !Number.isNaN(rawId)) {
    const byId = FUKSIARZ_MARKET_ID_TO_CODE[rawId];
    if (byId) {
      return { code: byId, matchedBy: "id" };
    }
  }

  const normalized = normalizeText(raw.name);

  if (/^wynik meczu$/.test(normalized) || /^1x2$/.test(normalized)) {
    return { code: "MATCH_WINNER", matchedBy: "name" };
  }

  if (/^1 polowa - 1x2$/.test(normalized)) {
    return { code: "HALF_TIME_RESULT", matchedBy: "name" };
  }

  if (/^2 polowa - 1x2$/.test(normalized)) {
    return { code: "SECOND_HALF_RESULT", matchedBy: "name" };
  }

  if (/^podwojna szansa$/.test(normalized)) {
    return { code: "DOUBLE_CHANCE", matchedBy: "name" };
  }

  if (/^zaklad bez remisu$/.test(normalized) || /^remis = zwrot$/.test(normalized)) {
    return { code: "DRAW_NO_BET", matchedBy: "name" };
  }

  if (/^obie druzyny strzela/.test(normalized)) {
    if (normalized.startsWith("1 polowa")) {
      return { code: "HALF_TIME_BTTS", matchedBy: "name" };
    }
    if (normalized.includes(" i liczba goli")) {
      return { code: "OTHER", matchedBy: "name" };
    }
    if (normalized.includes("w obu polowach")) {
      return { code: "BOTH_HALVES_GOALS", matchedBy: "pattern" };
    }
    return { code: "BTTS", matchedBy: "name" };
  }

  if (/^1x2 i liczba goli$/.test(normalized)) {
    return { code: "RESULT_AND_TOTAL", matchedBy: "pattern" };
  }

  if (/^1x2 i obie druzyny strzela/.test(normalized)) {
    return { code: "RESULT_AND_BTTS", matchedBy: "pattern" };
  }

  if (/^1x2 i 1 gol$/.test(normalized)) {
    return { code: "FIRST_GOAL_AND_RESULT", matchedBy: "pattern" };
  }

  if (/^podwojna szansa i liczba goli$/.test(normalized)) {
    return { code: "DOUBLE_CHANCE_TOTAL", matchedBy: "pattern" };
  }

  if (/^podwojna szansa i obie druzyny strzela/.test(normalized)) {
    return { code: "DOUBLE_CHANCE_BTTS", matchedBy: "pattern" };
  }

  if (/^1 gol \(przedzialy/.test(normalized)) {
    return { code: "FIRST_GOAL_TIME", matchedBy: "pattern" };
  }

  if (/^1 gol$/.test(normalized)) {
    return { code: "FIRST_TEAM_TO_SCORE", matchedBy: "pattern" };
  }

  if (/^1 kartka$/.test(normalized)) {
    return { code: "FIRST_CARD", matchedBy: "pattern" };
  }

  if (/^1 rzut rozny$/.test(normalized)) {
    return { code: "FIRST_CORNER", matchedBy: "pattern" };
  }

  if (/^wiecej rzutow roznych$/.test(normalized)) {
    return { code: "CORNERS_RACE", matchedBy: "pattern" };
  }

  if (/^wiecej kartek$/.test(normalized)) {
    return { code: "CARDS_RACE", matchedBy: "pattern" };
  }

  if (/^rzuty rozne - handicap$/.test(normalized)) {
    return { code: "CORNERS_HANDICAP", matchedBy: "pattern" };
  }

  if (/^handicap europejski$/.test(normalized) || normalized === "handicap") {
    return { code: "EUROPEAN_HANDICAP", matchedBy: "pattern" };
  }

  if (/^dokladny wynik$/.test(normalized) || /^1 polowa - dokladny wynik$/.test(normalized)) {
    return { code: "CORRECT_SCORE", matchedBy: "pattern" };
  }

  if (/^strzelec 1 gola$/.test(normalized) || /- strzelec 1 gola$/.test(normalized)) {
    return { code: "GOALSCORER_FIRST", matchedBy: "pattern" };
  }

  if (/^strzeli gola$/.test(normalized) || /strzeli gola$/.test(normalized)) {
    const teamSide = resolveTeamSide(raw.name, ctx);
    if (teamSide) {
      return {
        code: teamSide === "HOME" ? "HOME_TEAM_TO_SCORE" : "AWAY_TEAM_TO_SCORE",
        matchedBy: "pattern",
      };
    }
    return { code: "GOALSCORER_ANYTIME", matchedBy: "pattern" };
  }

  if (/^strzeli przynajmniej \d+ gole$/.test(normalized)) {
    return { code: "GOALSCORER_ANYTIME", matchedBy: "pattern" };
  }

  if (/^zawodnik zaliczy asyste$/.test(normalized)) {
    return { code: "PLAYER_ASSISTS", matchedBy: "pattern" };
  }

  if (/^zawodnik odda co najmniej \d+ celny strzal/.test(normalized)) {
    return { code: "PLAYER_SHOTS_ON_TARGET", matchedBy: "pattern" };
  }

  if (/^zawodnik otrzyma kartke$/.test(normalized)) {
    return { code: "PLAYER_CARDS", matchedBy: "pattern" };
  }

  if (/^liczba fauli$/.test(normalized)) {
    return { code: "FOULS_TOTAL", matchedBy: "pattern" };
  }

  if (/^liczba spalonych$/.test(normalized)) {
    return { code: "OFFSIDES_TOTAL", matchedBy: "pattern" };
  }

  if (/^liczba rzutow roznych$/.test(normalized)) {
    return { code: "CORNERS_TOTAL", matchedBy: "pattern" };
  }

  if (/^liczba kartek$/.test(normalized)) {
    return { code: "CARDS_TOTAL", matchedBy: "pattern" };
  }

  if (/^liczba goli$/.test(normalized)) {
    return { code: "GOAL_RANGE", matchedBy: "pattern" };
  }

  if (/^1 polowa - liczba goli$/.test(normalized)) {
    return { code: "HALF_TIME_TOTAL_GOALS", matchedBy: "pattern" };
  }

  if (/^2 polowa - liczba goli$/.test(normalized)) {
    return { code: "SECOND_HALF_TOTAL_GOALS", matchedBy: "pattern" };
  }

  if (/^liczba goli \d/.test(normalized)) {
    const line = parseDecimalLine(raw.name) ?? parseIntegerLine(raw.name);
    if (line && line.endsWith(".0")) {
      return { code: "TOTAL_GOALS_ASIAN", matchedBy: "pattern" };
    }
    return { code: "TOTAL_GOALS", matchedBy: "pattern" };
  }

  if (/^1x2 - \d+ minut/.test(normalized)) {
    return { code: "TIME_PERIOD_RESULT", matchedBy: "pattern" };
  }

  if (/^(.+) - liczba goli$/.test(normalized)) {
    return { code: "TEAM_TOTAL_GOALS", matchedBy: "pattern" };
  }

  if (/^(.+) - liczba rzutow roznych$/.test(normalized)) {
    return { code: "CORNERS_TEAM", matchedBy: "pattern" };
  }

  if (/^(.+) - liczba kartek$/.test(normalized)) {
    return { code: "CARDS_TEAM", matchedBy: "pattern" };
  }

  if (/^1 polowa - (.+) - liczba goli$/.test(normalized) || /^2 polowa - (.+) - liczba goli$/.test(normalized)) {
    return { code: "TEAM_TOTAL_GOALS", matchedBy: "pattern" };
  }

  if (/^1 polowa - (.+) - liczba rzutow roznych$/.test(normalized)) {
    return { code: "CORNERS_TEAM", matchedBy: "pattern" };
  }

  if (/^1 polowa - (.+) - liczba kartek$/.test(normalized)) {
    return { code: "CARDS_TEAM", matchedBy: "pattern" };
  }

  if (/^1 polowa - obie druzyny strzela/.test(normalized)) {
    return { code: "HALF_TIME_BTTS", matchedBy: "pattern" };
  }

  if (/^1 polowa - podwojna szansa$/.test(normalized)) {
    return { code: "OTHER", matchedBy: "pattern" };
  }

  if (/^2 polowa - obie druzyny strzela/.test(normalized)) {
    return { code: "OTHER", matchedBy: "pattern" };
  }

  return { code: "OTHER", matchedBy: "pattern" };
}

function parseLineFromSelections(selectionNames: string[]): string | undefined {
  const overUnderLine = parseOverUnderLine(selectionNames);
  if (overUnderLine) return overUnderLine;

  for (const name of selectionNames) {
    const decimalLine = parseDecimalLine(name);
    if (decimalLine) return decimalLine;
    const integerLine = parseIntegerLine(name);
    if (integerLine) return integerLine;
  }

  return undefined;
}

function extractParamValue(marketCode: NormalizedMarketType, raw: RawBookmakerMarket): string | undefined {
  const selectionNames = raw.selections.map((s) => s.name);

  if ([
    "TOTAL_GOALS",
    "TOTAL_GOALS_ASIAN",
    "HALF_TIME_TOTAL_GOALS",
    "SECOND_HALF_TOTAL_GOALS",
    "TEAM_TOTAL_GOALS",
    "CORNERS_TOTAL",
    "CARDS_TOTAL",
    "FOULS_TOTAL",
    "OFFSIDES_TOTAL",
    "RESULT_AND_TOTAL",
    "DOUBLE_CHANCE_TOTAL",
  ].includes(marketCode)) {
    return parseLineFromSelections(selectionNames) || parseDecimalLine(raw.name) || parseIntegerLine(raw.name);
  }

  if (["ASIAN_HANDICAP", "EUROPEAN_HANDICAP", "CORNERS_HANDICAP"].includes(marketCode)) {
    return (
      parseHandicapLine(raw.name) ||
      selectionNames.map((name) => parseHandicapLine(name)).find(Boolean)
    );
  }

  if (marketCode === "TIME_PERIOD_RESULT") {
    return parseIntegerLine(raw.name);
  }

  if (marketCode === "GOALSCORER_ANYTIME" || marketCode === "PLAYER_SHOTS_ON_TARGET") {
    return parseIntegerLine(raw.name);
  }

  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  return parseDecimalLine(raw.name) || parseIntegerLine(raw.name) || parseLineFromSelections(selectionNames);
}

function normalizeRangeSelection(selectionName: string): NormalizedSelection {
  const trimmed = selectionName.trim();
  const normalized = normalizeText(trimmed);

  if (/(brak|none)/i.test(normalized)) return "NONE" as NormalizedSelection;
  if (/^\d+\s*-\s*\d+/.test(trimmed) || /\+\s*$/.test(trimmed)) {
    return trimmed as NormalizedSelection;
  }
  return "UNKNOWN";
}

function normalizeFirstEventSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();
  const normalized = normalizeText(trimmed);

  if (/(brak|nikt|none)/i.test(normalized)) return "NONE" as NormalizedSelection;
  if (/obie/.test(normalized)) return "BOTH" as NormalizedSelection;

  const teamResult = normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);
  if (teamResult !== "UNKNOWN") return teamResult;

  return trimmed as NormalizedSelection;
}

function normalizeCombinationSelection(
  selectionName: string,
  ctx: NormalizationContext,
  mode: "result-total" | "result-btts" | "dc-total" | "dc-btts"
): NormalizedSelection {
  const [left, right] = selectionName.split(/\s+i\s+/i).map((part) => part.trim());
  if (!left || !right) return selectionName.trim() as NormalizedSelection;

  if (mode === "result-total") {
    const result = normalize1x2Selection(left, ctx.homeTeam, ctx.awayTeam);
    const ou = normalizeOverUnderSelection(right);
    if (result === "UNKNOWN" || ou === "UNKNOWN") return selectionName.trim() as NormalizedSelection;
    return `${result}_${ou}` as NormalizedSelection;
  }

  if (mode === "result-btts") {
    const result = normalize1x2Selection(left, ctx.homeTeam, ctx.awayTeam);
    const yesNo = normalizeYesNoSelection(right);
    if (result === "UNKNOWN" || yesNo === "UNKNOWN") return selectionName.trim() as NormalizedSelection;
    return `${result}_${yesNo}` as NormalizedSelection;
  }

  const dc = normalizeDoubleChanceSelection(left);
  const prefix = DOUBLE_CHANCE_PREFIX[dc];
  if (!prefix) return selectionName.trim() as NormalizedSelection;

  if (mode === "dc-total") {
    const ou = normalizeOverUnderSelection(right);
    if (ou === "UNKNOWN") return selectionName.trim() as NormalizedSelection;
    return `${prefix}_${ou}` as NormalizedSelection;
  }

  const yesNo = normalizeYesNoSelection(right);
  if (yesNo === "UNKNOWN") return selectionName.trim() as NormalizedSelection;
  return `${prefix}_${yesNo}` as NormalizedSelection;
}

function normalizeFirstGoalAndResultSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();
  const normalized = normalizeText(trimmed);

  if (/(brak gola|brak|none)/i.test(normalized)) return "NONE" as NormalizedSelection;

  const [resultPart, firstPart] = trimmed.split(/\s+i\s+/i).map((part) => part.trim());
  if (!resultPart || !firstPart) return trimmed as NormalizedSelection;

  const result = normalize1x2Selection(resultPart, ctx.homeTeam, ctx.awayTeam);
  const teamName = firstPart.replace(/1\.\s*gol/i, "").trim();
  const firstTeam = normalize1x2Selection(teamName, ctx.homeTeam, ctx.awayTeam);

  if (result === "UNKNOWN" || firstTeam === "UNKNOWN") return trimmed as NormalizedSelection;

  return `${firstTeam}_${result}` as NormalizedSelection;
}

function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();

  if (TEAM_TO_SCORE_MARKETS.has(marketCode)) {
    return normalizeYesNoSelection(trimmed);
  }

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "CORNERS_RACE":
    case "CARDS_RACE":
    case "TIME_PERIOD_RESULT":
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
    case "FOULS_TOTAL":
    case "OFFSIDES_TOTAL": {
      const ou = normalizeOverUnderSelection(trimmed);
      return ou === "UNKNOWN" ? normalizeRangeSelection(trimmed) : ou;
    }

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "BOTH_HALVES_GOALS":
      return normalizeYesNoSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "CORNERS_HANDICAP": {
      if (/\bX\b/i.test(trimmed) || /remis/i.test(trimmed)) return "DRAW";
      if (ctx.homeTeam && normalizeText(trimmed).includes(normalizeText(ctx.homeTeam))) return "HOME";
      if (ctx.awayTeam && normalizeText(trimmed).includes(normalizeText(ctx.awayTeam))) return "AWAY";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);
    }

    case "CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME":
    case "DOUBLE_RESULT": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    case "FIRST_GOAL_TIME":
      return normalizeRangeSelection(trimmed);

    case "FIRST_TEAM_TO_SCORE":
    case "FIRST_CARD":
    case "FIRST_CORNER":
      return normalizeFirstEventSelection(trimmed, ctx);

    case "RESULT_AND_TOTAL":
      return normalizeCombinationSelection(trimmed, ctx, "result-total");

    case "RESULT_AND_BTTS":
      return normalizeCombinationSelection(trimmed, ctx, "result-btts");

    case "DOUBLE_CHANCE_TOTAL":
      return normalizeCombinationSelection(trimmed, ctx, "dc-total");

    case "DOUBLE_CHANCE_BTTS":
      return normalizeCombinationSelection(trimmed, ctx, "dc-btts");

    case "FIRST_GOAL_AND_RESULT":
      return normalizeFirstGoalAndResultSelection(trimmed, ctx);

    case "GOAL_RANGE":
      return normalizeRangeSelection(trimmed);

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
      return trimmed as NormalizedSelection;
  }
}

export const fuksiarzNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "fuksiarz",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { code: marketCode, matchedBy } = resolveMarketCode(raw, ctx);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[fuksiarz] Market code "${marketCode}" not in catalog for "${raw.name}"`);
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

export default fuksiarzNormalizer;
