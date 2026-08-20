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
  canonicalizePlayerName,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode, getMarketByCode } from "../../../data/market-catalog.js";
import { matchToCanonical } from "../../../utils/team-matcher.js";

const FUKSIARZ_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  1: "MATCH_WINNER",
  2: "HALF_TIME_RESULT",
  4: "DOUBLE_CHANCE",
  // Audit /audit-match (Arsenal vs Coventry City): id 5 is labelled "Handicap
  // europejski" but serves a 3x3 HALF-TIME / FULL-TIME grid ("1/1", "X/1", …)
  // whose odds match betfan's HT/FT market to the decimal. The genuine
  // European handicap arrives under the plain "Handicap" label with
  // "<team> (±line)" selections. Detected by selection shape in
  // resolveMarketCode so a future relabel cannot silently reintroduce the bug.
  5: "HALFTIME_FULLTIME",
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
  // "Zawodnik strzeli gola i jego drużyna wygra" ("Player scores and his own
  // team wins") never needs a HOME/DRAW/AWAY pick — it is the dedicated
  // PLAYER_GOAL_AND_TEAM_WIN catalog code (same shape betcris uses for its
  // "PlayerWillScoreandHisTeamWillWin" market), not the 3-way
  // PLAYER_GOAL_AND_RESULT market that STS's per-player "i 1/X/2" labels use.
  "-30021": "PLAYER_GOAL_AND_TEAM_WIN",
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
  "-30417": "HALF_TIME_HOME_WIN_TO_NIL",
  "-30418": "HALF_TIME_HOME_WIN_TO_NIL",
  "-4548": "HALF_TIME_EXACT_GOALS",
  "-4555": "HALF_TIME_HOME_EXACT_GOALS",
  "-4521": "HALF_TIME_HOME_EXACT_GOALS",
  "-4534": "SECOND_HALF_FIRST_GOAL",
  "-188": "SECOND_HALF_DOUBLE_CHANCE",
  "-283": "SECOND_HALF_DRAW_NO_BET",
  "121": "SECOND_HALF_BTTS",
  // "2. połowa - Arsenal wygra do zera" / "...Coventry..." are team-specific
  // bets (which team wins the 2nd half to nil), not the generic "either team"
  // SECOND_HALF_WIN_TO_NIL code — map to the HOME_ variant and let the
  // AWAY_SIDE_VARIANT flip below resolve -30420 to the AWAY_ code (same
  // pattern already used for the HALF_TIME_ sibling above; audit-match
  // Arsenal vs Coventry City, round 7).
  "-30419": "SECOND_HALF_HOME_WIN_TO_NIL",
  "-30420": "SECOND_HALF_HOME_WIN_TO_NIL",
  "-30627": "SECOND_HALF_EXACT_GOALS",
  "-30628": "SECOND_HALF_HOME_EXACT_GOALS",
  "-30629": "SECOND_HALF_HOME_EXACT_GOALS",
  "-261": "HALF_TIME_CORNERS_RACE",
  "-30517": "HALF_TIME_HOME_EXACT_CORNERS",
  "-30518": "HALF_TIME_HOME_EXACT_CORNERS",
  "-2954": "HALF_TIME_CORNERS_HANDICAP",
  "-30515": "CARDS_EXACT",
  // "1. połowa - dokładna liczba kartek" (0/1/2/3/4+) is an exact-count
  // distribution, not an over/under line — map straight to the dedicated
  // HALF_TIME_CARDS_EXACT catalog code (audit-match, Arsenal vs Coventry
  // City, round 9 CT-1/other) instead of HALF_TIME_CARDS_TOTAL, whose bucket
  // labels used to collide with the OTHER catch-all bucket.
  "-30516": "HALF_TIME_CARDS_EXACT",
  "-30314": "CARDS_HANDICAP",
  "22": "RED_CARD",
  "-250": "RED_CARD_TEAM",
  "-251": "RED_CARD_TEAM",
  "48": "HOME_WIN_TO_NIL",
  "-30333": "RED_CARD_OR_PENALTY",
  "130": "HOME_WIN_TO_NIL",
  "-30469": "RED_CARD_AND_PENALTY",
  "125": "HOME_WIN_BOTH_HALVES",
  "126": "HOME_WIN_BOTH_HALVES",
  "15": "PENALTY_AWARDED",
  // "<Team> wygra przynajmniej jedną połowę" (ids 127/128) is quoted per team
  // — map to the HOME_ side-specific catalog code (where the other nine
  // bookmakers keep this bet) and let the AWAY_SIDE_VARIANT flip below
  // resolve the away-team raw market to AWAY_WIN_AT_LEAST_ONE_HALF, same
  // pattern as the "wygra obie połowy" sibling (125/126). The old
  // TEAM_WIN_AT_LEAST_ONE_HALF param route duplicated the bet in the UI and
  // excluded fuksiarz from the main comparison pool (audit-match, Arsenal vs
  // Coventry City).
  "127": "HOME_WIN_AT_LEAST_ONE_HALF",
  "-30331": "PENALTY_AWARDED_TEAM",
  "128": "HOME_WIN_AT_LEAST_ONE_HALF",
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
  // Audit /audit-match (Arsenal vs Coventry City): "Liczba goli - N minut" and
  // "Handicap - N minut" are each ONE family, but the ids were spread over
  // three codes apiece (INTERVAL_TOTAL_GOALS / TIME_PERIOD_TOTAL_GOALS /
  // FIRST_30_MIN_TOTAL_GOALS and TIME_PERIOD_HANDICAP / _ASIAN_HANDICAP /
  // unmapped), so siblings of the same market never lined up and the 5-min and
  // 60-min windows fell out entirely. The market key already carries both the
  // window and the line ("TIME_PERIOD_TOTAL_GOALS:75 (2.5)"), so a single code
  // per family is safe.
  "-30570": "TIME_PERIOD_TOTAL_GOALS",
  "-30571": "TIME_PERIOD_TOTAL_GOALS",
  "-30572": "TIME_PERIOD_TOTAL_GOALS",
  "-30573": "TIME_PERIOD_TOTAL_GOALS",
  "-30574": "TIME_PERIOD_TOTAL_GOALS",
  "-30575": "TIME_PERIOD_TOTAL_GOALS",
  "-30564": "TIME_PERIOD_ASIAN_HANDICAP",
  "-30565": "TIME_PERIOD_ASIAN_HANDICAP",
  "-30566": "TIME_PERIOD_ASIAN_HANDICAP",
  "-30567": "TIME_PERIOD_ASIAN_HANDICAP",
  "-30568": "TIME_PERIOD_ASIAN_HANDICAP",
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
  "SECOND_HALF_HOME_EXACT_GOALS",
  "SECOND_HALF_AWAY_EXACT_GOALS",
  "HALF_TIME_AWAY_EXACT_GOALS",
  "HALF_TIME_HOME_EXACT_GOALS",
  "HALF_TIME_HOME_EXACT_CORNERS",
  "HALF_TIME_AWAY_EXACT_CORNERS",
  "CARDS_EXACT",
]);

/**
 * Markets whose per-selection normalizer returns "UNKNOWN" for a raw bucket
 * that has no faithful catalog counterpart (e.g. a combined tail or a coarser
 * bucketing than the catalog's overlapping-range scheme). The literal
 * "UNKNOWN" string must not leak into the aggregated selection set, so these
 * entries are filtered out of the final market instead.
 */
const UNKNOWN_FILTERED_MARKETS = new Set<NormalizedMarketType>([
  "CARDS_EXACT",
  "HALF_TIME_GOAL_RANGE",
  "SECOND_HALF_GOAL_RANGE",
  "HOME_GOAL_RANGE",
  "AWAY_GOAL_RANGE",
]);

/**
 * Multi-player line markets: one raw market ("Odda co najmniej N celnych
 * strzałów") lists every player as a selection while the threshold N lives in
 * the raw market name. The catalog convention (see etoto) keys these by
 * "{Player} {N}+" selection codes in the base parameter bucket — a numeric
 * pseudo-parameter ("1"/"2") must never be emitted.
 */
const PLAYER_LINE_MARKETS = new Set<NormalizedMarketType>([
  "PLAYER_SHOTS",
  "PLAYER_SHOTS_ON_TARGET",
  "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX",
  "PLAYER_FOULS",
  "PLAYER_FOULS_WON",
]);

/**
 * Team-sided markets whose Fuksiarz ids can only be mapped to the HOME_
 * catalog variant. When the raw market name actually names the away team,
 * the code must flip to the AWAY_ variant ("OTHER" = no away-side catalog
 * code exists yet, so the market is excluded instead of poisoning the
 * home-side odds).
 */
const AWAY_SIDE_VARIANT: Partial<Record<NormalizedMarketType, NormalizedMarketType>> = {
  HOME_WIN_TO_NIL: "AWAY_WIN_TO_NIL",
  HOME_SCORE_BOTH_HALVES: "AWAY_SCORE_BOTH_HALVES",
  HOME_WIN_BOTH_HALVES: "AWAY_WIN_BOTH_HALVES",
  HOME_WIN_AT_LEAST_ONE_HALF: "AWAY_WIN_AT_LEAST_ONE_HALF",
  HALF_TIME_HOME_WIN_TO_NIL: "HALF_TIME_AWAY_WIN_TO_NIL",
  SECOND_HALF_HOME_WIN_TO_NIL: "SECOND_HALF_AWAY_WIN_TO_NIL",
  HOME_EXACT_GOALS: "AWAY_EXACT_GOALS",
  HALF_TIME_HOME_EXACT_CORNERS: "HALF_TIME_AWAY_EXACT_CORNERS",
  HOME_TEAM_TOTAL_OFFSIDES: "AWAY_TEAM_TOTAL_OFFSIDES",
  HALF_TIME_HOME_EXACT_GOALS: "HALF_TIME_AWAY_EXACT_GOALS",
  SECOND_HALF_HOME_EXACT_GOALS: "SECOND_HALF_AWAY_EXACT_GOALS",
  HOME_POSSESSION: "AWAY_POSSESSION",
};

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

/**
 * Fuksiarz-only raw-name irregularities that break the shared
 * canonicalizePlayerName() "Lastname, Firstname" -> "Firstname Lastname"
 * swap because Fuksiarz itself put the name parts in the wrong slot at the
 * source. E.g. Frank Onyeka is quoted as "Onyeka Frank, Ogochukwu" (treating
 * "Onyeka Frank" as the surname and "Ogochukwu" as the given name), so the
 * generic swap produces "Ogochukwu Onyeka Frank" — a name no other
 * bookmaker uses — stranding this player's odds in their own single-book
 * parameter row instead of merging into the shared "Frank Onyeka" row
 * (audit-match, Arsenal vs Coventry City, AWAY_GOALSCORER_FIRST index 288).
 * Keyed by the raw text as-is (pre-canonicalization) since the malformation
 * is specific to Fuksiarz's source data, not a generic parsing pattern.
 */
const FUKSIARZ_PLAYER_NAME_ALIASES: Record<string, string> = {
  "Onyeka Frank, Ogochukwu": "Frank Onyeka",
  // Fuksiarz abbreviates Victor Torp's given name to a single initial
  // ("Torp, V"), so the generic comma-swap yields "V Torp" instead of the
  // full "Victor Torp" every other bookmaker (sts/betfan) quotes — stranding
  // this player's odds in their own single-book parameter row instead of
  // merging into the shared row (audit-match, Arsenal vs Coventry City,
  // PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX round 9).
  "Torp, V": "Victor Torp",
};

function canonicalizeFuksiarzPlayerName(raw: string): string {
  const alias = FUKSIARZ_PLAYER_NAME_ALIASES[raw.trim()];
  return alias ?? canonicalizePlayerName(raw);
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
    // The same "<Team> - liczba goli" label covers BOTH an over/under ladder
    // and a goal-range grid, so the side-scoped total codes have to be
    // rerouted here too — otherwise the range grid stays in the O/U market.
    if (
      code === "TEAM_TOTAL_GOALS" ||
      code === "HOME_TEAM_TOTAL_GOALS" ||
      code === "AWAY_TEAM_TOTAL_GOALS"
    ) {
      const side =
        code === "HOME_TEAM_TOTAL_GOALS"
          ? "HOME"
          : code === "AWAY_TEAM_TOTAL_GOALS"
            ? "AWAY"
            : resolveTeamSide(raw.name, ctx);
      if (side === "HOME") return "HOME_GOAL_RANGE";
      if (side === "AWAY") return "AWAY_GOAL_RANGE";
      return "OTHER";
    }
    if (code === "SECOND_HALF_TEAM_TOTAL_GOALS") return "SECOND_HALF_TEAM_GOAL_RANGE";
    if (code === "HALF_TIME_TEAM_TOTAL_GOALS") return "HALF_TIME_TEAM_GOAL_RANGE";
    // "<Team> - liczba rzutow roznych" has the identical dual-shape problem:
    // an O/U ladder ("poniżej 5.5"/"powyżej 5.5") and a discrete range panel
    // ("0-2"/"3-4"/"5-6"/"7+") share the same raw name and id. Without this
    // reroute the range panel's bucket labels ("0-2") get misparsed by
    // extractParamValue's generic line parser into a phantom decimal "0"
    // param, colliding CORNERS_TEAM into a nonsense line instead of landing
    // in CORNERS_TEAM_RANGE where forbet/etoto/betfan already keep this
    // product (audit-match, Arsenal vs Coventry City, round 8 CT-2).
    if (code === "CORNERS_TEAM") return "CORNERS_TEAM_RANGE";
    // Bracket panels of corners/cards totals ("0-5"/"6-8"/"9-11"/"12-14"/"15+",
    // "0-2"/"3-5"/"6+") have dedicated catalog vocabulary (CORNERS_TOTAL_RANGE /
    // CARDS_TOTAL_RANGE) — without this reroute they were wedged into the
    // OVER/UNDER parameter sliders as a fake "0" line, or (worse) collapsed
    // into the generic OTHER bucket where fuksiarz's "Liczba rzutów rożnych"
    // bucket panel and "Liczba kartek" bucket panel silently merged their
    // selections into one shared, mislabeled row (audit-match, Arsenal vs
    // Coventry City, round 9 CT-1/other).
    if (code === "CORNERS_TOTAL") return "CORNERS_TOTAL_RANGE";
    if (code === "CARDS_TOTAL") return "CARDS_TOTAL_RANGE";
  }

  // Team-sided raw markets: the id map can only point at the HOME_/TEAM_
  // variant, but Fuksiarz quotes a separate raw market per team — flip to the
  // AWAY_ catalog code when the raw name names the away team.
  const awayVariant = AWAY_SIDE_VARIANT[code];
  if (awayVariant && resolveTeamSide(raw.name, ctx) === "AWAY") {
    return awayVariant;
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
      return { code: "TOTAL_GOALS_AND_BTTS", matchedBy: "name" };
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
    // Audit /audit-match (premier-league Arsenal vs Coventry City): under the
    // "Handicap europejski" label fuksiarz actually serves a 3x3 HALF-TIME /
    // FULL-TIME grid ("1/1", "X/1", "2/1", "1/X", …). Its odds line up with
    // betfan's HT/FT market to the decimal (1/1 1.58 vs 1.50, X/1 4.10 vs
    // 3.90, X/X 9.50 vs 9.40), and forcing it into EUROPEAN_HANDICAP produced
    // an UNKNOWN selection plus a DRAW price parked on the wrong line.
    // The genuine handicap markets arrive under the plain "Handicap" label
    // with "<team> (±line)" selections, which the check below still catches.
    const isHalftimeFulltimeGrid =
      raw.selections.length >= 6 &&
      raw.selections.every((sel) => /^\s*[1x2]\s*\/\s*[1x2]\s*$/i.test(sel.name));
    if (isHalftimeFulltimeGrid) {
      return { code: "HALFTIME_FULLTIME", matchedBy: "pattern" };
    }
    return { code: "EUROPEAN_HANDICAP", matchedBy: "pattern" };
  }

  if (/^dokladny wynik$/.test(normalized)) {
    return { code: "CORRECT_SCORE", matchedBy: "pattern" };
  }

  if (/^1 polowa - dokladny wynik$/.test(normalized)) {
    return { code: "HALF_TIME_CORRECT_SCORE", matchedBy: "pattern" };
  }

  // "<Team> - strzelec 1. gola" is a TEAM-SCOPED first-goalscorer market
  // (only that team's squad plus a "no goal for this team" outcome) — a
  // different bet from the whole-match first goalscorer market below, so it
  // must be checked first (it shares the same "- strzelec 1 gola" suffix
  // and would otherwise feed the parsed "1" digit into GOALSCORER_FIRST's
  // parameter as a phantom line, falsely merging it with the match-wide
  // market).
  // Route straight to the dedicated HOME_/AWAY_GOALSCORER_FIRST catalog
  // codes (parameterType "player") instead of the shared TEAM_FIRST_GOALSCORER
  // code — that shared code's catalog entry also declares parameterType
  // "player", so stuffing the team side into the parameter left all 20+
  // players stranded as selection codes under one row ("Arsenal" isolated
  // from betfan's HOME_GOALSCORER_FIRST, which already uses this side-coded
  // pair — audit-match, Arsenal vs Coventry City, round 8 P4).
  const teamFirstScorer = normalized.match(/^(.+?)\s*-\s*strzelec\s+1\s+gola$/);
  if (teamFirstScorer) {
    const side = resolveTeamSide(raw.name, ctx);
    if (side === "HOME") return { code: "HOME_GOALSCORER_FIRST", matchedBy: "pattern" };
    if (side === "AWAY") return { code: "AWAY_GOALSCORER_FIRST", matchedBy: "pattern" };
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

  // Live Fuksiarz names this market plain "Zaliczy asystę" — no "Zawodnik"
  // prefix — so the anchor must accept the bare verb too, matching the same
  // fix already applied to the shot/foul line-prop anchors below. Without
  // this, the market fails classification entirely and its 40 bundled
  // player selections leak into the OTHER catch-all bucket instead of the
  // dedicated PLAYER_ASSISTS market (audit-match, Arsenal vs Coventry City,
  // OTHER index 15).
  if (/^(zawodnik\s+)?zaliczy asyste$/.test(normalized)) {
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
    // See the note in forbet-normalizer.ts: the side-scoped codes are where the
    // other nine bookmakers put this bet, so team totals only line up there.
    const side = resolveTeamSide(raw.name, ctx);
    if (side === "HOME") return { code: "HOME_TEAM_TOTAL_GOALS", matchedBy: "pattern" };
    if (side === "AWAY") return { code: "AWAY_TEAM_TOTAL_GOALS", matchedBy: "pattern" };
    return { code: "TEAM_TOTAL_GOALS", matchedBy: "pattern" };
  }

  // Per-half totals/team stats must be matched before the greedy full-match
  // patterns below — "1. połowa - {Team} - liczba kartek" would otherwise be
  // swallowed by "(.+) - liczba kartek" and land in the full-match market.
  const halfStatTeam = normalized.match(/^([12]) polowa - .+ - liczba (rzutow roznych|kartek)$/);
  if (halfStatTeam) {
    const corners = halfStatTeam[2] === "rzutow roznych";
    if (halfStatTeam[1] === "1") {
      return { code: corners ? "HALF_TIME_CORNERS_TEAM" : "HALF_TIME_CARDS_TEAM", matchedBy: "pattern" };
    }
    return { code: corners ? "SECOND_HALF_CORNERS_TEAM" : "SECOND_HALF_CARDS_TEAM", matchedBy: "pattern" };
  }

  const halfStatTotal = normalized.match(/^([12]) polowa - liczba (rzutow roznych|kartek)$/);
  if (halfStatTotal) {
    const corners = halfStatTotal[2] === "rzutow roznych";
    if (halfStatTotal[1] === "1") {
      return { code: corners ? "HALF_TIME_CORNERS_TOTAL" : "HALF_TIME_CARDS_TOTAL", matchedBy: "pattern" };
    }
    return { code: corners ? "SECOND_HALF_CORNERS_TOTAL" : "SECOND_HALF_CARDS_TOTAL", matchedBy: "pattern" };
  }

  if (/^(.+) - liczba rzutow roznych$/.test(normalized)) {
    return { code: "CORNERS_TEAM", matchedBy: "pattern" };
  }

  if (/^(.+) - liczba kartek$/.test(normalized)) {
    return { code: "CARDS_TEAM", matchedBy: "pattern" };
  }

  // Winning-margin markets by name (some payloads miss the -338/-30344 ids).
  if (/^roznica zwyciestwa$/.test(normalized)) {
    return { code: "WINNING_MARGIN", matchedBy: "pattern" };
  }

  if (/^1 polowa - roznica zwyciestwa$/.test(normalized)) {
    return { code: "HALF_TIME_WINNING_MARGIN", matchedBy: "pattern" };
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
    "HOME_TEAM_TOTAL_GOALS",
    "AWAY_TEAM_TOTAL_GOALS",
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
    "HALF_TIME_CORNERS_TEAM",
    "SECOND_HALF_CORNERS_TEAM",
    "HALF_TIME_CARDS_TEAM",
    "SECOND_HALF_CARDS_TEAM",
    "HALF_TIME_CORNERS_TOTAL",
    "SECOND_HALF_CORNERS_TOTAL",
    "HALF_TIME_CARDS_TOTAL",
    "SECOND_HALF_CARDS_TOTAL",
  ].includes(marketCode)) {
    return parseLineFromSelections(selectionNames);
  }

  // European handicap (3-way, full match or per-half): selections may carry
  // a virtual-score suffix ("Algieria (0:3)") instead of a plain decimal
  // line. Convert it to the signed home-perspective differential (STS
  // convention: "(1:0)" -> "+1", "(0:2)" -> "-2") before falling through to
  // the generic parseHandicapLine block below — otherwise parseHandicapLine
  // greedily matches the scoreline's first digit ("0") and fabricates a
  // bogus "0" line instead of the real "-3" handicap (confirmed root cause
  // of fuksiarz's phantom EUROPEAN_HANDICAP "0" param).
  if (
    marketCode === "EUROPEAN_HANDICAP" ||
    marketCode === "FIRST_HALF_EUROPEAN_HANDICAP" ||
    marketCode === "SECOND_HALF_EUROPEAN_HANDICAP"
  ) {
    for (const name of selectionNames) {
      const scoreline = name.match(/\((\d+)\s*:\s*(\d+)\)/);
      if (scoreline) {
        const diff = Number(scoreline[1]) - Number(scoreline[2]);
        return diff > 0 ? `+${diff}` : String(diff);
      }
    }
    if (marketCode !== "EUROPEAN_HANDICAP") {
      return extractHandicapLineFromSelections(raw, ctx);
    }
  }

  if (["ASIAN_HANDICAP", "EUROPEAN_HANDICAP", "CORNERS_HANDICAP"].includes(marketCode)) {
    return (
      parseHandicapLine(raw.name) ||
      selectionNames.map((name) => parseHandicapLine(name)).find(Boolean)
    );
  }

  // Per-half Asian handicap, per-half corners handicap and the cards
  // handicap: the line lives in the selection labels ("Algieria (+2.5)",
  // "Arsenal (-0.5)"), never in the raw name (which for per-half markets
  // holds the half number — parsing it would yield a bogus "1" line; for
  // "Kartki - handicap" it holds no number at all).
  //
  // CARDS_HANDICAP specifically must use this team-embedded-sign extraction
  // rather than falling through to the generic parseLineFromSelections below:
  // that generic path's parseOverUnderLine strips the sign from a match like
  // "-0.5" (its capture group excludes the leading sign), so "Arsenal (-0.5)"
  // and "Arsenal (+0.5)" — two DIFFERENT lines fuksiarz quotes side by side —
  // both collapsed onto the same unsigned "0.5" parameter, silently dropping
  // one line's odds and misfiling the other's home/away odds under the wrong
  // sign (audit-match, Arsenal vs Coventry City, round 9 CT-7).
  if (
    marketCode === "FIRST_HALF_ASIAN_HANDICAP" ||
    marketCode === "SECOND_HALF_ASIAN_HANDICAP" ||
    marketCode === "HALF_TIME_CORNERS_HANDICAP" ||
    marketCode === "CARDS_HANDICAP"
  ) {
    return extractHandicapLineFromSelections(raw, ctx);
  }

  // Time-window markets: the parameter is the window's end minute
  // ("1X2 - 75 minut (00:01-75:00)" -> "75"). parseIntegerLine would grab
  // the leading "1" of "1X2"/"00:01" instead.
  if (marketCode === "TIME_PERIOD_RESULT") {
    const minutes = raw.name.match(/(\d+)\s*minut/i);
    return minutes ? minutes[1] : parseIntegerLine(raw.name);
  }

  // Time-window goal totals: keep the end minute as the base parameter, but
  // when the raw goal line differs from the implicit 0.5 encode it into the
  // parameter — a 1.5-goals-in-15-min line must not merge with a peer's
  // 0.5-goals-in-15-min bucket as if directly comparable.
  if (
    marketCode === "TIME_PERIOD_TOTAL_GOALS" ||
    marketCode === "INTERVAL_TOTAL_GOALS" ||
    marketCode === "FIRST_30_MIN_TOTAL_GOALS"
  ) {
    const minutesMatch = raw.name.match(/(\d+)\s*minut/i);
    const minutes = minutesMatch ? minutesMatch[1] : parseIntegerLine(raw.name);
    if (!minutes) return parseLineFromSelections(selectionNames);
    const goalLine = parseOverUnderLine(selectionNames);
    if (goalLine && goalLine !== "0.5") return `${minutes} (${goalLine})`;
    return minutes;
  }

  if (marketCode === "GOALSCORER_ANYTIME") {
    return parseIntegerLine(raw.name);
  }

  // Multi-player line markets: the parser splits the bundled "Zawodnik ...
  // co najmniej N ..." raw market into one row per player (see parser.ts's
  // isMultiPlayerLineGame), so the sole selection's label is the player's
  // name. Canonicalize it into the catalog's "player" parameter — the same
  // convention etoto/fortuna/superbet/forbet use — instead of leaving every
  // player stranded in a shared "base" bucket. Falls back to the old
  // undefined/"base" behavior if a raw market unexpectedly still bundles
  // multiple players, so the grouper's safety net remains a backstop.
  if (PLAYER_LINE_MARKETS.has(marketCode)) {
    if (raw.selections.length !== 1) return undefined;
    const soleName = raw.selections[0].name;
    return soleName ? canonicalizeFuksiarzPlayerName(soleName.replace(/^\d+\.\s*/, "").trim()) : undefined;
  }

  // CORNERS_TEAM_RANGE's catalog parameter is the team side (HOME/AWAY), not
  // a line — the range buckets ("0-2"/"3-4"/"5-6"/"7+") carry no numeric
  // threshold to parse. Without this, the generic line-parsing fallback
  // below would derive a phantom decimal param from the first bucket label.
  if (marketCode === "CORNERS_TEAM_RANGE") {
    return resolveTeamSide(raw.name, ctx) ?? undefined;
  }

  // CORNERS_TOTAL_RANGE / CARDS_TOTAL_RANGE bundle every bucket ("0-5"/"6-8"/
  // "9-11"/"12-14"/"15+", "0-2"/"3-5"/"6+") as selections of ONE raw market —
  // there is no per-bucket numeric line to parse. Without this, the generic
  // line-parsing fallback below would derive a phantom decimal "0" param from
  // the first bucket label ("0-5" -> "0"), same defect CORNERS_TEAM_RANGE had
  // (audit-match, Arsenal vs Coventry City, round 9 CT-1/other).
  if (marketCode === "CORNERS_TOTAL_RANGE" || marketCode === "CARDS_TOTAL_RANGE") {
    return undefined;
  }

  // Digits in these raw names are goal thresholds or half numbers,
  // not market parameters.
  if (
    marketCode === "PLAYER_2_OR_MORE_GOALS" ||
    marketCode === "PLAYER_HAT_TRICK" ||
    marketCode === "SECOND_HALF_TEAM_GOAL_RANGE" ||
    marketCode === "HALF_TIME_TEAM_GOAL_RANGE" ||
    // "Strzelec 1. gola" - the "1" is the goal ordinal, not a market line.
    // Leaving paramValue unset lets the grouper's splitBundledPlayerSelections
    // fan the bundled 45-player list into one row per player (same recovery
    // path sts/betfan/etoto/superbet already take), keyed by player name with
    // the catalog's "PLAYER" selection code (audit-match, Arsenal vs
    // Coventry City, round 8 P2).
    marketCode === "GOALSCORER_FIRST" ||
    // "<Team> - strzelec 1. gola" — same phantom-"1" problem, but for the
    // team-scoped codes: HOME_/AWAY_GOALSCORER_FIRST also carry the player
    // as a catalog parameter, so paramValue must stay unset here too (round
    // 8 P4).
    marketCode === "HOME_GOALSCORER_FIRST" ||
    marketCode === "AWAY_GOALSCORER_FIRST"
  ) {
    return undefined;
  }

  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  // Strip a leading "1./2. połowa -" prefix before line parsing — the half
  // ordinal would otherwise be mistaken for the market line.
  const nameForLine = raw.name.replace(/^\s*[12]\.?\s*po[łl]owa\s*[-–]\s*/i, "");
  return parseDecimalLine(nameForLine) || parseIntegerLine(nameForLine) || parseLineFromSelections(selectionNames);
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
  ctx: NormalizationContext,
  rawName?: string
): NormalizedSelection {
  const trimmed = selectionName.trim();

  // Multi-player line markets: the player identity is now carried by the
  // market parameter (see extractParamValue), so the selection is just the
  // plain threshold ("3+") parsed from the raw market name ("Zawodnik odda
  // co najmniej 3 celne strzały") — matches the etoto/fortuna/superbet/
  // forbet convention. Falls back to the raw text if no threshold is found.
  if (PLAYER_LINE_MARKETS.has(marketCode)) {
    const threshold = rawName?.match(/co najmniej\s+(\d+)/i)?.[1];
    return (threshold ? `${threshold}+` : trimmed) as NormalizedSelection;
  }

  // Literal catalog-code passthrough: band/range/exact markets often quote
  // raw selection text that IS the catalog selection code ("0-2", "7+", "1+"),
  // and per-market cases below may miss them (falling through to UNKNOWN).
  // Skipped for MERGE_DUPLICATE_CODE_MARKETS: those markets have dedicated
  // tail-bucketing logic in the switch below (e.g. raw "3" -> "3+" for
  // HALF_TIME_AWAY_EXACT_GOALS), and some of their raw digits also happen to
  // be literal catalog codes in their own right ("3" is itself a valid
  // HALF_TIME_AWAY_EXACT_GOALS selection) — letting this fast path intercept
  // them here would return the un-bucketed literal and make the dedicated
  // case below dead code.
  const literalCatalogCodes = getMarketByCode(marketCode)?.selections;
  if (
    literalCatalogCodes &&
    literalCatalogCodes.length > 0 &&
    literalCatalogCodes.includes(trimmed) &&
    !MERGE_DUPLICATE_CODE_MARKETS.has(marketCode)
  ) {
    return trimmed as NormalizedSelection;
  }

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
    case "HALF_TIME_CORNERS_RACE":
    case "MOST_SHOTS":
    case "MOST_SHOTS_ON_TARGET":
    case "HT_OR_FT_RESULT":
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
    case "HOME_TEAM_TOTAL_GOALS":
    case "AWAY_TEAM_TOTAL_GOALS":
    case "HALF_TIME_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_TEAM_TOTAL_GOALS":
    case "TIME_PERIOD_TOTAL_GOALS":
    case "INTERVAL_TOTAL_GOALS":
    case "FIRST_30_MIN_TOTAL_GOALS":
    case "CORNERS_TOTAL":
    case "CARDS_TOTAL":
    case "FOULS_TOTAL":
    case "OFFSIDES_TOTAL":
    case "SUBSTITUTIONS_TOTAL":
    case "CORNERS_TEAM":
    case "HALF_TIME_CORNERS_TOTAL":
    case "SECOND_HALF_CORNERS_TOTAL":
    case "HALF_TIME_CARDS_TOTAL":
    case "SECOND_HALF_CARDS_TOTAL":
    case "TOTAL_SHOTS":
    case "TEAM_TOTAL_SHOTS":
    case "TOTAL_SHOTS_ON_TARGET":
    case "TEAM_TOTAL_SHOTS_ON_TARGET":
    case "EACH_TEAM_TOTAL_SHOTS_ON_TARGET_OVER":
    case "TEAM_TOTAL_FOULS":
    case "BOTH_TEAMS_FOULS_OVER":
    case "HOME_TEAM_TOTAL_OFFSIDES":
    case "AWAY_TEAM_TOTAL_OFFSIDES":
    case "EACH_TEAM_OFFSIDES":
    case "HOME_POSSESSION":
    case "AWAY_POSSESSION": {
      const ou = normalizeOverUnderSelection(trimmed);
      return ou === "UNKNOWN" ? normalizeRangeSelection(trimmed) : ou;
    }

    // Side-prefixed team stat markets (catalog codes HOME_OVER/AWAY_UNDER...):
    // emit the bare OVER/UNDER here — the team-side prefix is applied in
    // normalizeMarket from the raw market name.
    case "CARDS_TEAM":
    case "HALF_TIME_CORNERS_TEAM":
    case "SECOND_HALF_CORNERS_TEAM":
    case "HALF_TIME_CARDS_TEAM":
    case "SECOND_HALF_CARDS_TEAM":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
    case "BOTH_HALVES_GOALS":
    case "BTTS_BOTH_HALVES":
    case "BTTS_2PLUS_GOALS":
    case "OWN_GOAL":
    case "HOME_WIN_AT_LEAST_ONE_HALF":
    case "AWAY_WIN_AT_LEAST_ONE_HALF":
    case "TEAM_WIN_BOTH_HALVES":
    case "AWAY_WIN_BOTH_HALVES":
    case "HOME_WIN_TO_NIL":
    case "AWAY_WIN_TO_NIL":
    case "HALF_TIME_WIN_TO_NIL":
    case "SECOND_HALF_WIN_TO_NIL":
    // Team-sided variants (AWAY_SIDE_VARIANT flips the market code to these,
    // not the generic codes above) need the same tak/nie -> YES/NO handling;
    // they fell through to the default case before, leaving raw Polish text
    // as the normalizedName instead of YES/NO (audit-match Arsenal vs
    // Coventry City, round 7).
    case "HALF_TIME_HOME_WIN_TO_NIL":
    case "HALF_TIME_AWAY_WIN_TO_NIL":
    case "SECOND_HALF_HOME_WIN_TO_NIL":
    case "SECOND_HALF_AWAY_WIN_TO_NIL":
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
    case "TIME_PERIOD_HANDICAP":
    case "TIME_PERIOD_ASIAN_HANDICAP":
    case "HALF_TIME_CORNERS_HANDICAP":
    case "CARDS_HANDICAP":
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

    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
    case "HOME_GOAL_RANGE":
    case "AWAY_GOAL_RANGE":
      // Unlike GOAL_RANGE (whose catalog vocabulary includes a literal "0-1"
      // bucket), these four codes only support the 5-way overlapping scheme
      // (0,1-2,1-3,2-3,4+). Fuksiarz's raw "0-1" here combines the catalog's
      // separate "0" and "1-2" codes into a single price and cannot be split
      // without fabricating two derived odds, so drop it instead of leaking
      // an orphan "0-1" column.
      if (/^0\s*-\s*1$/.test(trimmed)) return "UNKNOWN";
      return normalizeRangeSelection(trimmed);

    case "GOAL_RANGE":
    case "SECOND_HALF_TEAM_GOAL_RANGE":
    case "HALF_TIME_TEAM_GOAL_RANGE":
    case "CORNERS_TEAM_RANGE":
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

    case "EXACT_GOALS":
    case "HOME_EXACT_GOALS":
    case "AWAY_EXACT_GOALS":
      // The catalog now carries the full discrete ladder (0..8 for the
      // team-scoped codes, 0..9 for the total-match code) alongside the
      // "6+" bucket for bookmakers that only quote a tail — Fuksiarz quotes
      // discrete 6/7/8(/9) tails, and collapsing them into "6+" fabricated
      // a price (1/(1/21+1/46+1/50)=11.19) the bookmaker never published
      // and described "exactly 6-8" as "6 or more" (audit-match, Arsenal vs
      // Coventry City, round 8 HEG-1). Pass the discrete value through.
      return trimmed as NormalizedSelection;

    case "SECOND_HALF_EXACT_GOALS":
    case "SECOND_HALF_HOME_EXACT_GOALS":
    case "SECOND_HALF_AWAY_EXACT_GOALS":
      // Catalog buckets everything from 2 goals up into "2+".
      if (/^\d+$/.test(trimmed) && parseInt(trimmed, 10) >= 2) return "2+" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "HALF_TIME_AWAY_EXACT_GOALS":
      // Catalog buckets everything from 3 goals up into "3+".
      if (/^\d+$/.test(trimmed) && parseInt(trimmed, 10) >= 3) return "3+" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "HALF_TIME_HOME_EXACT_GOALS":
      // Unlike the away variant, the home catalog code has no separate "3+"
      // tier — "3" itself is the open 3-or-more bucket. Fuksiarz quotes
      // discrete 3/4/5 tails that must collapse (and merge) into it.
      if (/^\d+$/.test(trimmed) && parseInt(trimmed, 10) >= 3) return "3" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "HALF_TIME_HOME_EXACT_CORNERS":
    case "HALF_TIME_AWAY_EXACT_CORNERS": {
      // Catalog tops out at "4+" — Fuksiarz's finer "4"/"5+" tail collapses
      // there (duplicates merged into one combined price afterwards).
      const cornersTail = trimmed.match(/^(\d+)\s*\+?$/);
      if (cornersTail && parseInt(cornersTail[1], 10) >= 4) return "4+" as NormalizedSelection;
      // Fuksiarz is the only bookmaker to split the "0-1" tier into separate
      // "0"/"1" rows — merge both into the shared "0-1" code (duplicates
      // combined into one price afterwards) so it lines up with every peer.
      if (/^[01]$/.test(trimmed)) return "0-1" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "CARDS_EXACT":
      // Catalog groups the low tail into a single "0-3" bucket.
      if (/^\d+$/.test(trimmed) && parseInt(trimmed, 10) <= 3) return "0-3" as NormalizedSelection;
      // Fuksiarz's own ladder tops out at an open "7+" tier (confirmed via
      // raw ground truth, audit-match round 5b) — the catalog carries this
      // as its own code alongside the discrete "7", so pass it through as-is
      // instead of fabricating a probability by merging into "7" or "12+".
      if (trimmed === "7+") return "7+" as NormalizedSelection;
      // No other open-ended tail ("8+"/"9+"/"10+"/"11+") has a matching
      // catalog code (8,9,10,11 are all separate discrete codes) and merging
      // one into a discrete code would fabricate a wrong probability, so
      // drop it instead of leaking the raw "N+" text as an orphan selection.
      if (/^\d+\+$/.test(trimmed) && trimmed !== "12+") return "UNKNOWN";
      return trimmed as NormalizedSelection;

    case "TOTAL_GOALS_AND_BTTS": {
      // "tak i powyżej 2.5" -> OVER_YES, "nie i poniżej 2.5" -> UNDER_NO.
      const parts = splitCombinationSelection(trimmed);
      if (!parts) return trimmed as NormalizedSelection;
      const yesNo = normalizeYesNoSelection(parts[0]);
      const ou = normalizeOverUnderSelection(parts[1]);
      if (yesNo === "UNKNOWN" || ou === "UNKNOWN") return trimmed as NormalizedSelection;
      return `${ou}_${yesNo}` as NormalizedSelection;
    }

    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
    case "HOME_GOALSCORER_FIRST":
    case "AWAY_GOALSCORER_FIRST":
    case "PLAYER_2_OR_MORE_GOALS":
    case "PLAYER_HAT_TRICK":
    case "PLAYER_CARDS":
    case "PLAYER_PASSES":
    case "PLAYER_RED_CARD":
    case "PLAYER_HEADER_GOAL":
    case "PLAYER_GOAL_OUTSIDE_BOX":
    case "PLAYER_GOAL_OR_ASSIST":
    case "PLAYER_GOAL_AND_ASSIST":
    case "PLAYER_GOAL_AND_TEAM_WIN":
      // Catch-all "no scorer" bucket is quoted in English on Fuksiarz — map
      // it to the catalog-wide NONE convention instead of leaking untranslated
      // text into a Polish-facing selection.
      if (/^no\s+goal\s*scorer$/i.test(trimmed)) return "NONE" as NormalizedSelection;
      // Selection is a player name — unify "Lastname, Firstname" to the
      // canonical "Firstname Lastname" order used by other bookmakers.
      return canonicalizeFuksiarzPlayerName(trimmed.replace(/^\d+\.\s*/, "").trim()) as NormalizedSelection;

    case "PLAYER_ASSISTS": {
      // Align with the catalog convention used by peers ("{Player} 1+") —
      // Fuksiarz's "anytime assist" market implies the 1+ line.
      const player = canonicalizeFuksiarzPlayerName(trimmed.replace(/^\d+\.\s*/, "").trim());
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

    let paramValue = extractParamValue(marketCode, raw, ctx);

    // TEAM_TOTAL_SHOTS(_ON_TARGET)'s catalog selections are bare OVER/UNDER
    // (no side variant) — the side lives in the parameter instead, matching
    // the betcris/superbet "HOME:8.5"/"AWAY:2.5" convention. Fuksiarz maps
    // both the home-team and away-team ids (168/169, -30342/-30343) to the
    // same bare catalog code, so without the side-prefixed param a home line
    // and an away line at the same numeric threshold collide into one
    // OVER/UNDER bucket. CORNERS_TEAM has the identical shape: "Arsenal -
    // liczba rzutów rożnych" and "Coventry - liczba rzutów rożnych" both map
    // to bare CORNERS_TEAM, and other bookmakers (betclic, betcris, fortuna,
    // lvbet) already scope this market's param by side.
    if (
      (marketCode === "TEAM_TOTAL_SHOTS" ||
        marketCode === "TEAM_TOTAL_SHOTS_ON_TARGET" ||
        marketCode === "CORNERS_TEAM") &&
      paramValue
    ) {
      const side = resolveTeamSide(raw.name, ctx);
      if (!side) return null;
      paramValue = `${side}:${paramValue}`;
    }

    const marketKey = buildMarketKey(marketCode, paramValue);

    let selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode, ctx, raw.name),
      label: sel.name,
      odds: sel.odds,
    }));

    // Team markets: the catalog codes are side-prefixed
    // (HOME_OVER/AWAY_UNDER, AWAY_2-3, ...) while the raw selections only say
    // "powyżej"/"poniżej" — the side lives in the raw market name. Without a
    // resolved side the odds cannot be attributed to a team, and bare
    // OVER/UNDER codes would collide with the other team's data across
    // bookmakers — drop the market instead.
    if (
      marketCode === "TEAM_TOTAL_GOALS" ||
      marketCode === "HALF_TIME_TEAM_TOTAL_GOALS" ||
      marketCode === "SECOND_HALF_TEAM_TOTAL_GOALS" ||
      marketCode === "HALF_TIME_TEAM_GOAL_RANGE" ||
      marketCode === "SECOND_HALF_TEAM_GOAL_RANGE" ||
      marketCode === "CARDS_TEAM" ||
      marketCode === "HALF_TIME_CORNERS_TEAM" ||
      marketCode === "SECOND_HALF_CORNERS_TEAM" ||
      marketCode === "HALF_TIME_CARDS_TEAM" ||
      marketCode === "SECOND_HALF_CARDS_TEAM"
    ) {
      const side = resolveTeamSide(raw.name, ctx);
      if (!side) return null;
      selections = selections.map((sel) =>
        sel.code === "UNKNOWN"
          ? sel
          : { ...sel, code: `${side}_${sel.code}` as NormalizedSelection }
      );
    }

    // Collapse raw buckets that map to a single catalog selection
    // (e.g. "by 3" + "by 4+" -> HOME_BY_3PLUS, exact goals 3/4/5 -> "3+").
    if (MERGE_DUPLICATE_CODE_MARKETS.has(marketCode)) {
      selections = mergeDuplicateSelectionCodes(selections);
    }

    // Markets whose per-selection normalizer deliberately drops an
    // off-catalog combined bucket (returns "UNKNOWN") must not leak that
    // literal string into the aggregated table — remove it instead.
    if (UNKNOWN_FILTERED_MARKETS.has(marketCode)) {
      selections = selections.filter((sel) => sel.code !== "UNKNOWN");
      if (selections.length === 0) return null;
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
