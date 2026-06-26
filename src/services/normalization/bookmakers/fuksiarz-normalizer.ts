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
  // Audited market id mappings (Fuksiarz bookmakerMarketId -> catalog code)
  "-30320": "HT_OR_FT_RESULT",
  "-30194": "BTTS_2PLUS_GOALS",
  "-30020": "HOME_POSSESSION",
  "88": "MOST_SHOTS_ON_TARGET",
  "167": "TOTAL_SHOTS_ON_TARGET",
  "168": "TEAM_TOTAL_SHOTS_ON_TARGET",
  "169": "TEAM_TOTAL_SHOTS_ON_TARGET",
  "-30607": "EACH_TEAM_TOTAL_SHOTS_ON_TARGET_OVER",
  "-30340": "MOST_SHOTS",
  "-30341": "TOTAL_SHOTS",
  "-30342": "TEAM_TOTAL_SHOTS",
  "-30343": "TEAM_TOTAL_SHOTS",
  "162": "TEAM_TOTAL_FOULS",
  "163": "TEAM_TOTAL_FOULS",
  "-30608": "BOTH_TEAMS_FOULS_OVER",
  "165": "HOME_TEAM_TOTAL_OFFSIDES",
  "166": "HOME_TEAM_TOTAL_OFFSIDES",
  "-30609": "EACH_TEAM_OFFSIDES",
  "-30021": "PLAYER_GOAL_AND_RESULT",
  "-4890": "PLAYER_GOAL_OR_ASSIST",
  "-30322": "PLAYER_GOAL_AND_ASSIST",
  "-30527": "PLAYER_SHOTS_ON_TARGET",
  "-30528": "PLAYER_SHOTS_ON_TARGET",
  "-30529": "PLAYER_SHOTS_ON_TARGET",
  "-30519": "PLAYER_SHOTS",
  "-30520": "PLAYER_SHOTS",
  "-30521": "PLAYER_SHOTS",
  "-4893": "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX",
  "-4894": "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX",
  "-30591": "HALF_TIME_LEAD_CHANGE",
  "-152": "SUBSTITUTIONS_TOTAL",
  "-227": "EXACT_GOALS",
  "-2658": "HOME_EXACT_GOALS",
  "-2659": "HOME_EXACT_GOALS",
  "-6008": "FIRST_HALF_ASIAN_HANDICAP",
  "-2557": "FIRST_HALF_EUROPEAN_HANDICAP",
  "-6009": "SECOND_HALF_ASIAN_HANDICAP",
  "-2558": "SECOND_HALF_EUROPEAN_HANDICAP",
  "-4549": "HALF_TIME_FIRST_GOAL",
  "27": "HALF_TIME_DOUBLE_CHANCE",
  "-237": "HALF_TIME_DRAW_NO_BET",
  "-30417": "HALF_TIME_WIN_TO_NIL",
  "-30418": "HALF_TIME_WIN_TO_NIL",
  "-4548": "HALF_TIME_EXACT_GOALS",
  "-4555": "HALF_TIME_HOME_EXACT_GOALS",
  "-4521": "HALF_TIME_HOME_EXACT_GOALS",
  "-4534": "SECOND_HALF_FIRST_GOAL",
  "-188": "SECOND_HALF_DOUBLE_CHANCE",
  "-283": "SECOND_HALF_DRAW_NO_BET",
  "121": "SECOND_HALF_BTTS",
  "-30419": "SECOND_HALF_WIN_TO_NIL",
  "-30420": "SECOND_HALF_WIN_TO_NIL",
  "-30627": "SECOND_HALF_EXACT_GOALS",
  "-30628": "SECOND_HALF_HOME_EXACT_GOALS",
  "-30629": "SECOND_HALF_HOME_EXACT_GOALS",
  "-261": "HALF_TIME_CORNERS_RACE",
  "-30517": "HALF_TIME_HOME_EXACT_CORNERS",
  "-30518": "HALF_TIME_HOME_EXACT_CORNERS",
  "-2954": "HALF_TIME_CORNERS_HANDICAP",
  "-30515": "CARDS_EXACT",
  "-30516": "HALF_TIME_CARDS_TOTAL",
  "-30314": "CARDS_HANDICAP",
  "22": "RED_CARD",
  "-250": "RED_CARD_TEAM",
  "-251": "RED_CARD_TEAM",
  "48": "HOME_WIN_TO_NIL",
  "-30333": "RED_CARD_OR_PENALTY",
  "130": "HOME_WIN_TO_NIL",
  "-30469": "RED_CARD_AND_PENALTY",
  "125": "TEAM_WIN_BOTH_HALVES",
  "126": "TEAM_WIN_BOTH_HALVES",
  "15": "PENALTY_AWARDED",
  "127": "TEAM_WIN_AT_LEAST_ONE_HALF",
  "-30331": "PENALTY_AWARDED_TEAM",
  "128": "TEAM_WIN_AT_LEAST_ONE_HALF",
  "-30332": "PENALTY_AWARDED_TEAM",
  "106": "HOME_SCORE_BOTH_HALVES",
  "107": "HOME_SCORE_BOTH_HALVES",
  "-30334": "OWN_GOAL",
  "-30415": "PLAYER_RED_CARD",
  "-2555": "TOTAL_GOALS_AND_BTTS",
  "-30204": "HALF_TIME_RESULT_AND_TOTAL",
  "-2554": "HALF_TIME_RESULT_AND_BTTS",
  "-30205": "HALF_TIME_DOUBLE_CHANCE_TOTAL",
  "-30007": "HALF_TIME_DOUBLE_CHANCE_BTTS",
  "-30431": "SECOND_HALF_RESULT_AND_TOTAL",
  "-30430": "SECOND_HALF_RESULT_AND_BTTS",
  "-30429": "SECOND_HALF_DOUBLE_CHANCE_TOTAL",
  "-30008": "SECOND_HALF_DOUBLE_CHANCE_BTTS",
  "-30570": "INTERVAL_TOTAL_GOALS",
  "-30571": "TIME_PERIOD_TOTAL_GOALS",
  "-30572": "TIME_PERIOD_TOTAL_GOALS",
  "-30573": "FIRST_30_MIN_TOTAL_GOALS",
  "-30575": "TIME_PERIOD_TOTAL_GOALS",
  "-30565": "TIME_PERIOD_HANDICAP",
  "-30566": "TIME_PERIOD_ASIAN_HANDICAP",
  "-30567": "TIME_PERIOD_ASIAN_HANDICAP",
  "-30568": "TIME_PERIOD_HANDICAP",
  "-30569": "TIME_PERIOD_ASIAN_HANDICAP",
  "38": "HALF_WITH_MORE_GOALS",
  "-2957": "FIRST_GOAL_TIME",
  "-30313": "FIRST_GOAL_TIME_30MIN",
  "-338": "WINNING_MARGIN",
  "-30344": "HALF_TIME_WINNING_MARGIN",
  "-30590": "GOAL_OUTSIDE_BOX",
  "-4897": "PLAYER_FOULS",
  "-4898": "PLAYER_FOULS",
  "-4899": "PLAYER_FOULS_WON",
  "-4900": "PLAYER_FOULS_WON",
  "-4891": "PLAYER_HEADER_GOAL",
  "-4892": "PLAYER_GOAL_OUTSIDE_BOX",
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

  const teamResult = normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
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
    const result = normalize1x2Selection(left, ctx.homeTeam, ctx.awayTeam, ctx.league);
    const ou = normalizeOverUnderSelection(right);
    if (result === "UNKNOWN" || ou === "UNKNOWN") return selectionName.trim() as NormalizedSelection;
    return `${result}_${ou}` as NormalizedSelection;
  }

  if (mode === "result-btts") {
    const result = normalize1x2Selection(left, ctx.homeTeam, ctx.awayTeam, ctx.league);
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

  const result = normalize1x2Selection(resultPart, ctx.homeTeam, ctx.awayTeam, ctx.league);
  const teamName = firstPart.replace(/1\.\s*gol/i, "").trim();
  const firstTeam = normalize1x2Selection(teamName, ctx.homeTeam, ctx.awayTeam, ctx.league);

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
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
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
