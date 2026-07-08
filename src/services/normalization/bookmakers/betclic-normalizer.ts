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
  extractMultipleHandicapLines,
  extractMultipleOverUnderLines,
  normalize1x2Selection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  parseScoreSelection,
  parseHtFtSelection,
  normalizeAsianHandicap3WaySelection,
  normalizeHandicapSelection,
  canonicalizePlayerName,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";
import { matchToCanonical } from "../../../utils/team-matcher.js";

const BETCLIC_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {};

const BETCLIC_MARKET_NAME_TO_CODE: Record<string, NormalizedMarketType> = {
  "wynik meczu": "MATCH_WINNER",
  "wynik meczu (z wylaczeniem dogrywki)": "MATCH_WINNER",
  "podwojna szansa": "DOUBLE_CHANCE",
  "obie druzyny strzela": "BTTS",
  "oba zespoly strzela gola": "BTTS",
  "oba zespoly strzela gola lub powyzej 2,5 gola w meczu": "BTTS_OR_OVER_2_5",
  "dokladny wynik": "CORRECT_SCORE",
  "dokladny wynik w grupie": "CORRECT_SCORE_GROUP",
  "dokladny wynik - 1. polowa": "HALF_TIME_CORRECT_SCORE",
  "dokladny wynik - 2. polowa": "SECOND_HALF_CORRECT_SCORE",
  "dokladna liczba goli - 1. polowa": "HALF_TIME_EXACT_GOALS",
  "dokladna liczba goli - 2. polowa": "SECOND_HALF_EXACT_GOALS",
  "gole nieparzyste/parzyste - 1. polowa": "HALF_TIME_ODD_EVEN_GOALS",
  "gole nieparzyste/parzyste - 2. polowa": "SECOND_HALF_ODD_EVEN_GOALS",
  "wynik 1 polowy": "HALF_TIME_RESULT",
  "pierwsza kartka- 1. polowa": "FIRST_HALF_FIRST_CARD",
  "1. polowa wynik": "HALF_TIME_RESULT",
  "wynik 2 polowy": "SECOND_HALF_RESULT",
  "2. polowa wynik": "SECOND_HALF_RESULT",
  "remis bez zakladu": "DRAW_NO_BET",
  "remis - zwrot": "DRAW_NO_BET",
  "remis - zwrot - 1. polowa": "HALF_TIME_DRAW_NO_BET",
  "remis - zwrot - 2. polowa": "SECOND_HALF_DRAW_NO_BET",
  "1. polowa - pierwszy gol": "HALF_TIME_FIRST_GOAL",
  "2. polowa - pierwszy gol": "SECOND_HALF_FIRST_GOAL",
  "1. polowa - rzuty rozne": "HALF_TIME_CORNERS_TOTAL",
  "rzuty rozne w- 1. polowa": "HALF_TIME_CORNERS_RACE",
  "rozne nieparzyste/parzyste - 1. polowa": "HALF_TIME_CORNERS_ODD_EVEN",
  "rzuty rozne nieparz./parz.": "CORNERS_ODD_EVEN",
  "czerwona kartka": "RED_CARD",
  "liczba kartek": "CARDS_TOTAL",
  "gol bezposrednio z rzutu wolnego": "FREE_KICK_GOAL",
  "gol bezposrednio z rzutu wolnego w meczu": "FREE_KICK_GOAL",
  "gol glowa": "HEADER_GOAL",
  "gole glowa w obu polowach": "HEADER_GOAL_BOTH_HALVES",
  "liczba goli - opcja i": "GOAL_RANGE",
  "liczba goli - opcja ii": "EXACT_GOALS",
  // Both first-goal-time variants must be explicit to prevent parseIntegerLine collision on "1." in market name
  "czas 1. gola": "FIRST_GOAL_TIME",
  "czas 1. gola - opcja ii": "FIRST_GOAL_TIME_ALT",
  "gol z rzutu karnego": "PENALTY_GOAL",
  "gole 1. polowa": "HALF_TIME_TOTAL_GOALS",
  "gole 2. polowa": "SECOND_HALF_TOTAL_GOALS",
  "ile druzyn strzeli": "TEAMS_TO_SCORE",
  "handicap": "ASIAN_HANDICAP_3WAY",
  "handicap (2-drozny)": "ASIAN_HANDICAP",
  "handicap (2-drozny) - 1. polowa": "FIRST_HALF_ASIAN_HANDICAP",
  "handicap (2-drozny) - 2. polowa": "SECOND_HALF_ASIAN_HANDICAP",
  "handicap 1. polowa": "FIRST_HALF_EUROPEAN_HANDICAP",
  "handicap 2. polowa": "SECOND_HALF_EUROPEAN_HANDICAP",
  "ktorykolwiek zawodnik strzeli gola": "TWO_PLAYERS_ANYTIME",
  "ktorykolwiek zawodnik strzeli gola - 1. polowa": "HALF_TIME_TWO_PLAYERS_ANYTIME",
  "ktorykolwiek zawodnik strzeli gola - 2. polowa": "SECOND_HALF_TWO_PLAYERS_ANYTIME",
  "ktorykolwiek zawodnik strzeli gola (3 pl) - 1. polowa": "HALF_TIME_THREE_PLAYERS_ANYTIME",
  "ktorykolwiek zawodnik strzeli gola (3 pl) - 2. polowa": "SECOND_HALF_THREE_PLAYERS_ANYTIME",
  "ktorykolwiek gracz zdobedzie gola w obu polowach": "ANY_PLAYER_SCORES_BOTH_HALVES",
  "ktorykolwiek zawodnik zaliczy asyste": "PLAYER_ASSIST_PAIRS",
  "ktorykolwiek zawodnik zaliczy asyste - 3 zawodnik": "PLAYER_ASSIST_TRIPLE",
  "obaj gracze strzela": "BOTH_PLAYERS_ANYTIME",
  "obaj gracze strzela w obu polowach": "BOTH_PLAYERS_SCORE_BOTH_HALVES",
  "jeden z graczy strzeli pierwszego gola": "ANY_PLAYER_FIRST_GOAL",
  "jeden z graczy strzeli w obu polowach": "SAME_PLAYER_SCORES_BOTH_HALVES",
  "wszyscy strzela": "ALL_PLAYERS_SCORE",
  "hat-trick": "HAT_TRICK",
  "bramka rezerwowego": "SUBSTITUTE_GOAL",
  "dokladna liczba kartek": "CARDS_EXACT",
  "liczba odbiorow (opta) (z dogrywka)": "CLEARANCES_TOTAL",
  "odbiory 1x2 (opta) (z dogrywka)": "CLEARANCES_1X2",
  "pierwszy strzal": "FIRST_SHOT",
  "pierwszy celny strzal": "FIRST_SHOT_ON_TARGET",
  "punkty za kartki powyzej/ponizej": "CARDS_POINTS_OVER_UNDER",
  "punkty za kartki powyzej/ponizej - 1. polowa": "HALF_TIME_CARDS_POINTS_OVER_UNDER",
  "pierwszy rozny": "FIRST_CORNER",
  "polowa z wieksza iloscia goli": "HALF_WITH_MORE_GOALS",
  "przedzial goli": "GOAL_RANGE",
  "przewaga dwoma bramkami lub wygrana w meczu (reg. czas)": "WIN_OR_WIN_BY_2",
  "roznica goli": "WINNING_MARGIN",
  "rzuty rozne - przedzialy": "CORNERS_RANGE",
  "spalone 1x2 (opta)": "OFFSIDES_1X2",
  "strzaly celne - 1x2 (opta)": "MOST_SHOTS_ON_TARGET",
  "suma celnych strzalow w meczu (opta)": "TOTAL_SHOTS_ON_TARGET",
  "suma celnych strzalow w meczu  (opta)": "TOTAL_SHOTS_ON_TARGET",
  "liczba celnych strzalow w meczu (opta)": "TOTAL_SHOTS_ON_TARGET",
  "liczba celnych strzalow w meczu  (opta)": "TOTAL_SHOTS_ON_TARGET",
  "suma strzalow w meczu (opta)": "TOTAL_SHOTS",
  "liczba strzalow w meczu (opta)": "TOTAL_SHOTS",
  "suma faulu w meczu (opta)": "FOULS_TOTAL",
  "suma spalonych w meczu (opta)": "OFFSIDES_TOTAL",
  "ostatni rozny": "LAST_CORNER",
  "rzuty rozne": "CORNERS_TOTAL",
  "wiecej kartek": "CARDS_RACE",
  "wiecej rzutow roznych": "CORNERS_RACE",
  "pierwszy zespol ktory otrzyma kartke": "FIRST_CARD",
  "liczba rzutow roznych - 1. polowa": "HALF_TIME_CORNERS_TOTAL",
  "liczba kartek - 1. polowa": "HALF_TIME_CARDS_TOTAL",
  "rzuty rozne handicap": "CORNERS_HANDICAP",
  "rzuty rozne handicap (2-way) 1. polowa": "HALF_TIME_CORNERS_HANDICAP",
  "wynik i gole": "RESULT_AND_TOTAL",
  "wynik i kto zdobedzie 1. bramke": "RESULT_AND_FIRST_GOAL",
  "wynik i liczba bramek - 1. polowa": "HALF_TIME_RESULT_AND_TOTAL",
  "wynik i liczba bramek - 2. polowa": "SECOND_HALF_RESULT_AND_TOTAL",
  "wynik meczu & oba zespoly strzela": "RESULT_AND_BTTS",
  "wynik meczu polowa / caly": "HALFTIME_FULLTIME",
  "polowa / caly & liczba goli": "HALFTIME_FULLTIME_AND_TOTAL",
  "wynik/oba zespoly strzela - 1. polowa": "HALF_TIME_RESULT_AND_BTTS",
  "wynik/oba zespoly strzela - 2. polowa": "SECOND_HALF_RESULT_AND_BTTS",
  "zawodnik strzeli gola bezposrednio z rzutu wolnego.": "PLAYER_FREE_KICK_GOAL",
  "zawodnik strzeli gola glowa": "PLAYER_HEADER_GOAL",
  "zawodnik strzeli gola i zaliczy asyste": "PLAYER_GOAL_AND_ASSIST",
  "zawodnik wykorzysta rzut karny.": "PENALTY_SCORER",
};

const BETCLIC_MARKET_PATTERNS: Array<{
  pattern: RegExp;
  code: NormalizedMarketType;
}> = [
  { pattern: /^posiadanie pilki gospodarzy$/i, code: "HOME_POSSESSION" },
  { pattern: /^posiadanie pilki gosci$/i, code: "AWAY_POSSESSION" },
  { pattern: /^liczba goli\s+(?:parzysta\s*\/\s*nieparzysta|nieparzysta\s*\/\s*parzysta)/i, code: "ODD_EVEN_GOALS" },
   { pattern: /^liczba goli\s+\d+/i, code: "TOTAL_GOALS" },
   { pattern: /^pierwszy.*rożny$/i, code: "FIRST_CORNER" },
   { pattern: /^ostatni.*rożny$/i, code: "LAST_CORNER" },
   { pattern: /^suma rzutow roznych/i, code: "CORNERS_TOTAL" },
     { pattern: /^liczba goli\b/i, code: "TOTAL_GOALS" },
      { pattern: /^gole\s+powyzej\s*\/\s*ponizej/i, code: "TOTAL_GOALS" },
       { pattern: /^gole.*powyzej.*ponizej/i, code: "TOTAL_GOALS" },
           // Only the exact 2+ threshold maps to the dedicated BTTS_2PLUS_GOALS code;
           // other thresholds (3+, 4+, ...) are a different market and must not merge
           // into the 2+ odds — they route to parameterized BOTH_TEAMS_OVER_GOALS.
           { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela po 2\+/i, code: "BTTS_2PLUS_GOALS" },
           { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela po \d+\+/i, code: "BOTH_TEAMS_OVER_GOALS" },
           { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela.*rzut.*karn.*1\. polowa/i, code: "HALF_TIME_BTTS_PENALTY" },
           { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela.*rzut.*karn.*2\. polowa/i, code: "SECOND_HALF_BTTS_PENALTY" },
           { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela.*rzut.*karn/i, code: "BTTS_PENALTY" },
          { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela.*gola.*glowa/i, code: "BTTS_HEAD_GOALS" },
          { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela.*rzut.*woln/i, code: "BTTS_FREE_KICK" },
          { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela.*1\. polowa/i, code: "HALF_TIME_BTTS" },
         { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela.*2\. polowa/i, code: "SECOND_HALF_BTTS" },
         { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela.*1\. i 2\. polow/i, code: "BTTS_BY_HALF" },
         { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela.*\blub\b.*powyzej\s*2[,.]5\s*gola?\s*w\s*meczu/i, code: "BTTS_OR_OVER_2_5" },
         { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela.*liczba bramek/i, code: "TOTAL_GOALS_AND_BTTS" },
         // "spoza pola karnego" (goal from outside the box) is a distinct market —
         // must not collapse into plain BTTS via the catch-all below.
         { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela.*spoza pola/i, code: "OTHER" },
         { pattern: /^ob(?:a|ie) (?:druzyny|zespoly) strzela/i, code: "BTTS" },
      { pattern: /^gol.*rzut.*wolny/i, code: "FREE_KICK_GOAL" },
     { pattern: /^gol glowa\s*-\s*1\. polowa/i, code: "HALF_TIME_HEADER_GOAL" },
     { pattern: /^gol glowa\s*-\s*2\. polowa/i, code: "SECOND_HALF_HEADER_GOAL" },
     { pattern: /^gol.*rzut.*karn.*1\. polowa/i, code: "HALF_TIME_PENALTY_GOAL" },
     { pattern: /^gol.*rzut.*karn.*2\. polowa/i, code: "SECOND_HALF_PENALTY_GOAL" },
    { pattern: /^1\. polowa - nastepny \d+ rzut rozny$/i, code: "NEXT_CORNER_1H" },
     { pattern: /^1\. polowa - ostatni rzut rozny$/i, code: "HALF_TIME_LAST_CORNER" },
    { pattern: /^liczba kartek\s*1\.?\s*polowa/i, code: "HALF_TIME_CARDS_TOTAL" },
     { pattern: /^podwojna szansa\s*\(1\.?\s*polowa\s+lub\s+mecz\)/i, code: "HT_OR_FT_RESULT" },
     { pattern: /^podwojna szansa.*\(.*lub.*\)/i, code: "DOUBLE_CHANCE" },
      { pattern: /^podwojna szansa,?\s*obie\s+(?:druzyny|zespoly)\s+zdobywaj[aą]\s+gole?\s*-\s*1\.?\s*polowa/i, code: "HALF_TIME_DOUBLE_CHANCE_BTTS" },
  { pattern: /^podwojna szansa,?\s*obie\s+(?:druzyny|zespoly)\s+zdobywaj[aą]\s+gole?\s*-\s*2\.?\s*polowa/i, code: "SECOND_HALF_DOUBLE_CHANCE_BTTS" },
  { pattern: /^podwojna szansa\s*(?:&|i|oraz).*oba (?:zespoly|druzyny) strzela/i, code: "DOUBLE_CHANCE_BTTS" },
     { pattern: /^podwojna szansa\s*(?:&|i|oraz)\s*powyzej\s*\/\s*ponizej/i, code: "DOUBLE_CHANCE_TOTAL" },
     { pattern: /^1x2 rzuty rozne/i, code: "CORNERS_RACE" },
  { pattern: /^1x2 strzaly/i, code: "MOST_SHOTS" },
  { pattern: /^faule\s+1x2\s*\(opta\)/i, code: "FOUL_RACE" },
  { pattern: /^strzelec:/i, code: "OTHER" },
   { pattern: /^2\s+graczy\s+strzeli\s+pow\.\s*\d+[,.]?\d*\s+gol/i, code: "TWO_PLAYERS_COMBINED_GOALS" },
  { pattern: /^3\s+graczy\s+strzeli\s+pow\.\s*\d+[,.]?\d*\s+gol/i, code: "THREE_PLAYERS_COMBINED_GOALS" },
   { pattern: /^ktorykolwiek\s+zawodnik\s+strzeli\s+gola\s*-\s*\d+\s*gracz/i, code: "THREE_PLAYERS_ANYTIME" },
   { pattern: /^ktorykolwiek\s+zawodnik\s+zaliczy\s+asyste\s*-\s*3\s+zawodnik/i, code: "PLAYER_ASSIST_TRIPLE" },
   { pattern: /^czas 1\. gola/i, code: "FIRST_GOAL_TIME" },
   { pattern: /^kartki\s+1x2\s*-\s*1\. polowa/i, code: "FIRST_HALF_CARDS_1X2" },
   { pattern: /^obie polowy ponizej\s+\d+[,.]?\d*\s*gol[ia]$/i, code: "BOTH_HALVES_UNDER_GOALS" },
   { pattern: /^obie polowy powyzej\s+\d+[,.]?\d*\s*gol[ia]$/i, code: "BOTH_HALVES_OVER_GOALS" },
 ];
// NOTE: TEAM_HALF_WITH_MORE_GOALS is resolved via resolveTeamHalfWithMoreGoalsTeamSide()
// in resolveMarketCode() which returns teamSide for distinct marketKey generation.

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function resolveHalfTeamGoalsMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^(\d)\. polowa gole - (.+)$/i);
  if (!match) return null;

  const half = match[1];
  const teamPart = match[2].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (half === "1") {
    if (isHome) return "HALF_TIME_HOME_TEAM_TOTAL_GOALS";
    if (isAway) return "HALF_TIME_AWAY_TEAM_TOTAL_GOALS";
  } else if (half === "2") {
    if (isHome) return "SECOND_HALF_HOME_TEAM_TOTAL_GOALS";
    if (isAway) return "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS";
  }

  return null;
}

function resolveTeamTotalGoalsMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^liczba goli\s+-\s+(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  if (/^opcja\s+[ivxlcdm]+$/i.test(teamPart)) return null;

  if (/^1\.?\s*polowa$/i.test(teamPart)) return "HALF_TIME_GOAL_RANGE";
  if (/^2\.?\s*polowa$/i.test(teamPart)) return "SECOND_HALF_GOAL_RANGE";

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return "HOME_TEAM_TOTAL_GOALS";
  if (isAway) return "AWAY_TEAM_TOTAL_GOALS";

  // Team suffix did not resolve to either side. Mapping to TEAM_TOTAL_GOALS
  // would emit plain OVER/UNDER (invalid for that code's HOME_/AWAY_ vocabulary)
  // and let an unattributed team line poison cross-team best-odds comparison.
  // Exclude instead of guessing.
  return "OTHER";
}

function resolveCardsTeamMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^kartki\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return "CARDS_TEAM";
  if (isAway) return "CARDS_TEAM";

  return null;
}

// "dokladna liczba kartek - {team}" (full match, team suffix)
function resolveExactCardsTeamSuffixMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^dokladna liczba kartek\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();
  if (fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league)) return "HOME_EXACT_CARDS";
  if (fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league)) return "AWAY_EXACT_CARDS";
  return null;
}

// "{team} dokladna liczba kartek - 1. polowa" (team prefix, half suffix)
function resolveHalfTimeExactCardsTeamPrefixMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^(.+?)\s+dokladna liczba kartek\s*-\s*1\.?\s*polowa$/i);
  if (!match) return null;

  const teamPart = match[1].trim();
  if (fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league)) return "HALF_TIME_HOME_EXACT_CARDS";
  if (fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league)) return "HALF_TIME_AWAY_EXACT_CARDS";
  return null;
}

// "{team} dokladna liczba rzutow roznych - 1. polowa" (team prefix, half suffix)
function resolveHalfTimeExactCornersTeamPrefixMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^(.+?)\s+dokladna liczba rzutow roznych\s*-\s*1\.?\s*polowa$/i);
  if (!match) return null;

  const teamPart = match[1].trim();
  if (fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league)) return "HALF_TIME_HOME_EXACT_CORNERS";
  if (fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league)) return "HALF_TIME_AWAY_EXACT_CORNERS";
  return null;
}

interface RedCardTeamResult {
  code: NormalizedMarketType;
  teamName?: string;
}

function extractRedCardTeamInfo(
  normalizedName: string,
  ctx: NormalizationContext
): { teamName: string; teamSide: "HOME" | "AWAY" } | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^czerwona kartka\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return { teamName: ctx.homeTeam, teamSide: "HOME" };
  if (isAway) return { teamName: ctx.awayTeam, teamSide: "AWAY" };

  return null;
}

function extractRedCardTeamName(normalizedName: string, ctx: NormalizationContext): string | null {
  return extractRedCardTeamInfo(normalizedName, ctx)?.teamName ?? null;
}

function resolveRedCardTeamMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const info = extractRedCardTeamInfo(normalizedName, ctx);
  return info ? "RED_CARD_TEAM" : null;
}

function resolveTeamHalfWithMoreGoalsTeamSide(
  normalizedName: string,
  ctx: NormalizationContext
): "HOME" | "AWAY" | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^polowa z wieksza ilos[c]?[c]?i[a]? goli\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  if (fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league)) return "HOME";
  if (fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league)) return "AWAY";

  return null;
}

function resolveScoreBothHalvesMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^strzela w obu polowach\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return "HOME_SCORE_BOTH_HALVES";
  if (isAway) return "AWAY_SCORE_BOTH_HALVES";

  return null;
}


function resolveWinAtLeastOneHalfMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^wygra[a-z]+ jedna z polow\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return "HOME_WIN_AT_LEAST_ONE_HALF";
  if (isAway) return "AWAY_WIN_AT_LEAST_ONE_HALF";

  return null;
}

function resolveWinBothHalvesMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^wygra[a-z]*\s+obie\s+polow[yi]\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return "HOME_WIN_BOTH_HALVES";
  if (isAway) return "AWAY_WIN_BOTH_HALVES";

  return null;
}

function resolveTeamOddEvenGoalsMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  // Match "Liczba Goli Parzysta/Nieparzysta - <teamName>" variant
  // Whole-match variant has no " - " suffix and falls through to BETCLIC_MARKET_PATTERNS
  const match = normalizedName.match(
    /^liczba goli\s+(?:parzysta\s*\/\s*nieparzysta|nieparzysta\s*\/\s*parzysta)\s*-\s*(.+)$/i
  );
  if (!match) return null;

  const teamPart = match[1].trim();

  if (fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league)) return "HOME_TEAM_ODD_EVEN_GOALS";
  if (fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league)) return "AWAY_TEAM_ODD_EVEN_GOALS";

  return null;
}

interface CornersTeamResult {
  code: NormalizedMarketType;
  teamSide: "HOME" | "AWAY";
}

function resolveCornersTeamMarket(
  normalizedName: string,
  ctx: NormalizationContext
): CornersTeamResult | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  // Pattern: "rzuty rozne {team} (razem z dogrywka)" or "rzuty rozne {team}"
  const match = normalizedName.match(/^rzuty rozne\s+(.+?)(?:\s*\(razem z dogrywka\))?$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return { code: "CORNERS_TEAM", teamSide: "HOME" };
  if (isAway) return { code: "CORNERS_TEAM", teamSide: "AWAY" };

  return null;
}

function resolveFreeKickGoalTeamMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^strzela gola bezposrednio z rzutu wolnego\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return "HOME_TEAM_FREE_KICK_GOAL";
  if (isAway) return "AWAY_TEAM_FREE_KICK_GOAL";

  return null;
}

interface TeamHeaderGoalResult {
  teamSide: "HOME" | "AWAY";
  teamName: string;
}

function extractTeamHeaderGoalInfo(
  normalizedName: string,
  ctx: NormalizationContext
): TeamHeaderGoalResult | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^strzela? gola glowa\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return { teamSide: "HOME", teamName: ctx.homeTeam };
  if (isAway) return { teamSide: "AWAY", teamName: ctx.awayTeam };

  return null;
}

interface TeamShotsOnTargetResult {
  teamSide: "HOME" | "AWAY";
  teamName: string;
}

function resolveTeamShotsOnTargetMarket(
  normalizedName: string,
  ctx: NormalizationContext
): TeamShotsOnTargetResult | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  // Pattern: "(suma|liczba) celnych strzalow w meczu (opta) - {teamName}"
  const match = normalizedName.match(/^(?:suma|liczba) celnych strzalow w meczu\s*\(opta\)\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return { teamSide: "HOME", teamName: ctx.homeTeam };
  if (isAway) return { teamSide: "AWAY", teamName: ctx.awayTeam };

  return null;
}

interface TeamShotsResult {
  teamSide: "HOME" | "AWAY";
  teamName: string;
}

interface TeamTacklesResult {
  teamSide: "HOME" | "AWAY";
  teamName: string;
}

function resolveTeamShotsMarket(
  normalizedName: string,
  ctx: NormalizationContext
): TeamShotsResult | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  // Pattern: "(suma|liczba) strzalow w meczu (opta) - {teamName}"
  const match = normalizedName.match(/^(?:suma|liczba) strzalow w meczu\s*\(opta\)\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return { teamSide: "HOME", teamName: ctx.homeTeam };
  if (isAway) return { teamSide: "AWAY", teamName: ctx.awayTeam };

  return null;
}

function resolveTeamTacklesMarket(
  normalizedName: string,
  ctx: NormalizationContext
): TeamTacklesResult | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^liczba odbiorow\s*\(opta\)(?:\s*\(z dogrywka\))?\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return { teamSide: "HOME", teamName: ctx.homeTeam };
  if (isAway) return { teamSide: "AWAY", teamName: ctx.awayTeam };

  return null;
}

interface TeamOffsidesResult {
  code: NormalizedMarketType;
  teamSide: "HOME" | "AWAY";
}

function resolveTeamOffsidesMarket(
  normalizedName: string,
  ctx: NormalizationContext
): TeamOffsidesResult | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  // Pattern: "suma spalonych w meczu - {teamName} (opta)"
  const match = normalizedName.match(/^suma spalonych w meczu\s*-\s*(.+?)\s*\(opta\)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return { code: "HOME_TEAM_TOTAL_OFFSIDES", teamSide: "HOME" };
  if (isAway) return { code: "AWAY_TEAM_TOTAL_OFFSIDES", teamSide: "AWAY" };

  return null;
}

/**
 * Resolves clean sheet market for a specific half and team.
 * Pattern: "Czyste konto- {1|2}. polowa - {teamName}"
 * Returns HALF_TIME_HOME/AWAY_CLEAN_SHEET for 1st half,
 * SECOND_HALF_HOME/AWAY_CLEAN_SHEET for 2nd half.
 */
function resolveCleanSheetHalfMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  // Pattern: "czyste konto- {1|2}. polowa - {teamName}" (Betclic uses dash without space before half)
  const match = normalizedName.match(/^czyste konto-\s*(\d)\.\s*polowa\s*-\s*(.+)$/i);
  if (!match) return null;

  const half = match[1];
  const teamPart = match[2].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (half === "1") {
    if (isHome) return "HALF_TIME_HOME_CLEAN_SHEET";
    if (isAway) return "HALF_TIME_AWAY_CLEAN_SHEET";
  }

  if (half === "2") {
    if (isHome) return "SECOND_HALF_HOME_CLEAN_SHEET";
    if (isAway) return "SECOND_HALF_AWAY_CLEAN_SHEET";
  }

  return null;
}


/**
 * Resolves "Dokładna liczba bramek - {teamName}" markets to HOME_EXACT_GOALS or AWAY_EXACT_GOALS.
 * Pattern used by Betclic in the "Gole druzyny" group (subca_ftb_gbt).
 * Selections provided by Betclic: 0, 1, 2, 3+
 */
function resolveTeamExactGoalsMarket(
  normalizedName: string,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  const match = normalizedName.match(/^dokladna liczba bramek\s*-\s*(.+)$/i);
  if (!match) return null;

  const teamPart = match[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  if (isHome) return "HOME_EXACT_GOALS";
  if (isAway) return "AWAY_EXACT_GOALS";

  return null;
}

function resolveMarketCode(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): {
  marketCode: NormalizedMarketType;
  matchedBy: "id" | "name" | "pattern";
  teamName?: string;
  teamSide?: "HOME" | "AWAY";
} {
  if (raw.bookmakerMarketId !== undefined && raw.bookmakerMarketId !== null) {
    const rawId = Number(raw.bookmakerMarketId);
    const marketCode = BETCLIC_MARKET_ID_TO_CODE[rawId];
    if (marketCode) {
      return { marketCode, matchedBy: "id" };
    }
  }

  const normalizedName = normalizeName(raw.name);
  const direct = BETCLIC_MARKET_NAME_TO_CODE[normalizedName];
  if (direct) {
    return { marketCode: direct, matchedBy: "name" };
  }

  const halfTeamGoals = resolveHalfTeamGoalsMarket(normalizedName, ctx);
  if (halfTeamGoals) {
    return { marketCode: halfTeamGoals, matchedBy: "pattern" };
  }

  const cardsTeam = resolveCardsTeamMarket(normalizedName, ctx);
  if (cardsTeam) {
    return { marketCode: cardsTeam, matchedBy: "pattern" };
  }

  const exactCardsTeam = resolveExactCardsTeamSuffixMarket(normalizedName, ctx);
  if (exactCardsTeam) {
    return { marketCode: exactCardsTeam, matchedBy: "pattern" };
  }

  const halfTimeExactCardsTeam = resolveHalfTimeExactCardsTeamPrefixMarket(normalizedName, ctx);
  if (halfTimeExactCardsTeam) {
    return { marketCode: halfTimeExactCardsTeam, matchedBy: "pattern" };
  }

  const halfTimeExactCornersTeam = resolveHalfTimeExactCornersTeamPrefixMarket(normalizedName, ctx);
  if (halfTimeExactCornersTeam) {
    return { marketCode: halfTimeExactCornersTeam, matchedBy: "pattern" };
  }

  const redCardTeamInfo = extractRedCardTeamInfo(normalizedName, ctx);
  if (redCardTeamInfo) {
    return { marketCode: "RED_CARD_TEAM", matchedBy: "pattern", teamName: redCardTeamInfo.teamName, teamSide: redCardTeamInfo.teamSide };
  }

  const cornersTeam = resolveCornersTeamMarket(normalizedName, ctx);
  if (cornersTeam) {
    return { marketCode: cornersTeam.code, matchedBy: "pattern", teamSide: cornersTeam.teamSide };
  }

  const freeKickGoalTeam = resolveFreeKickGoalTeamMarket(normalizedName, ctx);
  if (freeKickGoalTeam) {
    return { marketCode: freeKickGoalTeam, matchedBy: "pattern" };
  }

  const teamHeaderGoalInfo = extractTeamHeaderGoalInfo(normalizedName, ctx);
  if (teamHeaderGoalInfo) {
    return { marketCode: "TEAM_HEADER_GOAL", matchedBy: "pattern", teamName: teamHeaderGoalInfo.teamName, teamSide: teamHeaderGoalInfo.teamSide };
  }

  const scoreBothHalves = resolveScoreBothHalvesMarket(normalizedName, ctx);
  if (scoreBothHalves) {
    return { marketCode: scoreBothHalves, matchedBy: "pattern" };
  }

  const teamShotsOnTarget = resolveTeamShotsOnTargetMarket(normalizedName, ctx);
  if (teamShotsOnTarget) {
    return { marketCode: "TEAM_TOTAL_SHOTS_ON_TARGET", matchedBy: "pattern", teamName: teamShotsOnTarget.teamName, teamSide: teamShotsOnTarget.teamSide };
  }

  const teamShots = resolveTeamShotsMarket(normalizedName, ctx);
  if (teamShots) {
    return { marketCode: "TEAM_TOTAL_SHOTS", matchedBy: "pattern", teamName: teamShots.teamName, teamSide: teamShots.teamSide };
  }

  const teamTackles = resolveTeamTacklesMarket(normalizedName, ctx);
  if (teamTackles) {
    return { marketCode: "TEAM_TOTAL_TACKLES", matchedBy: "pattern", teamName: teamTackles.teamName, teamSide: teamTackles.teamSide };
  }

  const teamOffsides = resolveTeamOffsidesMarket(normalizedName, ctx);
  if (teamOffsides) {
    return { marketCode: teamOffsides.code, matchedBy: "pattern", teamSide: teamOffsides.teamSide };
  }

  const winAtLeastOneHalf = resolveWinAtLeastOneHalfMarket(normalizedName, ctx);
  if (winAtLeastOneHalf) {
    return { marketCode: winAtLeastOneHalf, matchedBy: "pattern" };
  }

  const winBothHalves = resolveWinBothHalvesMarket(normalizedName, ctx);
  if (winBothHalves) {
    return { marketCode: winBothHalves, matchedBy: "pattern" };
  }

  const cleanSheetHalf = resolveCleanSheetHalfMarket(normalizedName, ctx);
  if (cleanSheetHalf) {
    return { marketCode: cleanSheetHalf, matchedBy: "pattern" };
  }

  const teamTotalGoals = resolveTeamTotalGoalsMarket(normalizedName, ctx);
  if (teamTotalGoals) {
    return { marketCode: teamTotalGoals, matchedBy: "pattern" };
  }

  const teamExactGoals = resolveTeamExactGoalsMarket(normalizedName, ctx);
  if (teamExactGoals) {
    return { marketCode: teamExactGoals, matchedBy: "pattern" };
  }

  // Resolve TEAM_HALF_WITH_MORE_GOALS with teamSide so normalizeMarket() can build
  // a distinct marketKey per team variant (HOME/AWAY) via buildMarketKey(code, teamSide).
  const teamHalfMoreGoalsSide = resolveTeamHalfWithMoreGoalsTeamSide(normalizedName, ctx);
  if (teamHalfMoreGoalsSide) {
    return { marketCode: "TEAM_HALF_WITH_MORE_GOALS", matchedBy: "pattern", teamSide: teamHalfMoreGoalsSide };
  }

  const teamOddEvenGoals = resolveTeamOddEvenGoalsMarket(normalizedName, ctx);
  if (teamOddEvenGoals) {
    return { marketCode: teamOddEvenGoals, matchedBy: "pattern" };
  }

  for (const entry of BETCLIC_MARKET_PATTERNS) {
    if (entry.pattern.test(normalizedName)) {
      return { marketCode: entry.code, matchedBy: "pattern" };
    }
  }

  return { marketCode: "OTHER", matchedBy: "pattern" };
}

const TEAM_ABBREVIATIONS: Record<string, string[]> = {
  "united": ["utd"],
  "real": ["r."],
  "bromwich": ["brom"],
  "wich": ["w"],
};

/**
 * Checks if a team name is present in a normalized selection string.
 * Handles cases where the selection uses an abbreviated team name
 * (e.g., "Manchester Utd" vs "Manchester United").
 */
function isTeamInSelection(
  normalizedSelection: string,
  normalizedTeamName: string
): boolean {
  if (normalizedSelection.includes(normalizedTeamName)) {
    return true;
  }

  const teamParts = normalizedTeamName.split(" ");
  const selectionParts = normalizedSelection.split(" ");

  if (teamParts.length >= 3) {
    const matchingParts = teamParts.filter(part => {
      if (selectionParts.includes(part)) return true;

      const abbreviations = TEAM_ABBREVIATIONS[part] || [];
      if (abbreviations.some(abbr => selectionParts.includes(abbr))) return true;

      // Only allow substring matching for parts with 4+ characters
      // to prevent false positives like "ham" matching inside "wolverhampton"
      if (part.length >= 4) {
        const partialMatches = selectionParts.filter(selPart =>
          selPart.includes(part) || part.includes(selPart)
        );
        if (partialMatches.length > 0) return true;
      }

      return false;
    });

    if (matchingParts.length >= 1) {
      return true;
    }
  }

  if (teamParts.length === 2) {
    const [part1, part2] = teamParts;
    const part1Match = selectionParts.includes(part1) ||
      (TEAM_ABBREVIATIONS[part1] || []).some(abbr => selectionParts.includes(abbr));
    const part2Match = selectionParts.includes(part2) ||
      (TEAM_ABBREVIATIONS[part2] || []).some(abbr => selectionParts.includes(abbr));

    if (part1Match && part2Match) {
      return true;
    }

    const matchingParts = teamParts.filter(part => selectionParts.includes(part));
    if (matchingParts.length >= 1) {
      return true;
    }
  }

  return false;
}

// Tokens that recur in Betclic combination selections but are never team names.
// Filtering them out before canonical resolution avoids noisy "unknown team"
// warnings and false positives from fuzzy matching.
const NON_TEAM_TOKENS = new Set<string>([
  "remis", "lub", "i", "oraz", "x", "tak", "nie", "yes", "no",
  "powyzej", "ponizej", "over", "under", "gol", "gola", "goli", "gole",
  "strzeli", "strzela", "rzut", "rzutu", "karny", "karnego", "przewaga",
  "przewag", "przewaga", "inny", "wynik", "polowa", "polowie", "brak",
  "zaden", "zadna", "zadnej", "zespol", "zespoly", "none", "any",
  "ktorykolwiek", "zawodnik", "oba", "obie", "obd", "both", "pierwszy",
  "pierwsza", "wiecej", "home", "away", "gospodarz", "gosci", "gosc",
]);

/**
 * Canonical-aware team membership test for Betclic selection fragments.
 *
 * Betclic renders team names in Polish ("Argentyna"), while the normalization
 * context carries the canonical — often English — form ("Argentina"). The plain
 * substring matcher (`isTeamInSelection`) misses these and, crucially, only the
 * home side is affected whenever the away name happens to be spelled identically
 * in both languages. We therefore fall back to resolving each token of the
 * fragment through the league alias map and comparing canonical identities.
 *
 * Returns true when `fragment` denotes `canonicalTeam`.
 */
function fragmentIsTeam(
  fragment: string,
  canonicalTeam: string | undefined,
  league: string | undefined
): boolean {
  if (!canonicalTeam) return false;

  // Fast path: literal substring / token match against the canonical name.
  if (isTeamInSelection(normalizeName(fragment), normalizeName(canonicalTeam))) {
    return true;
  }

  // Canonical fallback for bookmaker-vs-context language mismatches.
  if (!league) return false;
  const target = matchToCanonical(canonicalTeam, league);
  if (!target) return false;

  const rawTokens = fragment.split(/[\s/&+,()]+/).filter((t) => {
    const normalizedToken = normalizeName(t);
    return (
      normalizedToken.length >= 3 &&
      !NON_TEAM_TOKENS.has(normalizedToken) &&
      !/^\d/.test(normalizedToken)
    );
  });

  // Candidates: single tokens resolve one-word names ("Argentyna"), while
  // contiguous n-grams are required for multi-word names that only resolve as
  // a whole alias phrase (e.g. "Wyspy Zielonego Przylądka" -> Cape Verde).
  const candidates: string[] = rawTokens.map((t) => normalizeName(t));
  for (let size = 2; size <= 3; size++) {
    for (let i = 0; i + size <= rawTokens.length; i++) {
      candidates.push(rawTokens.slice(i, i + size).join(" "));
    }
  }

  for (const candidate of candidates) {
    const m = matchToCanonical(candidate, league);
    if (m && m.name === target.name) return true;
  }
  return false;
}

/**
 * Parses HT/FT selection from Betclic format "Team1 / Team2" or "Remis / Team"
 * Returns format like "HOME_HOME", "DRAW_AWAY", etc.
 */
function parseBetclicHtFtSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection | null {
  const parts = selectionName.split("/").map((part) => part.trim());
  if (parts.length !== 2) return null;

  const [htRaw, ftRaw] = parts;

  function resolveResult(raw: string): "HOME" | "DRAW" | "AWAY" | null {
    const normalized = normalizeName(raw);
    if (normalized === "remis" || normalized.includes("remis")) return "DRAW";
    if (fragmentIsTeam(raw, ctx.homeTeam, ctx.league)) return "HOME";
    if (fragmentIsTeam(raw, ctx.awayTeam, ctx.league)) return "AWAY";
    return null;
  }

  const ht = resolveResult(htRaw);
  const ft = resolveResult(ftRaw);

  if (!ht || !ft) return null;
  return `${ht}_${ft}` as NormalizedSelection;
}

/**
 * Normalizes 1X2 selections for Betclic markets using proper team name matching.
 * Handles Polish team names and abbreviations (e.g., "R. Madryt" for "Real Madrid").
 * Falls back to normalize1x2Selection() for generic 1/X/2 patterns.
 */
function normalizeBetclic1x2Selection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const normalizedSelection = normalizeName(selectionName);
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  // Check for draw first (Polish: "remis")
  if (normalizedSelection === "remis" || normalizedSelection.includes("remis")) {
    return "DRAW";
  }

  // Use isTeamInSelection for proper team name matching with abbreviations
  if (home && isTeamInSelection(normalizedSelection, home)) {
    return "HOME";
  }
  if (away && isTeamInSelection(normalizedSelection, away)) {
    return "AWAY";
  }

  // Fallback to generic patterns (1, X, 2, Home, Away, etc.)
  return normalize1x2Selection(selectionName, ctx.homeTeam, ctx.awayTeam, ctx.league);
}

function normalizeBetclicDoubleChance(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const normalizedSelection = normalizeName(selectionName);
  const isHome = fragmentIsTeam(selectionName, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(selectionName, ctx.awayTeam, ctx.league);

  if (normalizedSelection.includes("remis")) {
    if (isHome) return "HOME_OR_DRAW";
    if (isAway) return "DRAW_OR_AWAY";
  }

  if (isHome && isAway) {
    return "HOME_OR_AWAY";
  }

  return normalizeDoubleChanceSelection(selectionName);
}

function normalizeBetclicDoubleChanceBttsSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const normalizedSelection = normalizeName(selectionName);

  const parts = normalizedSelection.split("&");
  if (parts.length !== 2) {
    return selectionName as NormalizedSelection;
  }

  const dcPart = parts[0].trim();
  const bttsPart = parts[1].trim();

  const bttsValue = bttsPart.includes("tak") || bttsPart.includes("yes") ? "YES" : "NO";

  const isHome = fragmentIsTeam(dcPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(dcPart, ctx.awayTeam, ctx.league);

  if (dcPart.includes("remis")) {
    if (isHome) {
      return bttsValue === "YES" ? "1X_YES" : "1X_NO";
    }
    if (isAway) {
      return bttsValue === "YES" ? "X2_YES" : "X2_NO";
    }
  }

  if (isHome && isAway) {
    return bttsValue === "YES" ? "12_YES" : "12_NO";
  }

  return selectionName as NormalizedSelection;
}

function normalizeBetclicDoubleChanceTotalSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const parts = selectionName.split("&");
  if (parts.length !== 2) {
    return selectionName as NormalizedSelection;
  }

  const dcPart = normalizeName(parts[0].trim());
  const goalsPart = normalizeName(parts[1].trim());

  const hasHomeTeam = fragmentIsTeam(dcPart, ctx.homeTeam, ctx.league);
  const hasAwayTeam = fragmentIsTeam(dcPart, ctx.awayTeam, ctx.league);
  const hasDraw = dcPart.includes("remis") || dcPart.includes("x");

  let dcType: "1X" | "X2" | "12" | null = null;

  if (hasHomeTeam && !hasAwayTeam) {
    dcType = hasDraw ? "1X" : null;
  } else if (hasAwayTeam && !hasHomeTeam) {
    dcType = hasDraw ? "X2" : null;
  } else if (hasHomeTeam && hasAwayTeam) {
    dcType = "12";
  }

  const isOver = goalsPart.includes("powyzej") || goalsPart.includes("over");
  const ouDirection = isOver ? "OVER" : "UNDER";

  if (!dcType) {
    return selectionName as NormalizedSelection;
  }

  return `${dcType}_${ouDirection}` as NormalizedSelection;
}

function normalizeResultAndTotalSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const normalized = normalizeName(selectionName);

  const parts = normalized.split("&");
  if (parts.length !== 2) {
    return selectionName as NormalizedSelection;
  }

  const teamPart = parts[0].trim();
  const goalsPart = parts[1].trim();

  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);
  const isDraw = teamPart.includes("remis") || teamPart.includes("x");

  const isOver = goalsPart.includes("powyzej") || goalsPart.includes("over");
  const ouDirection = isOver ? "OVER" : "UNDER";

  if (isHome && !isAway && !isDraw) {
    return `HOME_${ouDirection}` as NormalizedSelection;
  }
  if (isAway && !isHome && !isDraw) {
    return `AWAY_${ouDirection}` as NormalizedSelection;
  }
  if (isDraw) {
    return `DRAW_${ouDirection}` as NormalizedSelection;
  }

  return selectionName as NormalizedSelection;
}

/**
 * Normalize a "HT/FT + Total Goals" selection.
 *
 * Input format: "HT_TEAM / FT_TEAM & Powyżej/Poniżej LINE"
 * e.g. "Fulham / Fulham & Powyżej 2,5"    -> HOME_HOME_OVER
 *      "Remis / Aston Villa & Poniżej 1,5" -> DRAW_AWAY_UNDER
 *
 * The line value is stripped by extractMultipleOverUnderLines so each call here
 * only needs to encode the directional part (OVER/UNDER) without the numeric line.
 */
function normalizeHtFtAndTotalSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);
  const normalized = normalizeName(selectionName);

  // Split on "&" to separate "HT / FT" from "over/under LINE"
  const ampParts = normalized.split("&");
  if (ampParts.length !== 2) {
    return selectionName as NormalizedSelection;
  }

  const htftPart = ampParts[0].trim(); // e.g. "fulham / fulham"
  const goalsPart = ampParts[1].trim(); // e.g. "powyzej 2,5"

  // Split HT/FT part on "/"
  const slashParts = htftPart.split("/");
  if (slashParts.length !== 2) {
    return selectionName as NormalizedSelection;
  }

  const htPart = slashParts[0].trim();
  const ftPart = slashParts[1].trim();

  const resolveOutcome = (part: string): "HOME" | "DRAW" | "AWAY" | null => {
    if (part === "remis" || part === "x") return "DRAW";
    if (home && isTeamInSelection(part, home)) return "HOME";
    if (away && isTeamInSelection(part, away)) return "AWAY";
    return null;
  };

  const htOutcome = resolveOutcome(htPart);
  const ftOutcome = resolveOutcome(ftPart);

  if (!htOutcome || !ftOutcome) {
    return selectionName as NormalizedSelection;
  }

  const isOver = goalsPart.includes("powyzej") || goalsPart.includes("over");
  const ouDirection = isOver ? "OVER" : "UNDER";

  return `${htOutcome}_${ftOutcome}_${ouDirection}` as NormalizedSelection;
}

function normalizeResultAndFirstGoalSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const normalized = normalizeName(selectionName);

  const parts = normalized.split("/");
  if (parts.length !== 2) {
    return selectionName as NormalizedSelection;
  }

  const resultPart = parts[0].trim();
  const firstGoalPart = parts[1].trim();

  let result: "HOME" | "DRAW" | "AWAY" | null = null;
  if (fragmentIsTeam(resultPart, ctx.homeTeam, ctx.league)) {
    result = "HOME";
  } else if (fragmentIsTeam(resultPart, ctx.awayTeam, ctx.league)) {
    result = "AWAY";
  } else if (resultPart.includes("remis") || resultPart === "x") {
    result = "DRAW";
  }

  let firstGoal: "HOME" | "AWAY" | "NONE" | null = null;
  if (firstGoalPart.includes("brak") || firstGoalPart.includes("zaden") || firstGoalPart.includes("none")) {
    firstGoal = "NONE";
  } else if (fragmentIsTeam(firstGoalPart, ctx.homeTeam, ctx.league)) {
    firstGoal = "HOME";
  } else if (fragmentIsTeam(firstGoalPart, ctx.awayTeam, ctx.league)) {
    firstGoal = "AWAY";
  }

  if (result && firstGoal) {
    return `${result}_${firstGoal}` as NormalizedSelection;
  }

  return selectionName as NormalizedSelection;
}

function normalizeResultAndBttsSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const normalized = normalizeName(selectionName);

  const parts = normalized.split("/");
  if (parts.length !== 2) {
    return selectionName as NormalizedSelection;
  }

  const resultPart = parts[0].trim();
  const bttsPart = parts[1].trim();

  let result: "HOME" | "DRAW" | "AWAY" | null = null;
  if (resultPart.includes("remis") || resultPart === "x") {
    result = "DRAW";
  } else if (fragmentIsTeam(resultPart, ctx.homeTeam, ctx.league)) {
    result = "HOME";
  } else if (fragmentIsTeam(resultPart, ctx.awayTeam, ctx.league)) {
    result = "AWAY";
  }

  const bttsValue = bttsPart.includes("tak") || bttsPart.includes("yes") ? "YES" : "NO";

  if (result) {
    return `${result}_${bttsValue}` as NormalizedSelection;
  }

  return selectionName as NormalizedSelection;
}

function normalizeNextCornerSelection(
  selectionName: string,
  homeTeam: string,
  awayTeam: string,
  league?: string
): NormalizedSelection {
  const normalized = normalizeName(selectionName);
  const home = normalizeName(homeTeam);
  const away = normalizeName(awayTeam);

  if (normalized.includes("brak") && normalized.includes("rozn")) {
    return "NONE";
  }

  if (home && normalized.includes(home)) {
    return "HOME";
  }
  if (away && normalized.includes(away)) {
    return "AWAY";
  }

  return normalize1x2Selection(selectionName, homeTeam, awayTeam, league);
}

function normalizeFirstGoalSelection(
  selectionName: string,
  homeTeam: string,
  awayTeam: string,
  league?: string
): NormalizedSelection {
  const normalized = normalizeName(selectionName);
  const home = normalizeName(homeTeam);
  const away = normalizeName(awayTeam);

  if (normalized.includes("brak") && normalized.includes("gol")) {
    return "NONE";
  }

  if (home && normalized.includes(home)) {
    return "HOME";
  }
  if (away && normalized.includes(away)) {
    return "AWAY";
  }

  return normalize1x2Selection(selectionName, homeTeam, awayTeam, league);
}

function normalizeFirstCardSelection(
  selectionName: string,
  homeTeam: string,
  awayTeam: string,
  league?: string
): NormalizedSelection {
  const normalized = normalizeName(selectionName);
  const home = normalizeName(homeTeam);
  const away = normalizeName(awayTeam);

  if (normalized.includes("nikt") || normalized.includes("brak") || normalized.includes("bez ")) {
    return "NONE";
  }

  if (home && normalized.includes(home)) {
    return "HOME";
  }
  if (away && normalized.includes(away)) {
    return "AWAY";
  }

  return normalize1x2Selection(selectionName, homeTeam, awayTeam, league);
}

function normalizeCardsTeamSelection(
  selectionName: string,
  marketName: string,
  ctx: NormalizationContext
): NormalizedSelection | null {
  const normalizedMarketName = normalizeName(marketName);

  const marketMatch = normalizedMarketName.match(/^kartki\s*-\s*(.+)$/i);
  if (!marketMatch) return null;

  // Betclic renders team names in Polish while the context carries the
  // canonical (often English) form — a plain substring test missed both
  // sides and let raw "Powyżej 0,5" labels leak through as selection codes.
  const teamPart = marketMatch[1].trim();
  const isHome = fragmentIsTeam(teamPart, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(teamPart, ctx.awayTeam, ctx.league);

  const normalizedSel = normalizeName(selectionName);
  if (normalizedSel.includes("powyzej")) {
    return isHome ? "HOME_OVER" : isAway ? "AWAY_OVER" : null;
  }
  if (normalizedSel.includes("ponizej")) {
    return isHome ? "HOME_UNDER" : isAway ? "AWAY_UNDER" : null;
  }

  return null;
}

function normalizeCornersTeamSelection(
  selectionName: string,
  marketName: string,
  ctx: NormalizationContext
): NormalizedSelection | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);
  const normalizedMarketName = normalizeName(marketName);

  const marketMatch = normalizedMarketName.match(/^rzuty rozne\s+(.+?)(?:\s*\(razem z dogrywka\))?$/i);
  if (!marketMatch) return null;

  const teamPart = marketMatch[1].trim();
  const isHome = home && teamPart.includes(home);
  const isAway = away && teamPart.includes(away);

  const normalizedSel = normalizeName(selectionName);
  if (normalizedSel.includes("powyzej")) {
    return isHome ? "HOME_OVER" : isAway ? "AWAY_OVER" : null;
  }
  if (normalizedSel.includes("ponizej")) {
    return isHome ? "HOME_UNDER" : isAway ? "AWAY_UNDER" : null;
  }

  return null;
}

function normalizeTeamShotsOnTargetSelection(
  selectionName: string,
  marketName: string,
  ctx: NormalizationContext
): NormalizedSelection | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);
  const normalizedMarketName = normalizeName(marketName);

  const marketMatch = normalizedMarketName.match(/^suma celnych strzalow w meczu\s*\(opta\)\s*-\s*(.+)$/i);
  if (!marketMatch) return null;

  const teamPart = marketMatch[1].trim();
  const isHome = home && teamPart.includes(home);
  const isAway = away && teamPart.includes(away);

  const normalizedSel = normalizeName(selectionName);
  if (normalizedSel.includes("powyzej")) {
    return isHome ? "HOME_OVER" : isAway ? "AWAY_OVER" : null;
  }
  if (normalizedSel.includes("ponizej")) {
    return isHome ? "HOME_UNDER" : isAway ? "AWAY_UNDER" : null;
  }

  return null;
}

function normalizeTeamShotsSelection(
  selectionName: string,
  marketName: string,
  ctx: NormalizationContext
): NormalizedSelection | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);
  const normalizedMarketName = normalizeName(marketName);

  const marketMatch = normalizedMarketName.match(/^suma strzalow w meczu\s*\(opta\)\s*-\s*(.+)$/i);
  if (!marketMatch) return null;

  const teamPart = marketMatch[1].trim();
  const isHome = home && teamPart.includes(home);
  const isAway = away && teamPart.includes(away);

  const normalizedSel = normalizeName(selectionName);
  if (normalizedSel.includes("powyzej")) {
    return isHome ? "HOME_OVER" : isAway ? "AWAY_OVER" : null;
  }
  if (normalizedSel.includes("ponizej")) {
    return isHome ? "HOME_UNDER" : isAway ? "AWAY_UNDER" : null;
  }

  return null;
}

function normalizeTeamTacklesSelection(
  selectionName: string,
  marketName: string,
  ctx: NormalizationContext
): NormalizedSelection | null {
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);
  const normalizedMarketName = normalizeName(marketName);

  const marketMatch = normalizedMarketName.match(/^liczba odbiorow\s*\(opta\)(?:\s*\(z dogrywka\))?\s*-\s*(.+)$/i);
  if (!marketMatch) return null;

  const teamPart = marketMatch[1].trim();
  const isHome = home && teamPart.includes(home);
  const isAway = away && teamPart.includes(away);

  const normalizedSel = normalizeName(selectionName);
  if (normalizedSel.includes("powyzej")) {
    return isHome ? "HOME_OVER" : isAway ? "AWAY_OVER" : null;
  }
  if (normalizedSel.includes("ponizej")) {
    return isHome ? "HOME_UNDER" : isAway ? "AWAY_UNDER" : null;
  }

  return null;
}

function normalizePenaltyGoalSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const normalized = normalizeName(selectionName);

  if (normalized.includes("ktorykolwiek") || normalized.includes("zawodnik") || normalized.includes("any")) {
    return "ANY";
  }

  if (normalized.includes("zaden") || normalized.includes("brak") || normalized.includes("zadna") || normalized.includes("none")) {
    return "NONE";
  }

  if (fragmentIsTeam(selectionName, ctx.homeTeam, ctx.league)) {
    return "TEAM_HOME";
  }
  if (fragmentIsTeam(selectionName, ctx.awayTeam, ctx.league)) {
    return "TEAM_AWAY";
  }

  if (normalized.includes("home")) {
    return "TEAM_HOME";
  }
  if (normalized.includes("away")) {
    return "TEAM_AWAY";
  }

  return selectionName as NormalizedSelection;
}

function normalizeTeamsToScoreSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const normalized = normalizeName(selectionName);
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  if (normalized.includes("oba") || normalized.includes("obd") || normalized.includes("both")) {
    return "TWO_TEAMS";
  }

  if (normalized.includes("brak") && normalized.includes("gol")) {
    return "ZERO_TEAMS";
  }

  if (normalized.includes("tylko") || normalized.includes("only")) {
    if (home && normalized.includes(home)) {
      return "ONE_TEAM_HOME";
    }
    if (away && normalized.includes(away)) {
      return "ONE_TEAM_AWAY";
    }
    return "ONE_TEAM";
  }

  return selectionName as NormalizedSelection;
}

export function normalizeFirstGoalTimeSelection(
  selectionName: string
): NormalizedSelection {
  // Handles 10-minute interval buckets: "00:00 - 09:59", "10:00 - 19:59", etc.
  const normalized = selectionName.trim();

  if (/brak\s+gola?$/i.test(normalized)) return "NONE";

  // Pattern: "HH:MM - HH:MM" - map to 10-minute buckets by start minute
  const standardMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/i);
  if (standardMatch) {
    const startMin = parseInt(standardMatch[1], 10);

    if (startMin < 10) return "1-10";
    if (startMin < 20) return "11-20";
    if (startMin < 30) return "21-30";
    if (startMin < 40) return "31-40";
    if (startMin < 50) return "41-50";
    if (startMin < 60) return "51-60";
    if (startMin < 70) return "61-70";
    if (startMin < 80) return "71-80";
    return "81-90";
  }

  // Pattern: "HH:MM - Koniec meczu" or "HH:MM - Koniec meczu (90min)"
  const endMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*-\s*koniec\s+meczu/i);
  if (endMatch) {
    return "81-90";
  }

  return normalized as NormalizedSelection;
}

export function normalizeFirstGoalTimeAltSelection(
  selectionName: string
): NormalizedSelection {
  // Handles 15-minute interval buckets: "00:00 - 14:59", "15:00 - 29:59", etc.
  const normalized = selectionName.trim();

  if (/brak\s+gola?$/i.test(normalized)) return "NONE";

  // Pattern: "HH:MM - HH:MM" - map to 15-minute buckets by end minute
  const standardMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/i);
  if (standardMatch) {
    const endMin = parseInt(standardMatch[3], 10);

    if (endMin < 15) return "1-15";
    if (endMin < 30) return "16-30";
    if (endMin < 45) return "31-45";
    if (endMin < 60) return "46-60";
    if (endMin < 75) return "61-75";
    return "76-90";
  }

  // Pattern: "HH:MM - Przerwa" (30:00 - Przerwa = 31-45 bucket)
  const halftimeMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*-\s*przerwa/i);
  if (halftimeMatch) {
    return "31-45";
  }

  // Pattern: "Przerwa - HH:MM" (covers 45-59 = 46-60 bucket)
  const afterHalftimeMatch = normalized.match(/^przerwa\s*-\s*(\d{1,2}):(\d{2})/i);
  if (afterHalftimeMatch) {
    return "46-60";
  }

  // Pattern: "HH:MM - Koniec meczu" or "HH:MM - Koniec meczu (90min)"
  const endMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*-\s*koniec\s+meczu/i);
  if (endMatch) {
    return "76-90";
  }

  return normalized as NormalizedSelection;
}

function normalizeWinningMarginSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const normalized = normalizeName(selectionName);

  if (normalized === "remis" || normalized.startsWith("remis")) {
    return "DRAW";
  }

  const isHome = fragmentIsTeam(selectionName, ctx.homeTeam, ctx.league);
  const isAway = fragmentIsTeam(selectionName, ctx.awayTeam, ctx.league);

  if (normalized.includes("przewaga") || normalized.includes("przewag")) {
    if (normalized.includes("3 lub wiecej") || normalized.includes("3+")) {
      if (isHome) return "HOME_BY_3PLUS" as NormalizedSelection;
      if (isAway) return "AWAY_BY_3PLUS" as NormalizedSelection;
    }
    if (normalized.includes("2 gol")) {
      if (isHome) return "HOME_BY_2" as NormalizedSelection;
      if (isAway) return "AWAY_BY_2" as NormalizedSelection;
    }
    if (normalized.includes("1 gol")) {
      if (isHome) return "HOME_BY_1" as NormalizedSelection;
      if (isAway) return "AWAY_BY_1" as NormalizedSelection;
    }
  }

  return selectionName as NormalizedSelection;
}

function normalizeCorrectScoreGroupSelection(
  selectionName: string,
  homeTeam: string,
  awayTeam: string,
  league?: string
): NormalizedSelection | null {
  const normalized = normalizeName(selectionName);

  if (normalized.startsWith("remis")) {
    return "DRAW";
  }

  if (normalized.includes("inny wynik")) {
    if (fragmentIsTeam(selectionName, homeTeam, league)) {
      return "HOME_OTHER";
    }
    if (fragmentIsTeam(selectionName, awayTeam, league)) {
      return "AWAY_OTHER";
    }
    return null;
  }

  if (/^\s*1\s*-\s*0\s*,\s*2\s*-\s*0\s+lub\s+3\s*-\s*0$/i.test(normalized)) {
    return "HOME_WIN_GROUP_0";
  }
  if (/^\s*4\s*-\s*0\s*,\s*5\s*-\s*0\s+lub\s+6\s*-\s*0$/i.test(normalized)) {
    return "HOME_WIN_GROUP_1";
  }
  if (/^\s*2\s*-\s*1\s*,\s*3\s*-\s*1\s+lub\s+4\s*-\s*1$/i.test(normalized)) {
    return "HOME_WIN_GROUP_2";
  }
  if (/^\s*3\s*-\s*2\s*,\s*4\s*-\s*2\s*,\s*4\s*-\s*3\s+lub\s+5\s*-\s*1$/i.test(normalized)) {
    return "HOME_WIN_GROUP_3";
  }
  if (/^\s*0\s*-\s*1\s*,\s*0\s*-\s*2\s+lub\s+0\s*-\s*3$/i.test(normalized)) {
    return "AWAY_WIN_GROUP_1";
  }
  if (/^\s*0\s*-\s*4\s*,\s*0\s*-\s*5\s+lub\s+0\s*-\s*6$/i.test(normalized)) {
    return "AWAY_WIN_GROUP_2";
  }
  if (/^\s*1\s*-\s*2\s*,\s*1\s*-\s*3\s+lub\s+1\s*-\s*4$/i.test(normalized)) {
    return "AWAY_WIN_GROUP_3";
  }
  if (/^\s*2\s*-\s*3\s*,\s*2\s*-\s*4\s*,\s*3\s*-\s*4\s+lub\s+1\s*-\s*5$/i.test(normalized)) {
    return "AWAY_WIN_GROUP_4";
  }

  return null;
}

// Betclic's selections feed renders a few well-known players' surnames without
// their native diacritics (e.g. "K. Mbappe") even though other players in the
// very same market keep theirs ("O. Dembélé", "D. Doué", "B. Díaz"). Restore
// the missing accent so the same player merges into one canonical selection
// code instead of silently splitting off as a separate, ASCII-only variant.
const BETCLIC_PLAYER_SURNAME_FIXUPS: Record<string, string> = {
  mbappe: "Mbappé",
};

function fixBetclicPlayerDiacritics(canonicalName: string): string {
  const parts = canonicalName.split(" ");
  const lastIndex = parts.length - 1;
  const surname = parts[lastIndex];
  if (!surname) return canonicalName;
  const fixed = BETCLIC_PLAYER_SURNAME_FIXUPS[surname.toLowerCase()];
  if (!fixed) return canonicalName;
  parts[lastIndex] = fixed;
  return parts.join(" ");
}

/**
 * Builds a stable selection code for player-combination markets from the
 * player list itself. Betclic separates players with "/" or "&"
 * ("L. Diaz / Luis Suárez", "B. Embolo & L. Diaz & Cucho Hernandez");
 * each name is canonicalized to "Firstname Lastname" order and the list is
 * sorted so the same combination merges across bookmakers regardless of
 * listing order.
 */
function normalizePlayerComboSelection(selectionName: string): NormalizedSelection {
  const players = selectionName
    .split(/\s*[/&]\s*/)
    .map((part) => fixBetclicPlayerDiacritics(canonicalizePlayerName(part)))
    .filter((part) => part.length > 0);

  if (players.length < 2) {
    return fixBetclicPlayerDiacritics(canonicalizePlayerName(selectionName)) as NormalizedSelection;
  }

  return players
    .sort((a, b) => a.localeCompare(b, "en"))
    .join(" & ") as NormalizedSelection;
}

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext,
  marketName?: string
): NormalizedSelection {
  const trimmed = selName.trim();

  if (marketCode === "OTHER") {
    return trimmed as NormalizedSelection;
  }

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "WIN_TO_NIL":
    case "CLEAN_SHEET":
    case "FIRST_TEAM_TO_SCORE":
    case "CORNERS_RACE":
    case "HALF_TIME_CORNERS_RACE":
    case "CARDS_RACE":
    case "FIRST_HALF_CARDS_1X2":
    case "FOUL_RACE":
    case "OFFSIDES_1X2":
    case "MOST_SHOTS":
    case "MOST_SHOTS_ON_TARGET":
    case "WIN_OR_WIN_BY_2":
      return normalizeBetclic1x2Selection(trimmed, ctx);

    case "FIRST_CARD":
    case "FIRST_HALF_FIRST_CARD":
    case "FIRST_SHOT":
    case "FIRST_SHOT_ON_TARGET":
      return normalizeFirstCardSelection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

     case "FIRST_CORNER":
     case "LAST_CORNER":
     case "NEXT_CORNER_1H":
     case "HALF_TIME_LAST_CORNER":
       return normalizeNextCornerSelection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "HALF_TIME_FIRST_GOAL":
    case "SECOND_HALF_FIRST_GOAL":
      return normalizeFirstGoalSelection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
      return normalizeBetclicDoubleChance(trimmed, ctx);

    case "DOUBLE_CHANCE_BTTS":
    case "HALF_TIME_DOUBLE_CHANCE_BTTS":
    case "SECOND_HALF_DOUBLE_CHANCE_BTTS":
      return normalizeBetclicDoubleChanceBttsSelection(trimmed, ctx);

    case "DOUBLE_CHANCE_TOTAL": {
      return normalizeBetclicDoubleChanceTotalSelection(trimmed, ctx);
    }

    case "RESULT_AND_FIRST_GOAL": {
      return normalizeResultAndFirstGoalSelection(trimmed, ctx);
    }

    case "RESULT_AND_BTTS":
    case "HALF_TIME_RESULT_AND_BTTS":
    case "SECOND_HALF_RESULT_AND_BTTS": {
      return normalizeResultAndBttsSelection(trimmed, ctx);
    }

    case "RESULT_AND_TOTAL":
    case "HALF_TIME_RESULT_AND_TOTAL":
    case "SECOND_HALF_RESULT_AND_TOTAL":
      return normalizeResultAndTotalSelection(trimmed, ctx);

    case "HT_OR_FT_RESULT":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

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
    case "CARDS_TOTAL":
    case "HOME_POSSESSION":
    case "AWAY_POSSESSION":
    case "TOTAL_SHOTS_ON_TARGET":
    case "FOULS_TOTAL":
    case "OFFSIDES_TOTAL":
    case "HOME_TEAM_TOTAL_OFFSIDES":
    case "AWAY_TEAM_TOTAL_OFFSIDES":
    case "CARDS_POINTS_OVER_UNDER":
    case "HALF_TIME_CARDS_POINTS_OVER_UNDER":
    case "CLEARANCES_TOTAL":
      return normalizeOverUnderSelection(trimmed);

    case "CARDS_TEAM": {
      const cardsSelection = marketName
        ? normalizeCardsTeamSelection(trimmed, marketName, ctx)
        : null;
      return (cardsSelection ?? trimmed) as NormalizedSelection;
    }

    case "CORNERS_TEAM": {
      // Range variant first: "0 - 2", "3 - 4", "5 - 6", "7+"
      const sel = trimmed.trim();
      const rangeMatch = sel.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) return `${rangeMatch[1]}-${rangeMatch[2]}` as NormalizedSelection;
      if (/^\d+\+$/.test(sel)) return sel as NormalizedSelection;
      // O/U variant — teamSide is already encoded in paramValue, so use plain OVER/UNDER.
      return normalizeOverUnderSelection(trimmed);
    }

    case "TOTAL_SHOTS":
    case "TEAM_TOTAL_SHOTS":
    case "TEAM_TOTAL_SHOTS_ON_TARGET":
    case "TEAM_TOTAL_TACKLES":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "BTTS_OR_OVER_2_5":
    case "BTTS_PENALTY":
    case "HALF_TIME_BTTS_PENALTY":
    case "SECOND_HALF_BTTS_PENALTY":
    case "BTTS_HEAD_GOALS":
    case "BTTS_FREE_KICK":
    case "BTTS_2PLUS_GOALS":
    case "BOTH_TEAMS_OVER_GOALS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
    case "HAT_TRICK":
    case "SUBSTITUTE_GOAL":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
    case "BOTH_HALVES_GOALS":
    case "BOTH_HALVES_OVER_GOALS":
    case "BOTH_HALVES_UNDER_GOALS":
    case "RED_CARD":
    case "RED_CARD_TEAM":
    case "FREE_KICK_GOAL":
    case "HOME_TEAM_FREE_KICK_GOAL":
    case "AWAY_TEAM_FREE_KICK_GOAL":
    case "HEADER_GOAL":
    case "HEADER_GOAL_BOTH_HALVES":
    case "HALF_TIME_HEADER_GOAL":
    case "SECOND_HALF_HEADER_GOAL":
    case "TEAM_HEADER_GOAL":
    case "HOME_SCORE_BOTH_HALVES":
    case "AWAY_SCORE_BOTH_HALVES":
    case "HOME_WIN_BOTH_HALVES":
    case "AWAY_WIN_BOTH_HALVES":
    case "HOME_WIN_AT_LEAST_ONE_HALF":
    case "AWAY_WIN_AT_LEAST_ONE_HALF":
    case "HALF_TIME_HOME_CLEAN_SHEET":
    case "HALF_TIME_AWAY_CLEAN_SHEET":
    case "SECOND_HALF_HOME_CLEAN_SHEET":
    case "SECOND_HALF_AWAY_CLEAN_SHEET":
      return normalizeYesNoSelection(trimmed);

    case "TEAMS_TO_SCORE":
      return normalizeTeamsToScoreSelection(trimmed, ctx);

    case "WINNING_MARGIN":
      return normalizeWinningMarginSelection(trimmed, ctx);

    case "PENALTY_GOAL":
    case "HALF_TIME_PENALTY_GOAL":
    case "SECOND_HALF_PENALTY_GOAL":
      return normalizePenaltyGoalSelection(trimmed, ctx);

    case "FIRST_GOAL_TIME":
      return normalizeFirstGoalTimeSelection(trimmed);

    case "FIRST_GOAL_TIME_ALT":
      return normalizeFirstGoalTimeAltSelection(trimmed);

    case "TOTAL_GOALS_AND_BTTS": {
      const normalized = normalizeName(trimmed);
      if (normalized.includes("tak") && normalized.includes("powyzej")) return "OVER_YES";
      if (normalized.includes("tak") && normalized.includes("ponizej")) return "UNDER_YES";
      if (normalized.includes("nie") && normalized.includes("powyzej")) return "OVER_NO";
      if (normalized.includes("nie") && normalized.includes("ponizej")) return "UNDER_NO";
      return trimmed as NormalizedSelection;
    }

    case "BTTS_BY_HALF": {
      const normalized = normalizeName(trimmed);
      if (/^tak\s*\/\s*tak$/i.test(trimmed)) return "Both" as NormalizedSelection;
      if (/^tak\s*\/\s*nie$/i.test(trimmed)) return "1st" as NormalizedSelection;
      if (/^nie\s*\/\s*tak$/i.test(trimmed)) return "2nd" as NormalizedSelection;
      if (/^nie\s*\/\s*nie$/i.test(trimmed)) return "None" as NormalizedSelection;
      if (normalized.includes("1. polowa") || normalized === "1") return "1st" as NormalizedSelection;
      if (normalized.includes("2. polowa") || normalized === "2") return "2nd" as NormalizedSelection;
      if (normalized.includes("obie") || normalized.includes("both") || normalized === "rowno") return "Both" as NormalizedSelection;
      if (normalized.includes("zadnej") || normalized.includes("zadna") || normalized.includes("none") || normalized.includes("bez goli") || normalized.includes("brak goli")) return "None" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "ODD_EVEN_GOALS":
    case "HOME_TEAM_ODD_EVEN_GOALS":
    case "AWAY_TEAM_ODD_EVEN_GOALS":
    case "HALF_TIME_ODD_EVEN_GOALS":
    case "SECOND_HALF_ODD_EVEN_GOALS":
    case "HALF_TIME_CORNERS_ODD_EVEN":
    case "CORNERS_ODD_EVEN":
      return normalizeOddEvenSelection(trimmed);

    case "HALF_WITH_MORE_GOALS": {
      const normalized = normalizeName(trimmed);
      if (normalized.includes("1. polowa") || normalized === "1") return "1st" as NormalizedSelection;
      if (normalized.includes("2. polowa") || normalized === "2") return "2nd" as NormalizedSelection;
      if (normalized.includes("remis") || normalized === "x") return "Draw" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "TEAM_HALF_WITH_MORE_GOALS": {
      const normalizedMarket = marketName ? normalizeName(marketName) : "";
      const teamSide = resolveTeamHalfWithMoreGoalsTeamSide(normalizedMarket, ctx);
      const normalized = normalizeName(trimmed);

      if (normalized.includes("1. polowa") || normalized === "1") {
        return teamSide === "HOME" ? "HOME_1ST" : "AWAY_1ST";
      }
      if (normalized.includes("2. polowa") || normalized === "2") {
        return teamSide === "HOME" ? "HOME_2ND" : "AWAY_2ND";
      }
      if (normalized.includes("remis") || normalized === "x") {
        return teamSide === "HOME" ? "HOME_EQUAL" : "AWAY_EQUAL";
      }
      return trimmed as NormalizedSelection;
    }

    case "ASIAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP":
      return normalizeHandicapSelection(trimmed, ctx);

    case "EUROPEAN_HANDICAP":
    case "CORNERS_HANDICAP":
    case "HALF_TIME_CORNERS_HANDICAP": {
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed)) return "DRAW";
      // Betclic labels handicap selections with team name + line, e.g.
      // "Szwajcaria (-0,5)". The context team name may be the canonical
      // English form ("Switzerland"), so resolve via fragmentIsTeam —
      // otherwise both sides fell through to UNKNOWN and the grouper kept
      // only one price, silently dropping the away side of each line.
      if (fragmentIsTeam(trimmed, ctx.homeTeam, ctx.league)) return "HOME";
      if (fragmentIsTeam(trimmed, ctx.awayTeam, ctx.league)) return "AWAY";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "FIRST_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_EUROPEAN_HANDICAP": {
      // Betclic uses team names in selections (e.g. "Fulham (-1)", "Remis (Fulham -1)", "Aston Villa (+1)")
      const normalized = normalizeName(trimmed);

      if (normalized.startsWith("remis")) {
        return "DRAW";
      }

      if (fragmentIsTeam(trimmed, ctx.homeTeam, ctx.league)) {
        return "HOME";
      }
      if (fragmentIsTeam(trimmed, ctx.awayTeam, ctx.league)) {
        return "AWAY";
      }

      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "ASIAN_HANDICAP_3WAY":
      return normalizeAsianHandicap3WaySelection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "CORRECT_SCORE":
    case "HALF_TIME_CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      if (score) return score as NormalizedSelection;
      // Betclic labels the catch-all outcome "Inny" — align with the canonical
      // OTHER code used by peers for the same score-grid column.
      const normalized = normalizeName(trimmed);
      if (normalized === "inny" || normalized === "inny wynik" || normalized === "pozostale") {
        return "OTHER" as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "CORRECT_SCORE_GROUP": {
      const csgSelection = normalizeCorrectScoreGroupSelection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
      return (csgSelection ?? trimmed) as NormalizedSelection;
    }

    case "EXACT_GOALS":
    case "HOME_EXACT_GOALS":
    case "AWAY_EXACT_GOALS":
    case "SECOND_HALF_HOME_EXACT_GOALS":
    case "HALF_TIME_EXACT_GOALS":
    case "SECOND_HALF_EXACT_GOALS":
    case "CARDS_EXACT":
    case "HOME_EXACT_CARDS":
    case "AWAY_EXACT_CARDS":
    case "HALF_TIME_HOME_EXACT_CARDS":
    case "HALF_TIME_AWAY_EXACT_CARDS":
    case "HALF_TIME_HOME_EXACT_CORNERS":
    case "HALF_TIME_AWAY_EXACT_CORNERS":
    case "HALF_TIME_CARDS_TOTAL":
    case "HALF_TIME_CORNERS_TOTAL": {
      const sel = trimmed.trim();
      // Range/exact-count variants first
      if (/^\d+\+$/.test(sel)) return sel as NormalizedSelection;
      const rangeMatch = sel.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) return `${rangeMatch[1]}-${rangeMatch[2]}` as NormalizedSelection;
      if (/^\d+$/.test(sel)) return sel as NormalizedSelection;
      if (sel === "2+") return "2+" as NormalizedSelection;
      if (sel === "3+") return "3+" as NormalizedSelection;
      // Fall back to OVER/UNDER (handled by "Powyżej/Poniżej" variants)
      const normalized = normalizeName(sel);
      if (normalized.includes("powyzej") || normalized.includes("over")) return "OVER";
      if (normalized.includes("ponizej") || normalized.includes("under")) return "UNDER";
      return sel as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME":
    case "DOUBLE_RESULT": {
      const htft = parseHtFtSelection(trimmed) ?? parseBetclicHtFtSelection(trimmed, ctx);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME_AND_TOTAL": {
      return normalizeHtFtAndTotalSelection(trimmed, ctx);
    }

    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
    case "PLAYER_SHOTS":
    case "PLAYER_CARDS":
    case "PLAYER_ASSISTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_PASSES":
    case "PLAYER_FREE_KICK_GOAL":
    case "PLAYER_HEADER_GOAL":
    case "PLAYER_GOAL_AND_ASSIST":
    case "PENALTY_SCORER":
      // Canonicalize to "Firstname Lastname" so the same player merges
      // across bookmakers regardless of the source name order.
      return fixBetclicPlayerDiacritics(
        canonicalizePlayerName(trimmed.replace(/^\d+\.\s*/, "").trim())
      ) as NormalizedSelection;

    case "PLAYER_ASSIST_PAIRS":
    case "PLAYER_ASSIST_TRIPLE":
      return "YES" as NormalizedSelection;

    case "TWO_PLAYERS_COMBINED_GOALS":
    case "TWO_PLAYERS_ANYTIME":
    case "BOTH_PLAYERS_ANYTIME":
    case "HALF_TIME_TWO_PLAYERS_ANYTIME":
    case "SECOND_HALF_TWO_PLAYERS_ANYTIME":
    case "ANY_PLAYER_FIRST_GOAL":
    case "SAME_PLAYER_SCORES_BOTH_HALVES":
    case "BOTH_PLAYERS_SCORE_BOTH_HALVES":
    case "THREE_PLAYERS_COMBINED_GOALS":
    case "THREE_PLAYERS_ANYTIME":
    case "HALF_TIME_THREE_PLAYERS_ANYTIME":
    case "SECOND_HALF_THREE_PLAYERS_ANYTIME":
    case "ANY_PLAYER_SCORES_BOTH_HALVES":
    case "ALL_PLAYERS_SCORE":
      // Betclic quotes dozens of distinct player combinations per market
      // ("L. Diaz / Luis Suárez", "B. Embolo & L. Diaz & Cucho Hernandez").
      // Collapsing them all onto the constant PLAYER_PAIR/PLAYER_TRIO code
      // let the aggregator keep a single arbitrary row and silently discard
      // every other combination's odds — encode the player list instead.
      return normalizePlayerComboSelection(trimmed);

    case "GOAL_RANGE":
    case "TEAM_GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
    case "HOME_GOAL_RANGE":
    case "AWAY_GOAL_RANGE":
    case "CORNERS_RANGE": {
      const normalized = normalizeName(trimmed);
      // "Brak Gola" -> "0"
      if (normalized.includes("brak") && normalized.includes("gol")) {
        return "0" as NormalizedSelection;
      }
      // "7+" -> "7+"
      if (/^\d+\+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      // "1 - 2" -> "1-2" (remove spaces around dash)
      const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        return `${rangeMatch[1]}-${rangeMatch[2]}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

function extractNextCornerParam(marketName: string): string | undefined {
  const match = marketName.match(/nastepny\s+(\d+)\s+rzut\s+rozny/i);
  return match ? match[1] : undefined;
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): { paramValue?: string; parameters?: string[] } {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return {};

  const selectionNames = raw.selections.map((s) => s.name);

  if (marketCode === "NEXT_CORNER_1H") {
    const paramValue = extractNextCornerParam(normalizeName(raw.name));
    return { paramValue };
  }

  if (
    marketCode === "ASIAN_HANDICAP_3WAY" ||
    marketCode === "ASIAN_HANDICAP" ||
    marketCode === "FIRST_HALF_ASIAN_HANDICAP" ||
    marketCode === "SECOND_HALF_ASIAN_HANDICAP" ||
    marketCode === "FIRST_HALF_EUROPEAN_HANDICAP" ||
    marketCode === "EUROPEAN_HANDICAP" ||
    marketCode === "SECOND_HALF_EUROPEAN_HANDICAP" ||
    marketCode === "CORNERS_HANDICAP" ||
    marketCode === "HALF_TIME_CORNERS_HANDICAP"
  ) {
    // Parser pre-splits multi-line handicap markets, so raw.paramValue carries this line's value
    if (raw.paramValue) {
      return { paramValue: raw.paramValue };
    }
    const parameters = extractMultipleHandicapLines(selectionNames);
    return { parameters };
  }

  if (
    marketCode === "DOUBLE_CHANCE_TOTAL" ||
    marketCode === "RESULT_AND_TOTAL" ||
    marketCode === "HALF_TIME_RESULT_AND_TOTAL" ||
    marketCode === "SECOND_HALF_RESULT_AND_TOTAL" ||
    marketCode === "HALFTIME_FULLTIME_AND_TOTAL"
  ) {
    // Parser pre-splits Result+Total combo markets per goal line
    // (splitResultAndTotalMarket), so raw.paramValue carries this line's value —
    // same contract as handicaps above.
    if (raw.paramValue) {
      return { paramValue: raw.paramValue };
    }
    const parameters = extractMultipleOverUnderLines(selectionNames);
    // A single distinct line (e.g. "Algieria & Powyżej 1,5") identifies the
    // market parameter — expose it as paramValue so the marketKey groups with
    // peers (…:1.5) instead of falling into the unparameterized "base" bucket.
    if (parameters && parameters.length === 1) {
      return { paramValue: parameters[0] };
    }
    return { parameters };
  }

  const fromSelections = parseOverUnderLine(selectionNames);

  switch (metadata.parameterType) {
    case "player": {
      // For player markets, distinguish between:
      // 1. Single player markets (no parameters) - GOALSCORER_ANYTIME, etc.
      // 2. Multiple player markets with parameters - TWO_PLAYERS_COMBINED_GOALS, THREE_PLAYERS_ANYTIME
      
      const playerMarketCodesWithParams = ["TWO_PLAYERS_COMBINED_GOALS", "THREE_PLAYERS_ANYTIME", "PLAYER_ASSIST_PAIRS", "PLAYER_ASSIST_TRIPLE", "TWO_PLAYERS_ANYTIME", "THREE_PLAYERS_COMBINED_GOALS"];
      const isParameterizedPlayerMarket = playerMarketCodesWithParams.includes(marketCode);
      
      if (isParameterizedPlayerMarket) {
        // These markets have selections as parameters (e.g., player pairs/trios).
        // Canonicalize each name to "Firstname Lastname" order so the same
        // combination merges across bookmakers.
        return { parameters: selectionNames.map((name) => normalizePlayerComboSelection(name)) };
      } else {
        // Single player markets - return empty parameters
        return {};
      }
    }
    case "handicap": {
      const handicapValue = (
        parseHandicapLine(raw.name) ??
        parseHandicapLine(selectionNames.join(" ")) ??
        fromSelections
      );
      return { paramValue: handicapValue };
    }
    case "integer": {
      const integerValue = (
        parseIntegerLine(raw.name) ??
        parseIntegerLine(selectionNames.join(" ")) ??
        fromSelections
      );
      return { paramValue: integerValue };
    }
    case "decimal":
    default: {
      const decimalValue = parseDecimalLine(raw.name) ?? fromSelections;
      return { paramValue: decimalValue };
    }
  }
}

export const betclicNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "betclic",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { marketCode, matchedBy, teamName, teamSide } = resolveMarketCode(raw, ctx);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[betclic] Market code "${marketCode}" not in catalog`);
      return null;
    }

    let { paramValue, parameters } = extractParamValue(marketCode, raw);

    // "Oba zespoly strzela po N+ gole" = each team scores N or more,
    // i.e. both teams over (N - 0.5) goals on the decimal slider.
    if (marketCode === "BOTH_TEAMS_OVER_GOALS") {
      const thresholdMatch = normalizeName(raw.name).match(/strzela po (\d+)\+/);
      if (thresholdMatch) {
        paramValue = (Number(thresholdMatch[1]) - 0.5).toString();
      }
    }

    if (marketCode === "TEAM_HEADER_GOAL" && teamSide) {
      paramValue = teamSide;
    }

    // Use teamSide as paramValue so HOME/AWAY variants produce distinct marketKeys:
    // TEAM_HALF_WITH_MORE_GOALS_HOME vs TEAM_HALF_WITH_MORE_GOALS_AWAY
    if (marketCode === "TEAM_HALF_WITH_MORE_GOALS" && teamSide) {
      paramValue = teamSide;
    }

    // Team-suffix markets that carry an over/under line AND per-team variants:
    // combine teamSide with the numeric line so HOME/AWAY lines don't collide on marketKey.
    // Example: TEAM_TOTAL_SHOTS:HOME:2.5 vs TEAM_TOTAL_SHOTS:AWAY:2.5
    const TEAM_SUFFIX_MARKETS_WITH_LINE = new Set<string>([
      "CORNERS_TEAM",
      "TEAM_TOTAL_SHOTS",
      "TEAM_TOTAL_SHOTS_ON_TARGET",
    ]);
    if (teamSide && TEAM_SUFFIX_MARKETS_WITH_LINE.has(marketCode)) {
      paramValue = paramValue ? `${teamSide}:${paramValue}` : teamSide;
    }

    // Team-suffix markets without a numeric line: use teamSide as the paramValue directly.
    if (marketCode === "RED_CARD_TEAM" && teamSide) {
      paramValue = teamSide;
    }
    
    const marketKey = buildMarketKey(marketCode, paramValue);

    const selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode, ctx, raw.name),
      label: sel.name,
      odds: sel.odds,
    }));

    let customLabel: string | undefined;
    if (marketCode === "RED_CARD_TEAM" && teamName) {
      customLabel = `Czerwona kartka - ${teamName}`;
    } else if (marketCode === "TEAM_HEADER_GOAL" && teamName) {
      customLabel = `Strzelą gola głową - ${teamName}`;
    }

    return {
      marketCode,
      paramValue,
      parameters,
      marketKey,
      customLabel,
      selections,
      debug: {
        rawName: raw.name,
        rawId: raw.bookmakerMarketId ?? undefined,
        matchedBy,
      },
    };
  },
};

export default betclicNormalizer;
