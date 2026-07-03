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
import { matchToCanonical } from "../../../utils/team-matcher.js";

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
  // Shared platform game-type ids (identical id space as eToto/Forbet/Betfan).
  // Goal-count bucket panels ("0-1"/"2-3"/"4+") that share raw names with the
  // over/under markets, plus half-time correct score and per-half team totals.
  "-2902": "HALF_TIME_GOAL_RANGE",
  "-2903": "SECOND_HALF_GOAL_RANGE",
  "74": "HALF_TIME_CORRECT_SCORE",
  "110": "HALF_TIME_TEAM_TOTAL_GOALS",
  "117": "HALF_TIME_TEAM_TOTAL_GOALS",
  "118": "SECOND_HALF_TEAM_TOTAL_GOALS",
  "119": "SECOND_HALF_TEAM_TOTAL_GOALS",
};

const DOUBLE_CHANCE_PREFIX: Partial<Record<NormalizedSelection, string>> = {
  HOME_OR_DRAW: "1X",
  DRAW_OR_AWAY: "X2",
  HOME_OR_AWAY: "12",
};

const TEAM_TO_SCORE_MARKETS = new Set<NormalizedMarketType>([
  "HOME_TEAM_TO_SCORE",
  "AWAY_TEAM_TO_SCORE",
  "HALF_TIME_HOME_TO_SCORE",
  "HALF_TIME_AWAY_TO_SCORE",
  "SECOND_HALF_HOME_TO_SCORE",
  "SECOND_HALF_AWAY_TO_SCORE",
]);

/**
 * Markets whose Fuksiarz raw duplicates within one market must be collapsed
 * into a single catalog selection (e.g. "by 3" + "by 4+" -> HOME_BY_3PLUS,
 * "Score Draw" + "No Goal" -> DRAW, exact goals "3"/"4"/"5" -> "3+").
 */
const MERGE_DUPLICATE_CODE_MARKETS = new Set<NormalizedMarketType>([
  "WINNING_MARGIN",
  "HALF_TIME_WINNING_MARGIN",
  "HALF_TIME_EXACT_GOALS",
  "SECOND_HALF_EXACT_GOALS",
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
  return resolveTeamSideByAlias(text, ctx);
}

/**
 * Fallback team-side resolution via the league alias map. Fuksiarz names
 * teams in Polish ("Algieria", "Republika Zielonego Przylądka") while the
 * context teams are canonical English ("Algeria", "Cape Verde"), so plain
 * substring matching fails. Extracts the team-like fragment from the raw
 * market name and resolves it through matchToCanonical.
 */
function resolveTeamSideByAlias(text: string, ctx: NormalizationContext): "HOME" | "AWAY" | null {
  if (!ctx.league) return null;

  // Candidate team fragment: strip the leading half prefix, then cut at the
  // first verb or " - " market suffix so the alias matcher sees only the team.
  const candidate = text
    .replace(/^\s*[12]\.?\s*po[łl]owa\s*[-–]\s*/i, "")
    .split(/\s+(?:wygra|strzeli|zdob[ęe]dzie|otrzyma|nie\s)/i)[0]
    .split(/\s*[-–]\s*/)[0]
    .trim();
  if (!candidate) return null;

  const candidateMatch = matchToCanonical(candidate, ctx.league);
  if (!candidateMatch) return null;

  const homeMatch = ctx.homeTeam ? matchToCanonical(ctx.homeTeam, ctx.league) : null;
  if (homeMatch && candidateMatch.name === homeMatch.name) return "HOME";
  const awayMatch = ctx.awayTeam ? matchToCanonical(ctx.awayTeam, ctx.league) : null;
  if (awayMatch && candidateMatch.name === awayMatch.name) return "AWAY";
  return null;
}

function isDrawLikeSelection(name: string): boolean {
  return /^x\b/i.test(name.trim()) || /remis/i.test(name);
}

/**
 * Detect goal-count bucket panels ("0-1" / "2-3" / "4+", optionally plain
 * digits). Fuksiarz serves these under the same raw names as the over/under
 * markets, so they must be told apart by selection shape.
 */
function hasGoalBucketSelections(raw: RawBookmakerMarket): boolean {
  const names = raw.selections.map((s) => s.name.trim()).filter(Boolean);
  if (names.length < 2) return false;
  const isBucket = (n: string) => /^\d+\s*-\s*\d+$/.test(n) || /^\d+\s*\+$/.test(n);
  const isPlainCount = (n: string) => /^\d+$/.test(n);
  return names.some(isBucket) && names.every((n) => isBucket(n) || isPlainCount(n));
}

/**
 * Post-resolution corrections that depend on selection shape or on the team
 * side named in the raw market (the id map alone cannot express these).
 */
function adjustMarketCode(
  code: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): NormalizedMarketType {
  // Fuksiarz's plain "Handicap" market quotes only two outcomes (no draw) on
  // every line, including integer ones — that is an Asian handicap, not a
  // 3-way European one.
  if (
    code === "EUROPEAN_HANDICAP" &&
    raw.selections.length === 2 &&
    !raw.selections.some((s) => isDrawLikeSelection(s.name))
  ) {
    return "ASIAN_HANDICAP";
  }

  // Goal-count bucket panels share raw names with over/under markets —
  // reroute them to the goal-range catalog codes instead of poisoning the
  // over/under parameter sliders with "0-1"/"2-3"/"4+" codes.
  if (hasGoalBucketSelections(raw)) {
    if (code === "TOTAL_GOALS") return "GOAL_RANGE";
    if (code === "HALF_TIME_TOTAL_GOALS") return "HALF_TIME_GOAL_RANGE";
    if (code === "SECOND_HALF_TOTAL_GOALS") return "SECOND_HALF_GOAL_RANGE";
    if (code === "TEAM_TOTAL_GOALS") {
      const side = resolveTeamSide(raw.name, ctx);
      if (side === "HOME") return "HOME_GOAL_RANGE";
      if (side === "AWAY") return "AWAY_GOAL_RANGE";
      return "OTHER";
    }
    if (code === "SECOND_HALF_TEAM_TOTAL_GOALS") return "SECOND_HALF_TEAM_GOAL_RANGE";
    // No half-time team goal-range code exists in the catalog yet.
    if (code === "HALF_TIME_TEAM_TOTAL_GOALS") return "OTHER";
  }

  // Team-sided raw markets: the id map can only point at the HOME_/TEAM_
  // variant, but Fuksiarz quotes a separate raw market per team — flip to the
  // AWAY_ catalog code when the raw name names the away team.
  if (
    code === "HOME_WIN_TO_NIL" ||
    code === "HOME_SCORE_BOTH_HALVES" ||
    code === "TEAM_WIN_BOTH_HALVES"
  ) {
    const side = resolveTeamSide(raw.name, ctx);
    if (side === "AWAY") {
      if (code === "HOME_WIN_TO_NIL") return "AWAY_WIN_TO_NIL";
      if (code === "HOME_SCORE_BOTH_HALVES") return "AWAY_SCORE_BOTH_HALVES";
      return "AWAY_WIN_BOTH_HALVES";
    }
  }

  return code;
}

function resolveMarketCode(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): { code: NormalizedMarketType; matchedBy: "id" | "name" | "pattern" } {
  const base = resolveMarketCodeBase(raw, ctx);
  const adjusted = adjustMarketCode(base.code, raw, ctx);
  return adjusted === base.code ? base : { code: adjusted, matchedBy: base.matchedBy };
}

function resolveMarketCodeBase(
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
      // "Obie drużyny strzelą gola w obu połowach" = BTTS in each half,
      // a much narrower market than the generic "goal in both halves".
      return { code: "BTTS_BOTH_HALVES", matchedBy: "pattern" };
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

  if (/^dokladny wynik$/.test(normalized)) {
    return { code: "CORRECT_SCORE", matchedBy: "pattern" };
  }

  if (/^1 polowa - dokladny wynik$/.test(normalized)) {
    return { code: "HALF_TIME_CORRECT_SCORE", matchedBy: "pattern" };
  }

  if (/^strzelec 1 gola$/.test(normalized) || /- strzelec 1 gola$/.test(normalized)) {
    return { code: "GOALSCORER_FIRST", matchedBy: "pattern" };
  }

  // "1./2. połowa - {Team} strzeli gola" — binary team-to-score-in-half
  // market; must not leak into player goalscorer markets.
  const halfTeamToScore = normalized.match(/^([12]) polowa - .+ strzeli gola$/);
  if (halfTeamToScore) {
    const teamSide = resolveTeamSide(raw.name, ctx);
    if (teamSide === "HOME") {
      return {
        code: halfTeamToScore[1] === "1" ? "HALF_TIME_HOME_TO_SCORE" : "SECOND_HALF_HOME_TO_SCORE",
        matchedBy: "pattern",
      };
    }
    if (teamSide === "AWAY") {
      return {
        code: halfTeamToScore[1] === "1" ? "HALF_TIME_AWAY_TO_SCORE" : "SECOND_HALF_AWAY_TO_SCORE",
        matchedBy: "pattern",
      };
    }
    return { code: "OTHER", matchedBy: "pattern" };
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

  // "Strzeli przynajmniej N goli/gole" — dedicated multi-goal scorer markets,
  // not extra parameter slots of GOALSCORER_ANYTIME.
  const scorerAtLeast = normalized.match(/^strzeli przynajmniej (\d+) gol/);
  if (scorerAtLeast) {
    const count = parseInt(scorerAtLeast[1], 10);
    if (count === 2) return { code: "PLAYER_2_OR_MORE_GOALS", matchedBy: "pattern" };
    if (count >= 3) return { code: "PLAYER_HAT_TRICK", matchedBy: "pattern" };
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

  // "1./2. połowa - {Team} - liczba goli" — per-half team totals; must be
  // checked before the generic full-match team-total pattern below.
  const halfTeamTotals = normalized.match(/^([12]) polowa - .+ - liczba goli$/);
  if (halfTeamTotals) {
    return {
      code: halfTeamTotals[1] === "1" ? "HALF_TIME_TEAM_TOTAL_GOALS" : "SECOND_HALF_TEAM_TOTAL_GOALS",
      matchedBy: "pattern",
    };
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

function formatSignedLine(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

/**
 * Extract a handicap line from selection labels like "Algieria (+2.5)" /
 * "Austria (-2.5)", normalized to the home team's line. Falls back to the
 * first parenthesised value (selections are ordered home-first).
 */
function extractHandicapLineFromSelections(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): string | undefined {
  let fallback: string | undefined;

  for (const sel of raw.selections) {
    const match = sel.name.match(/\(([+-]?\d+(?:[.,]\d+)?)\)\s*$/);
    if (!match) continue;
    const value = parseFloat(match[1].replace(",", "."));
    if (Number.isNaN(value)) continue;
    if (fallback === undefined) fallback = formatSignedLine(value);

    const side = normalizeHandicapSideSelection(sel.name, ctx);
    if (side === "HOME") return formatSignedLine(value);
    if (side === "AWAY") return formatSignedLine(-value);
  }

  return fallback;
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): string | undefined {
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

  // Per-half markets: the raw name starts with "1./2. połowa", so the goal
  // line must come from the selections only — parseIntegerLine on the name
  // would return the half number instead of the actual line.
  if ([
    "HALF_TIME_TEAM_TOTAL_GOALS",
    "SECOND_HALF_TEAM_TOTAL_GOALS",
    "HALF_TIME_RESULT_AND_TOTAL",
    "SECOND_HALF_RESULT_AND_TOTAL",
    "HALF_TIME_DOUBLE_CHANCE_TOTAL",
    "SECOND_HALF_DOUBLE_CHANCE_TOTAL",
  ].includes(marketCode)) {
    return parseLineFromSelections(selectionNames);
  }

  if (["ASIAN_HANDICAP", "EUROPEAN_HANDICAP", "CORNERS_HANDICAP"].includes(marketCode)) {
    return (
      parseHandicapLine(raw.name) ||
      selectionNames.map((name) => parseHandicapLine(name)).find(Boolean)
    );
  }

  // Per-half European handicap: selections carry a scoreline suffix
  // ("Algieria (0:1)") — use the scoreline as the parameter (STS convention).
  if (marketCode === "FIRST_HALF_EUROPEAN_HANDICAP" || marketCode === "SECOND_HALF_EUROPEAN_HANDICAP") {
    for (const name of selectionNames) {
      const scoreline = name.match(/\((\d+)\s*:\s*(\d+)\)/);
      if (scoreline) return `${scoreline[1]}:${scoreline[2]}`;
    }
    return extractHandicapLineFromSelections(raw, ctx);
  }

  // Per-half Asian handicap: the line lives in the selection labels
  // ("Algieria (+2.5)"), never in the raw name (which holds the half number).
  if (marketCode === "FIRST_HALF_ASIAN_HANDICAP" || marketCode === "SECOND_HALF_ASIAN_HANDICAP") {
    return extractHandicapLineFromSelections(raw, ctx);
  }

  if (marketCode === "TIME_PERIOD_RESULT") {
    return parseIntegerLine(raw.name);
  }

  if (marketCode === "GOALSCORER_ANYTIME" || marketCode === "PLAYER_SHOTS_ON_TARGET") {
    return parseIntegerLine(raw.name);
  }

  // Same convention as the STS normalizer: the parameter is the team side.
  if (marketCode === "TEAM_WIN_AT_LEAST_ONE_HALF") {
    return resolveTeamSide(raw.name, ctx) ?? undefined;
  }

  // Digits in these raw names are goal thresholds or half numbers,
  // not market parameters.
  if (
    marketCode === "PLAYER_2_OR_MORE_GOALS" ||
    marketCode === "PLAYER_HAT_TRICK" ||
    marketCode === "SECOND_HALF_TEAM_GOAL_RANGE"
  ) {
    return undefined;
  }

  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  return parseDecimalLine(raw.name) || parseIntegerLine(raw.name) || parseLineFromSelections(selectionNames);
}

function normalizeRangeSelection(selectionName: string): NormalizedSelection {
  const trimmed = selectionName.trim();
  const normalized = normalizeText(trimmed);

  if (/(brak|none)/i.test(normalized)) return "NONE" as NormalizedSelection;
  if (/^\d+\s*-\s*\d+/.test(trimmed) || /\+\s*$/.test(trimmed) || /^\d+$/.test(trimmed)) {
    return trimmed as NormalizedSelection;
  }
  return "UNKNOWN";
}

/**
 * Resolve a handicap selection to HOME/DRAW/AWAY. Fuksiarz labels carry the
 * team name with a trailing line — numeric "Algieria (-2)" / "Algieria (+2.5)"
 * or scoreline "Algieria (0:1)" — and the team name is Polish while context
 * teams are canonical, so the suffix must be stripped before alias matching.
 */
function normalizeHandicapSideSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();

  if (/^x\b/i.test(trimmed) || /remis/i.test(trimmed)) return "DRAW";
  if (ctx.homeTeam && normalizeText(trimmed).includes(normalizeText(ctx.homeTeam))) return "HOME";
  if (ctx.awayTeam && normalizeText(trimmed).includes(normalizeText(ctx.awayTeam))) return "AWAY";

  const teamPart = trimmed
    .replace(/\s*\((?:[+-]?\d+(?:[.,]\d+)?|\d+\s*:\s*\d+)\)\s*$/, "")
    .trim();
  return normalize1x2Selection(teamPart || trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
}

/**
 * Winning margin selections: "{Team} by N" / "{Team} by N+" (English labels
 * on Fuksiarz) plus draw buckets "Score Draw" and "No Goal" (0:0), which both
 * belong to the catalog's single DRAW selection. "by 3" and "by 4+" collapse
 * into the catalog's 3PLUS bucket (duplicates merged afterwards).
 */
function normalizeWinningMarginSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();
  const normalized = normalizeText(trimmed);

  if (/^(score draw|no goal|remis|rowno|bez goli|brak goli|0\s*:\s*0)$/.test(normalized)) {
    return "DRAW";
  }

  const marginMatch = trimmed.match(/^(.+?)\s+(?:by|o)\s+(\d+)\s*(\+)?$/i);
  if (marginMatch) {
    const side = normalize1x2Selection(marginMatch[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
    if (side === "HOME" || side === "AWAY") {
      const count = parseInt(marginMatch[2], 10);
      const bucket = count >= 3 || marginMatch[3] ? "3PLUS" : String(count);
      return `${side}_BY_${bucket}` as NormalizedSelection;
    }
  }

  return trimmed as NormalizedSelection;
}

/**
 * Merge selections that normalized to the same catalog code (e.g. raw "by 3"
 * and "by 4+" both mapping to HOME_BY_3PLUS). The combined price sums the
 * implied probabilities: 1 / (1/o1 + 1/o2).
 */
function mergeDuplicateSelectionCodes(
  selections: Array<{ code: NormalizedSelection; label: string; odds: number }>
): Array<{ code: NormalizedSelection; label: string; odds: number }> {
  const byCode = new Map<string, { code: NormalizedSelection; label: string; odds: number }>();
  const order: string[] = [];

  for (const sel of selections) {
    const existing = byCode.get(sel.code);
    if (!existing) {
      byCode.set(sel.code, { ...sel });
      order.push(sel.code);
      continue;
    }
    if (existing.odds > 0 && sel.odds > 0) {
      existing.odds = Math.round((1 / (1 / existing.odds + 1 / sel.odds)) * 100) / 100;
    }
    existing.label = `${existing.label} / ${sel.label}`;
  }

  return order.map((code) => byCode.get(code)!);
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

/**
 * Split a combined selection ("{Team} i tak", "X i powyżej 2.5") into its two
 * legs. Anchors the right-hand side on the known keywords so team names that
 * contain " i " (e.g. "Bośnia i Hercegowina") stay intact.
 */
function splitCombinationSelection(selectionName: string): [string, string] | null {
  const anchored = selectionName.match(/^(.+)\s+i\s+((?:tak|nie|powy[żz]ej|poni[żz]ej)\b.*)$/i);
  if (anchored) return [anchored[1].trim(), anchored[2].trim()];

  const [left, right] = selectionName.split(/\s+i\s+/i).map((part) => part.trim());
  if (!left || !right) return null;
  return [left, right];
}

function normalizeCombinationSelection(
  selectionName: string,
  ctx: NormalizationContext,
  mode: "result-total" | "result-btts" | "dc-total" | "dc-btts"
): NormalizedSelection {
  const parts = splitCombinationSelection(selectionName);
  if (!parts) return selectionName.trim() as NormalizedSelection;
  const [left, right] = parts;

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

  // Strip slashes so "1/X" matches the "1X" double-chance vocabulary.
  const dc = normalizeDoubleChanceSelection(left.replace(/\s*\/\s*/g, ""));
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
    case "HALF_TIME_DRAW_NO_BET":
    case "SECOND_HALF_DRAW_NO_BET":
    case "CORNERS_RACE":
    case "CARDS_RACE":
    case "TIME_PERIOD_RESULT":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
    case "HALF_TIME_DOUBLE_CHANCE":
    case "SECOND_HALF_DOUBLE_CHANCE":
      // Strip slashes so "1/X" matches the "1X" double-chance vocabulary.
      return normalizeDoubleChanceSelection(trimmed.replace(/\s*\/\s*/g, ""));

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS":
    case "HALF_TIME_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_TEAM_TOTAL_GOALS":
    case "TIME_PERIOD_TOTAL_GOALS":
    case "INTERVAL_TOTAL_GOALS":
    case "FIRST_30_MIN_TOTAL_GOALS":
    case "CORNERS_TOTAL":
    case "CARDS_TOTAL":
    case "FOULS_TOTAL":
    case "OFFSIDES_TOTAL": {
      const ou = normalizeOverUnderSelection(trimmed);
      return ou === "UNKNOWN" ? normalizeRangeSelection(trimmed) : ou;
    }

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
    case "BOTH_HALVES_GOALS":
    case "BTTS_BOTH_HALVES":
    case "BTTS_2PLUS_GOALS":
    case "OWN_GOAL":
    case "TEAM_WIN_AT_LEAST_ONE_HALF":
    case "TEAM_WIN_BOTH_HALVES":
    case "AWAY_WIN_BOTH_HALVES":
    case "HOME_WIN_TO_NIL":
    case "AWAY_WIN_TO_NIL":
    case "HALF_TIME_WIN_TO_NIL":
    case "SECOND_HALF_WIN_TO_NIL":
    case "HOME_SCORE_BOTH_HALVES":
    case "AWAY_SCORE_BOTH_HALVES":
      return normalizeYesNoSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "CORNERS_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP":
    case "FIRST_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_EUROPEAN_HANDICAP":
      return normalizeHandicapSideSelection(trimmed, ctx);

    case "CORRECT_SCORE":
    case "HALF_TIME_CORRECT_SCORE": {
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
    case "HALF_TIME_FIRST_GOAL":
    case "SECOND_HALF_FIRST_GOAL":
      return normalizeFirstEventSelection(trimmed, ctx);

    case "RESULT_AND_TOTAL":
    case "HALF_TIME_RESULT_AND_TOTAL":
    case "SECOND_HALF_RESULT_AND_TOTAL":
      return normalizeCombinationSelection(trimmed, ctx, "result-total");

    case "RESULT_AND_BTTS":
    case "HALF_TIME_RESULT_AND_BTTS":
    case "SECOND_HALF_RESULT_AND_BTTS":
      return normalizeCombinationSelection(trimmed, ctx, "result-btts");

    case "DOUBLE_CHANCE_TOTAL":
    case "HALF_TIME_DOUBLE_CHANCE_TOTAL":
    case "SECOND_HALF_DOUBLE_CHANCE_TOTAL":
      return normalizeCombinationSelection(trimmed, ctx, "dc-total");

    case "DOUBLE_CHANCE_BTTS":
    case "HALF_TIME_DOUBLE_CHANCE_BTTS":
    case "SECOND_HALF_DOUBLE_CHANCE_BTTS":
      return normalizeCombinationSelection(trimmed, ctx, "dc-btts");

    case "FIRST_GOAL_AND_RESULT":
      return normalizeFirstGoalAndResultSelection(trimmed, ctx);

    case "GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
    case "HOME_GOAL_RANGE":
    case "AWAY_GOAL_RANGE":
    case "SECOND_HALF_TEAM_GOAL_RANGE":
      return normalizeRangeSelection(trimmed);

    case "HALF_WITH_MORE_GOALS": {
      const normalized = normalizeText(trimmed);
      if (/rowno|remis|zadna/.test(normalized)) return "Draw" as NormalizedSelection;
      if (/^1\b/.test(normalized) || normalized.includes("pierwsza")) return "1st" as NormalizedSelection;
      if (/^2\b/.test(normalized) || normalized.includes("druga")) return "2nd" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "WINNING_MARGIN":
    case "HALF_TIME_WINNING_MARGIN":
      return normalizeWinningMarginSelection(trimmed, ctx);

    case "HALF_TIME_EXACT_GOALS":
      // Catalog buckets everything from 3 goals up into "3+".
      if (/^\d+$/.test(trimmed) && parseInt(trimmed, 10) >= 3) return "3+" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "SECOND_HALF_EXACT_GOALS":
      // Catalog buckets everything from 2 goals up into "2+".
      if (/^\d+$/.test(trimmed) && parseInt(trimmed, 10) >= 2) return "2+" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
    case "PLAYER_2_OR_MORE_GOALS":
    case "PLAYER_HAT_TRICK":
    case "PLAYER_SHOTS":
    case "PLAYER_CARDS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_PASSES":
      return trimmed.replace(/^\d+\.\s*/, "").trim() as NormalizedSelection;

    case "PLAYER_ASSISTS": {
      // Align with the catalog convention used by peers ("{Player} 1+") —
      // Fuksiarz's "anytime assist" market implies the 1+ line.
      const player = trimmed.replace(/^\d+\.\s*/, "").trim();
      return (/\d\+$/.test(player) ? player : `${player} 1+`) as NormalizedSelection;
    }

    default: {
      // Generic fallback: many Fuksiarz binary markets quote raw Polish
      // "tak"/"nie" — translate them to canonical YES/NO instead of leaking
      // raw lowercase codes into the aggregated selection set.
      const yesNo = normalizeYesNoSelection(trimmed);
      if (yesNo !== "UNKNOWN") return yesNo;
      return trimmed as NormalizedSelection;
    }
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

    const paramValue = extractParamValue(marketCode, raw, ctx);
    const marketKey = buildMarketKey(marketCode, paramValue);

    let selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode, ctx),
      label: sel.name,
      odds: sel.odds,
    }));

    // Per-half team markets: the catalog codes are side-prefixed
    // (HOME_OVER/AWAY_UNDER, AWAY_2-3, ...) while the raw selections only say
    // "powyżej"/"poniżej" — the side lives in the raw market name.
    if (
      marketCode === "HALF_TIME_TEAM_TOTAL_GOALS" ||
      marketCode === "SECOND_HALF_TEAM_TOTAL_GOALS" ||
      marketCode === "SECOND_HALF_TEAM_GOAL_RANGE"
    ) {
      const side = resolveTeamSide(raw.name, ctx);
      if (side) {
        selections = selections.map((sel) =>
          sel.code === "UNKNOWN"
            ? sel
            : { ...sel, code: `${side}_${sel.code}` as NormalizedSelection }
        );
      }
    }

    // Collapse raw buckets that map to a single catalog selection
    // (e.g. "by 3" + "by 4+" -> HOME_BY_3PLUS, exact goals 3/4/5 -> "3+").
    if (MERGE_DUPLICATE_CODE_MARKETS.has(marketCode)) {
      selections = mergeDuplicateSelectionCodes(selections);
    }

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
