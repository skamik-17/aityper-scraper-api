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
  normalizeHandicapSelection,
  normalizeOddEvenSelection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  parseScoreSelection,
  parseHtFtSelection,
  canonicalizePlayerName,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode, getMarketByCode } from "../../../data/market-catalog.js";
import { GAME_TYPES } from "../../../scrapers/bookmakers/betfan/constants.js";

const BETFAN_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "MATCH_WINNER",
  [GAME_TYPES.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [GAME_TYPES.DRAW_NO_BET]: "DRAW_NO_BET",
  [GAME_TYPES.OVER_UNDER]: "TOTAL_GOALS",
  [GAME_TYPES.BTTS]: "BTTS",
  [GAME_TYPES.ODD_EVEN]: "ODD_EVEN_GOALS",
  [GAME_TYPES.HANDICAP]: "ASIAN_HANDICAP",
  [GAME_TYPES.HALF_TIME_RESULT]: "HALF_TIME_RESULT",
  [GAME_TYPES.HALF_TIME_OVER_UNDER]: "HALF_TIME_TOTAL_GOALS",
  [GAME_TYPES.HALF_TIME_BTTS]: "HALF_TIME_BTTS",
  [GAME_TYPES.CORRECT_SCORE]: "CORRECT_SCORE",
  [GAME_TYPES.CORNERS_TOTAL]: "CORNERS_TOTAL",
  [GAME_TYPES.CARDS_TOTAL]: "CARDS_TOTAL",
  [GAME_TYPES.TEAM_GOALS]: "TEAM_TOTAL_GOALS",
  // Side-specific team totals use OVER/UNDER selections, matching the
  // HOME/AWAY_TEAM_TOTAL_GOALS catalog vocabulary (TEAM_TOTAL_GOALS expects
  // HOME_OVER/AWAY_OVER codes and would silently merge both teams' lines).
  [GAME_TYPES.HOME_TEAM_OVER_UNDER]: "HOME_TEAM_TOTAL_GOALS",
  [GAME_TYPES.AWAY_TEAM_OVER_UNDER]: "AWAY_TEAM_TOTAL_GOALS",
  [GAME_TYPES.CLEAN_SHEET]: "CLEAN_SHEET",
  [GAME_TYPES.WIN_MARGIN]: "WINNING_MARGIN",
  [GAME_TYPES.HALFTIME_FULLTIME]: "HALFTIME_FULLTIME",
  [GAME_TYPES.EXACT_GOALS]: "GOAL_RANGE",
  "-8132": "HT_OR_FT_RESULT",
  "-2982": "HOME_TEAM_TO_SCORE",
  "-2983": "AWAY_TEAM_TO_SCORE",
  "-200345": "HOME_GOALSCORER_FIRST",
  "-200346": "AWAY_GOALSCORER_FIRST",
  "-200017": "COMEBACK",
  "-200069": "MOST_SHOTS_ON_TARGET",
  "-30242": "TOTAL_SHOTS_ON_TARGET",
  "168": "TOTAL_SHOTS_ON_TARGET",
  "169": "TEAM_TOTAL_SHOTS_ON_TARGET",
  "-200194": "TOTAL_SHOTS",
  "-200054": "TEAM_TOTAL_SHOTS",
  "-200055": "TEAM_TOTAL_SHOTS",
  "-200070": "FOUL_RACE",
  "-30243": "FOULS_TOTAL",
  "162": "TEAM_TOTAL_FOULS",
  "-30244": "OFFSIDES_TOTAL",
  "-200165": "HOME_TEAM_TOTAL_OFFSIDES",
  "-200166": "HOME_TEAM_TOTAL_OFFSIDES",
  "-200038": "BOTH_TEAMS_CORNERS_EACH_HALF",
  "-200039": "TEAM_CORNERS_BOTH_HALVES_OVER",
  "-200050": "BOTH_TEAMS_OVER_CORNERS",
  "-200041": "BOTH_TEAMS_CARDS_OVER",
  "-200253": "EACH_TEAM_SHOTS_ON_TARGET",
  "-200246": "BOTH_TEAMS_OVER_FOULS",
  "-200254": "EACH_TEAM_OFFSIDES",
  "-2902": "HALF_TIME_GOAL_RANGE",
  "-2903": "SECOND_HALF_GOAL_RANGE",
  "125": "TEAM_WIN_BOTH_HALVES",
  "126": "HOME_WIN_BOTH_HALVES",
  "127": "AWAY_WIN_AT_LEAST_ONE_HALF",
  "128": "TEAM_WIN_AT_LEAST_ONE_HALF",
  "-232": "TEAMS_TO_SCORE",
  "-239": "HALF_WITH_MORE_GOALS",
  "-240": "HOME_HALF_WITH_MOST_GOALS",
  "-8049": "EITHER_TEAM_TO_WIN",
  "-2549": "HOME_WIN_NO_BET",
  "-30002": "BTTS_BY_HALF",
  "-200340": "HALF_TIME_GOALSCORER_ANYTIME",
  "160": "CORNERS_RACE",
  // 115/116 are the per-team corner O/U lines ("<team> suma X rzutów
  // rożnych"), matching etoto's mapping for the shared platform ids —
  // 115 previously polluted the full-match CORNERS_TOTAL with team lines.
  "115": "CORNERS_TEAM",
  "116": "CORNERS_TEAM",
  "-271": "CORNERS_RANGE",
  // -265/-266 carry the unparameterized band tables ("0-2","3-4","5-6","7+");
  // CORNERS_TEAM has a decimal parameter, so band rows there are dropped by
  // the grouper's no-parameter guard. CORNERS_TEAM_RANGE is the band market.
  "-265": "CORNERS_TEAM_RANGE",
  "-2971": "FIRST_CORNER",
  "-266": "CORNERS_TEAM_RANGE",
  // audit-match (Arsenal vs Coventry City): betfan's name-based override
  // ("liczba goli" below) routed BOTH the exact-count ladder (id -227:
  // 0/1/2/3/4/5/6+) and the disjoint-band table (id -225: "Liczba goli -
  // przedzial bramkowy", 0-1/2-3/4-6/7+) to GOAL_RANGE, silently merging two
  // different widgets into one 11-selection chimera. forbet/etoto/fuksiarz
  // already disambiguate the same shared platform ids as EXACT_GOALS (-227)
  // vs GOAL_RANGE (-225); mirror that split here. This id match wins over
  // the name-based override below.
  "-227": "EXACT_GOALS",
  "-225": "GOAL_RANGE",
  "105": "HALF_TIME_CORNERS_TOTAL",
  "171": "CARDS_RACE",
  "-261": "HALF_TIME_CORNERS_RACE",
  "-272": "HALF_TIME_CORNERS_TOTAL",
  "-268": "HALF_TIME_HOME_EXACT_CORNERS",
  // -267 is the away-team variant (etoto maps the same platform id to AWAY);
  // the side is re-resolved from the team name in refineMarketCode anyway.
  "-267": "HALF_TIME_AWAY_EXACT_CORNERS",
  "-2953": "HALF_TIME_FIRST_CORNER",
  "-170": "FIRST_HALF_CARDS_1X2",
  "-2955": "FIRST_HALF_FIRST_CARD",
  "-250": "RED_CARD_TEAM",
  "-251": "RED_CARD_TEAM",
  "-247": "HALF_TIME_RED_CARD",
  "22": "RED_CARD",
  "15": "PENALTY_AWARDED",
  "138": "OWN_GOAL",
  "-200180": "PLAYER_OF_THE_MATCH",
  "-200172": "PLAYER_GOAL_AND_ASSIST",
  "-228": "HT_FT_CORRECT_SCORE",
  "-2543": "RESULT_AND_BTTS",
  "-2555": "TOTAL_GOALS_AND_BTTS",
  "-345": "RESULT_AND_TOTAL",
  "-2719": "DOUBLE_CHANCE_BTTS",
  "-2720": "DOUBLE_CHANCE_TOTAL",
  "38": "HALF_WITH_MORE_GOALS",
  "-2904": "HOME_GOAL_RANGE",
  "-2905": "HOME_GOAL_RANGE",
  "-8031": "DOUBLE_CHANCE_HALF_TIME_BTTS",
  "-8032": "DOUBLE_CHANCE_SECOND_HALF_BTTS",
  "-200325": "PLAYER_CARDS",
  "-200326": "PLAYER_RED_CARD",
  "-200324": "PLAYER_GOAL_OR_ASSIST",
  "-200173": "PLAYER_HEADER_GOAL",
  // "Zawodnik strzeli gola bezposrednio z rzutu wolnego" (43 player rows in
  // this match, e.g. "Eze, Eberechi"=8.8) matches the catalog's
  // PLAYER_FREE_KICK_GOAL description verbatim; unmapped it fell through to
  // OTHER and collapsed to a single UNKNOWN selection.
  "-200175": "PLAYER_FREE_KICK_GOAL",
  // "Pierwszy zawodnik ukarany kartka" (48 player rows in this match, e.g.
  // "Onyeka, Frank"=6.8) matches the catalog's FIRST_PLAYER_CARDED
  // description verbatim; unmapped it fell through to OTHER and collapsed
  // to a single UNKNOWN selection, dropping 47 players and the survivor's name.
  "-200344": "FIRST_PLAYER_CARDED",
  "-200342": "PLAYER_RIGHT_FOOT_GOAL",
  "-200341": "PLAYER_LEFT_FOOT_GOAL",
  "-200337": "ASSIST_SCORER_ANYTIME",
  "-200333": "PLAYER_SHOTS_ON_TARGET",
  "-200334": "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX",
  "-200343": "PLAYER_HEADER_SHOTS_ON_TARGET",
  "-200327": "PLAYER_SHOTS_ANYTIME",
  // "Zawodnik popelni 5+ fauli" lists players as selections with the threshold
  // in the market name -> PLAYER_FOULS_OVER (PLAYER dropdown), not PLAYER_FOULS
  // (per-player stat lines).
  "-200331": "PLAYER_FOULS_OVER",
  "-200332": "PLAYER_FOULS_WON",
  "-200338": "PLAYER_OFFSIDES",
  "-200339": "PLAYER_SAVES",
};

/**
 * Ids verified against the live bookmaker page during /audit-match
 * (premier-league Arsenal vs Coventry City, 2026-08-19). Several GAME_TYPES
 * constants no longer describe what betfan serves under those numbers, and the
 * stale values were routing real markets into unrelated codes:
 *   3    "1. połowa - wynik"         → was HALF_TIME_DRAW_NO_BET (it has a draw)
 *   111  "2. połowa - wynik"         → was HALFTIME_FULLTIME
 *   5    "1. połowa / wynik końcowy" → was HALF_TIME_CORRECT_SCORE
 *   -2967 "1. gol"                   → was WINNING_MARGIN (the real margin
 *                                      market is "Różnica zwycięstwa", -338)
 * These win over both the symbolic map and the name patterns.
 */
const BETFAN_VERIFIED_ID_OVERRIDES: Record<string, NormalizedMarketType> = {
  "3": "HALF_TIME_RESULT",
  "111": "SECOND_HALF_RESULT",
  "5": "HALFTIME_FULLTIME",
  "-2967": "FIRST_TEAM_TO_SCORE",
  "-338": "WINNING_MARGIN",
  "93": "DRAW_NO_BET",
  "-30001": "CORRECT_SCORE",
};

const BETFAN_MARKET_TYPE_TO_CODE: Record<string, NormalizedMarketType> = {
  "1x2": "MATCH_WINNER",
  double_chance: "DOUBLE_CHANCE",
  draw_no_bet: "DRAW_NO_BET",
  over_under: "TOTAL_GOALS",
  btts: "BTTS",
  odd_even: "ODD_EVEN_GOALS",
  handicap: "ASIAN_HANDICAP",
  half_time_1x2: "HALF_TIME_RESULT",
  half_time_over_under: "HALF_TIME_TOTAL_GOALS",
  half_time_btts: "HALF_TIME_BTTS",
  correct_score: "CORRECT_SCORE",
  team_goals: "TEAM_TOTAL_GOALS",
  home_team_over_under: "HOME_TEAM_TOTAL_GOALS",
  away_team_over_under: "AWAY_TEAM_TOTAL_GOALS",
  clean_sheet: "CLEAN_SHEET",
  win_margin: "WINNING_MARGIN",
  halftime_fulltime: "HALFTIME_FULLTIME",
  exact_goals: "GOAL_RANGE",
  corners: "CORNERS_TOTAL",
  cards: "CARDS_TOTAL",
};

const BETFAN_MARKET_NAME_OVERRIDES: Record<string, NormalizedMarketType> = {
  mecz: "MATCH_WINNER",
  "1x2": "MATCH_WINNER",
  "podwojna szansa": "DOUBLE_CHANCE",
  "zaklad bez remisu (remis=zwrot)": "DRAW_NO_BET",
  "obie druzyny strzela gola": "BTTS",
  "dokladny wynik": "CORRECT_SCORE",
  // Grouped scorelines ("1:0, 2:0 lub 3:0", "X") match the MULTI_RESULT
  // catalog codes, not single SCORE_GRID cells.
  multiwynik: "MULTI_RESULT",
  "liczba goli - przedzial bramkowy": "GOAL_RANGE",
  "liczba goli": "GOAL_RANGE",
  "roznica zwyciestwa": "WINNING_MARGIN",
  "strzelec 1. gola": "GOALSCORER_FIRST",
  "zawodnik strzeli gola": "GOALSCORER_ANYTIME",
  "1. gol": "FIRST_TEAM_TO_SCORE",
  "1. gol i wynik meczu": "FIRST_GOAL_AND_RESULT",
  "kiedy zostanie strzelony 1. gol (przedzial 10 minutowy)": "FIRST_GOAL_TIME",
  // 15-minute buckets have their own catalog entry - mixing them into the
  // 10-minute FIRST_GOAL_TIME market produces incomparable selections.
  "kiedy zostanie strzelony 1. gol (przedzial 15 minutowy)": "FIRST_GOAL_TIME_ALT",
  "10 minut - wynik od 1 do 10 (00:00-09:59)": "TIME_PERIOD_RESULT",
  "1. polowa/wynik koncowy - dokladny wynik": "OTHER",
};

const BETFAN_MARKET_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  // Combo markets (double chance + BTTS) must precede the plain double chance
  // patterns so they don't bleed into the DC markets.
  { pattern: /^1\.?\s*polow.*podwojna szansa.*obie/, code: "HALF_TIME_DOUBLE_CHANCE_BTTS" },
  { pattern: /^2\.?\s*polow.*podwojna szansa.*obie/, code: "SECOND_HALF_DOUBLE_CHANCE_BTTS" },
  { pattern: /podwojna szansa.*obie.*strzel/, code: "DOUBLE_CHANCE_BTTS" },
  { pattern: /^1\.?\s*polow.*podwojna szansa/, code: "HALF_TIME_DOUBLE_CHANCE" },
  { pattern: /^2\.?\s*polow.*podwojna szansa/, code: "SECOND_HALF_DOUBLE_CHANCE" },
  { pattern: /^1\.?\s*polow.*zaklad bez remisu/, code: "HALF_TIME_DRAW_NO_BET" },
  { pattern: /^2\.?\s*polow.*zaklad bez remisu/, code: "SECOND_HALF_DRAW_NO_BET" },
  { pattern: /^1\.?\s*polow.*obie.*strzela/, code: "HALF_TIME_BTTS" },
  { pattern: /^2\.?\s*polow.*obie.*strzela/, code: "SECOND_HALF_BTTS" },
  // Half-scoped correct score / exact goals must precede the generic
  // "wynik" / "liczba goli" half patterns.
  { pattern: /^1\.?\s*polow.*dokladny wynik/, code: "HALF_TIME_CORRECT_SCORE" },
  { pattern: /^2\.?\s*polow.*dokladny wynik/, code: "SECOND_HALF_CORRECT_SCORE" },
  { pattern: /^1\.?\s*polow.*dokladna liczba goli/, code: "HALF_TIME_EXACT_GOALS" },
  { pattern: /^2\.?\s*polow.*dokladna liczba goli/, code: "SECOND_HALF_EXACT_GOALS" },
  { pattern: /^1\.?\s*polow.*wynik/, code: "HALF_TIME_RESULT" },
  { pattern: /^2\.?\s*polow.*wynik/, code: "SECOND_HALF_RESULT" },
  { pattern: /^1\.?\s*polow.*liczba goli/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /^2\.?\s*polow.*liczba goli/, code: "SECOND_HALF_TOTAL_GOALS" },
  // Stat-specific and half-scoped handicaps must precede the generic
  // goals handicap pattern.
  { pattern: /celne strzaly.*handicap|handicap celnych strzalow/, code: "SHOTS_ON_TARGET_HANDICAP" },
  { pattern: /^1\.?\s*polow.*rzuty rozne.*handicap/, code: "HALF_TIME_CORNERS_HANDICAP" },
  // No 2nd-half corners handicap code in the catalog - keep it out of goals handicap
  { pattern: /^2\.?\s*polow.*rzuty rozne.*handicap/, code: "OTHER" },
  { pattern: /rzuty rozne.*handicap|handicap rzutow roznych/, code: "CORNERS_HANDICAP" },
  { pattern: /^1\.?\s*polow.*kartk.*handicap/, code: "HALF_TIME_CARDS_HANDICAP" },
  { pattern: /kartk.*handicap|handicap kartek/, code: "CARDS_HANDICAP" },
  { pattern: /^1\.?\s*polow.*handicap/, code: "FIRST_HALF_ASIAN_HANDICAP" },
  { pattern: /^2\.?\s*polow.*handicap/, code: "SECOND_HALF_ASIAN_HANDICAP" },
  { pattern: /handicap/, code: "ASIAN_HANDICAP" },
  // Half/team-scoped clean sheets are refined via context in refineMarketCode
  { pattern: /czyste konto/, code: "CLEAN_SHEET" },
  { pattern: /wygr[a-z]+ do zera/, code: "WIN_TO_NIL" },
  { pattern: /wygra obie polowy/, code: "TEAM_WIN_BOTH_HALVES" },
  { pattern: /wygra przynajmniej jedna polowe/, code: "TEAM_WIN_AT_LEAST_ONE_HALF" },
  { pattern: /strzeli gola w obu polowach/, code: "BOTH_HALVES_GOALS" },
  // "Obie polowy powyzej/ponizej X goli" is a per-half over/under, not the
  // plain "goal in both halves" market.
  { pattern: /obie polowy powyzej/, code: "BOTH_HALVES_OVER_GOALS" },
  { pattern: /obie polowy ponizej/, code: "BOTH_HALVES_UNDER_GOALS" },
  { pattern: /polowa z (najwieksza|wieksza) liczba goli/, code: "HALF_WITH_MORE_GOALS" },
  // Team-scoped exact goal counts are refined via context in refineMarketCode
  { pattern: /dokladna liczba goli/, code: "EXACT_GOALS" },
  { pattern: /- liczba goli$/, code: "TEAM_TOTAL_GOALS" },
  { pattern: /kiedy zostanie strzelony 1\. gol.*15 minutowy/, code: "FIRST_GOAL_TIME_ALT" },
  { pattern: /kiedy zostanie strzelony 1\. gol/, code: "FIRST_GOAL_TIME" },
  // Team-scoped first goalscorer is a player prop with no catalog equivalent
  { pattern: /strzelec 1\. gola dla druzyny/, code: "OTHER" },
  { pattern: /1\. gol i wynik/, code: "FIRST_GOAL_AND_RESULT" },
  { pattern: /1\. gol/, code: "FIRST_TEAM_TO_SCORE" },
  { pattern: /multiwynik/, code: "MULTI_RESULT" },
  { pattern: /dokladny wynik/, code: "CORRECT_SCORE" },
  { pattern: /parzyste\/?nieparzyste/, code: "ODD_EVEN_GOALS" },
  // "Czy dojdzie do konkursu rzutow karnych?" - penalty shootout market
  { pattern: /konkurs\w* rzutow karnych/, code: "PENALTY_SHOOTOUT" },
  { pattern: /rzuty rozne/, code: "CORNERS_TOTAL" },
  { pattern: /liczba kartek/, code: "CARDS_TOTAL" },
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[łŁ]/g, "l")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Betfan-specific bare-mononym aliases: some player-prop outcomes arrive
 * under a short/common name while other bookmakers canonicalize to the full
 * name, which would otherwise strand the same player in a separate
 * parameter row from the rest of the market.
 */
const BETFAN_PLAYER_NAME_ALIASES: Record<string, string> = {
  munir: "Munir Mohamedi",
  // Betfan lists Coventry's Ellis Simms with his full middle name ("Simms,
  // Ellis Reco"), while other bookmakers (betcris, lvbet) canonicalize to
  // the shorter "Ellis Simms" used everywhere else in the industry — fold
  // to the shared canonical form so odds compare against the same row.
  "ellis reco simms": "Ellis Simms",
};

function canonicalizeBetfanPlayerName(name: string): string {
  const canonical = canonicalizePlayerName(name);
  const alias = BETFAN_PLAYER_NAME_ALIASES[canonical.toLowerCase()];
  return alias ?? canonical;
}

function resolveMarketCode(raw: RawBookmakerMarket): {
  marketCode: NormalizedMarketType;
  matchedBy: "id" | "name" | "pattern";
  rawId?: string | number;
} {
  const rawId = raw.bookmakerMarketId;

  if (rawId !== undefined && rawId !== null) {
    if (typeof rawId === "number" || /^-?\d+$/.test(String(rawId))) {
      const numericId = Number(rawId);
      const verified = BETFAN_VERIFIED_ID_OVERRIDES[String(numericId)];
      if (verified) {
        return { marketCode: verified, matchedBy: "id", rawId: numericId };
      }
      const byId = BETFAN_MARKET_ID_TO_CODE[numericId];
      if (byId) {
        return { marketCode: byId, matchedBy: "id", rawId: numericId };
      }
    } else {
      const normalizedType = normalizeText(String(rawId)).replace(/\s+/g, "_");
      const byType = BETFAN_MARKET_TYPE_TO_CODE[normalizedType];
      if (byType) {
        return { marketCode: byType, matchedBy: "id", rawId: String(rawId) };
      }
    }
  }

  const normalizedName = normalizeText(raw.name);
  const direct = BETFAN_MARKET_NAME_OVERRIDES[normalizedName];
  if (direct) {
    return { marketCode: direct, matchedBy: "name", rawId: rawId ?? undefined };
  }

  for (const entry of BETFAN_MARKET_PATTERNS) {
    if (entry.pattern.test(normalizedName)) {
      return { marketCode: entry.code, matchedBy: "pattern", rawId: rawId ?? undefined };
    }
  }

  return { marketCode: "OTHER", matchedBy: "pattern", rawId: rawId ?? undefined };
}

/** Two-way handicap codes and their three-way (with draw) counterparts. */
const THREE_WAY_HANDICAP_VARIANTS: Partial<Record<NormalizedMarketType, NormalizedMarketType>> = {
  ASIAN_HANDICAP: "EUROPEAN_HANDICAP",
  FIRST_HALF_ASIAN_HANDICAP: "FIRST_HALF_EUROPEAN_HANDICAP",
  SECOND_HALF_ASIAN_HANDICAP: "SECOND_HALF_EUROPEAN_HANDICAP",
};

function resolveHandicapCode(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): NormalizedMarketType {
  const threeWayCode = THREE_WAY_HANDICAP_VARIANTS[marketCode];
  if (!threeWayCode) {
    return marketCode;
  }

  const hasDrawSelection = raw.selections.some((sel) => {
    const normalized = normalizeText(sel.name);
    return normalized === "x" || normalized.startsWith("x ") || normalized.includes("remis");
  });

  if (hasDrawSelection || raw.selections.length === 3) {
    return threeWayCode;
  }

  return marketCode;
}

/**
 * Words that indicate a name segment is market phrasing, not a team name.
 * Applied to diacritic-free lowercase text.
 */
const MARKET_KEYWORD_PATTERN =
  /\b(gol|gole|gola|goli|golem|golami|bramk\w*|wynik\w*|handicap|polow\w*|kartk\w*|rozn\w*|konto|strzel\w*|strzal\w*|przedzial\w*|liczba|zaklad\w*|szansa|remis|mecz\w*|faul\w*|spalon\w*|wygra|zera|obie|druzyn\w*|zespol\w*|zawodnik\w*|minut\w*|czas\w*|dokladn\w*|karn\w*|rzut\w*|powyzej|ponizej)\b/;

/**
 * Detects which match team a raw market name refers to, e.g.
 * "Austria - przedzial bramkowy" -> AWAY when Austria is the away team.
 * Splits the name into segments and matches each candidate against the
 * context teams, including canonical alias resolution so Polish names
 * ("Algieria", "Wyspy Zielonego Przyladka") match canonical context teams.
 */
function detectTeamSide(rawName: string, ctx: NormalizationContext): "HOME" | "AWAY" | null {
  const segments = rawName.split(/\s*:\s*|\s+[-–]\s+/);
  const candidates: string[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || /^\d/.test(trimmed)) continue;
    candidates.push(trimmed);
    // Strip trailing market phrases: "Algieria wygra obie polowy" -> "Algieria"
    const stripped = trimmed
      .replace(/\s+(wygra|czyste|strzeli|zdob\w*|po[lł]ow\w*|przedzia\w*|liczba|dok[lł]adna|handicap)\b.*$/i, "")
      .trim();
    if (stripped && stripped !== trimmed) candidates.push(stripped);
  }

  for (const candidate of candidates) {
    if (MARKET_KEYWORD_PATTERN.test(normalizeText(candidate))) continue;
    const side = normalize1x2Selection(candidate, ctx.homeTeam, ctx.awayTeam, ctx.league);
    if (side === "HOME" || side === "AWAY") return side;
  }

  return null;
}

/** Full-match codes and their half-scoped catalog counterparts. */
const HALF_SCOPED_CODE_MAP: Partial<
  Record<NormalizedMarketType, { firstHalf: NormalizedMarketType; secondHalf: NormalizedMarketType }>
> = {
  MATCH_WINNER: { firstHalf: "HALF_TIME_RESULT", secondHalf: "SECOND_HALF_RESULT" },
  DOUBLE_CHANCE: { firstHalf: "HALF_TIME_DOUBLE_CHANCE", secondHalf: "SECOND_HALF_DOUBLE_CHANCE" },
  DRAW_NO_BET: { firstHalf: "HALF_TIME_DRAW_NO_BET", secondHalf: "SECOND_HALF_DRAW_NO_BET" },
  BTTS: { firstHalf: "HALF_TIME_BTTS", secondHalf: "SECOND_HALF_BTTS" },
  TOTAL_GOALS: { firstHalf: "HALF_TIME_TOTAL_GOALS", secondHalf: "SECOND_HALF_TOTAL_GOALS" },
  CORRECT_SCORE: { firstHalf: "HALF_TIME_CORRECT_SCORE", secondHalf: "SECOND_HALF_CORRECT_SCORE" },
  GOAL_RANGE: { firstHalf: "HALF_TIME_GOAL_RANGE", secondHalf: "SECOND_HALF_GOAL_RANGE" },
  // Half-scoped stat totals ("1. polowa - liczba kartek") must not feed the
  // full-match markets - the odds distributions are incomparable.
  CORNERS_TOTAL: { firstHalf: "HALF_TIME_CORNERS_TOTAL", secondHalf: "SECOND_HALF_CORNERS_TOTAL" },
  CARDS_TOTAL: { firstHalf: "HALF_TIME_CARDS_TOTAL", secondHalf: "SECOND_HALF_CARDS_TOTAL" },
};

/** Generic codes and their team-scoped catalog counterparts. */
const TEAM_SCOPED_CODE_MAP: Partial<
  Record<NormalizedMarketType, { home: NormalizedMarketType; away: NormalizedMarketType }>
> = {
  TEAM_TOTAL_GOALS: { home: "HOME_TEAM_TOTAL_GOALS", away: "AWAY_TEAM_TOTAL_GOALS" },
  HALF_TIME_TOTAL_GOALS: {
    home: "HALF_TIME_HOME_TEAM_TOTAL_GOALS",
    away: "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
  },
  SECOND_HALF_TOTAL_GOALS: {
    home: "SECOND_HALF_HOME_TEAM_TOTAL_GOALS",
    away: "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
  },
  HOME_GOAL_RANGE: { home: "HOME_GOAL_RANGE", away: "AWAY_GOAL_RANGE" },
  AWAY_GOAL_RANGE: { home: "HOME_GOAL_RANGE", away: "AWAY_GOAL_RANGE" },
  HALF_WITH_MORE_GOALS: { home: "HOME_HALF_WITH_MOST_GOALS", away: "AWAY_HALF_WITH_MOST_GOALS" },
  HOME_HALF_WITH_MOST_GOALS: {
    home: "HOME_HALF_WITH_MOST_GOALS",
    away: "AWAY_HALF_WITH_MOST_GOALS",
  },
  AWAY_HALF_WITH_MOST_GOALS: {
    home: "HOME_HALF_WITH_MOST_GOALS",
    away: "AWAY_HALF_WITH_MOST_GOALS",
  },
  WIN_TO_NIL: { home: "HOME_WIN_TO_NIL", away: "AWAY_WIN_TO_NIL" },
  TEAM_WIN_BOTH_HALVES: { home: "HOME_WIN_BOTH_HALVES", away: "AWAY_WIN_BOTH_HALVES" },
  TEAM_WIN_AT_LEAST_ONE_HALF: {
    home: "HOME_WIN_AT_LEAST_ONE_HALF",
    away: "AWAY_WIN_AT_LEAST_ONE_HALF",
  },
  BOTH_HALVES_GOALS: { home: "HOME_SCORE_BOTH_HALVES", away: "AWAY_SCORE_BOTH_HALVES" },
  EXACT_GOALS: { home: "HOME_EXACT_GOALS", away: "AWAY_EXACT_GOALS" },
  // Betfan ids 126/127 are per-team markets whose side is only known from the
  // name ("Kolumbia wygra obie polowy" arrives under the "home" id), so the
  // id-guessed side codes must also be re-resolved from the team name.
  HOME_WIN_BOTH_HALVES: { home: "HOME_WIN_BOTH_HALVES", away: "AWAY_WIN_BOTH_HALVES" },
  AWAY_WIN_BOTH_HALVES: { home: "HOME_WIN_BOTH_HALVES", away: "AWAY_WIN_BOTH_HALVES" },
  HOME_WIN_AT_LEAST_ONE_HALF: {
    home: "HOME_WIN_AT_LEAST_ONE_HALF",
    away: "AWAY_WIN_AT_LEAST_ONE_HALF",
  },
  AWAY_WIN_AT_LEAST_ONE_HALF: {
    home: "HOME_WIN_AT_LEAST_ONE_HALF",
    away: "AWAY_WIN_AT_LEAST_ONE_HALF",
  },
  // Team-scoped OPTA offsides: the whole-match id family also carries
  // "<team> - Liczba spalonych (OPTA)" markets, and the id-guessed home code
  // must be re-resolved from the team name ("Kolumbia ..." is the away side).
  OFFSIDES_TOTAL: { home: "HOME_TEAM_TOTAL_OFFSIDES", away: "AWAY_TEAM_TOTAL_OFFSIDES" },
  HOME_TEAM_TOTAL_OFFSIDES: {
    home: "HOME_TEAM_TOTAL_OFFSIDES",
    away: "AWAY_TEAM_TOTAL_OFFSIDES",
  },
  // Per-team 1st-half exact corners arrive under home/away ids whose side is
  // only reliable from the team name in the market title.
  HALF_TIME_HOME_EXACT_CORNERS: {
    home: "HALF_TIME_HOME_EXACT_CORNERS",
    away: "HALF_TIME_AWAY_EXACT_CORNERS",
  },
  HALF_TIME_AWAY_EXACT_CORNERS: {
    home: "HALF_TIME_HOME_EXACT_CORNERS",
    away: "HALF_TIME_AWAY_EXACT_CORNERS",
  },
};

const FIRST_HALF_PREFIX = /^1\.?\s*polow/;
const SECOND_HALF_PREFIX = /^2\.?\s*polow/;

/**
 * Refines a resolved market code using the raw market name and match context.
 * Handles stat-specific handicaps (corners / shots on target / cards),
 * half-scoped variants ("2. polowa - zaklad bez remisu") and team-scoped
 * markets that must land in side-specific HOME/AWAY catalog codes
 * ("Austria - przedzial bramkowy"). Applies to both id- and name-resolved
 * codes, since Betfan reuses generic game types for scoped variants.
 */
function refineMarketCode(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): NormalizedMarketType {
  const name = normalizeText(raw.name);
  let code = marketCode;

  let cachedSide: "HOME" | "AWAY" | null | undefined;
  const teamSide = (): "HOME" | "AWAY" | null => {
    if (cachedSide === undefined) cachedSide = detectTeamSide(raw.name, ctx);
    return cachedSide;
  };

  // Handicap family: stat-specific and half-scoped variants must not pollute
  // the full-match goals handicap market.
  if (code === "ASIAN_HANDICAP" || code === "EUROPEAN_HANDICAP") {
    if (/celne strzaly|celnych strzalow/.test(name)) {
      code = "SHOTS_ON_TARGET_HANDICAP";
    } else if (/rzuty rozne|rzutow roznych/.test(name)) {
      if (FIRST_HALF_PREFIX.test(name)) code = "HALF_TIME_CORNERS_HANDICAP";
      // No 2nd-half corners handicap code in the catalog
      else if (SECOND_HALF_PREFIX.test(name)) code = "OTHER";
      else code = "CORNERS_HANDICAP";
    } else if (/kartk/.test(name)) {
      code = FIRST_HALF_PREFIX.test(name) ? "HALF_TIME_CARDS_HANDICAP" : "CARDS_HANDICAP";
    } else if (FIRST_HALF_PREFIX.test(name)) {
      code = "FIRST_HALF_ASIAN_HANDICAP";
    } else if (SECOND_HALF_PREFIX.test(name)) {
      code = "SECOND_HALF_ASIAN_HANDICAP";
    }
  }

  // Betfan's HOME/AWAY_TEAM_OVER_UNDER ids (120/121) also carry a completely
  // unrelated half-scoped BTTS market ("1./2. polowa - obie druzyny strzela
  // gola") under the same numeric id - trust the market name over the
  // id-resolved code so the Tak/Nie selections land in HALF_TIME_BTTS/
  // SECOND_HALF_BTTS instead of being forced through the team-goals
  // OVER/UNDER vocabulary as literal "Tak"/"Nie" strings.
  if (
    (code === "HOME_TEAM_TOTAL_GOALS" || code === "AWAY_TEAM_TOTAL_GOALS") &&
    /obie.*strzela/.test(name)
  ) {
    code = FIRST_HALF_PREFIX.test(name) ? "HALF_TIME_BTTS" : "SECOND_HALF_BTTS";
  }

  // Double chance + BTTS combos must not bleed into plain double chance
  if (
    (code === "DOUBLE_CHANCE" ||
      code === "HALF_TIME_DOUBLE_CHANCE" ||
      code === "SECOND_HALF_DOUBLE_CHANCE") &&
    /podwojna szansa.*obie.*strzel/.test(name)
  ) {
    if (FIRST_HALF_PREFIX.test(name)) code = "HALF_TIME_DOUBLE_CHANCE_BTTS";
    else if (SECOND_HALF_PREFIX.test(name)) code = "SECOND_HALF_DOUBLE_CHANCE_BTTS";
    else code = "DOUBLE_CHANCE_BTTS";
  }

  // Betfan reuses numeric game-type ids across unrelated markets, so an
  // id-resolved goals code can carry a plain double-chance market (raw
  // "1. polowa - podwojna szansa" arrives under the team-goals game type).
  // Trust the market name when it is exactly the double-chance phrasing.
  const dcExact = name.match(/^(?:([12])\.?\s*polow\w*\s*[-–]*\s*)?podwojna szansa$/);
  if (
    dcExact &&
    code !== "DOUBLE_CHANCE" &&
    code !== "HALF_TIME_DOUBLE_CHANCE" &&
    code !== "SECOND_HALF_DOUBLE_CHANCE"
  ) {
    code =
      dcExact[1] === "1"
        ? "HALF_TIME_DOUBLE_CHANCE"
        : dcExact[1] === "2"
          ? "SECOND_HALF_DOUBLE_CHANCE"
          : "DOUBLE_CHANCE";
  }

  // Betfan sends plain half-result markets ("2. polowa - wynik", 3 outcomes)
  // under the HT/FT game-type id; a 3-way half result must not pollute the
  // 9-way HT/FT double-result market.
  if (code === "HALFTIME_FULLTIME") {
    if (/^1\.?\s*polow\w*\s*[-–]\s*wynik$/.test(name)) code = "HALF_TIME_RESULT";
    else if (/^2\.?\s*polow\w*\s*[-–]\s*wynik$/.test(name)) code = "SECOND_HALF_RESULT";
  }

  // Combined "result + total goals" markets ("1. polowa - wynik i liczba
  // goli", 6 outcomes) must not merge into the plain 1X2 result markets.
  if (/wynik i liczba goli/.test(name)) {
    if (FIRST_HALF_PREFIX.test(name)) code = "HALF_TIME_RESULT_AND_TOTAL";
    else if (SECOND_HALF_PREFIX.test(name)) code = "SECOND_HALF_RESULT_AND_TOTAL";
    else code = "RESULT_AND_TOTAL";
  }

  // Combined "result + BTTS" markets ("1. polowa - wynik i obie druzyny
  // strzela", 6 outcomes) must not merge into the plain YES/NO BTTS binaries.
  if (
    (code === "BTTS" || code === "HALF_TIME_BTTS" || code === "SECOND_HALF_BTTS") &&
    /wynik i obie/.test(name)
  ) {
    if (FIRST_HALF_PREFIX.test(name)) code = "HALF_TIME_RESULT_AND_BTTS";
    else if (SECOND_HALF_PREFIX.test(name)) code = "SECOND_HALF_RESULT_AND_BTTS";
    else code = "RESULT_AND_BTTS";
  }

  // Half-scoped first-goal markets ("2. polowa - 1. gol") must not pollute
  // the full-match first-team-to-score market.
  if (code === "FIRST_TEAM_TO_SCORE") {
    if (FIRST_HALF_PREFIX.test(name)) code = "HALF_TIME_FIRST_GOAL";
    else if (SECOND_HALF_PREFIX.test(name)) code = "SECOND_HALF_FIRST_GOAL";
  }

  // Exact goal count markets ("dokladna liczba goli") per half / per team
  if (/dokladna liczba goli/.test(name)) {
    if (FIRST_HALF_PREFIX.test(name)) code = "HALF_TIME_EXACT_GOALS";
    else if (SECOND_HALF_PREFIX.test(name)) code = "SECOND_HALF_EXACT_GOALS";
    else if (teamSide() === "HOME") code = "HOME_EXACT_GOALS";
    else if (teamSide() === "AWAY") code = "AWAY_EXACT_GOALS";
  }

  // Half-scoped variants of full-match markets
  const halfScoped = HALF_SCOPED_CODE_MAP[code];
  if (halfScoped) {
    if (FIRST_HALF_PREFIX.test(name)) code = halfScoped.firstHalf;
    else if (SECOND_HALF_PREFIX.test(name)) code = halfScoped.secondHalf;
  }

  // Half-scoped clean sheets are team-specific YES/NO markets in the catalog
  if (code === "CLEAN_SHEET") {
    const firstHalf = FIRST_HALF_PREFIX.test(name);
    const secondHalf = SECOND_HALF_PREFIX.test(name);
    if (firstHalf || secondHalf) {
      const side = teamSide();
      if (side === "HOME") {
        code = firstHalf ? "HALF_TIME_HOME_CLEAN_SHEET" : "SECOND_HALF_HOME_CLEAN_SHEET";
      } else if (side === "AWAY") {
        code = firstHalf ? "HALF_TIME_AWAY_CLEAN_SHEET" : "SECOND_HALF_AWAY_CLEAN_SHEET";
      } else {
        // Half-scoped clean sheet without a resolvable team cannot be compared
        // against the full-match market
        code = "OTHER";
      }
    }
  }

  // Team-prefixed stat totals ("Szwajcaria - liczba strzalow (OPTA)",
  // "Szwajcaria - liczba rzutow roznych", "Maroko - liczba kartek") arrive
  // under whole-match ids and must move to the per-team catalog codes - a
  // single team's line merged into the whole-match market corrupts the
  // parameter list (e.g. a team's lower card count masquerading as the
  // match-wide total at the same param rows).
  if (
    (code === "TOTAL_SHOTS" ||
      code === "TOTAL_SHOTS_ON_TARGET" ||
      code === "FOULS_TOTAL" ||
      code === "CORNERS_TOTAL" ||
      code === "CARDS_TOTAL") &&
    teamSide() !== null
  ) {
    if (code === "TOTAL_SHOTS") code = "TEAM_TOTAL_SHOTS";
    else if (code === "TOTAL_SHOTS_ON_TARGET") code = "TEAM_TOTAL_SHOTS_ON_TARGET";
    else if (code === "FOULS_TOTAL") code = "TEAM_TOTAL_FOULS";
    else if (code === "CARDS_TOTAL") code = "CARDS_TEAM";
    else code = "CORNERS_TEAM";
  }

  // Team-scoped markets routed to HOME_*/AWAY_* catalog codes
  const teamScoped = TEAM_SCOPED_CODE_MAP[code];
  if (teamScoped) {
    const side = teamSide();
    if (side === "HOME") code = teamScoped.home;
    else if (side === "AWAY") code = teamScoped.away;
  }

  // Band sub-tables ("0-2","3-4","5-6","7+") share ids with the O/U corner
  // lines. Route them to the unparameterized range codes so they are not
  // dropped by the grouper's decimal-parameter guard.
  const isBandSelections =
    raw.selections.length > 0 &&
    raw.selections.every((sel) => /^\d+(?:\s*-\s*\d+)?\s*\+?$/.test(sel.name.trim()));
  if (isBandSelections) {
    if (code === "CORNERS_TEAM") code = "CORNERS_TEAM_RANGE";
    else if (code === "HALF_TIME_CORNERS_TOTAL") code = "HALF_TIME_CORNERS_RANGE";
    else if (code === "CORNERS_TOTAL") code = "CORNERS_RANGE";
  }

  // Betfan lists an exact-goal-count sub-table under the same raw name as the
  // team O/U lines ("Kolumbia - liczba goli" with selections 0/1/2/3+). Route
  // it to the exact-goals catalog codes instead of the OVER/UNDER slider.
  if (
    (code === "HOME_TEAM_TOTAL_GOALS" ||
      code === "AWAY_TEAM_TOTAL_GOALS" ||
      code === "TEAM_TOTAL_GOALS") &&
    raw.selections.length > 0 &&
    raw.selections.every((sel) => /^\d+\s*\+?$/.test(sel.name.trim()))
  ) {
    if (code === "HOME_TEAM_TOTAL_GOALS") code = "HOME_EXACT_GOALS";
    else if (code === "AWAY_TEAM_TOTAL_GOALS") code = "AWAY_EXACT_GOALS";
    // Team-scoped exact counts without a resolvable side cannot be compared
    // against either catalog market
    else code = "OTHER";
  }

  // Betfan also carries a raw 3-way exact first-half goal count ("0"/"1"/
  // "2+") under the identical raw name as the correctly-mapped 0.5/1.5
  // half-time O/U lines ("1. polowa - liczba goli"). Its bare-digit selections
  // never match OVER/UNDER, so it would otherwise land in an unparameterized
  // "base" HALF_TIME_TOTAL_GOALS bucket (a decimal-parameter market) and be
  // silently dropped. Route it to the catalog's dedicated exact-count code
  // instead, which already covers this exact "0"/"1"/"2"/"2+"/"3+" shape.
  if (
    code === "HALF_TIME_TOTAL_GOALS" &&
    raw.selections.length > 0 &&
    raw.selections.every((sel) => /^\d+\+?$/.test(sel.name.trim()))
  ) {
    code = "HALF_TIME_EXACT_GOALS";
  }

  return code;
}

function normalizeBetfanDoubleChance(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const base = normalizeDoubleChanceSelection(selectionName);
  if (base !== "UNKNOWN") return base;

  const normalizedSelection = normalizeText(selectionName.replace(/[\/]/g, " "));
  const home = normalizeText(ctx.homeTeam ?? "");
  const away = normalizeText(ctx.awayTeam ?? "");

  if (normalizedSelection.includes("remis") || normalizedSelection.includes("x")) {
    if (home && normalizedSelection.includes(home)) return "HOME_OR_DRAW";
    if (away && normalizedSelection.includes(away)) return "DRAW_OR_AWAY";
  }

  if (home && away && normalizedSelection.includes(home) && normalizedSelection.includes(away)) {
    return "HOME_OR_AWAY";
  }

  // Canonical fallback: resolve each side of "A/B" separately so Polish team
  // names ("Algieria/Austria") match the canonical context teams via aliases.
  const parts = selectionName
    .split("/")
    .map((part) => normalize1x2Selection(part.trim(), ctx.homeTeam, ctx.awayTeam, ctx.league));
  if (parts.length === 2) {
    const sides = new Set(parts);
    if (sides.has("HOME") && sides.has("DRAW")) return "HOME_OR_DRAW";
    if (sides.has("DRAW") && sides.has("AWAY")) return "DRAW_OR_AWAY";
    if (sides.has("HOME") && sides.has("AWAY")) return "HOME_OR_AWAY";
  }

  return "UNKNOWN";
}

function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext,
  teamSide?: "HOME" | "AWAY" | null
): NormalizedSelection {
  const trimmed = selectionName.trim();

  // Literal catalog-code passthrough: band/range/exact markets often quote
  // raw selection text that IS the catalog selection code ("0-2", "7+", "1+"),
  // and per-market cases below may miss them (falling through to UNKNOWN).
  const literalCatalogCodes = getMarketByCode(marketCode)?.selections;
  if (literalCatalogCodes && literalCatalogCodes.length > 0 && literalCatalogCodes.includes(trimmed)) {
    return trimmed as NormalizedSelection;
  }

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "HALF_TIME_DRAW_NO_BET":
    case "SECOND_HALF_DRAW_NO_BET":
    case "TIME_PERIOD_RESULT":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "FIRST_TEAM_TO_SCORE":
    case "LAST_TEAM_TO_SCORE":
    case "HALF_TIME_FIRST_GOAL":
    case "SECOND_HALF_FIRST_GOAL": {
      const normalized = normalizeText(trimmed);
      if (/^(zaden|zadna|nikt|brak)/.test(normalized)) return "NONE";
      if (/^obie/.test(normalized)) return "BOTH" as NormalizedSelection;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "DOUBLE_CHANCE":
    case "HALF_TIME_DOUBLE_CHANCE":
    case "SECOND_HALF_DOUBLE_CHANCE":
      return normalizeBetfanDoubleChance(trimmed, ctx);

    case "DOUBLE_CHANCE_BTTS":
    case "HALF_TIME_DOUBLE_CHANCE_BTTS":
    case "SECOND_HALF_DOUBLE_CHANCE_BTTS":
    case "DOUBLE_CHANCE_HALF_TIME_BTTS":
    case "DOUBLE_CHANCE_SECOND_HALF_BTTS": {
      // "Remis/Austria i tak" -> X2_YES
      const comboMatch = trimmed.match(/^(.+?)\s+i\s+(tak|nie)$/i);
      if (comboMatch) {
        const dc = normalizeBetfanDoubleChance(comboMatch[1].trim(), ctx);
        const yesNo = normalizeYesNoSelection(comboMatch[2]);
        const dcToken =
          dc === "HOME_OR_DRAW" ? "1X" : dc === "DRAW_OR_AWAY" ? "X2" : dc === "HOME_OR_AWAY" ? "12" : null;
        if (dcToken && yesNo !== "UNKNOWN") {
          return `${dcToken}_${yesNo}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "RESULT_AND_BTTS":
    case "HALF_TIME_RESULT_AND_BTTS":
    case "SECOND_HALF_RESULT_AND_BTTS": {
      // "Szwajcaria i tak" -> HOME_YES, "X i nie" -> DRAW_NO
      const comboMatch = trimmed.match(/^(.+?)\s+i\s+(tak|nie)$/i);
      if (comboMatch) {
        const side = normalize1x2Selection(
          comboMatch[1].trim(),
          ctx.homeTeam,
          ctx.awayTeam,
          ctx.league
        );
        const yesNo = normalizeYesNoSelection(comboMatch[2]);
        if (side !== "UNKNOWN" && yesNo !== "UNKNOWN") {
          return `${side}_${yesNo}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "RESULT_AND_TOTAL":
    case "HALF_TIME_RESULT_AND_TOTAL":
    case "SECOND_HALF_RESULT_AND_TOTAL": {
      // "Szwajcaria i powyzej 2.5" -> HOME_OVER, "X i ponizej 1.5" -> DRAW_UNDER
      const comboMatch = trimmed.match(/^(.+?)\s+i\s+((?:powy|poni)[żz]ej\s+\d+(?:[.,]\d+)?)$/i);
      if (comboMatch) {
        const side = normalize1x2Selection(
          comboMatch[1].trim(),
          ctx.homeTeam,
          ctx.awayTeam,
          ctx.league
        );
        const overUnder = normalizeOverUnderSelection(comboMatch[2]);
        if (side !== "UNKNOWN" && overUnder !== "UNKNOWN") {
          return `${side}_${overUnder}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "DOUBLE_CHANCE_TOTAL": {
      // "Szwajcaria/Remis i powyzej 2.5" (or "1X i powyzej 2.5") -> 1X_OVER
      const comboMatch = trimmed.match(/^(.+?)\s+i\s+((?:powy|poni)[żz]ej\s+\d+(?:[.,]\d+)?)$/i);
      if (comboMatch) {
        const dc = normalizeBetfanDoubleChance(comboMatch[1].trim(), ctx);
        const overUnder = normalizeOverUnderSelection(comboMatch[2]);
        const dcToken =
          dc === "HOME_OR_DRAW" ? "1X" : dc === "DRAW_OR_AWAY" ? "X2" : dc === "HOME_OR_AWAY" ? "12" : null;
        if (dcToken && overUnder !== "UNKNOWN") {
          return `${dcToken}_${overUnder}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "TOTAL_GOALS_AND_BTTS": {
      // "Powyzej 2.5 i tak" -> OVER_YES (also accepts the reversed order)
      const ouFirst = trimmed.match(/^((?:powy|poni)[żz]ej\s+\d+(?:[.,]\d+)?)\s+i\s+(tak|nie)$/i);
      if (ouFirst) {
        const overUnder = normalizeOverUnderSelection(ouFirst[1]);
        const yesNo = normalizeYesNoSelection(ouFirst[2]);
        if (overUnder !== "UNKNOWN" && yesNo !== "UNKNOWN") {
          return `${overUnder}_${yesNo}` as NormalizedSelection;
        }
      }
      const yesNoFirst = trimmed.match(/^(tak|nie)\s+i\s+((?:powy|poni)[żz]ej\s+\d+(?:[.,]\d+)?)$/i);
      if (yesNoFirst) {
        const yesNo = normalizeYesNoSelection(yesNoFirst[1]);
        const overUnder = normalizeOverUnderSelection(yesNoFirst[2]);
        if (overUnder !== "UNKNOWN" && yesNo !== "UNKNOWN") {
          return `${overUnder}_${yesNo}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS":
    case "HOME_TEAM_TOTAL_GOALS":
    case "AWAY_TEAM_TOTAL_GOALS":
    case "HALF_TIME_HOME_TEAM_TOTAL_GOALS":
    case "HALF_TIME_AWAY_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_HOME_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS":
    case "CORNERS_TOTAL":
    case "CORNERS_TEAM":
    case "HALF_TIME_CORNERS_TOTAL":
    case "SECOND_HALF_CORNERS_TOTAL":
    case "CARDS_TOTAL":
    case "HALF_TIME_CARDS_TOTAL":
    case "SECOND_HALF_CARDS_TOTAL":
    case "TOTAL_SHOTS":
    case "TEAM_TOTAL_SHOTS":
    case "TOTAL_SHOTS_ON_TARGET":
    case "TEAM_TOTAL_SHOTS_ON_TARGET":
    case "FOULS_TOTAL":
    case "TEAM_TOTAL_FOULS":
    case "OFFSIDES_TOTAL":
    case "HOME_TEAM_TOTAL_OFFSIDES":
    case "AWAY_TEAM_TOTAL_OFFSIDES": {
      const overUnder = normalizeOverUnderSelection(trimmed);
      return overUnder === "UNKNOWN" ? (trimmed as NormalizedSelection) : overUnder;
    }

    // Catalog vocabulary is side-prefixed (HOME_OVER/HOME_UNDER/AWAY_OVER/
    // AWAY_UNDER); the side comes from the market scope (see
    // TEAM_LINE_PARAM_MARKETS), the selection text only carries the O/U leg.
    case "CARDS_TEAM": {
      const overUnder = normalizeOverUnderSelection(trimmed);
      if (overUnder === "UNKNOWN" || !teamSide) return trimmed as NormalizedSelection;
      return `${teamSide}_${overUnder}` as NormalizedSelection;
    }

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
    case "BOTH_HALVES_GOALS":
    case "BOTH_HALVES_OVER_GOALS":
    case "BOTH_HALVES_UNDER_GOALS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
    case "HOME_SCORE_BOTH_HALVES":
    case "AWAY_SCORE_BOTH_HALVES":
    case "OWN_GOAL":
    case "TEAM_WIN_AT_LEAST_ONE_HALF":
    case "TEAM_WIN_BOTH_HALVES":
    case "HOME_WIN_AT_LEAST_ONE_HALF":
    case "AWAY_WIN_AT_LEAST_ONE_HALF":
    case "HOME_WIN_BOTH_HALVES":
    case "AWAY_WIN_BOTH_HALVES":
    case "HOME_WIN_TO_NIL":
    case "AWAY_WIN_TO_NIL":
    case "HALF_TIME_HOME_CLEAN_SHEET":
    case "HALF_TIME_AWAY_CLEAN_SHEET":
    case "SECOND_HALF_HOME_CLEAN_SHEET":
    case "SECOND_HALF_AWAY_CLEAN_SHEET":
    case "RED_CARD":
    case "RED_CARD_TEAM":
    case "HALF_TIME_RED_CARD":
    case "PENALTY_AWARDED":
    case "PENALTY_SHOOTOUT":
    case "COMEBACK":
      return normalizeYesNoSelection(trimmed);

    // "Each team over X" binaries: the raw selection is either a bare
    // "Tak"/"Nie" or a repeat of the market phrase ("Kazda druzyna powyzej
    // 1.5 rzutow roznych"), which always describes the over/yes side.
    case "BOTH_TEAMS_OVER_CORNERS":
    case "BOTH_TEAMS_CORNERS_EACH_HALF":
    case "TEAM_CORNERS_BOTH_HALVES_OVER":
    case "BOTH_TEAMS_CARDS_OVER":
    case "BOTH_TEAMS_OVER_FOULS":
    case "EACH_TEAM_SHOTS_ON_TARGET": {
      const yesNo = normalizeYesNoSelection(trimmed);
      if (yesNo !== "UNKNOWN") return yesNo;
      const normalized = normalizeText(trimmed);
      if (/powyzej/.test(normalized)) return "YES";
      if (/ponizej/.test(normalized)) return "NO";
      return "UNKNOWN";
    }

    // Same market family, but the catalog vocabulary here is OVER/UNDER
    case "EACH_TEAM_OFFSIDES": {
      const yesNo = normalizeYesNoSelection(trimmed);
      const normalized = normalizeText(trimmed);
      if (yesNo === "YES" || /powyzej/.test(normalized)) return "OVER";
      if (yesNo === "NO" || /ponizej/.test(normalized)) return "UNDER";
      return "UNKNOWN";
    }

    // Race markets ("Kto wiecej ...") quote the draw as "Tyle samo"
    case "CORNERS_RACE":
    case "HALF_TIME_CORNERS_RACE":
    case "CARDS_RACE":
    case "FOUL_RACE":
    case "MOST_SHOTS_ON_TARGET":
    case "FIRST_HALF_CARDS_1X2": {
      const normalized = normalizeText(trimmed);
      if (normalized === "tyle samo" || normalized === "rowno") return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    // First/last corner and first card markets quote "Brak" for no event
    case "FIRST_CORNER":
    case "LAST_CORNER":
    case "HALF_TIME_FIRST_CORNER":
    case "FIRST_HALF_FIRST_CARD": {
      const normalized = normalizeText(trimmed);
      if (/^(brak|zaden|zadna|nikt)/.test(normalized)) return "NONE";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    // Exact/band corner counts use the raw numeric text as the catalog code
    case "CORNERS_TEAM_RANGE":
    case "HALF_TIME_CORNERS_RANGE":
    case "HALF_TIME_HOME_EXACT_CORNERS":
    case "HALF_TIME_AWAY_EXACT_CORNERS":
      return trimmed as NormalizedSelection;

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP":
    case "FIRST_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP":
    case "SECOND_HALF_EUROPEAN_HANDICAP":
    case "CORNERS_HANDICAP":
    case "HALF_TIME_CORNERS_HANDICAP":
    case "CARDS_HANDICAP":
    case "HALF_TIME_CARDS_HANDICAP":
    case "SHOTS_ON_TARGET_HANDICAP": {
      // Strip a trailing parenthetical line: "Algieria (0:2)", "Austria (+1.5)"
      const base = trimmed.replace(/\s*\([^)]*\)\s*$/, "").trim();
      // Full-match handicap selections carry the line unbracketed
      // ("Szwajcaria -1.5", "Kolumbia +1", "Szwajcaria 0") - strip a trailing
      // bare handicap value so the team name resolves via canonical matching.
      const teamOnly = base.replace(/\s+[+-]?\d+(?:[.,]\d+)?$/, "").trim();
      const candidate = teamOnly.length > 0 ? teamOnly : base;
      if (/^1\b/i.test(candidate)) return "HOME";
      if (/^2\b/i.test(candidate)) return "AWAY";
      if (/^x\b/i.test(candidate) || /^remis$/i.test(normalizeText(candidate))) return "DRAW";
      return normalizeHandicapSelection(candidate, ctx);
    }

    case "CORRECT_SCORE":
    case "HALF_TIME_CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE": {
      const normalized = normalizeText(trimmed);
      if (normalized === "inne" || normalized === "inny") {
        return "OTHER" as NormalizedSelection;
      }
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HT_FT_CORRECT_SCORE": {
      // Convert dash score notation to the catalog's colon notation on each
      // half independently: "0-0 / 1-0" -> "0:0 / 1:0". Also covers the
      // orphaned open-ended bucket ("0-0 / 4+", "4+ / 4+") where one or both
      // halves collapse into a tail bucket instead of a paired score - the
      // bucket text is left untouched while the score half still gets its
      // separator normalized, matching forbet's colon-based vocabulary.
      const parts = trimmed.split("/").map((part) => part.trim());
      if (parts.length === 2) {
        const normalizeHalf = (half: string): string => {
          const scoreMatch = half.match(/^(\d+)\s*[-:]\s*(\d+)$/);
          return scoreMatch ? `${scoreMatch[1]}:${scoreMatch[2]}` : half;
        };
        return `${normalizeHalf(parts[0])} / ${normalizeHalf(parts[1])}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "MULTI_RESULT": {
      const normalized = normalizeText(trimmed);
      if (normalized === "remis" || normalized === "x") return "X" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME":
    case "DOUBLE_RESULT": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
    case "HOME_GOALSCORER_FIRST":
    case "AWAY_GOALSCORER_FIRST":
    case "HOME_GOALSCORER_LAST":
    case "AWAY_GOALSCORER_LAST":
    case "HALF_TIME_GOALSCORER_ANYTIME":
    case "FIRST_PLAYER_CARDED":
    case "PLAYER_SHOTS":
    case "PLAYER_CARDS":
    case "PLAYER_ASSISTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_PASSES":
    case "PLAYER_HEADER_GOAL":
    case "PLAYER_FREE_KICK_GOAL":
    case "PLAYER_RIGHT_FOOT_GOAL":
    case "PLAYER_LEFT_FOOT_GOAL":
    case "PLAYER_FOULS_OVER":
    case "PLAYER_FOULS_WON":
    case "PLAYER_OFFSIDES":
    case "PLAYER_SAVES":
    case "PLAYER_RED_CARD":
    case "PLAYER_GOAL_OR_ASSIST":
    case "PLAYER_GOAL_AND_ASSIST":
    case "PLAYER_SHOTS_ANYTIME":
    case "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX":
    case "PLAYER_HEADER_SHOTS_ON_TARGET":
    case "ASSIST_SCORER_ANYTIME":
    case "PLAYER_OF_THE_MATCH":
      // Unify "Lastname, Firstname" -> "Firstname Lastname" so the same
      // player merges across bookmakers. Threshold codes ("1+", "2+") from
      // split player-prop markets pass through unchanged.
      return canonicalizeBetfanPlayerName(
        trimmed.replace(/^\d+\.\s*/, "").trim()
      ) as NormalizedSelection;

    case "WIN_TO_NIL":
    case "CLEAN_SHEET": {
      const yesNo = normalizeYesNoSelection(trimmed);
      return yesNo === "UNKNOWN"
        ? normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league)
        : yesNo;
    }

    case "TEAMS_TO_SCORE": {
      const normalized = normalizeText(trimmed);
      if (/^(zaden|zadna|brak)/.test(normalized)) return "ZERO_TEAMS";
      if (/^obie/.test(normalized)) return "TWO_TEAMS";
      if (/^tylko\s+/.test(normalized)) {
        const teamPart = trimmed.replace(/^tylko\s+/i, "").trim();
        const side = normalize1x2Selection(teamPart, ctx.homeTeam, ctx.awayTeam, ctx.league);
        if (side === "HOME") return "ONE_TEAM_HOME";
        if (side === "AWAY") return "ONE_TEAM_AWAY";
      }
      return "UNKNOWN";
    }

    case "WINNING_MARGIN": {
      const normalized = normalizeText(trimmed);
      if (normalized === "x" || normalized === "remis") return "DRAW";
      // "Algieria 2 golami" / "Austria 3+ golami" -> HOME_BY_2 / AWAY_BY_3PLUS
      const marginMatch = normalized.match(/(\d+)\s*(\+)?\s*gol\w*/);
      if (marginMatch) {
        const teamPart = trimmed.replace(/\s*\d+\s*\+?\s*gol\w*\s*$/i, "").trim();
        const side = normalize1x2Selection(teamPart, ctx.homeTeam, ctx.awayTeam, ctx.league);
        if (side === "HOME" || side === "AWAY") {
          const margin = parseInt(marginMatch[1], 10);
          const bucket = margin >= 3 || marginMatch[2] ? "3PLUS" : String(margin);
          return `${side}_BY_${bucket}` as NormalizedSelection;
        }
      }
      return trimmed as NormalizedSelection;
    }

    case "HALF_WITH_MORE_GOALS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS": {
      const normalized = normalizeText(trimmed);
      if (/^1/.test(normalized)) return "1st" as NormalizedSelection;
      if (/^2/.test(normalized)) return "2nd" as NormalizedSelection;
      if (normalized === "tyle samo" || normalized === "remis" || normalized === "x" || normalized === "rowno") {
        return "Draw" as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    case "BTTS_BY_HALF": {
      const normalized = normalizeText(trimmed);
      if (/^tak\s*\/\s*tak$/.test(normalized)) return "Both" as NormalizedSelection;
      if (/^tak\s*\/\s*nie$/.test(normalized)) return "1st" as NormalizedSelection;
      if (/^nie\s*\/\s*tak$/.test(normalized)) return "2nd" as NormalizedSelection;
      if (/^nie\s*\/\s*nie$/.test(normalized)) return "None" as NormalizedSelection;
      return "UNKNOWN";
    }

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_TIME_ALT": {
      const normalized = normalizeText(trimmed);
      if (/^(brak|zaden|bez gola)/.test(normalized)) return "NONE";
      return trimmed as NormalizedSelection;
    }

    case "GOAL_RANGE":
    case "HOME_GOAL_RANGE":
    case "AWAY_GOAL_RANGE":
    case "TEAM_GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
    case "EXACT_GOALS":
    case "HOME_EXACT_GOALS":
    case "AWAY_EXACT_GOALS":
    case "HALF_TIME_EXACT_GOALS":
    case "SECOND_HALF_EXACT_GOALS": {
      const normalized = normalizeText(trimmed);
      // "Brak gola" -> catalog code "0"
      if (/^(brak|zaden|bez gola)/.test(normalized)) return "0" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "FIRST_GOAL_AND_RESULT": {
      // "Szwajcaria gol i Szwajcaria" -> HOME_HOME, "Brak gola" -> NONE
      // (same raw phrasing as etoto's mapping for the shared platform)
      const normalized = normalizeText(trimmed);
      if (/^(brak|bez)/.test(normalized)) return "NONE";
      const comboMatch = trimmed.match(/^(.+?)\s+gol\s+i\s+(.+)$/i);
      if (comboMatch) {
        const first = normalize1x2Selection(
          comboMatch[1].trim(),
          ctx.homeTeam,
          ctx.awayTeam,
          ctx.league
        );
        const result = normalize1x2Selection(
          comboMatch[2].trim(),
          ctx.homeTeam,
          ctx.awayTeam,
          ctx.league
        );
        if (
          (first === "HOME" || first === "AWAY") &&
          (result === "HOME" || result === "DRAW" || result === "AWAY")
        ) {
          return `${first}_${result}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

// Betfan quotes whole-number over/under lines as bare Polish text ("Poniżej
// 2"/"Powyżej 2") with no decimal point and no leading sign, while its
// half-number lines ("Poniżej 1.5") carry a decimal point that the shared
// parseOverUnderLine picks up fine. The shared helper's own integer branch
// only matches signed literals ("+2"/"-2", the handicap-style shape), so it
// never matches these. Without a paramValue, a hasParameter:true "decimal"
// market is dropped entirely by the grouper (see the CORNERS_TEAM_RANGE
// comment below), so every whole-goal line silently vanished from betfan's
// TOTAL_GOALS and HALF_TIME_TOTAL_GOALS offers (audit-match, Arsenal vs
// Coventry City: line "2" missing from TOTAL_GOALS, line "1" missing from
// HALF_TIME_TOTAL_GOALS, even though both are present in the raw offer).
function parseBetfanBareIntegerOverUnderLine(selectionNames: string[]): string | undefined {
  for (const name of selectionNames) {
    const match = name.trim().match(/^(?:powy[żz]ej|poni[żz]ej)\s+(\d+)$/i);
    if (match) return match[1];
  }
  return undefined;
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): string | undefined {
  // Parser-provided parameter takes precedence: player-prop splits set the
  // player name here (checked before the hasParameter guard because some
  // player markets carry the player as a parameter despite hasParameter
  // being false in the catalog).
  if (raw.paramValue) {
    return canonicalizeBetfanPlayerName(raw.paramValue);
  }

  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);
  const groupName = raw.groupName ?? "";

  switch (metadata.parameterType) {
    // audit-match (Arsenal vs Coventry City), CORNERS_TEAM_RANGE gap: the
    // catalog declares parameterType "team" with validParameters HOME/AWAY
    // (round 8 CT-5), but this switch had no case for it, so paramValue
    // fell through to the decimal branch and came back undefined for band
    // selections like "0-2"/"3-4" - a hasParameter:true market with no
    // paramValue is dropped entirely by the grouper, silently omitting
    // betfan's whole corners-range offer. Resolve the side directly from
    // the team name embedded in the raw market name instead.
    case "team":
      return detectTeamSide(raw.name, ctx) ?? undefined;
    case "handicap": {
      // Strip a leading half indicator ("2. polowa - handicap ...") so the
      // half number is not mistaken for the handicap line.
      const nameForParam = raw.name.replace(/^\s*\d\.?\s*po[lł]ow\w*\s*[-–:]*\s*/i, "");
      // Score-style European handicap: "Handicap 0:2" means the away team
      // starts two goals up -> home-perspective line "-2".
      const scoreStyle = nameForParam.match(/handicap\s+(\d+)\s*:\s*(\d+)/i);
      if (scoreStyle) {
        const diff = parseInt(scoreStyle[1], 10) - parseInt(scoreStyle[2], 10);
        return diff > 0 ? `+${diff}` : String(diff);
      }
      return (
        parseHandicapLine(nameForParam) ??
        parseHandicapLine(selectionNames.join(" ")) ??
        parseHandicapLine(groupName)
      );
    }
    case "integer":
      return (
        parseIntegerLine(raw.name) ??
        parseIntegerLine(groupName) ??
        parseOverUnderLine(selectionNames)
      );
    case "decimal":
    default:
      return (
        parseDecimalLine(raw.name) ??
        parseDecimalLine(groupName) ??
        parseOverUnderLine(selectionNames) ??
        parseBetfanBareIntegerOverUnderLine(selectionNames)
      );
  }
}

/**
 * Team-scoped stat lines whose catalog vocabulary carries the side in the
 * PARAMETER ("HOME:6.5"/"AWAY:6.5") rather than in a dedicated HOME_/AWAY_
 * marketCode (mirrors fortuna's convention for the same catalog codes).
 * Without the side folded into the param, both teams' lines collide on the
 * same (marketCode, param) key and only one team's odds survive.
 */
const TEAM_LINE_PARAM_MARKETS = new Set<NormalizedMarketType>(["CORNERS_TEAM", "CARDS_TEAM"]);

export const betfanNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "betfan",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { marketCode, matchedBy, rawId } = resolveMarketCode(raw);
    const refinedCode = refineMarketCode(marketCode, raw, ctx);
    const resolvedCode = resolveHandicapCode(refinedCode, raw);

    if (!isValidMarketCode(resolvedCode)) {
      console.error(`[betfan] Market code "${resolvedCode}" not in catalog`);
      return null;
    }

    // PLAYER_OFFSIDES now carries 1+/2+/3+ catalog lines (audit-match:
    // Arsenal vs Coventry City — sts quotes all three thresholds and
    // betfan's own raw offside selections include 2+/3+ too), so only a
    // genuinely unrecognized tier should be dropped.
    if (
      resolvedCode === "PLAYER_OFFSIDES" &&
      !["1+", "2+", "3+"].includes(raw.selections[0]?.name.trim() ?? "")
    ) {
      return null;
    }

    const teamSide = TEAM_LINE_PARAM_MARKETS.has(resolvedCode) ? detectTeamSide(raw.name, ctx) : null;

    let paramValue = extractParamValue(resolvedCode, raw, ctx);
    if (teamSide && paramValue) {
      paramValue = `${teamSide}:${paramValue}`;
    }
    const marketKey = buildMarketKey(resolvedCode, paramValue);

    const selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, resolvedCode, ctx, teamSide),
      label: sel.name,
      odds: sel.odds,
    }));

    return {
      marketCode: resolvedCode,
      paramValue,
      marketKey,
      selections,
      debug: {
        rawName: raw.name,
        rawId: rawId ?? undefined,
        matchedBy,
      },
    };
  },
};

export default betfanNormalizer;
