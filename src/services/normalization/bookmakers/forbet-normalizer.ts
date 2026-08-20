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
  normalize1x2Selection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  parseScoreSelection,
  parseHtFtSelection,
  parseHandicapLine,
  canonicalizePlayerName,
} from "../helpers/index.js";
import { isValidMarketCode, getMarketByCode } from "../../../data/market-catalog.js";

const FORBET_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  1: "MATCH_WINNER",
  4: "DOUBLE_CHANCE",
  11: "DRAW_NO_BET",
  // gameType 12 is forBET's anytime-goalscorer board (49 player selections),
  // not the winning-margin grid (that is id -338). Audit-match: Arsenal vs
  // Coventry City.
  12: "GOALSCORER_ANYTIME",
  98: "BTTS",
  8: "TOTAL_GOALS",
  9: "GOAL_RANGE",
  // forBET gameType 3 is the plain 1st-half 1X2; gameType 5 is HT/FT
  // (1. połowa/mecz). Verified against raw offer ids for Arsenal vs
  // Coventry City.
  5: "HALFTIME_FULLTIME",
  10: "HALF_TIME_TOTAL_GOALS",
  99: "HALF_TIME_BTTS",
  6: "EUROPEAN_HANDICAP",
  7: "ASIAN_HANDICAP",
  2: "CORRECT_SCORE",
  3: "HALF_TIME_RESULT",
  // Audited mappings keyed by raw bookmakerMarketId
  "-31170": "EUROPEAN_HANDICAP",
  "-8132": "HT_OR_FT_RESULT",
  "-2982": "HOME_TEAM_TO_SCORE",
  "-2983": "HOME_TEAM_TO_SCORE",
  "-2976": "TIME_PERIOD_RESULT",
  127: "TEAM_WIN_AT_LEAST_ONE_HALF",
  128: "TEAM_WIN_AT_LEAST_ONE_HALF",
  "-237": "HALF_TIME_DRAW_NO_BET",
  111: "SECOND_HALF_RESULT",
  "-283": "SECOND_HALF_DRAW_NO_BET",
  "-458": "ASIAN_HANDICAP",
  "-6048": "EUROPEAN_HANDICAP",
  "-2557": "FIRST_HALF_EUROPEAN_HANDICAP",
  "-2558": "SECOND_HALF_EUROPEAN_HANDICAP",
  "-2967": "FIRST_TEAM_TO_SCORE",
  "-2972": "HALF_TIME_FIRST_GOAL",
  41: "LAST_TEAM_TO_SCORE",
  "-2904": "HOME_GOAL_RANGE",
  "-2905": "HOME_GOAL_RANGE",
  106: "HOME_SCORE_BOTH_HALVES",
  107: "HOME_SCORE_BOTH_HALVES",
  125: "TEAM_WIN_BOTH_HALVES",
  126: "TEAM_WIN_BOTH_HALVES",
  "-30366": "TEAM_TO_LEAD",
  48: "WIN_TO_NIL",
  "-30367": "TEAM_TO_LEAD",
  130: "HOME_WIN_TO_NIL",
  "-30387": "TEAM_SCORES_TWO_CONSECUTIVE_GOALS",
  "-30388": "TEAM_TWO_GOALS_IN_A_ROW",
  "-8048": "TEAM_WIN_MATCH",
  "-8047": "TEAM_WIN_MATCH",
  "-8049": "ANY_TEAM_TO_WIN",
  87: "OFFSIDES_1X2",
  164: "OFFSIDES_TOTAL",
  165: "HOME_TEAM_TOTAL_OFFSIDES",
  166: "HOME_TEAM_TOTAL_OFFSIDES",
  "-271": "CORNERS_RANGE",
  "-2901": "MULTI_RESULT",
  138: "OWN_GOAL",
  "-8037": "DRAW_OR_OVER_2_5",
  "-30234": "HALF_TIME_SUBSTITUTION",
  38: "HALF_WITH_MORE_GOALS",
  "-239": "TEAM_HALF_WITH_MORE_GOALS",
  "-240": "TEAM_HALF_WITH_MORE_GOALS",
  "-30199": "MOST_SHOTS_ON_TARGET",
  "-30149": "TOTAL_SHOTS_ON_TARGET",
  "-338": "WINNING_MARGIN",
  "-2959": "BOTH_HALVES_OVER_GOALS",
  "-30150": "TEAM_TOTAL_SHOTS_ON_TARGET",
  "-2958": "BOTH_HALVES_UNDER_GOALS",
  "-30151": "TEAM_TOTAL_SHOTS_ON_TARGET",
  "-30417": "TOTAL_XG",
  "-31167": "TOTAL_SHOTS",
  "-31168": "TEAM_TOTAL_SHOTS",
  "-31169": "TEAM_TOTAL_SHOTS",
  "-30200": "FOUL_RACE",
  "-30152": "FOULS_TOTAL",
  "-30229": "TEAM_TOTAL_FOULS",
  "-30230": "TEAM_TOTAL_FOULS",
  "-30402": "GOAL_KICKS_TOTAL",
  "-30401": "SAVES_TOTAL",
  "-30403": "THROW_INS_TOTAL",
  "-2973": "SECOND_HALF_FIRST_GOAL",
  "-2977": "FIRST_GOAL_TIME_ALT",
  "-232": "TEAMS_TO_SCORE",
  "-2957": "FIRST_GOAL_TIME",
  "-2960": "FIRST_GOAL_AND_RESULT",
  "-2545": "HALF_TIME_HOME_CLEAN_SHEET",
  "-2546": "HALF_TIME_HOME_CLEAN_SHEET",
  "-2547": "SECOND_HALF_HOME_CLEAN_SHEET",
  "-2548": "SECOND_HALF_HOME_CLEAN_SHEET",
  "-30704": "PLAYER_GOAL_OR_ASSIST",
  "-2903": "SECOND_HALF_GOAL_RANGE",
  "-30368": "PLAYER_OF_THE_MATCH",
  136: "SUBSTITUTE_GOAL",
  "-30414": "ANY_PLAYER_2_OR_MORE_GOALS",
  "-30411": "HAT_TRICK",
  160: "CORNERS_RACE",
  23: "CORNERS_TOTAL",
  "-30232": "GOAL_IN_FIRST_15_MIN",
  "-30233": "GOAL_IN_FIRST_30MIN",
  "-30373": "GOAL_IN_INTERVAL",
  "-30374": "GOAL_IN_INTERVAL",
  "-30375": "GOAL_IN_INTERVAL",
  "-30376": "GOAL_IN_INTERVAL",
  "-30377": "GOAL_IN_INTERVAL",
  115: "CORNERS_TEAM",
  116: "CORNERS_TEAM",
  "-30391": "GOAL_IN_TIME_PERIOD",
  "-30392": "FIRST_30_MIN_TOTAL_GOALS",
  "-30393": "TEAM_GOALS_BEFORE_MINUTE",
  "-30394": "FIRST_30_MIN_TOTAL_GOALS",
  "-30395": "TOTAL_GOALS_BY_60_MIN",
  "-30396": "TEAM_TOTAL_GOALS_FIRST_60MIN",
  "-30397": "TOTAL_GOALS_BY_60MIN",
  "-30389": "DRAW_IN_AT_LEAST_ONE_HALF",
  // -265/-266 are the home/away pair of the team corners RANGE market
  // ("<team> - liczba rzutów rożnych" with 0-2/3-4/5-6/7+ selections) — same
  // ids and routing as eToto, which shares the feed.
  "-265": "CORNERS_TEAM_RANGE",
  "-266": "CORNERS_TEAM_RANGE",
  // audit-match (Arsenal vs Coventry City): forbet publishes THREE distinct
  // "Liczba goli"-named markets that the generic /liczba\s*goli/i pattern
  // below routed into one shared TOTAL_GOALS/UNKNOWN bucket with an
  // impossible <1 odds value. Explicit ids disambiguate:
  // -227 = exact counts (0/1/2/3/4/5/6+), -225 = disjoint exhaustive bands
  // (0-1/2-3/4-6/7+), -30009 "Multi-gole (liczba goli)" = the cumulative
  // multi-goal ladder (see MULTI_GOAL_RANGE catalog entry).
  "-227": "EXACT_GOALS",
  "-225": "GOAL_RANGE",
  "-30009": "MULTI_GOAL_RANGE",
  105: "HALF_TIME_CORNERS_TOTAL",
  "-2954": "HALF_TIME_CORNERS_HANDICAP",
  "-2975": "CORNERS_HANDICAP",
  "-261": "HALF_TIME_CORNERS_RACE",
  "-180": "HALF_TIME_CORNERS_TEAM",
  171: "CARDS_RACE",
  13: "CARDS_TOTAL",
  "-182": "HALF_TIME_CORNERS_TEAM",
  "-30415": "TWO_PLAYERS_ANYTIME",
  "-30416": "BOTH_PLAYERS_ANYTIME",
  "-114": "SECOND_HALF_CORNERS_RACE",
  132: "CARDS_TEAM",
  108: "SECOND_HALF_CORNERS_TOTAL",
  "-181": "SECOND_HALF_CORNERS_TEAM",
  "-183": "SECOND_HALF_CORNERS_TEAM",
  "-267": "HALF_TIME_HOME_EXACT_CORNERS",
  133: "CARDS_TEAM",
  "-268": "HALF_TIME_HOME_EXACT_CORNERS",
  "-2971": "FIRST_CORNER",
  "-269": "LAST_CORNER",
  "-2953": "HALF_TIME_FIRST_CORNER",
  "-270": "HALF_TIME_LAST_CORNER",
  "-262": "CORNERS_ODD_EVEN",
  "-263": "HALF_TIME_CORNERS_ODD_EVEN",
  "-241": "HOME_EXACT_CARDS",
  "-242": "HOME_EXACT_CARDS",
  "-170": "HALF_TIME_CARDS_RACE",
  134: "HALF_TIME_CARDS_TOTAL",
  "-184": "HALF_TIME_CARDS_TEAM",
  "-244": "HALF_TIME_HOME_EXACT_CARDS",
  "-186": "HALF_TIME_CARDS_TEAM",
  "-243": "HALF_TIME_HOME_EXACT_CARDS",
  15: "PENALTY_AWARDED",
  "-30380": "MISSED_PENALTY",
  22: "RED_CARD",
  "-250": "RED_CARD_TEAM",
  "-251": "RED_CARD_TEAM",
  "-247": "HALF_TIME_RED_CARD",
  137: "RED_CARD_AND_PENALTY",
  "-2955": "FIRST_HALF_FIRST_CARD",
  "-2419": "PLAYER_SHOTS_ON_TARGET",
  "-2418": "PLAYER_SHOTS",
  "-8213": "PLAYER_CARDS",
  "-2412": "PLAYER_ASSISTS",
  // player-goals props; keyed by id because the name regex drops hyphenated
  // surnames (Lewis-Skelly, Thomas-Asante, Mason-Clark). Audit-match:
  // Arsenal vs Coventry City.
  "-2417": "PLAYER_GOALS",
  "-2420": "PLAYER_PASSES",
  "-2422": "PLAYER_TACKLES",
  "-6008": "FIRST_HALF_ASIAN_HANDICAP",
};

const FORBET_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  // ORDER MATTERS: the list is evaluated top-down and the generic full-match
  // patterns below ("obie … strzelą", "liczba goli") also match half-scoped
  // names. Every half-scoped rule therefore has to come FIRST — otherwise
  // "2. połowa - obie drużyny strzelą gola" lands in full-match BTTS
  // (observed right after the "Wydarzy się min. jedno z" fix freed that slot).
  { pattern: /^2\.?\s*po[lł]owa\s*-\s*obie/i, code: "SECOND_HALF_BTTS" },
  { pattern: /^1\.?\s*po[lł]owa\s*-\s*obie/i, code: "HALF_TIME_BTTS" },
  { pattern: /^2\.?\s*po[lł]owa\s*-\s*1x2$/i, code: "SECOND_HALF_RESULT" },
  { pattern: /^1\.?\s*po[lł]owa\s*-\s*1x2$/i, code: "HALF_TIME_RESULT" },
  { pattern: /wynik\s*1\.?\s*po[lł]owy/i, code: "HALF_TIME_RESULT" },
  { pattern: /^2\.?\s*po[lł]owa.*(poni[zż]ej|powy[zż]ej).*gol/i, code: "SECOND_HALF_TOTAL_GOALS" },
  { pattern: /^1\.?\s*po[lł]owa.*(poni[zż]ej|powy[zż]ej).*gol/i, code: "HALF_TIME_TOTAL_GOALS" },

  { pattern: /^1x2$/i, code: "MATCH_WINNER" },
  { pattern: /wynik\s*meczu/i, code: "MATCH_WINNER" },
  { pattern: /podw[oó]jna\s*szansa/i, code: "DOUBLE_CHANCE" },
  { pattern: /remis\s*=?\s*zwrot/i, code: "DRAW_NO_BET" },
  { pattern: /draw\s*no\s*bet/i, code: "DRAW_NO_BET" },
  { pattern: /obie.*strzel[aą]/i, code: "BTTS" },
  { pattern: /poni[zż]ej.*powy[zż]ej.*gol/i, code: "TOTAL_GOALS" },
  { pattern: /liczba\s*goli/i, code: "TOTAL_GOALS" },
  { pattern: /over.*under/i, code: "TOTAL_GOALS" },
  { pattern: /1\.?\s*po[lł]owa.*1x2/i, code: "HALF_TIME_RESULT" },
  { pattern: /1\.?\s*po[lł]owa.*gol/i, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /1\.?\s*po[lł]owa.*obie/i, code: "HALF_TIME_BTTS" },
  { pattern: /handicap\s*europejski/i, code: "EUROPEAN_HANDICAP" },
  { pattern: /handicap\s*azjatycki/i, code: "ASIAN_HANDICAP" },
  { pattern: /european\s*handicap/i, code: "EUROPEAN_HANDICAP" },
  { pattern: /asian\s*handicap/i, code: "ASIAN_HANDICAP" },
  { pattern: /dok[lł]adny\s*wynik/i, code: "CORRECT_SCORE" },
  { pattern: /correct\s*score/i, code: "CORRECT_SCORE" },
  { pattern: /po[lł]owa.*koniec/i, code: "HALFTIME_FULLTIME" },
  { pattern: /ht.*ft/i, code: "HALFTIME_FULLTIME" },
];

const FORBET_SELECTION_OVERRIDES: Record<string, NormalizedSelection> = {
  "tak": "YES",
  "nie": "NO",
  "1x": "HOME_OR_DRAW",
  "1/x": "HOME_OR_DRAW",
  "x2": "DRAW_OR_AWAY",
  "x/2": "DRAW_OR_AWAY",
  "12": "HOME_OR_AWAY",
  "1/2": "HOME_OR_AWAY",
};

/**
 * Markets whose raw selection labels collide with the generic overrides
 * (e.g. "1/X" means a HT/FT combination, not double chance) or must be
 * resolved from the raw market name (player pairs). For these the
 * market-specific handling runs instead of the override table.
 */
const OVERRIDE_EXEMPT_MARKETS = new Set<NormalizedMarketType>([
  "HALFTIME_FULLTIME",
  "DOUBLE_RESULT",
  "BOTH_PLAYERS_ANYTIME",
  "TWO_PLAYERS_ANYTIME",
  "THREE_PLAYERS_ANYTIME",
]);

/**
 * Normalizes a forBET market/selection name for pattern matching:
 * lowercase, diacritics stripped (incl. ł→l which NFD does not decompose),
 * en/em dashes unified to "-", whitespace collapsed.
 */
function normalizeForbetName(value: string): string {
  return value
    .replace(/Ł/g, "L")
    .replace(/ł/g, "l")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolves a team-name candidate to HOME/AWAY using the canonical team matcher.
 */
function resolveTeamSide(
  candidate: string,
  ctx: NormalizationContext
): "HOME" | "AWAY" | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  const side = normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  return side === "HOME" || side === "AWAY" ? side : null;
}

/**
 * Detects which team a team-scoped raw market name refers to, e.g.
 * "Austria wygra do zera", "Wyspy Zielonego Przylądka multi-gole",
 * "Austria - liczba kartek w 1 połowie", "2. połowa - Austria czyste konto".
 */
function detectTeamSide(
  rawName: string,
  ctx: NormalizationContext
): "HOME" | "AWAY" | null {
  let name = normalizeForbetName(rawName);
  // Strip a leading half prefix ("1. połowa - ", "2. połowa - ")
  name = name.replace(/^[12]\.?\s*polowa\s*-\s*/, "");
  const candidate = name
    // Cut at a colon separator ("Argentyna: Liczba bramek do 30 minuty…")
    .replace(/\s*:\s*.*$/, "")
    // Cut at a spaced dash separator ("Austria - liczba kartek…")
    .replace(/\s+-\s+.*$/, "")
    // Cut at the first market keyword ("Austria wygra do zera", "… multi-gole")
    .replace(
      /\s+(wygra|strzeli|multi-gole|ponizej|powyzej|bedzie|otrzyma|czyste|zdobedzie|liczba)\b.*$/,
      ""
    )
    .trim();
  return resolveTeamSide(candidate, ctx);
}

/**
 * forBET quotes team-scoped markets separately per team but the id map only
 * points at the HOME_* (or generic) catalog code. When the raw name clearly
 * names one of the teams, reroute to the correct home/away catalog variant.
 */
/**
 * Codes whose catalog entry is parameterised by team but carries no numeric
 * line — the resolved side becomes the paramValue.
 */
const FORBET_TEAM_PARAM_MARKETS = new Set<NormalizedMarketType>([
  "TEAM_HALF_WITH_MORE_GOALS",
  "TEAM_WIN_MATCH",
  "WIN_OR_BTTS",
  "TEAM_WIN_OR_CLEAN_SHEET",
  // CORNERS_TEAM_RANGE is parameterized by team (param HOME/AWAY, catalog
  // validParameters) rather than split into separate HOME_/AWAY_ codes — same
  // shape as TEAM_HALF_WITH_MORE_GOALS above. Audit /audit-match,
  // premier-league Arsenal vs Coventry City: ids -265 (home) / -266 (away)
  // both mapped straight to CORNERS_TEAM_RANGE with no paramValue, so the
  // resulting unparameterized key never matched the catalog's HOME/AWAY
  // parameter buckets and forbet's whole ladder (incl. the market-best 0-2
  // price) silently dropped out of the aggregated market entirely.
  "CORNERS_TEAM_RANGE",
]);

const FORBET_TEAM_SIDED_VARIANTS: Partial<
  Record<NormalizedMarketType, { home: NormalizedMarketType; away: NormalizedMarketType }>
> = {
  HOME_TEAM_TO_SCORE: { home: "HOME_TEAM_TO_SCORE", away: "AWAY_TEAM_TO_SCORE" },
  HOME_GOAL_RANGE: { home: "HOME_GOAL_RANGE", away: "AWAY_GOAL_RANGE" },
  HOME_SCORE_BOTH_HALVES: { home: "HOME_SCORE_BOTH_HALVES", away: "AWAY_SCORE_BOTH_HALVES" },
  HOME_WIN_TO_NIL: { home: "HOME_WIN_TO_NIL", away: "AWAY_WIN_TO_NIL" },
  WIN_TO_NIL: { home: "HOME_WIN_TO_NIL", away: "AWAY_WIN_TO_NIL" },
  TEAM_WIN_BOTH_HALVES: { home: "HOME_WIN_BOTH_HALVES", away: "AWAY_WIN_BOTH_HALVES" },
  TEAM_WIN_AT_LEAST_ONE_HALF: {
    home: "HOME_WIN_AT_LEAST_ONE_HALF",
    away: "AWAY_WIN_AT_LEAST_ONE_HALF",
  },
  // NOTE: TEAM_HALF_WITH_MORE_GOALS is NOT rerouted per side — the catalog code
  // is parameterized by team (param HOME/AWAY) with side-prefixed selections
  // (HOME_1ST, …), which is where peer bookmakers (betclic) aggregate.
  HALF_TIME_HOME_EXACT_CARDS: {
    home: "HALF_TIME_HOME_EXACT_CARDS",
    away: "HALF_TIME_AWAY_EXACT_CARDS",
  },
  HOME_EXACT_CARDS: { home: "HOME_EXACT_CARDS", away: "AWAY_EXACT_CARDS" },
  HALF_TIME_HOME_EXACT_CORNERS: {
    home: "HALF_TIME_HOME_EXACT_CORNERS",
    away: "HALF_TIME_AWAY_EXACT_CORNERS",
  },
  HALF_TIME_HOME_CLEAN_SHEET: {
    home: "HALF_TIME_HOME_CLEAN_SHEET",
    away: "HALF_TIME_AWAY_CLEAN_SHEET",
  },
  SECOND_HALF_HOME_CLEAN_SHEET: {
    home: "SECOND_HALF_HOME_CLEAN_SHEET",
    away: "SECOND_HALF_AWAY_CLEAN_SHEET",
  },
  HOME_TEAM_TOTAL_OFFSIDES: {
    home: "HOME_TEAM_TOTAL_OFFSIDES",
    away: "AWAY_TEAM_TOTAL_OFFSIDES",
  },
  TEAM_TOTAL_FOULS: {
    home: "HOME_TEAM_TOTAL_FOULS",
    away: "AWAY_TEAM_TOTAL_FOULS",
  },
};

/**
 * Specific raw-name rules that must win over the coarse game-type id map and
 * the generic name patterns: forBET reuses generic game-type ids for combo
 * and special markets (e.g. gameType 5 carries "1. połowa/mecz" = HT/FT).
 */
function resolveForbetSpecialMarket(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const name = normalizeForbetName(raw.name);

  // "Wydarzy się min. jedno z: <A> lub <B>" is an ALTERNATIVE bet — it wins if
  // either leg happens — not the plain market whose wording it borrows. Ground
  // truth (/audit-match, premier-league Arsenal vs Coventry City, 2026-08-19)
  // showed "…: remis w meczu lub obie drużyny strzelą gola" (2.09 / 1.61)
  // matching the generic /obie.*strzelą/ pattern and taking over BTTS, which
  // pushed forBET's real "Obie drużyny strzelą gola" market out of the offer.
  // Only variants with a dedicated catalog code (e.g. -8037 → DRAW_OR_OVER_2_5)
  // keep one; the rest must stay out of the canonical markets they name.
  if (/^wydarzy sie min\.? jedno z/.test(name)) {
    return FORBET_MARKET_ID_TO_CODE[Number(raw.bookmakerMarketId)] ?? "OTHER";
  }

  // Half-scoped exact goal count ("2. połowa - liczba goli", id -234) shares
  // its bare "<prefix> - liczba goli" wording with the team-scoped exact-goal
  // market below, whose fallback treats any non-team prefix as OTHER — so
  // without this guard "2. połowa" gets misread as an unresolvable team name
  // and the whole market is dropped into OTHER (audit /audit-match,
  // premier-league Arsenal vs Coventry City: forbet's "2. połowa - liczba
  // goli" 0/1/2+ landed in OTHER instead of merging with the SECOND_HALF_
  // EXACT_GOALS peers already contributed by betfan/etoto/fuksiarz/lvbet/
  // pzbuk/sts, whose implied-probability sums bracket forbet's own 1.119).
  // Must be checked before the team-scoped branch below.
  if (
    /^2\.?\s*polowa\s*-\s*liczba goli$/.test(name) &&
    raw.selections.every((sel) => /^\d+\+?$/.test(sel.name.trim()))
  ) {
    return "SECOND_HALF_EXACT_GOALS";
  }

  // The 1st-half twin of the rule above was missed when it was added -
  // forbet's "1. połowa - liczba goli" (0/1/2/3+) kept falling through the
  // team-scoped branch into OTHER, where it rendered inside the fused
  // "Inne" catch-all card instead of the HALF_TIME_EXACT_GOALS comparison
  // row (market-display audit, Arsenal vs Coventry City).
  if (
    /^1\.?\s*polowa\s*-\s*liczba goli$/.test(name) &&
    raw.selections.every((sel) => /^\d+\+?$/.test(sel.name.trim()))
  ) {
    return "HALF_TIME_EXACT_GOALS";
  }

  // "<Team> - liczba goli" carries EXACT goal counts (0 / 1 / 2 / 3+), not an
  // over/under ladder — audit /audit-match found both forbet variants landing
  // in the match-wide TOTAL_GOALS with every selection UNKNOWN.
  const teamExact = name.match(/^(.+?)\s+-\s+liczba goli$/);
  if (teamExact && raw.selections.some((sel) => /^\s*\d+\+?\s*$/.test(sel.name))) {
    const side = resolveTeamSide(teamExact[1], ctx);
    if (side === "HOME") return "HOME_EXACT_GOALS";
    if (side === "AWAY") return "AWAY_EXACT_GOALS";
    return "OTHER";
  }

  // Odd/even total-goals market ("Parzysta/nieparzysta - liczba goli") shares
  // the generic O/U game type (8) but its selections are "Parzyste" /
  // "Nieparzyste", not over/under thresholds — route to the dedicated
  // odd/even catalog code instead of leaving them UNKNOWN under TOTAL_GOALS.
  // Guarded to goal-worded names only so it never hijacks the corner/card
  // odd/even markets, which already route correctly via bookmakerMarketId
  // (-262/-263) and use the same "Parzyste"/"Nieparzyste" wording.
  if (
    raw.selections.some((sel) => /parzyst/i.test(sel.name)) &&
    /gol/.test(name) &&
    !/rzut|rozn|kartek/.test(name)
  ) {
    if (/^1\.?\s*polowa/.test(name)) return "HALF_TIME_ODD_EVEN_GOALS";
    if (/^2\.?\s*polowa/.test(name)) return "SECOND_HALF_ODD_EVEN_GOALS";
    const side = detectTeamSide(raw.name, ctx);
    if (side === "HOME") return "HOME_TEAM_ODD_EVEN_GOALS";
    if (side === "AWAY") return "AWAY_TEAM_ODD_EVEN_GOALS";
    return "ODD_EVEN_GOALS";
  }

  // Player goals special quoted as a generic goals market:
  // "Wanner, Paul - liczba goli (…)", "Richard - liczba goli (…)".
  // The prefix must not be a team name (guards hypothetical team totals) and
  // cannot start with a digit (guards half-scoped names like "1. połowa - …").
  const playerGoals = name.match(/^(.+?)\s*-\s*liczba goli\s*\(/);
  if (playerGoals && !resolveTeamSide(playerGoals[1], ctx)) return "PLAYER_GOALS";

  // "1. połowa/mecz" is the HT/FT market, not the plain 1st-half 1X2
  if (/^1\.?\s*polowa\s*\/\s*mecz$/.test(name)) return "HALFTIME_FULLTIME";

  // "1. połowa dokładny wynik / dokładny wynik końcowy" → HT/FT correct score
  if (/polowa dokladny wynik\s*\/\s*dokladny wynik/.test(name)) {
    return "HT_FT_CORRECT_SCORE";
  }

  // Half-scoped correct score ("2. połowa - dokładny wynik") reuses the
  // generic correct-score game type and must not land in full-match grid.
  const halfScore = name.match(/^([12])\.?\s*polowa\s*-\s*dokladny wynik$/);
  if (halfScore) {
    return halfScore[1] === "1" ? "HALF_TIME_CORRECT_SCORE" : "SECOND_HALF_CORRECT_SCORE";
  }

  // Half-scoped double chance ("2. połowa - podwójna szansa")
  const halfDc = name.match(/^([12])\.?\s*polowa\s*-\s*podwojna szansa$/);
  if (halfDc) {
    return halfDc[1] === "1" ? "HALF_TIME_DOUBLE_CHANCE" : "SECOND_HALF_DOUBLE_CHANCE";
  }

  // BTTS × totals combo ("Obie drużyny strzelą i poniżej/powyżej 2.5 goli")
  // is a 4-outcome market, not plain BTTS.
  if (/^obie druzyny strzela i (ponizej|powyzej)/.test(name)) {
    return "TOTAL_GOALS_AND_BTTS";
  }

  // Full-match cumulative multi-goal ladder ("Multi-gole (liczba goli)")
  // quotes overlapping range selections ("Brak goli", "1-2", "2-6"), not
  // O/U — keep out of TOTAL_GOALS. This is the same ladder family as
  // MULTI_GOAL_RANGE (see catalog entry), not the disjoint-band GOAL_RANGE
  // (audit-match: Arsenal vs Coventry City — the two families collide when
  // a bookmaker quotes both, id -30009 vs id -225).
  if (/^multi-gole/.test(name)) return "MULTI_GOAL_RANGE";

  // Double chance + BTTS combos ("2. Połowa - Podwójna szansa + obie drużyny strzelą")
  if (/^2\.?\s*polowa.*podwojna szansa.*obie druzyny strzela/.test(name)) {
    return "SECOND_HALF_DOUBLE_CHANCE_BTTS";
  }
  if (/^1\.?\s*polowa.*podwojna szansa.*obie druzyny strzela/.test(name)) {
    return "HALF_TIME_DOUBLE_CHANCE_BTTS";
  }
  if (/podwojna szansa.*obie druzyny strzela/.test(name)) return "DOUBLE_CHANCE_BTTS";

  // Double chance + totals combo ("Podwójna szansa i poniżej/powyżej 4.5 goli")
  // — a 6-way combo market, not plain double chance.
  if (/^podwojna szansa i (ponizej|powyzej)/.test(name)) return "DOUBLE_CHANCE_TOTAL";

  // Half-combination BTTS ("1./2.Połowa - Obie drużyny strzelą gola") is the
  // 4-outcome BTTS-by-half market (tak/tak, tak/nie, …), not full-match BTTS.
  if (/^1\.\s*\/\s*2\.?\s*polowa\s*-?\s*obie druzyny strzela/.test(name)) {
    return "BTTS_BY_HALF";
  }

  // 1X2 + BTTS combos ("2. Połowa – 1X2 + obie drużyny strzelą gola")
  if (/^2\.?\s*polowa.*1x2.*obie druzyny strzela/.test(name)) {
    return "SECOND_HALF_RESULT_AND_BTTS";
  }
  if (/^1\.?\s*polowa.*1x2.*obie druzyny strzela/.test(name)) {
    return "HALF_TIME_RESULT_AND_BTTS";
  }
  if (/^1x2.*obie druzyny strzela/.test(name)) return "RESULT_AND_BTTS";

  // 1X2 + totals combos ("2. Połowa – 1X2 + liczba goli", "1X2 i poniżej/powyżej 2.5 goli")
  if (/^2\.?\s*polowa.*1x2.*liczba goli/.test(name)) return "SECOND_HALF_RESULT_AND_TOTAL";
  if (/^1\.?\s*polowa.*1x2.*liczba goli/.test(name)) return "HALF_TIME_RESULT_AND_TOTAL";
  if (/^1x2 i (ponizej|powyzej)/.test(name)) return "RESULT_AND_TOTAL";

  // Half goal-range markets ("1. Połowa - multi-gole" has range selections, not O/U)
  if (/^1\.?\s*polowa\s*-\s*multi-gole$/.test(name)) return "HALF_TIME_GOAL_RANGE";
  if (/^2\.?\s*polowa\s*-\s*multi-gole$/.test(name)) return "SECOND_HALF_GOAL_RANGE";

  // Team-less half totals ("2. połowa - poniżej/powyżej 1.5 goli") reuse the
  // generic O/U game type (8) and must not land in full-match TOTAL_GOALS.
  // forBET quotes corners/cards half totals with the same prefix — route by
  // the counted subject so corner/card lines never poison the goals sliders.
  const halfTotal = name.match(/^([12])\.?\s*polowa\s*-?\s*ponizej\/powyzej\s*[\d.,]*\s*(.*)$/);
  if (halfTotal) {
    const firstHalf = halfTotal[1] === "1";
    const subject = halfTotal[2];
    if (/rzutow roznych/.test(subject)) {
      return firstHalf ? "HALF_TIME_CORNERS_TOTAL" : "SECOND_HALF_CORNERS_TOTAL";
    }
    if (/kartek/.test(subject)) {
      return firstHalf ? "HALF_TIME_CARDS_TOTAL" : "SECOND_HALF_CARDS_TOTAL";
    }
    return firstHalf ? "HALF_TIME_TOTAL_GOALS" : "SECOND_HALF_TOTAL_GOALS";
  }

  // Goals-by-minute family ("Liczba bramek do 30/60 minuty meczu", optionally
  // team-scoped: "Kolumbia: Liczba bramek do 60 minuty meczu"). Team-scoped
  // variants must never leak into the whole-match by-minute buckets.
  const byMinute = name.match(/^(?:(.+?)\s*:\s*)?liczba bramek do (\d+) minuty/);
  if (byMinute) {
    const minute = byMinute[2];
    if (byMinute[1] !== undefined) {
      const side = resolveTeamSide(byMinute[1], ctx);
      // Unresolvable team prefix — keep it out of the match-level buckets
      if (!side) return "OTHER";
      if (minute === "60") return "TEAM_TOTAL_GOALS_FIRST_60MIN";
      // TEAM_GOALS_BEFORE_MINUTE has plain OVER/UNDER selections, so it can
      // only carry one side; away-team windows have no catalog code yet.
      return side === "HOME" ? "TEAM_GOALS_BEFORE_MINUTE" : "OTHER";
    }
    if (minute === "60") return "TOTAL_GOALS_BY_60_MIN";
    if (minute === "30") return "FIRST_30_MIN_TOTAL_GOALS";
    return "OTHER";
  }

  // Per-team half totals ("2. połowa - Austria poniżej/powyżej 0.5 goli")
  const halfTeamTotal = name.match(/^([12])\.?\s*polowa\s*-\s*(.+?)\s+ponizej\/powyzej/);
  if (halfTeamTotal) {
    const side = resolveTeamSide(halfTeamTotal[2], ctx);
    if (side) {
      if (halfTeamTotal[1] === "1") {
        return side === "HOME"
          ? "HALF_TIME_HOME_TEAM_TOTAL_GOALS"
          : "HALF_TIME_AWAY_TEAM_TOTAL_GOALS";
      }
      return side === "HOME"
        ? "SECOND_HALF_HOME_TEAM_TOTAL_GOALS"
        : "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS";
    }
    // Team not resolvable — keep it out of the full-match TOTAL_GOALS bucket
    return "OTHER";
  }

  // Full-match per-team totals ("Kolumbia poniżej/powyżej 0.5 goli") also use
  // the generic O/U game type (8) — they are TEAM totals, not match totals.
  const teamTotal = name.match(/^(.+?)\s+ponizej\/powyzej\s*[\d.,]+\s*goli/);
  if (teamTotal) {
    const side = resolveTeamSide(teamTotal[1], ctx);
    // Audit /audit-match (Arsenal vs Coventry City): nine bookmakers put this
    // bet in HOME_/AWAY_TEAM_TOTAL_GOALS while forBET and fuksiarz used the
    // side-prefixed TEAM_TOTAL_GOALS — two parallel codes for one bet, so the
    // team totals were never actually compared across bookmakers. Converge on
    // the majority code.
    if (side === "HOME") return "HOME_TEAM_TOTAL_GOALS";
    if (side === "AWAY") return "AWAY_TEAM_TOTAL_GOALS";
    // Unresolvable prefix — do not let it fall into the match TOTAL_GOALS
    return "OTHER";
  }

  return null;
}

/**
 * Parses a HT/FT selection into catalog codes ("HOME_DRAW", …).
 * Handles both symbol form ("1/X") and team-name form ("Austria / Algieria").
 */
function parseHtFtToCodes(
  selectionName: string,
  ctx: NormalizationContext
): string | null {
  // The shared helper already returns catalog codes ("HOME_DRAW", ...).
  const basic = parseHtFtSelection(selectionName);
  if (basic) return basic;

  const parts = selectionName.split("/").map((part) => part.trim());
  if (parts.length !== 2) return null;

  const ht = normalize1x2Selection(parts[0], ctx.homeTeam, ctx.awayTeam, ctx.league);
  const ft = normalize1x2Selection(parts[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
  if (ht === "UNKNOWN" || ft === "UNKNOWN") return null;
  return `${ht}_${ft}`;
}

/** Formats one leg of an HT/FT correct-score selection ("0-0" → "0:0", "4 +" → "4+"). */
function formatHtFtScorePart(part: string): string {
  const score = part.match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (score) return `${score[1]}:${score[2]}`;
  const plus = part.match(/^(\d+)\s*\+$/);
  if (plus) return `${plus[1]}+`;
  return part;
}

/** Known player surnames whose canonical diacritic forBET drops in plain text. */
const FORBET_PLAYER_SURNAME_FIXUPS: Record<string, string> = {
  mbappe: "Mbappé",
};

function fixForbetPlayerDiacritics(canonicalName: string): string {
  const parts = canonicalName.split(" ");
  const lastIndex = parts.length - 1;
  const surname = parts[lastIndex];
  if (!surname) return canonicalName;
  const fixed = FORBET_PLAYER_SURNAME_FIXUPS[surname.toLowerCase()];
  if (!fixed) return canonicalName;
  parts[lastIndex] = fixed;
  return parts.join(" ");
}

/**
 * forBET's combo market names carry the given name pre-abbreviated, but not
 * always down to a single letter ("Lau. Martinez", "Gab. Jesus") — while the
 * network convention other bookmakers converge on (betclic's raw feed, our
 * own canonicalizePlayerName-based pipeline) is always a single-letter
 * initial ("L. Martinez"). Left alone, "Lau. Martinez & R. De Paul" never
 * merges with betclic's "G. Jesus & V. Gyokeres"-style pairs even when both
 * name the exact same two players. Collapse a multi-letter abbreviation
 * ("Lau.") down to its first letter; a name that is already a single-letter
 * initial ("R.") is left untouched, so this is a no-op for the common case.
 */
function compressComboInitial(name: string): string {
  const parts = name.split(" ");
  if (parts.length < 2) return name;
  const first = parts[0];
  if (/^\p{L}{2,}\.$/u.test(first)) {
    parts[0] = `${first.charAt(0)}.`;
  }
  return parts.join(" ");
}

/**
 * Builds a stable selection code for player-combination markets ("A & B",
 * "A / B / C") so the same pair/trio merges across bookmakers regardless of
 * forBET's listing order or separator ("&" vs "/") — mirrors betclic's
 * normalizePlayerComboSelection (sort + diacritic fixup + fixed "&" join).
 */
function normalizeForbetPlayerCombo(raw: string): string {
  const sep = raw.includes("&") ? "&" : "/";
  const names = raw
    .split(sep)
    .map((part) => compressComboInitial(fixForbetPlayerDiacritics(canonicalizePlayerName(part))))
    .filter(Boolean);
  if (names.length < 2) {
    return compressComboInitial(fixForbetPlayerDiacritics(canonicalizePlayerName(raw)));
  }
  return names.sort((a, b) => a.localeCompare(b, "en")).join(" & ");
}

/**
 * Merges selections that normalized to the same catalog code (e.g. a hidden
 * "3"/"4+" split both clamped to "3+"). The combined price sums the implied
 * probabilities: 1 / (1/o1 + 1/o2), matching the fuksiarz-normalizer pattern.
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

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext,
  rawMarketName?: string
): NormalizedSelection {
  const trimmed = selName.trim();

  // Literal catalog-code passthrough: band/range/exact markets often quote
  // raw selection text that IS the catalog selection code ("0-2", "7+", "1+"),
  // and per-market cases below may miss them (falling through to UNKNOWN).
  const literalCatalogCodes = getMarketByCode(marketCode)?.selections;
  if (literalCatalogCodes && literalCatalogCodes.length > 0 && literalCatalogCodes.includes(trimmed)) {
    return trimmed as NormalizedSelection;
  }
  const lower = trimmed.toLowerCase();
  const normalized = normalizeForbetName(trimmed);

  // Player-pair/trio markets come in two shapes:
  // 1. One concrete pair in the raw market name ("R. De Paul & Lau. Martínez:
  //    obaj wymienieni zawodnicy strzelą…") with tak/nie selections.
  // 2. A generic market name with each selection listing the players
  //    ("L. Diaz & Luis Suárez", "B. Embolo / L. Diaz / Luis Suárez").
  // Expose the player list as the selection code so distinct pairs/trios in
  // one raw market never collide (a bare YES/UNKNOWN would merge them).
  if (
    marketCode === "BOTH_PLAYERS_ANYTIME" ||
    marketCode === "TWO_PLAYERS_ANYTIME" ||
    marketCode === "THREE_PLAYERS_ANYTIME"
  ) {
    const colonIdx = rawMarketName ? rawMarketName.indexOf(":") : -1;
    if (rawMarketName && colonIdx > 0) {
      const pair = rawMarketName.slice(0, colonIdx).trim();
      if (pair && normalizeYesNoSelection(trimmed) !== "NO") {
        return normalizeForbetPlayerCombo(pair) as NormalizedSelection;
      }
      return normalizeYesNoSelection(trimmed);
    }
    const yn = normalizeYesNoSelection(trimmed);
    if (yn !== "UNKNOWN") return yn;
    if (trimmed.includes("&") || trimmed.includes("/")) {
      return normalizeForbetPlayerCombo(trimmed) as NormalizedSelection;
    }
    return trimmed as NormalizedSelection;
  }

  if (!OVERRIDE_EXEMPT_MARKETS.has(marketCode)) {
    const override = FORBET_SELECTION_OVERRIDES[lower];
    if (override) return override;
  }

  if (/^1\s*\([+-]/.test(trimmed)) return "HOME";
  if (/^2\s*\([+-]/.test(trimmed)) return "AWAY";
  if (/^x\s*\(/i.test(trimmed)) return "DRAW";

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "WIN_TO_NIL":
    case "CLEAN_SHEET":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    // 1X2-style markets with a "no goal/corner/card" outcome ("brak" → NONE)
    case "FIRST_TEAM_TO_SCORE":
    case "LAST_TEAM_TO_SCORE":
    case "SECOND_HALF_FIRST_GOAL":
    case "HALF_TIME_FIRST_GOAL":
    case "FIRST_CORNER":
    case "LAST_CORNER":
    case "HALF_TIME_FIRST_CORNER":
    case "HALF_TIME_LAST_CORNER":
    case "FIRST_HALF_FIRST_CARD":
      if (/^(brak|bez gola|zaden|zadna)/.test(normalized)) return "NONE";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    // Race markets ("Więcej rzutów rożnych") quote the tie as "równo"
    case "CORNERS_RACE":
    case "HALF_TIME_CORNERS_RACE":
    case "SECOND_HALF_CORNERS_RACE":
    case "CARDS_RACE":
    case "HALF_TIME_CARDS_RACE":
    case "FOUL_RACE":
    case "MOST_SHOTS_ON_TARGET":
      if (/^(rowno|remis|x)$/.test(normalized)) return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "CORNERS_ODD_EVEN":
    case "HALF_TIME_CORNERS_ODD_EVEN":
    case "ODD_EVEN_GOALS":
    case "HALF_TIME_ODD_EVEN_GOALS":
    case "SECOND_HALF_ODD_EVEN_GOALS":
    case "HOME_TEAM_ODD_EVEN_GOALS":
    case "AWAY_TEAM_ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "DOUBLE_CHANCE":
    case "HALF_TIME_DOUBLE_CHANCE":
    case "SECOND_HALF_DOUBLE_CHANCE": {
      const dc = normalizeDoubleChanceSelection(trimmed);
      if (dc !== "UNKNOWN") return dc;
      // Team-name form ("Szwajcaria/X", "Szwajcaria/Kolumbia", "X/Kolumbia")
      const legs = trimmed.split("/").map((part) => part.trim());
      if (legs.length === 2) {
        const sides = legs.map((leg) =>
          /^(x|remis)$/i.test(leg)
            ? "DRAW"
            : normalize1x2Selection(leg, ctx.homeTeam, ctx.awayTeam, ctx.league)
        );
        const set = new Set(sides);
        if (set.has("HOME") && set.has("DRAW")) return "HOME_OR_DRAW";
        if (set.has("DRAW") && set.has("AWAY")) return "DRAW_OR_AWAY";
        if (set.has("HOME") && set.has("AWAY")) return "HOME_OR_AWAY";
      }
      return "UNKNOWN";
    }

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "HOME_TEAM_TOTAL_GOALS":
    case "AWAY_TEAM_TOTAL_GOALS":
    case "HALF_TIME_HOME_TEAM_TOTAL_GOALS":
    case "HALF_TIME_AWAY_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_HOME_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS":
    case "FIRST_30_MIN_TOTAL_GOALS":
    case "TOTAL_GOALS_BY_60_MIN":
    case "TOTAL_GOALS_BY_60MIN":
    case "TEAM_GOALS_BEFORE_MINUTE":
    case "CORNERS_TOTAL":
    case "CARDS_TOTAL":
    // CORNERS_TEAM's catalog selections are plain OVER/UNDER (no side
    // prefix, unlike CARDS_TEAM) — matches etoto, which shares this feed
    // and the same 115/116 game-type ids.
    case "CORNERS_TEAM":
    case "HALF_TIME_CORNERS_TOTAL":
    case "SECOND_HALF_CORNERS_TOTAL":
    case "HALF_TIME_CARDS_TOTAL":
    case "SECOND_HALF_CARDS_TOTAL":
    case "TOTAL_SHOTS":
    case "TOTAL_SHOTS_ON_TARGET":
    case "TEAM_TOTAL_SHOTS":
    case "TEAM_TOTAL_SHOTS_ON_TARGET":
    case "FOULS_TOTAL":
    case "HOME_TEAM_TOTAL_FOULS":
    case "AWAY_TEAM_TOTAL_FOULS":
    case "OFFSIDES_TOTAL":
    case "HOME_TEAM_TOTAL_OFFSIDES":
    case "AWAY_TEAM_TOTAL_OFFSIDES":
    case "GOAL_KICKS_TOTAL":
    case "SAVES_TOTAL":
    case "THROW_INS_TOTAL":
    case "TOTAL_XG":
      return normalizeOverUnderSelection(trimmed);

    // Side-prefixed team totals ("Poniżej 0.5" → HOME_UNDER/AWAY_UNDER
    // depending on which team the raw market name is scoped to)
    case "TEAM_TOTAL_GOALS":
    case "CARDS_TEAM":
    case "HALF_TIME_CARDS_TEAM":
    case "HALF_TIME_CORNERS_TEAM":
    case "SECOND_HALF_CORNERS_TEAM":
    case "TEAM_TOTAL_GOALS_FIRST_60MIN": {
      const ou = normalizeOverUnderSelection(trimmed);
      if (ou === "UNKNOWN") return ou;
      const side = rawMarketName ? detectTeamSide(rawMarketName, ctx) : null;
      return side ? (`${side}_${ou}` as NormalizedSelection) : ou;
    }

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
      return normalizeYesNoSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "CORNERS_HANDICAP":
    case "HALF_TIME_CORNERS_HANDICAP":
    case "FIRST_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_EUROPEAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP": {
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed)) return "DRAW";
      // Strip trailing "(0:2)" / "(+0.5)" / bare "+0.5" suffix before team
      // matching, e.g. "Algieria (0:2)" / "Szwajcaria +0.5" → team name
      const teamPart = trimmed
        .replace(/\s*\([^)]*\)\s*$/, "")
        .replace(/\s*[+-]\d+(?:[.,]\d+)?\s*$/, "")
        .trim();
      if (/^(x|remis)$/i.test(teamPart)) return "DRAW";
      return normalize1x2Selection(
        teamPart || trimmed,
        ctx.homeTeam,
        ctx.awayTeam,
        ctx.league
      );
    }

    case "CORRECT_SCORE":
    case "HALF_TIME_CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      if (score) return score as NormalizedSelection;
      // forBET labels the catch-all outcome "inny" — align with the canonical
      // OTHER code used by peers (betclic, etoto, sts) for the same
      // score-grid column, mirroring betclic-normalizer.ts.
      if (normalized === "inny" || normalized === "inny wynik" || normalized === "pozostale") {
        return "OTHER" as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "HT_FT_CORRECT_SCORE": {
      // "0-0 / 1-0" → "0:0 / 1:0" (catalog format)
      const parts = trimmed.split("/").map((part) => part.trim());
      if (parts.length === 2) {
        return `${formatHtFtScorePart(parts[0])} / ${formatHtFtScorePart(parts[1])}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME": {
      const htft = parseHtFtToCodes(trimmed, ctx);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    case "DOUBLE_RESULT": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    case "WINNING_MARGIN": {
      if (/^(remis|x)$/.test(normalized)) return "DRAW";
      // "Algieria 1 golem", "Austria 2 golami", "Argentyna 3 golami lub więcej"
      const margin = normalized.match(/^(.+?)\s+(\d+)\s+gol\w*(\s+lub\s+wiecej)?$/);
      if (margin) {
        const side = resolveTeamSide(margin[1], ctx);
        if (side) {
          const n = parseInt(margin[2], 10);
          const by = margin[3] || n >= 3 ? "3PLUS" : String(n);
          return `${side}_BY_${by}` as NormalizedSelection;
        }
      }
      return trimmed as NormalizedSelection;
    }

    case "TEAMS_TO_SCORE": {
      // "Żadna" / "Tylko Algieria" / "Tylko Austria" / "Obie drużyny"
      if (/^zadna/.test(normalized)) return "ZERO_TEAMS";
      if (/^obie/.test(normalized)) return "TWO_TEAMS";
      const only = normalized.match(/^tylko\s+(.+)$/);
      if (only) {
        const side = resolveTeamSide(only[1], ctx);
        if (side === "HOME") return "ONE_TEAM_HOME";
        if (side === "AWAY") return "ONE_TEAM_AWAY";
      }
      return trimmed as NormalizedSelection;
    }

    // Team-scoped half comparison — catalog encodes the side in the selection
    // codes (HOME_1ST, …) and the team in the parameter (HOME/AWAY).
    case "TEAM_HALF_WITH_MORE_GOALS": {
      const side = rawMarketName ? detectTeamSide(rawMarketName, ctx) : null;
      if (!side) return trimmed as NormalizedSelection;
      if (/^1\.?\s*polowa/.test(normalized)) return `${side}_1ST` as NormalizedSelection;
      if (/^2\.?\s*polowa/.test(normalized)) return `${side}_2ND` as NormalizedSelection;
      if (/^(remis|x|rowno|zadna)/.test(normalized)) {
        return `${side}_EQUAL` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "HALF_WITH_MORE_GOALS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS": {
      // Catalog codes are "1st" / "2nd" / "Draw"
      if (/^1\.?\s*polowa/.test(normalized)) return "1st" as NormalizedSelection;
      if (/^2\.?\s*polowa/.test(normalized)) return "2nd" as NormalizedSelection;
      if (/^(remis|x|zadna)/.test(normalized)) return "Draw" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "GOAL_RANGE":
    case "MULTI_GOAL_RANGE":
    case "EXACT_GOALS":
    case "TEAM_GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
    case "HOME_GOAL_RANGE":
    case "AWAY_GOAL_RANGE": {
      // "brak" → 0, "1-2" / "2-3" ranges and "4+" pass through as catalog codes
      if (/^brak/.test(normalized)) return "0" as NormalizedSelection;
      const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) return `${range[1]}-${range[2]}` as NormalizedSelection;
      const plus = trimmed.match(/^(\d+)\s*\+$/);
      if (plus) return `${plus[1]}+` as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "HOME_EXACT_CARDS":
    case "AWAY_EXACT_CARDS":
    case "HALF_TIME_HOME_EXACT_CORNERS":
    case "HALF_TIME_AWAY_EXACT_CORNERS": {
      // Counts are literal codes ("0", "1", "2", "3+") — never HOME/AWAY
      if (/^brak/.test(normalized)) return "0" as NormalizedSelection;
      if (/^\d+$/.test(trimmed)) return trimmed as NormalizedSelection;
      const plus = trimmed.match(/^(\d+)\s*\+$/);
      if (plus) return `${plus[1]}+` as NormalizedSelection;
      const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) return `${range[1]}-${range[2]}` as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    // Half-time exact cards has no separate "3" bucket in the catalog (only
    // 0/1/2/3+, unlike the full-match variant which also has a bare "3" and
    // "4+"). Clamp any bare count ≥3 (and any "N+" tier) into "3+" so a
    // hidden 3/4+ split on forBET's side merges into one bucket instead of
    // leaking a stray non-catalog "3"/"4+" code that never matches peers.
    case "HALF_TIME_HOME_EXACT_CARDS":
    case "HALF_TIME_AWAY_EXACT_CARDS": {
      if (/^brak/.test(normalized)) return "0" as NormalizedSelection;
      const bare = trimmed.match(/^(\d+)$/);
      if (bare) {
        return (parseInt(bare[1], 10) >= 3 ? "3+" : bare[1]) as NormalizedSelection;
      }
      if (/^\d+\s*\+$/.test(trimmed)) return "3+" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_TIME_ALT": {
      // "brak" → NONE; "1-10" … "81-90" / "1-15" … "76-90" pass through
      if (/^(brak|bez gola)/.test(normalized)) return "NONE";
      const range = trimmed.match(/^(\d+)\s*-\s*(\d+)/);
      if (range) return `${range[1]}-${range[2]}` as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "RESULT_AND_TOTAL":
    case "HALF_TIME_RESULT_AND_TOTAL":
    case "SECOND_HALF_RESULT_AND_TOTAL": {
      // "Argentyna i powyżej 1,5" → HOME_OVER. forBET mixes "i" and "&" as
      // the leg separator within one market (same quirk as
      // DOUBLE_CHANCE_TOTAL below), so a "remis & powyżej 4,5" row must also
      // match or its DRAW_OVER leg silently falls through unnormalized.
      const combo = trimmed.match(/^(.+?)\s+(?:i|&)\s+(.+)$/i);
      if (combo) {
        const res = normalize1x2Selection(combo[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
        const ou = normalizeOverUnderSelection(combo[2]);
        if (res !== "UNKNOWN" && ou !== "UNKNOWN") {
          return `${res}_${ou}` as NormalizedSelection;
        }
      }
      return trimmed as NormalizedSelection;
    }

    case "RESULT_AND_BTTS":
    case "HALF_TIME_RESULT_AND_BTTS":
    case "SECOND_HALF_RESULT_AND_BTTS": {
      // "remis i tak" → DRAW_YES, "Argentyna i nie" → HOME_NO
      const combo = trimmed.match(/^(.+?)\s+i\s+(tak|nie)$/i);
      if (combo) {
        const res = normalize1x2Selection(combo[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
        if (res !== "UNKNOWN") {
          return `${res}_${combo[2].toLowerCase() === "tak" ? "YES" : "NO"}` as NormalizedSelection;
        }
      }
      return trimmed as NormalizedSelection;
    }

    case "DOUBLE_CHANCE_TOTAL": {
      // "Argentyna/remis i powyżej 4.5" → 1X_OVER. The DC leg names the teams
      // ("A/remis", "A/B", "remis/B"), the totals leg is "poniżej/powyżej X".
      // forBET mixes "i" and "&" as the leg separator within one market.
      // Greedy first group so team names containing " i " stay intact.
      const combo = normalized.match(/^(.+)\s+(?:i|&)\s+(ponizej|powyzej)\b.*$/);
      if (combo) {
        const ou = combo[2] === "powyzej" ? "OVER" : "UNDER";
        const legs = combo[1].split("/").map((part) => part.trim());
        if (legs.length === 2) {
          const sides = legs.map((leg) =>
            normalize1x2Selection(leg, ctx.homeTeam, ctx.awayTeam, ctx.league)
          );
          const set = new Set(sides);
          const dc =
            set.has("HOME") && set.has("DRAW")
              ? "1X"
              : set.has("DRAW") && set.has("AWAY")
                ? "X2"
                : set.has("HOME") && set.has("AWAY")
                  ? "12"
                  : null;
          if (dc) return `${dc}_${ou}` as NormalizedSelection;
        }
      }
      return trimmed as NormalizedSelection;
    }

    // Catalog uses the raw combo strings ("1:0, 2:0 lub 3:0") verbatim and
    // "X" for the draw bucket (literal passthrough covers the combos).
    case "MULTI_RESULT":
      if (/^(remis|x)$/.test(normalized)) return "X" as NormalizedSelection;
            // Audit /audit-match (Arsenal vs Coventry City): the "other win" legs are
      // quoted lowercase (and forBET even in the wrong grammatical case,
      // "inne zwycięstwo gospodarze"), so they never matched the catalog's
      // capitalized genitive codes and every one of those prices was dropped.
      if (/^inne\s+zwyci[eę]stwo\s+gospodarz/i.test(trimmed)) {
        return "Inne zwycięstwo gospodarzy" as NormalizedSelection;
      }
      if (/^inne\s+zwyci[eę]stwo\s+go[sś]c/i.test(trimmed)) {
        return "Inne zwycięstwo gości" as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;

    // "Tak i powyżej 2.5 goli" → OVER_YES (BTTS × totals combo)
    case "TOTAL_GOALS_AND_BTTS": {
      const combo = normalized.match(/^(tak|nie)\s+i\s+(ponizej|powyzej)/);
      if (combo) {
        const ou = combo[2] === "powyzej" ? "OVER" : "UNDER";
        return `${ou}_${combo[1] === "tak" ? "YES" : "NO"}` as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    // "Szwajcaria gol & remis" → HOME_DRAW; "brak goli" → NONE
    case "FIRST_GOAL_AND_RESULT": {
      if (/^(brak|bez gola)/.test(normalized)) return "NONE";
      const combo = trimmed.match(/^(.+?)\s+gol\s*(?:&|i)\s*(.+)$/i);
      if (combo) {
        const first = normalize1x2Selection(combo[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
        const result = normalize1x2Selection(combo[2], ctx.homeTeam, ctx.awayTeam, ctx.league);
        if (
          (first === "HOME" || first === "AWAY") &&
          (result === "HOME" || result === "DRAW" || result === "AWAY")
        ) {
          return `${first}_${result}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    // Player-dropdown markets: the selection code IS the player name
    // (canonicalized so "Lastname, Firstname" merges across bookmakers).
    case "PLAYER_GOAL_OR_ASSIST":
    case "PLAYER_OF_THE_MATCH":
    case "GOALSCORER_ANYTIME":
      return canonicalizePlayerName(trimmed) as NormalizedSelection;

    case "BTTS_BY_HALF": {
      // "tak/nie" = BTTS in 1st half only, "nie/tak" = 2nd only, "tak/tak" =
      // both halves, "nie/nie" = neither — catalog codes 1st/2nd/Both/None.
      const combo = normalized.match(/^(tak|nie)\s*\/\s*(tak|nie)$/);
      if (combo) {
        if (combo[1] === "tak") {
          return (combo[2] === "tak" ? "Both" : "1st") as NormalizedSelection;
        }
        return (combo[2] === "tak" ? "2nd" : "None") as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "DOUBLE_CHANCE_BTTS":
    case "HALF_TIME_DOUBLE_CHANCE_BTTS":
    case "SECOND_HALF_DOUBLE_CHANCE_BTTS": {
      // "1/X i tak" → 1X_YES
      const combo = normalized.match(/(1\/?x|x\/?2|1\/?2)\b.*\b(tak|nie)$/);
      if (combo) {
        const dcRaw = combo[1].replace("/", "");
        const dc = dcRaw === "1x" ? "1X" : dcRaw === "x2" ? "X2" : "12";
        return `${dc}_${combo[2] === "tak" ? "YES" : "NO"}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "PLAYER_CARDS": {
      // "Wanner, Paul 1+" → YES (catalog vocabulary for PLAYER_CARDS is YES/NO)
      if (/1\s*\+$/.test(trimmed)) return "YES";
      const yn = normalizeYesNoSelection(trimmed);
      if (yn !== "UNKNOWN") return yn;
      const threshold = trimmed.match(/(\d+)\s*\+$/);
      if (threshold) return `${threshold[1]}+` as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "PLAYER_GOALS":
    case "PLAYER_ASSISTS":
    case "PLAYER_PASSES":
    case "PLAYER_SHOTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_TACKLES": {
      // "Wanner, Paul 2+" → "2+" (player name goes into the parameter)
      const threshold = trimmed.match(/(\d+)\s*\+$/);
      if (threshold) return `${threshold[1]}+` as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    // OTHER is a catch-all for markets we route out of the standard buckets
    // (e.g. unresolvable team-scoped windows). normalize1x2Selection would
    // collapse distinct over/under (or yes/no) selections into the same
    // UNKNOWN code, silently merging both sides into one row — keep them
    // distinguishable instead, mirroring the sts/pzbuk OTHER handling.
    case "OTHER": {
      const ou = normalizeOverUnderSelection(trimmed);
      if (ou !== "UNKNOWN") return ou;
      const yn = normalizeYesNoSelection(trimmed);
      if (yn !== "UNKNOWN") return yn;
      return trimmed as NormalizedSelection;
    }

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

const PLAYER_PARAM_MARKETS: NormalizedMarketType[] = [
  "PLAYER_GOALS",
  "PLAYER_CARDS",
  "PLAYER_ASSISTS",
  "PLAYER_PASSES",
  "PLAYER_SHOTS",
  "PLAYER_SHOTS_ON_TARGET",
  "PLAYER_TACKLES",
];

const EUROPEAN_HANDICAP_MARKETS: NormalizedMarketType[] = [
  "EUROPEAN_HANDICAP",
  "FIRST_HALF_EUROPEAN_HANDICAP",
  "SECOND_HALF_EUROPEAN_HANDICAP",
];

/**
 * Team-scoped stat totals whose catalog selections are plain OVER/UNDER —
 * the side is carried in the parameter ("HOME:2.5"), matching betclic.
 *
 * CORNERS_TEAM shares this shape: game-type ids 115 (home) / 116 (away) both
 * collapse to the same catalog code with plain OVER/UNDER selections, so
 * without a side-prefixed param the two teams' independent line ladders
 * ("Arsenal 7.5" vs "Coventry 2.5") interleave into one bogus shared ladder
 * (audit /audit-match, premier-league Arsenal vs Coventry City: CORNERS_TEAM
 * scanner break at the 5 -> 5.5 seam was actually the Coventry/Arsenal
 * boundary, not a real outlier). etoto hits the exact same 115/116 feed and
 * already prefixes with HOME:/AWAY: (see etoto-normalizer.ts) — match that
 * convention here so the two bookmakers merge instead of colliding.
 */
const TEAM_LINE_PARAM_MARKETS = new Set<NormalizedMarketType>([
  "TEAM_TOTAL_SHOTS",
  "TEAM_TOTAL_SHOTS_ON_TARGET",
  "CORNERS_TEAM",
]);

const PARAMETERIZED_MARKETS: NormalizedMarketType[] = [
  "TOTAL_GOALS",
  "TOTAL_GOALS_ASIAN",
  "HALF_TIME_TOTAL_GOALS",
  "SECOND_HALF_TOTAL_GOALS",
  "TEAM_TOTAL_GOALS",
  "HOME_TEAM_TOTAL_GOALS",
  "AWAY_TEAM_TOTAL_GOALS",
  "HALF_TIME_HOME_TEAM_TOTAL_GOALS",
  "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
  "SECOND_HALF_HOME_TEAM_TOTAL_GOALS",
  "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
  "ASIAN_HANDICAP",
  "FIRST_HALF_ASIAN_HANDICAP",
  "EUROPEAN_HANDICAP",
  "FIRST_HALF_EUROPEAN_HANDICAP",
  "SECOND_HALF_EUROPEAN_HANDICAP",
  "CORNERS_TOTAL",
  "CARDS_TOTAL",
  "CORNERS_TEAM",
  "CORNERS_HANDICAP",
  "HALF_TIME_CORNERS_HANDICAP",
  "HALF_TIME_CORNERS_TOTAL",
  "SECOND_HALF_CORNERS_TOTAL",
  "HALF_TIME_CARDS_TOTAL",
  "SECOND_HALF_CARDS_TOTAL",
  "HALF_TIME_CORNERS_TEAM",
  "SECOND_HALF_CORNERS_TEAM",
  "CARDS_TEAM",
  "HALF_TIME_CARDS_TEAM",
  "TOTAL_SHOTS",
  "TOTAL_SHOTS_ON_TARGET",
  "TEAM_TOTAL_SHOTS",
  "TEAM_TOTAL_SHOTS_ON_TARGET",
  "FOULS_TOTAL",
  "HOME_TEAM_TOTAL_FOULS",
  "AWAY_TEAM_TOTAL_FOULS",
  "OFFSIDES_TOTAL",
  "HOME_TEAM_TOTAL_OFFSIDES",
  "AWAY_TEAM_TOTAL_OFFSIDES",
  "GOAL_KICKS_TOTAL",
  "SAVES_TOTAL",
  "THROW_INS_TOTAL",
  "TOTAL_XG",
  "RESULT_AND_TOTAL",
  "HALF_TIME_RESULT_AND_TOTAL",
  "SECOND_HALF_RESULT_AND_TOTAL",
  "DOUBLE_CHANCE_TOTAL",
  "BOTH_HALVES_OVER_GOALS",
  "BOTH_HALVES_UNDER_GOALS",
  "TIME_PERIOD_RESULT",
  "FIRST_30_MIN_TOTAL_GOALS",
  "TEAM_GOALS_BEFORE_MINUTE",
  "TOTAL_GOALS_BY_60_MIN",
  "TOTAL_GOALS_BY_60MIN",
  "TEAM_TOTAL_GOALS_FIRST_60MIN",
  // All team-parameterised markets (param = HOME/AWAY resolved from the raw
  // market name). Audit /audit-match (Arsenal vs Coventry City): TEAM_WIN_MATCH
  // (and its set-mates WIN_OR_BTTS, TEAM_WIN_OR_CLEAN_SHEET) sat in
  // FORBET_TEAM_PARAM_MARKETS but not in this gate list, so extractParamValue
  // returned undefined before reaching the team-side branch and "Arsenal FC
  // wygra mecz" landed under a meaningless "base" param instead of HOME —
  // never merging with peer bookmakers' HOME/AWAY rows. Spreading the set
  // keeps the two lists from drifting apart again.
  ...FORBET_TEAM_PARAM_MARKETS,
  ...PLAYER_PARAM_MARKETS,
];

/**
 * Extracts the player name (used as parameter value) from forBET player-prop
 * markets, e.g. "Wanner, Paul - liczba goli (…)", "Da Costa, Nuno otrzyma
 * kartkę (…)". Falls back to stripping the "N+" suffix from a selection label.
 */
function extractPlayerParam(raw: RawBookmakerMarket): string | undefined {
  const statMatch = raw.name.match(/^(.+?)\s*[-–]\s*liczba\s/i);
  if (statMatch) return statMatch[1].trim();

  const cardMatch = raw.name.match(/^(.+?)\s+otrzyma\s+kartk/i);
  if (cardMatch) return cardMatch[1].trim();

  const firstSelection = raw.selections[0]?.name?.trim() ?? "";
  const selMatch = firstSelection.match(/^(.+?)\s+\d+\s*\+$/);
  if (selMatch) return selMatch[1].trim();

  return undefined;
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): string | undefined {
  if (!PARAMETERIZED_MARKETS.includes(marketCode)) return undefined;

  if (PLAYER_PARAM_MARKETS.includes(marketCode)) {
    return extractPlayerParam(raw);
  }

  // European handicap quoted as a score line ("Handicap 0:2",
  // "1. połowa - handicap 0:2") → signed goal difference ("-2", "+1", "0")
  if (EUROPEAN_HANDICAP_MARKETS.includes(marketCode)) {
    const score = raw.name.match(/(\d+)\s*:\s*(\d+)/);
    if (score) {
      const diff = parseInt(score[1], 10) - parseInt(score[2], 10);
      return diff > 0 ? `+${diff}` : `${diff}`;
    }
  }

  // Time-window 1X2 ("10 minut – 1X2 od 1 do 10") → window length in minutes
  if (marketCode === "TIME_PERIOD_RESULT") {
    const minutes = raw.name.match(/(\d+)\s*minut/i);
    if (minutes) return minutes[1];
    const window = raw.name.match(/od\s*\d+\s*do\s*(\d+)/i);
    if (window) return window[1];
  }

  // Team-scoped markets with no numeric line: the side IS the parameter.
  // Audit /audit-match (Arsenal vs Coventry City): forBET quotes both teams
  // under the same code, so without a side param "Arsenal FC wygra mecz" and
  // "Coventry wygra mecz" collided on one key — the grouper kept the first and
  // dropped the second, and the surviving row never said whose win it was.
  if (FORBET_TEAM_PARAM_MARKETS.has(marketCode)) {
    return detectTeamSide(raw.name, ctx) ?? undefined;
  }

  // Goals-by-minute windows: parameter is the minute threshold
  // ("Liczba bramek do 30 minuty meczu" → "30", matching peer bookmakers)
  if (
    marketCode === "FIRST_30_MIN_TOTAL_GOALS" ||
    marketCode === "TEAM_GOALS_BEFORE_MINUTE"
  ) {
    const minute = raw.name.match(/do\s*(\d+)\s*minut/i);
    if (minute) return minute[1];
    return marketCode === "FIRST_30_MIN_TOTAL_GOALS" ? "30" : undefined;
  }

  // Handicap lines: prefer the explicit line attached to the home selection
  // ("1 (-1.5)"). The market name alone can be misleading — "1. połowa -
  // handicap" would otherwise yield a malformed "+1." from the half prefix,
  // and the generic decimal scan below would drop the sign.
  if (
    marketCode === "ASIAN_HANDICAP" ||
    marketCode === "FIRST_HALF_ASIAN_HANDICAP" ||
    marketCode === "EUROPEAN_HANDICAP" ||
    marketCode === "CORNERS_HANDICAP" ||
    marketCode === "HALF_TIME_CORNERS_HANDICAP"
  ) {
    for (const sel of raw.selections) {
      const line = sel.name.match(/^1\s*\(([+-]?\d+(?:[.,]\d+)?)\)/);
      if (line) return parseHandicapLine(line[1]);
    }
    // Team-name selections carry the line as a suffix: "Szwajcaria (+1.5)" /
    // "Szwajcaria +0.5" — take the line attached to the HOME team.
    for (const sel of raw.selections) {
      const teamLine = sel.name.match(/^(.+?)\s*\(?([+-]\d+(?:[.,]\d+)?)\)?\s*$/);
      if (teamLine && resolveTeamSide(teamLine[1], ctx) === "HOME") {
        return parseHandicapLine(teamLine[2]);
      }
    }
    const stripped = raw.name.replace(/^[12]\.?\s*po[lł]owa\s*[-–]?\s*/i, "");
    const handicapMatch = stripped.match(/([+-]?\d+(?:[.,]\d+)?)/);
    if (handicapMatch) return parseHandicapLine(handicapMatch[1]);
    // No reliable signed line found — better an unparameterized entry than a
    // line with a possibly flipped sign poisoning the handicap buckets.
    return undefined;
  }

  // Team-scoped stat totals with plain OVER/UNDER selections: encode the team
  // side in the parameter ("AWAY:14.5") so home/away lines never collide.
  if (TEAM_LINE_PARAM_MARKETS.has(marketCode)) {
    const line =
      raw.name.match(/(\d+[.,]\d+)/)?.[1].replace(",", ".") ??
      parseOverUnderLine(raw.selections.map((s) => s.name));
    if (!line) return undefined;
    const side = detectTeamSide(raw.name, ctx);
    return side ? `${side}:${line}` : line;
  }

  const nameMatch = raw.name.match(/(\d+[.,]\d+)/);
  if (nameMatch) {
    return nameMatch[1].replace(",", ".");
  }

  const selectionNames = raw.selections.map((s) => s.name);
  return parseOverUnderLine(selectionNames);
}

function matchMarketByName(name: string): NormalizedMarketType | null {
  const normalized = name.toLowerCase().trim();

  for (const { pattern, code } of FORBET_NAME_PATTERNS) {
    if (pattern.test(normalized)) {
      return code;
    }
  }

  return null;
}

function extractForbetGameType(raw: RawBookmakerMarket): number | null {
  if (raw.bookmakerMarketId !== undefined) {
    const id = Number(raw.bookmakerMarketId);
    if (!isNaN(id)) return id;
  }

  const match = raw.name.match(/^Rynek\s+(\d+)$/iu);
  return match ? Number(match[1]) : null;
}

export const forbetNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "forbet",

  normalizeMarket(
    raw: RawBookmakerMarket,
    ctx: NormalizationContext
  ): NormalizedMarketOutput | null {
    const gameTypeId = extractForbetGameType(raw);
    let marketCode: NormalizedMarketType | null = null;
    let matchedBy: "id" | "name" | "pattern" = "id";

    // Specific raw-name rules first: forBET reuses generic game-type ids for
    // combo/special markets, so the id map alone misroutes them.
    const special = resolveForbetSpecialMarket(raw, ctx);
    if (special) {
      marketCode = special;
      matchedBy = "pattern";
    }

    if (!marketCode && gameTypeId !== null) {
      marketCode = FORBET_MARKET_ID_TO_CODE[gameTypeId] ?? null;
    }

    if (!marketCode) {
      matchedBy = "name";
      marketCode = matchMarketByName(raw.name);
    }

    if (!marketCode) {
      console.warn(
        `[forbet] Unknown market: "${raw.name}" (gameType: ${gameTypeId ?? "none"})`
      );
      return null;
    }

    // Team-scoped markets: reroute to the home/away catalog variant when the
    // raw name clearly names one of the teams (forBET quotes both teams under
    // the same game-type id pair).
    const variant = FORBET_TEAM_SIDED_VARIANTS[marketCode];
    if (variant) {
      const side = detectTeamSide(raw.name, ctx);
      if (side) {
        marketCode = side === "HOME" ? variant.home : variant.away;
      }
    }

    // "Którykolwiek z wymienionych zawodników strzeli gola" reuses the
    // two-player game type for player TRIOS ("A / B / C" selections) — route
    // those to the three-player catalog code so the shorter-priced trio bets
    // never poison the two-player best-odds comparison.
    if (marketCode === "TWO_PLAYERS_ANYTIME" || marketCode === "BOTH_PLAYERS_ANYTIME") {
      const hasTrio = raw.selections.some(
        (sel) => sel.name.split("/").length >= 3
      );
      if (hasTrio) marketCode = "THREE_PLAYERS_ANYTIME";
    }

    // TEAM_HALF_WITH_MORE_GOALS needs a resolvable team side for both the
    // parameter (HOME/AWAY) and the side-prefixed selection codes; without it
    // the entry would pollute the shared market under a phantom "base" bucket.
    if (marketCode === "TEAM_HALF_WITH_MORE_GOALS" && !detectTeamSide(raw.name, ctx)) {
      marketCode = "OTHER";
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[forbet] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const paramValue = extractParamValue(marketCode, raw, ctx);
    const marketKey = buildMarketKey(marketCode, paramValue);

    const selections = mergeDuplicateSelectionCodes(
      raw.selections.map((sel) => ({
        code: normalizeSelectionForMarket(sel.name, marketCode!, ctx, raw.name),
        label: sel.name,
        odds: sel.odds,
      }))
    );

    return {
      marketCode,
      paramValue,
      marketKey,
      selections,
      debug: {
        rawName: raw.name,
        rawId: gameTypeId ?? undefined,
        matchedBy,
      },
    };
  },
};

export default forbetNormalizer;
