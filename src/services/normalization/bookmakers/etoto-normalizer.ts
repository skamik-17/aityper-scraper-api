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
  canonicalizePlayerName,
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

/**
 * eToto bookmakerMarketId (API `gameType`) -> catalog code mappings.
 *
 * Every id below was verified against the live eToto REST API
 * (`/rest/market/events/{eventId}` detail payload). The id space is shared
 * between the listing and detail endpoints, so mapping by id is stable.
 */
const ETOTO_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  // --- Match result family ---
  [1]: "MATCH_WINNER", // "1X2"
  [3]: "HALF_TIME_RESULT", // "1. połowa - 1X2"
  [111]: "SECOND_HALF_RESULT", // "2. połowa - 1X2"
  [4]: "DOUBLE_CHANCE", // "Podwójna szansa"
  [27]: "HALF_TIME_DOUBLE_CHANCE", // "1. połowa - podwójna szansa"
  [-188]: "SECOND_HALF_DOUBLE_CHANCE", // "2. połowa - podwójna szansa"
  [5]: "HALFTIME_FULLTIME", // "1. poł./mecz"
  [93]: "DRAW_NO_BET", // "Remis = zwrot"
  [-237]: "HALF_TIME_DRAW_NO_BET", // "1. połowa - remis = zwrot"
  [-283]: "SECOND_HALF_DRAW_NO_BET", // "2. połowa - remis = zwrot"
  [-2549]: "HOME_NO_BET", // "Wynik meczu - <home> wygra = zwrot"
  [-2550]: "AWAY_NO_BET", // "Wynik meczu - <away> wygra = zwrot"
  [-8132]: "HT_OR_FT_RESULT", // "1. połowa lub mecz"
  [-8048]: "TEAM_WIN_MATCH", // "<home> wygra"
  [-8049]: "ANY_TEAM_TO_WIN", // "Którakolwiek drużyna wygra"
  [-2976]: "TIME_PERIOD_RESULT", // "10' - 1X2 od 1 do 10"

  // --- Tournament / knockout resolution ---
  [18]: "TEAM_TO_QUALIFY", // "Awans" (selections are the two team names)
  [170]: "WIN_METHOD", // "Metoda zwycięstwa" ("<team> w reg. czasie/po dogrywce/po rzutach karnych")
  [-342]: "EXTRA_TIME", // "Dogrywka" (Tak/Nie)
  [-192]: "PENALTY_SHOOTOUT", // "Seria rzutów karnych" (Tak/Nie)

  // --- BTTS / team-to-score ---
  [98]: "BTTS", // "Obie strzelą"
  [120]: "HALF_TIME_BTTS", // "1. połowa - obie strzelą"
  [121]: "SECOND_HALF_BTTS", // "2. połowa - obie strzelą"
  [-30002]: "BTTS_BY_HALF", // "Obie strzelą w 1. połowie/2. połowie"
  [-344]: "HOME_TEAM_TO_SCORE", // "<home> strzeli gola"
  [-343]: "AWAY_TEAM_TO_SCORE", // "<away> strzeli gola"
  [-232]: "TEAMS_TO_SCORE", // "Drużyna strzeli gola"

  // --- Goal totals / ranges ---
  [8]: "TOTAL_GOALS", // "Suma X goli"
  [-284]: "HALF_TIME_TOTAL_GOALS", // "1. połowa - suma X"
  [-286]: "SECOND_HALF_TOTAL_GOALS", // "2. połowa - suma X"
  [52]: "HOME_TEAM_TOTAL_GOALS", // "<home> suma X goli"
  [53]: "AWAY_TEAM_TOTAL_GOALS", // "<away> suma X goli"
  [110]: "HALF_TIME_HOME_TEAM_TOTAL_GOALS", // "1. połowa - <home> suma X"
  [117]: "HALF_TIME_AWAY_TEAM_TOTAL_GOALS", // "1. połowa - <away> suma X"
  [118]: "SECOND_HALF_HOME_TEAM_TOTAL_GOALS", // "2. połowa - <home> suma X goli"
  [119]: "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS", // "2. połowa - <away> suma X goli"
  [-227]: "EXACT_GOALS", // "Suma goli" (0..6+)
  [102]: "HOME_EXACT_GOALS", // "<home> suma goli" (0/1/2/3+)
  [103]: "AWAY_EXACT_GOALS", // "<away> suma goli" (0/1/2/3+)
  [-225]: "GOAL_RANGE", // "Suma goli (przedział)" (0-1/2-3/4-6/7+)
  [-30009]: "GOAL_RANGE", // "Przedział goli"
  [-2904]: "HOME_GOAL_RANGE", // "<home> - przedział goli"
  [-2905]: "AWAY_GOAL_RANGE", // "<away> - przedział goli"
  [-233]: "HALF_TIME_EXACT_GOALS", // "1. połowa - suma goli" (0/1/2+)
  [-234]: "SECOND_HALF_EXACT_GOALS", // "2. połowa - suma goli" (0/1/2+)
  [-2902]: "HALF_TIME_GOAL_RANGE", // "1. połowa - przedział goli"
  [-2903]: "SECOND_HALF_GOAL_RANGE", // "2. połowa - przedział goli"
  [-2958]: "BOTH_HALVES_UNDER_GOALS", // "Obie połowy poniżej X goli"
  [-2959]: "BOTH_HALVES_OVER_GOALS", // "Obie połowy powyżej X goli"
  [21]: "ODD_EVEN_GOALS", // "Nieparzysta/parzysta suma goli"
  [-2551]: "HOME_TEAM_ODD_EVEN_GOALS", // "<home> nieparzysta/parzysta suma"
  [-2552]: "AWAY_TEAM_ODD_EVEN_GOALS", // "<away> nieparzysta/parzysta suma"
  [114]: "HALF_TIME_ODD_EVEN_GOALS", // "1. połowa - nieparzysta/parzysta"
  [-337]: "SECOND_HALF_ODD_EVEN_GOALS", // "2. połowa - nieparzysta/parzysta"

  // --- Goal timing ---
  [-2967]: "FIRST_TEAM_TO_SCORE", // "1. gol"
  [41]: "LAST_TEAM_TO_SCORE", // "Ostatni gol"
  [-2972]: "HALF_TIME_FIRST_GOAL", // "1. połowa - 1. gol"
  [-2973]: "SECOND_HALF_FIRST_GOAL", // "2. połowa - 1. gol"
  [-2957]: "FIRST_GOAL_TIME", // "Kiedy 1. gol zostanie strzelony (przedział 10')"
  [-2977]: "FIRST_GOAL_TIME_ALT", // "Kiedy 1. gol zostanie strzelony (przedział 15')"
  [38]: "HALF_WITH_MORE_GOALS", // "Połowa z większą sumą goli"
  [-239]: "HOME_HALF_WITH_MOST_GOALS", // "<home> połowa z większą sumą goli"
  [-240]: "AWAY_HALF_WITH_MOST_GOALS", // "<away> połowa z większą sumą goli"
  [106]: "HOME_SCORE_BOTH_HALVES", // "<home> strzeli w obu połowach"
  [107]: "AWAY_SCORE_BOTH_HALVES", // "<away> strzeli w obu połowach"

  // --- Win-to-nil / halves / clean sheets ---
  [48]: "HOME_WIN_TO_NIL", // "<home> wygra do zera"
  [130]: "AWAY_WIN_TO_NIL", // "<away> wygra do zera"
  [125]: "HOME_WIN_BOTH_HALVES", // "<home> wygra obie połowy"
  [126]: "AWAY_WIN_BOTH_HALVES", // "<away> wygra obie połowy"
  [127]: "HOME_WIN_AT_LEAST_ONE_HALF", // "<home> wygra którąkolwiek połowę"
  [128]: "AWAY_WIN_AT_LEAST_ONE_HALF", // "<away> wygra którąkolwiek połowę"
  [-2545]: "HALF_TIME_HOME_CLEAN_SHEET", // "1. połowa - <home> zachowa czyste konto"
  [-2546]: "HALF_TIME_AWAY_CLEAN_SHEET", // "1. połowa - <away> zachowa czyste konto"
  [-2547]: "SECOND_HALF_HOME_CLEAN_SHEET", // "2. połowa - <home> zachowa czyste konto"
  [-2548]: "SECOND_HALF_AWAY_CLEAN_SHEET", // "2. połowa - <away> zachowa czyste konto"

  // --- Handicaps ---
  [-458]: "ASIAN_HANDICAP", // "Handicap (-X / +X)"
  [-6048]: "EUROPEAN_HANDICAP", // "Handicap X:Y"
  [-2557]: "FIRST_HALF_EUROPEAN_HANDICAP", // "1. połowa - handicap X:Y"
  [-2558]: "SECOND_HALF_EUROPEAN_HANDICAP", // "2. połowa - handicap X:Y"
  [-6008]: "FIRST_HALF_ASIAN_HANDICAP", // "1. połowa - handicap -X / +X"
  [-6009]: "SECOND_HALF_ASIAN_HANDICAP_PUSH", // "2. połowa - handicap -X / +X"

  // --- Correct score ---
  [20]: "CORRECT_SCORE", // "Dokładny wynik"
  [74]: "HALF_TIME_CORRECT_SCORE", // "1. połowa - dokładny wynik"
  [-2556]: "SECOND_HALF_CORRECT_SCORE", // "2. połowa - dokładny wynik"
  [-228]: "HT_FT_CORRECT_SCORE", // "1. poł./mecz - dokładny wynik"
  [-2901]: "MULTI_RESULT", // "Multiwynik"

  // --- Misc match props ---
  [-338]: "WINNING_MARGIN", // "Margines zwycięstwa"
  [15]: "PENALTY_AWARDED", // "Rzut karny"

  // --- Goalscorers / player props ---
  [12]: "GOALSCORER_ANYTIME", // "Strzelec gola (musi wziąć udział w meczu)"
  [-2964]: "GOALSCORER_FIRST", // "Strzelec 1. gola (musi wziąć udział w meczu)"
  [-30376]: "PLAYER_FOULS", // "Faule popełnione przez zawodnika (opta)"
  [-30377]: "PLAYER_FOULS_WON", // "Faule popełnione na zawodniku (opta)"
  [-2417]: "PLAYER_GOALS", // "Zawodnik - suma goli"
  [-2412]: "PLAYER_ASSISTS", // "Zawodnik - suma asyst"
  [-2419]: "PLAYER_SHOTS_ON_TARGET", // "Zawodnik - suma celnych strzałów"
  [-2418]: "PLAYER_SHOTS", // "Zawodnik - suma strzałów"
  [-2420]: "PLAYER_PASSES", // "Zawodnik - suma podań"
  [-2422]: "PLAYER_TACKLES", // "Zawodnik - odbiory"
  [-8213]: "PLAYER_CARDS", // "Otrzyma kartkę (z dogrywką)"

  // --- Combination markets ---
  [-345]: "RESULT_AND_TOTAL", // "1X2 i suma X goli"
  [-2543]: "RESULT_AND_BTTS", // "1X2 i obie strzelą"
  [-2553]: "HALF_TIME_RESULT_AND_TOTAL", // "1. połowa - wygra i suma X goli"
  [-2554]: "HALF_TIME_RESULT_AND_BTTS", // "1. połowa - wygra i obie strzelą"
  [-8034]: "SECOND_HALF_RESULT_AND_TOTAL", // "2. połowa - 1X2 i suma X"
  [-8033]: "SECOND_HALF_RESULT_AND_BTTS", // "2. połowa - 1X2 i obie strzelą"
  [-2960]: "FIRST_GOAL_AND_RESULT", // "1. gol i 1X2"
  [-2720]: "DOUBLE_CHANCE_TOTAL", // "Podwójna szansa i suma X goli"
  [-2719]: "DOUBLE_CHANCE_BTTS", // "Podwójna szansa i obie strzelą"
  [-2555]: "TOTAL_GOALS_AND_BTTS", // "Obie strzelą i suma X goli"
  [-30004]: "HALFTIME_FULLTIME_AND_TOTAL", // "1. poł./mecz & suma goli X"
  [-30007]: "HALF_TIME_DOUBLE_CHANCE_BTTS", // "1. połowa - podwójna szansa i obie strzelą"
  [-30008]: "SECOND_HALF_DOUBLE_CHANCE_BTTS", // "2. połowa - podwójna szansa i obie strzelą"
  [-8031]: "DOUBLE_CHANCE_HALF_TIME_BTTS", // "Podwójna szansa (mecz) i obie strzelą (1. poł.)"
  [-8032]: "DOUBLE_CHANCE_SECOND_HALF_BTTS", // "Podwójna szansa (mecz) i obie strzelą (2. poł.)"
  [-8041]: "WIN_OR_BTTS", // "<home> wygra lub obie strzelą"
  [-8042]: "DRAW_OR_BTTS", // "Remis lub obie strzelą"
  [-8043]: "WIN_OR_BTTS", // "<away> wygra lub obie strzelą"
  [-8040]: "WIN_OR_UNDER", // "<away> wygra lub poniżej X"
  [-8037]: "DRAW_OR_OVER_2_5", // "Remis lub powyżej 2.5"
  [-8038]: "DRAW_OR_UNDER_2_5", // "Remis lub poniżej 2.5"
  [-8045]: "DRAW_OR_CLEAN_SHEET", // "Remis lub którakolwiek drużyna czyste konto"
  [-8044]: "TEAM_WIN_OR_CLEAN_SHEET", // "<home> wygra lub którakolwiek drużyna czyste konto"
  [-8046]: "TEAM_WIN_OR_CLEAN_SHEET", // "<away> wygra lub którakolwiek drużyna czyste konto"

  // --- Corners ---
  [160]: "CORNERS_RACE", // "Kto więcej rzutów rożnych"
  [23]: "CORNERS_TOTAL", // "Suma X rzutów rożnych"
  [115]: "CORNERS_TEAM", // "<home> suma X rzutów rożnych"
  [116]: "CORNERS_TEAM", // "<away> suma X rzutów rożnych"
  [-265]: "CORNERS_TEAM_RANGE", // "<home> suma rzutów rożnych"
  [-266]: "CORNERS_TEAM_RANGE", // "<away> suma rzutów rożnych"
  [-2975]: "CORNERS_HANDICAP", // "Handicap rzuty rożne -X"
  [-2971]: "FIRST_CORNER", // "1. rzut rożny"
  [-271]: "CORNERS_RANGE", // "Suma rzutów rożnych"
  [-262]: "CORNERS_ODD_EVEN", // "Nieparzysta/parzysta suma rzutów rożnych"
  [-269]: "LAST_CORNER", // "Ostatni rzut rożny"
  [-261]: "HALF_TIME_CORNERS_RACE", // "1. połowa - kto więcej rzutów rożnych"
  [105]: "HALF_TIME_CORNERS_TOTAL", // "1. połowa - suma X rzutów rożnych"
  [-272]: "HALF_TIME_CORNERS_TOTAL", // "1. połowa - suma rzutów rożnych"
  [-2954]: "HALF_TIME_CORNERS_HANDICAP", // "1. połowa - handicap rzuty rożne -X"
  [-2953]: "NEXT_CORNER_1H", // next corner, 1st half
  [-270]: "HALF_TIME_LAST_CORNER", // last corner, 1st half
  [-268]: "HALF_TIME_HOME_EXACT_CORNERS", // "1. połowa - <home> suma rzutów rożnych"
  [-267]: "HALF_TIME_AWAY_EXACT_CORNERS", // "1. połowa - <away> suma rzutów rożnych"
  [-263]: "HALF_TIME_CORNERS_ODD_EVEN", // "1. połowa - nieparzysta/parzysta suma rożnych"

  // --- Cards ---
  [171]: "CARDS_RACE", // "Kto więcej kartek"
  [13]: "CARDS_TOTAL", // "Suma X kartek"
  [134]: "HALF_TIME_CARDS_TOTAL", // "1. połowa - suma X kartek"
  [-30071]: "CARDS_TEAM", // "<home> - suma X kartek"
  [-30072]: "CARDS_TEAM", // "<away> - suma X kartek"
  [-2956]: "FIRST_CARD", // "1. kartka"
  [-2955]: "FIRST_HALF_FIRST_CARD", // "1. połowa - 1. kartka"
  [-241]: "HOME_EXACT_CARDS", // "<home> suma kartek"
  [-242]: "AWAY_EXACT_CARDS", // "<away> suma kartek"
  [-170]: "HALF_TIME_CARDS_RACE", // "1. połowa - kto więcej kartek"
  [-244]: "HALF_TIME_HOME_EXACT_CARDS", // "1. połowa - <home> suma kartek"
  [-243]: "HALF_TIME_AWAY_EXACT_CARDS", // "1. połowa - <away> suma kartek"
  [22]: "RED_CARD", // "Czerwona kartka"
  [-250]: "RED_CARD_TEAM", // "<home> czerwona kartka"
  [-251]: "RED_CARD_TEAM", // "<away> czerwona kartka"
  [-247]: "HALF_TIME_RED_CARD", // "1. połowa - co najmniej 1 czerwona kartka"
  [-248]: "HALF_TIME_RED_CARD_TEAM", // "1. połowa - <home> czerwona kartka"
  [-249]: "HALF_TIME_RED_CARD_TEAM", // "1. połowa - <away> czerwona kartka"
  [137]: "RED_CARD_AND_PENALTY", // "Czerwona kartka i rzut karny"
  [-30076]: "RED_CARD_OR_PENALTY", // "Czerwona kartka lub rzut karny"

  // --- Other stats ---
  [161]: "FOULS_TOTAL", // "Suma X fauli"
  [162]: "TEAM_TOTAL_FOULS", // "<home> suma X fauli"
  [163]: "TEAM_TOTAL_FOULS", // "<away> suma X fauli"
  [167]: "TOTAL_SHOTS_ON_TARGET", // "Suma X strzałów celnych"
  [168]: "TEAM_TOTAL_SHOTS_ON_TARGET", // "<home> suma X strzałów celnych"
  [169]: "TEAM_TOTAL_SHOTS_ON_TARGET", // "<away> suma X strzałów celnych"
  [-30726]: "TOTAL_SHOTS", // "Suma X strzałów"
  [-30727]: "TEAM_TOTAL_SHOTS", // "<home> suma X strzałów"
  [-30728]: "TEAM_TOTAL_SHOTS", // "<away> suma X strzałów"
};

/**
 * Which side of the match a team-specific eToto market id refers to.
 * Used to prefix Over/Under selections for markets whose catalog vocabulary
 * is side-prefixed (HOME_OVER, AWAY_UNDER, ...).
 */
const ETOTO_MARKET_ID_TEAM_SIDE: Record<number, "HOME" | "AWAY"> = {
  [-30071]: "HOME",
  [-30072]: "AWAY",
  [-250]: "HOME",
  [-251]: "AWAY",
  // CORNERS_TEAM's catalog selections are plain OVER/UNDER (no side prefix),
  // so the home/away variants must be told apart via the marketKey/paramValue
  // instead (see the CORNERS_TEAM branch in normalizeMarket below); without
  // this, both ids resolve to the same paramValue (just the line, e.g. "5.5")
  // and collide into a single row that mixes the two teams' prices.
  [115]: "HOME",
  [116]: "AWAY",
};

/**
 * Player-prop markets where each raw eToto market covers exactly one player
 * ("Lastname, Firstname 1+" selections). The player name becomes the market
 * parameter and the trailing "N+" threshold becomes the selection code.
 */
const ETOTO_PLAYER_STAT_MARKETS = new Set<NormalizedMarketType>([
  "PLAYER_GOALS",
  "PLAYER_ASSISTS",
  "PLAYER_SHOTS",
  "PLAYER_SHOTS_ON_TARGET",
  "PLAYER_PASSES",
  "PLAYER_TACKLES",
  "PLAYER_CARDS",
]);

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
  "ostatnia druzyna strzeli": "LAST_TEAM_TO_SCORE",
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
  { pattern: /^1\.?\s*polowa\s*-\s*podwojna szansa/, code: "HALF_TIME_DOUBLE_CHANCE" },
  { pattern: /^2\.?\s*polowa\s*-\s*podwojna szansa/, code: "SECOND_HALF_DOUBLE_CHANCE" },
  { pattern: /^1\.?\s*polowa.*suma goli/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /^2\.?\s*polowa.*suma goli/, code: "SECOND_HALF_TOTAL_GOALS" },
  { pattern: /^1\.?\s*polowa.*obie\s*strzel/, code: "HALF_TIME_BTTS" },
  { pattern: /^2\.?\s*polowa.*obie\s*strzel/, code: "SECOND_HALF_BTTS" },
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
    // "ł" is not a combining diacritic, so NFD leaves it intact.
    .replace(/ł/g, "l")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Team-scoped raw names ("<team> wygra do zera", "2. połowa - <team> zachowa
 * czyste konto") must resolve to the side-specific catalog codes; folding them
 * into the shared WIN_TO_NIL / CLEAN_SHEET buckets mixes home and away prices
 * under identical YES/NO codes and poisons best-odds comparison.
 */
function resolveTeamScopedMarket(
  rawName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const resolveSide = (teamText: string): NormalizedSelection =>
    normalize1x2Selection(teamText, ctx.homeTeam, ctx.awayTeam, ctx.league);

  // "<team> wygra do zera"
  let match = rawName.match(/^(.+?)\s+wygra\s+do\s+zera\s*$/i);
  if (match) {
    const side = resolveSide(match[1]);
    if (side === "HOME") return "HOME_WIN_TO_NIL";
    if (side === "AWAY") return "AWAY_WIN_TO_NIL";
    return null;
  }

  // "<team> wygra lub powyżej [line]" (win-or-over combo). The sibling
  // "wygra lub poniżej" (win-or-under) phrase is routed via a dedicated
  // gameType id to the generic WIN_OR_UNDER code instead, so this branch is
  // scoped to "powyżej" only to avoid touching that already-working path.
  match = rawName.match(/^(.+?)\s+wygra\s+lub\s+powy[zż]ej\b/i);
  if (match) {
    const side = resolveSide(match[1]);
    if (side === "HOME") return "HOME_WIN_OR_OVER";
    if (side === "AWAY") return "AWAY_WIN_OR_OVER";
    return null;
  }

  // "<team> wygra lub poniżej [line]" (win-or-under combo). The away side
  // already has a dedicated gameType id (-8040) routed to the generic
  // WIN_OR_UNDER code; the home side has no dedicated id and previously fell
  // through to OTHER via the name resolver, so route it here to the
  // catalog's HOME_WIN_OR_UNDER code (mirroring the away id's target when it
  // also arrives by name).
  match = rawName.match(/^(.+?)\s+wygra\s+lub\s+poni[zż]ej\b/i);
  if (match) {
    const side = resolveSide(match[1]);
    if (side === "HOME") return "HOME_WIN_OR_UNDER";
    if (side === "AWAY") return "WIN_OR_UNDER";
    return null;
  }

  // "[1./2. połowa - ]<team> zachowa czyste konto"
  match = rawName.match(
    /^(?:([12])\.?\s*po[łl]ow[aey]\s*-\s*)?(.+?)\s+zachowa\s+czyste\s+konto\s*$/i
  );
  if (match) {
    const half = match[1];
    const side = resolveSide(match[2]);
    if (side === "HOME") {
      if (half === "1") return "HALF_TIME_HOME_CLEAN_SHEET";
      if (half === "2") return "SECOND_HALF_HOME_CLEAN_SHEET";
      return "HOME_CLEAN_SHEET";
    }
    if (side === "AWAY") {
      if (half === "1") return "HALF_TIME_AWAY_CLEAN_SHEET";
      if (half === "2") return "SECOND_HALF_AWAY_CLEAN_SHEET";
      // No full-match away clean-sheet YES/NO code in the catalog yet;
      // excluding beats surfacing YES/NO inside CLEAN_SHEET's HOME/AWAY vocab.
      return "OTHER";
    }
    // Half-scoped market with an unresolved team must not fall through to the
    // generic full-match CLEAN_SHEET pattern.
    if (half) return "OTHER";
    return null;
  }

  return null;
}

function resolveMarketCodeFromName(
  rawName: string,
  ctx: NormalizationContext
): {
  marketCode: NormalizedMarketType;
  matchedBy: "name" | "pattern";
} {
  const teamScoped = resolveTeamScopedMarket(rawName, ctx);
  if (teamScoped) {
    return { marketCode: teamScoped, matchedBy: "pattern" };
  }

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

  // Combo phrases like "Argentyna lub X", "X lub Austria", "Algieria lub Austria".
  const parts = selectionName.split(/\s+lub\s+/i).map((part) => part.trim());
  if (parts.length === 2) {
    const legs = parts.map((part) =>
      normalize1x2Selection(part, ctx.homeTeam, ctx.awayTeam, ctx.league)
    );
    const has = (code: NormalizedSelection) => legs.includes(code);
    if (has("HOME") && has("DRAW")) return "HOME_OR_DRAW";
    if (has("AWAY") && has("DRAW")) return "DRAW_OR_AWAY";
    if (has("HOME") && has("AWAY")) return "HOME_OR_AWAY";
  }

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

/**
 * Handicap selections carry the line as a suffix: "Argentyna (-1.5)",
 * "Argentyna -1.5" (Asian) or the virtual score "Argentyna 0:2" / "X 0:2"
 * (European). Strip the suffix, then resolve the team side.
 */
function normalizeEtotoHandicapSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();
  if (/^x\b/i.test(trimmed)) return "DRAW";

  const teamPart = trimmed
    .replace(/\s*\([+-]?\d+(?:[.,]\d+)?\)\s*$/, "")
    .replace(/\s+[+-]\d+(?:[.,]\d+)?\s*$/, "")
    .replace(/\s+\d+\s*:\s*\d+\s*$/, "")
    .trim();

  const side = normalize1x2Selection(teamPart, ctx.homeTeam, ctx.awayTeam, ctx.league);
  if (side !== "UNKNOWN") return side;

  // Pick'em lines ("handicap +0 / -0") suffix one side with an unsigned zero
  // ("Szwajcaria 0") that the signed strip above misses; drop a bare trailing
  // number and retry so the home side does not fall through to UNKNOWN.
  const bareStripped = teamPart.replace(/\s+\d+(?:[.,]\d+)?$/, "").trim();
  if (bareStripped && bareStripped !== teamPart) {
    return normalize1x2Selection(bareStripped, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }

  return "UNKNOWN";
}

function parseTeamBasedHtFt(
  selectionName: string,
  ctx: NormalizationContext
): string | null {
  const parts = selectionName.split("/").map((part) => part.trim());
  if (parts.length !== 2) return null;

  const [htRaw, ftRaw] = parts;
  const ht = normalize1x2Selection(htRaw, ctx.homeTeam, ctx.awayTeam, ctx.league);
  const ft = normalize1x2Selection(ftRaw, ctx.homeTeam, ctx.awayTeam, ctx.league);

  if (ht === "UNKNOWN" || ft === "UNKNOWN") return null;
  return `${ht}_${ft}`;
}

const DC_TOKEN_TO_CODE: Record<string, string> = {
  "1 lub x": "1X",
  "1 lub 2": "12",
  "x lub 2": "X2",
};

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext,
  teamSide?: "HOME" | "AWAY"
): NormalizedSelection {
  const trimmed = selName.trim();
  const normalized = normalizeEtotoName(trimmed);

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "HALF_TIME_DRAW_NO_BET":
    case "SECOND_HALF_DRAW_NO_BET":
    case "HOME_NO_BET":
    case "AWAY_NO_BET":
    case "HT_OR_FT_RESULT":
    case "TIME_PERIOD_RESULT":
    case "TEAM_TO_QUALIFY":
    case "CORNERS_RACE":
    case "HALF_TIME_CORNERS_RACE":
    case "CARDS_RACE":
    case "HALF_TIME_CARDS_RACE":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    // Triple markets with a "no goal/card/corner" leg: "Brak" -> NONE.
    case "FIRST_TEAM_TO_SCORE":
    case "LAST_TEAM_TO_SCORE":
    case "HALF_TIME_FIRST_GOAL":
    case "SECOND_HALF_FIRST_GOAL":
    case "FIRST_CARD":
    case "FIRST_HALF_FIRST_CARD":
    case "FIRST_CORNER":
    case "LAST_CORNER":
    case "HALF_TIME_LAST_CORNER":
    case "NEXT_CORNER_1H":
      if (/^brak/.test(normalized)) return "NONE";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
    case "HALF_TIME_DOUBLE_CHANCE":
    case "SECOND_HALF_DOUBLE_CHANCE":
      return normalizeEtotoDoubleChance(trimmed, ctx);

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
    case "HALF_TIME_CORNERS_TOTAL":
    case "CORNERS_TEAM":
    case "CARDS_TOTAL":
    case "HALF_TIME_CARDS_TOTAL":
    case "FOULS_TOTAL":
    case "TEAM_TOTAL_FOULS":
    case "TOTAL_SHOTS_ON_TARGET":
    case "TEAM_TOTAL_SHOTS_ON_TARGET":
    case "TOTAL_SHOTS":
    case "TEAM_TOTAL_SHOTS": {
      const overUnder = normalizeOverUnderSelection(trimmed);
      if (overUnder !== "UNKNOWN") return overUnder;
      // Some totals also quote range buckets ("0-4", "5-6", "7+") which are
      // valid catalog codes for corner/card totals.
      if (/^\d+(?:-\d+)?\+?$/.test(trimmed)) return trimmed as NormalizedSelection;
      return "UNKNOWN";
    }

    // Team markets whose catalog selections are side-prefixed.
    case "CARDS_TEAM": {
      const overUnder = normalizeOverUnderSelection(trimmed);
      if (overUnder === "UNKNOWN" || !teamSide) return overUnder;
      return `${teamSide}_${overUnder}` as NormalizedSelection;
    }

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
    case "BOTH_HALVES_GOALS":
    case "BOTH_HALVES_UNDER_GOALS":
    case "BOTH_HALVES_OVER_GOALS":
    case "HOME_WIN_TO_NIL":
    case "AWAY_WIN_TO_NIL":
    case "HOME_SCORE_BOTH_HALVES":
    case "AWAY_SCORE_BOTH_HALVES":
    case "HOME_WIN_AT_LEAST_ONE_HALF":
    case "AWAY_WIN_AT_LEAST_ONE_HALF":
    case "TEAM_WIN_AT_LEAST_ONE_HALF":
    case "HOME_WIN_BOTH_HALVES":
    case "AWAY_WIN_BOTH_HALVES":
    case "HALF_TIME_HOME_CLEAN_SHEET":
    case "HALF_TIME_AWAY_CLEAN_SHEET":
    case "SECOND_HALF_HOME_CLEAN_SHEET":
    case "SECOND_HALF_AWAY_CLEAN_SHEET":
    case "HOME_CLEAN_SHEET":
    case "PENALTY_AWARDED":
    case "RED_CARD":
    case "RED_CARD_TEAM":
    case "HALF_TIME_RED_CARD":
    case "HALF_TIME_RED_CARD_TEAM":
    case "RED_CARD_AND_PENALTY":
    case "RED_CARD_OR_PENALTY":
    case "TEAM_WIN_MATCH":
    case "ANY_TEAM_TO_WIN":
    case "WIN_OR_BTTS":
    case "DRAW_OR_BTTS":
    case "WIN_OR_UNDER":
    case "HOME_WIN_OR_UNDER":
    case "HOME_WIN_OR_OVER":
    case "AWAY_WIN_OR_OVER":
    case "DRAW_OR_OVER_2_5":
    case "DRAW_OR_UNDER_2_5":
    case "DRAW_OR_CLEAN_SHEET":
    case "TEAM_WIN_OR_CLEAN_SHEET":
    case "EXTRA_TIME":
    case "PENALTY_SHOOTOUT":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
    case "HOME_TEAM_ODD_EVEN_GOALS":
    case "AWAY_TEAM_ODD_EVEN_GOALS":
    case "HALF_TIME_ODD_EVEN_GOALS":
    case "SECOND_HALF_ODD_EVEN_GOALS":
    case "CORNERS_ODD_EVEN":
    case "HALF_TIME_CORNERS_ODD_EVEN":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP_PUSH":
    case "FIRST_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_EUROPEAN_HANDICAP":
    case "CORNERS_HANDICAP":
    case "HALF_TIME_CORNERS_HANDICAP":
      return normalizeEtotoHandicapSelection(trimmed, ctx);

    case "WIN_TO_NIL":
    case "CLEAN_SHEET": {
      const yesNo = normalizeYesNoSelection(trimmed);
      if (yesNo !== "UNKNOWN") return yesNo;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "CORRECT_SCORE":
    case "HALF_TIME_CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE": {
      if (normalized === "inny" || normalized === "inne") {
        return "OTHER" as NormalizedSelection;
      }
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HT_FT_CORRECT_SCORE": {
      // eToto uses dash scores ("0-0 / 1-0"); catalog uses colons ("0:0 / 1:0").
      // The "4+" catch-all bucket ("0-0 / 4+") is not a score pair, so each
      // half must be converted independently rather than requiring both
      // halves to match the digit-digit pattern at once.
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

    case "HALFTIME_FULLTIME":
    case "DOUBLE_RESULT": {
      // Team-based resolution first: it emits the catalog's HOME_/DRAW_/AWAY_
      // vocabulary (parseHtFtSelection would keep the raw "X/X" token form).
      const htft = parseTeamBasedHtFt(trimmed, ctx) ?? parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    case "HALF_WITH_MORE_GOALS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS":
      if (/^1\.?\s*polowa/.test(normalized)) return "1st" as NormalizedSelection;
      if (/^2\.?\s*polowa/.test(normalized)) return "2nd" as NormalizedSelection;
      if (/^(x$|po rowno|rowno|remis)/.test(normalized)) return "Draw" as NormalizedSelection;
      return "UNKNOWN";

    case "TEAMS_TO_SCORE": {
      if (/^zadn/.test(normalized)) return "ZERO_TEAMS" as NormalizedSelection;
      if (/^obie/.test(normalized)) return "TWO_TEAMS" as NormalizedSelection;
      const only = trimmed.match(/^tylko\s+(.+)$/i);
      if (only) {
        const side = normalize1x2Selection(only[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
        if (side === "HOME") return "ONE_TEAM_HOME" as NormalizedSelection;
        if (side === "AWAY") return "ONE_TEAM_AWAY" as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    case "BTTS_BY_HALF": {
      const match = normalized.match(/^(tak|nie)\s*\/\s*(tak|nie)$/);
      if (match) {
        if (match[1] === "tak" && match[2] === "tak") return "Both" as NormalizedSelection;
        if (match[1] === "tak") return "1st" as NormalizedSelection;
        if (match[2] === "tak") return "2nd" as NormalizedSelection;
        return "None" as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_TIME_ALT":
      if (/^brak/.test(normalized)) return "NONE";
      return trimmed as NormalizedSelection;

    // Numeric goal/card/corner counts and ranges: pass catalog-shaped codes
    // through and map "Brak gola" to the "0" bucket.
    case "GOAL_RANGE":
    case "EXACT_GOALS":
    case "HOME_EXACT_GOALS":
    case "AWAY_EXACT_GOALS":
    case "HALF_TIME_EXACT_GOALS":
    case "SECOND_HALF_EXACT_GOALS":
    case "HOME_GOAL_RANGE":
    case "AWAY_GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
    case "HOME_EXACT_CARDS":
    case "AWAY_EXACT_CARDS":
    case "HALF_TIME_HOME_EXACT_CARDS":
    case "HALF_TIME_AWAY_EXACT_CARDS":
    case "HALF_TIME_HOME_EXACT_CORNERS":
    case "HALF_TIME_AWAY_EXACT_CORNERS":
    case "CORNERS_TEAM_RANGE":
    case "CORNERS_RANGE":
      if (/^brak/.test(normalized)) return "0" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    // "<1|X|2 or team> i <poniżej|powyżej> N" combos.
    case "RESULT_AND_TOTAL":
    case "HALF_TIME_RESULT_AND_TOTAL":
    case "SECOND_HALF_RESULT_AND_TOTAL": {
      const match = trimmed.match(/^(.+)\s+i\s+(poni[zż]ej|powy[zż]ej)\b/i);
      if (match) {
        const side = normalize1x2Selection(match[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
        const overUnder = /^poni/i.test(normalizeEtotoName(match[2])) ? "UNDER" : "OVER";
        if (side === "HOME" || side === "DRAW" || side === "AWAY") {
          return `${side}_${overUnder}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    // "<1|X|2 or team> i <tak|nie>" combos.
    case "RESULT_AND_BTTS":
    case "HALF_TIME_RESULT_AND_BTTS":
    case "SECOND_HALF_RESULT_AND_BTTS": {
      const match = trimmed.match(/^(.+)\s+i\s+(tak|nie)\s*$/i);
      if (match) {
        const side = normalize1x2Selection(match[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
        const yesNo = normalizeEtotoName(match[2]) === "tak" ? "YES" : "NO";
        if (side === "HOME" || side === "DRAW" || side === "AWAY") {
          return `${side}_${yesNo}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    // "Tak/Nie i poniżej/powyżej N" combos.
    case "TOTAL_GOALS_AND_BTTS": {
      const match = normalized.match(/^(tak|nie)\s+i\s+(poni\w*|powy\w*)/);
      if (match) {
        const yesNo = match[1] === "tak" ? "YES" : "NO";
        const overUnder = match[2].startsWith("poni") ? "UNDER" : "OVER";
        return `${overUnder}_${yesNo}` as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    // "1 lub X i tak/nie/poniżej/powyżej" combos.
    case "DOUBLE_CHANCE_TOTAL":
    case "DOUBLE_CHANCE_BTTS":
    case "HALF_TIME_DOUBLE_CHANCE_BTTS":
    case "SECOND_HALF_DOUBLE_CHANCE_BTTS":
    case "DOUBLE_CHANCE_HALF_TIME_BTTS":
    case "DOUBLE_CHANCE_SECOND_HALF_BTTS": {
      const match = normalized.match(/^(1 lub x|1 lub 2|x lub 2)\s+i\s+(tak|nie|poni\w*|powy\w*)/);
      if (match) {
        const dcToken = DC_TOKEN_TO_CODE[match[1]];
        let suffix: string;
        if (match[2] === "tak") suffix = "YES";
        else if (match[2] === "nie") suffix = "NO";
        else suffix = match[2].startsWith("poni") ? "UNDER" : "OVER";
        return `${dcToken}_${suffix}` as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    // "1/X i powyżej N" combos (HT/FT + total); each leg may also be a team
    // name ("2/Argentyna i poniżej 3.5").
    case "HALFTIME_FULLTIME_AND_TOTAL": {
      const match = trimmed.match(/^(.+?)\s*\/\s*(.+?)\s+i\s+(poni[zż]ej|powy[zż]ej)/i);
      if (match) {
        const ht = normalize1x2Selection(match[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
        const ft = normalize1x2Selection(match[2], ctx.homeTeam, ctx.awayTeam, ctx.league);
        const overUnder = /^poni/i.test(normalizeEtotoName(match[3])) ? "UNDER" : "OVER";
        if (ht !== "UNKNOWN" && ft !== "UNKNOWN") {
          return `${ht}_${ft}_${overUnder}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    // "<team> różnicą N goli" -> HOME_BY_N / AWAY_BY_N (3+ -> _BY_3PLUS).
    case "WINNING_MARGIN": {
      const match = normalized.match(/^(.+?)\s+roznic[a]?\s+(\d+)(\+?)/);
      if (match) {
        const side = normalize1x2Selection(match[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
        if (side === "HOME" || side === "AWAY") {
          const margin = match[3] === "+" || Number(match[2]) >= 3 ? "3PLUS" : match[2];
          return `${side}_BY_${margin}` as NormalizedSelection;
        }
      }
      if (/^(x|remis)$/.test(normalized)) return "DRAW";
      return "UNKNOWN";
    }

    // "<team> w reg. czasie" / "<team> po dogrywce" / "<team> po rzutach
    // karnych" -> HOME_/AWAY_ + REGULAR/EXTRA_TIME/PENALTIES.
    case "WIN_METHOD": {
      const match = trimmed.match(
        /^(.+?)\s+(w\s+reg\S*\s+czasie|po\s+dogrywce|po\s+rzutach\s+karnych)\s*$/i
      );
      if (match) {
        const side = normalize1x2Selection(match[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
        if (side === "HOME" || side === "AWAY") {
          const method = normalizeEtotoName(match[2]);
          const suffix = method.startsWith("w reg")
            ? "REGULAR"
            : method.includes("dogrywce")
              ? "EXTRA_TIME"
              : "PENALTIES";
          return `${side}_${suffix}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    // "<team> gol i <1|X|2 or team>" / "Brak gola".
    case "FIRST_GOAL_AND_RESULT": {
      if (/^brak/.test(normalized)) return "NONE";
      const match = trimmed.match(/^(.+?)\s+gol\s+i\s+(.+)$/i);
      if (match) {
        const first = normalize1x2Selection(match[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
        const result = normalize1x2Selection(match[2], ctx.homeTeam, ctx.awayTeam, ctx.league);
        if (
          (first === "HOME" || first === "AWAY") &&
          (result === "HOME" || result === "DRAW" || result === "AWAY")
        ) {
          return `${first}_${result}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    // Catalog uses the raw combo strings ("1:0, 2:0 lub 3:0", "X") verbatim,
    // except the "other win" legs which eToto quotes lowercase and in the
    // wrong grammatical case ("inne zwycięstwo gospodarze"/"goście") instead
    // of the catalog's capitalized genitive form.
    case "MULTI_RESULT": {
      if (/^inne\s+zwyci[eę]stwo\s+gospodarz/i.test(normalized)) {
        return "Inne zwycięstwo gospodarzy" as NormalizedSelection;
      }
      if (/^inne\s+zwyci[eę]stwo\s+go[sś]ci/i.test(normalized)) {
        return "Inne zwycięstwo gości" as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
      // eToto quotes players as "Lastname, Firstname"; canonicalize to
      // "Firstname Lastname" so selections line up across bookmakers.
      return canonicalizePlayerName(
        trimmed.replace(/^\d+\.\s*/, "").trim()
      ) as NormalizedSelection;

    // Per-player stat lines: "Lastname, Firstname N+" -> "N+"
    // (player name is carried in the market parameter).
    case "PLAYER_GOALS":
    case "PLAYER_ASSISTS":
    case "PLAYER_SHOTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_PASSES":
    case "PLAYER_TACKLES":
    case "PLAYER_CARDS": {
      const match = trimmed.match(/(\d+\+)\s*$/);
      if (match) {
        // PLAYER_CARDS catalog vocabulary is YES/NO; "1+" means "gets a card".
        if (marketCode === "PLAYER_CARDS" && match[1] === "1+") return "YES";
        return match[1] as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    // eToto bundles every player into one combined raw market for these two
    // stats ("Lastname, Firstname N+" per selection, thresholds mixed across
    // players), unlike the one-market-per-player shape used for
    // PLAYER_GOALS/PLAYER_CARDS etc. paramValue is left unset here (see
    // extractParamValue's default branch) so market-type-grouper's
    // splitBundledPlayerSelections() recovery can still split this into one
    // synthetic market per player downstream — that recovery only fires when
    // every selection's code passes looksLikePlayerName(), which requires a
    // bare name. Strip the trailing "N+" threshold token so the code carries
    // only the canonicalized player name (matching the bare-name format used
    // for cross-bookmaker player matching), instead of embedding the
    // threshold in the code and defeating that recovery.
    case "PLAYER_FOULS":
    case "PLAYER_FOULS_WON": {
      const cleaned = trimmed.replace(/^\d+\.\s*/, "").trim();
      const withLine = cleaned.match(/^(.+?)\s+\d+\+$/);
      if (withLine) {
        return canonicalizePlayerName(withLine[1]) as NormalizedSelection;
      }
      return canonicalizePlayerName(cleaned) as NormalizedSelection;
    }

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

/**
 * European handicap raw names embed the virtual score ("Handicap 0:2",
 * "1. połowa - handicap 1:0"). Convert it to the signed home-perspective
 * line used across bookmakers ("1:0" -> "+1", "0:2" -> "-2"), matching the
 * STS reference convention.
 */
function extractScorelineHandicap(rawName: string): string | undefined {
  const match = rawName.match(/handicap\s+(\d+)\s*:\s*(\d+)/i);
  if (!match) return undefined;
  const diff = Number(match[1]) - Number(match[2]);
  return diff > 0 ? `+${diff}` : String(diff);
}

/**
 * Integer goal lines like "1. połowa - suma 3" / "Suma 2 goli" carry no
 * decimal separator, so parseDecimalLine misses them.
 */
function parseSumIntegerLine(text: string): string | undefined {
  const match = text.match(/suma\s+(\d+)(?![.,]\d)/i);
  return match ? match[1] : undefined;
}

/**
 * Extract the player name from "Lastname, Firstname N+" style selections.
 * All selections of a per-player eToto market reference the same player.
 */
function extractPlayerParam(
  selections: Array<{ name: string }>
): string | undefined {
  const first = selections[0]?.name?.trim();
  if (!first) return undefined;
  const match = first.match(/^(.+?)\s+\d+\+$/);
  // Canonicalize "Lastname, Firstname" so per-player market keys match the
  // parameter format used by other bookmakers.
  return match ? canonicalizePlayerName(match[1].trim()) : undefined;
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
        fromSelections ??
        parseSumIntegerLine(raw.name)
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
      const resolved = resolveMarketCodeFromName(raw.name, ctx);
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

    const teamSide = marketId !== null ? ETOTO_MARKET_ID_TEAM_SIDE[marketId] : undefined;

    let paramValue: string | undefined;
    if (
      marketCode === "EUROPEAN_HANDICAP" ||
      marketCode === "FIRST_HALF_EUROPEAN_HANDICAP" ||
      marketCode === "SECOND_HALF_EUROPEAN_HANDICAP"
    ) {
      paramValue = extractScorelineHandicap(raw.name) ?? extractParamValue(marketCode, raw);
    } else if (ETOTO_PLAYER_STAT_MARKETS.has(marketCode)) {
      paramValue = extractPlayerParam(raw.selections);
    } else if (marketCode === "RED_CARD_TEAM" && teamSide) {
      // RED_CARD_TEAM has no numeric line, so the team side must carry the
      // param itself; otherwise the home/away variants collide on the same
      // (marketCode, undefined) bucket and the grouper's collision guard
      // silently drops the second one (see betclic-normalizer.ts for the
      // same pattern).
      paramValue = teamSide;
    } else {
      paramValue = extractParamValue(marketCode, raw);
      // CORNERS_TEAM's catalog selections are plain OVER/UNDER with no side
      // prefix, so the home (id 115) and away (id 116) variants must combine
      // teamSide with the numeric line to stay on distinct marketKeys
      // (e.g. CORNERS_TEAM:HOME:5.5 vs CORNERS_TEAM:AWAY:5.5); otherwise they
      // collide on a single "CORNERS_TEAM:5.5" key and mix the two teams'
      // prices into one row (see betclic-normalizer.ts for the same pattern).
      if (marketCode === "CORNERS_TEAM" && teamSide) {
        paramValue = paramValue ? `${teamSide}:${paramValue}` : teamSide;
      }
    }

    const marketKey = buildMarketKey(marketCode, paramValue);
    const marketMetadata = getMarketMetadata(marketCode);
    const marketName = marketMetadata?.labels.pl ?? raw.name;

    const selections = raw.selections.map((sel: { name: string; odds: number }) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode!, ctx, teamSide),
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
};

export default etotoNormalizer;
