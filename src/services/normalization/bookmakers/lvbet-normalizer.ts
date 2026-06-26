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
  normalizeMarketName,
  parseOverUnderLine,
  parseDecimalLine,
  parseIntegerLine,
  parseHandicapLine,
  normalize1x2Selection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  parseScoreSelection,
  parseHtFtSelection,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";

const LVBET_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {};

const LVBET_MARKET_NAME_TO_CODE: Record<string, NormalizedMarketType> = {
  "zwyciezca meczu": "MATCH_WINNER",
  "wynik meczu": "MATCH_WINNER",
  "podwojna szansa": "DOUBLE_CHANCE",
  "remis = zwrot": "DRAW_NO_BET",
  "dokładny wynik": "CORRECT_SCORE",
  "obie druzyny strzela gola": "BTTS",
  "obie druzyny strzela": "BTTS",
  "parzyste / nieparzyste": "ODD_EVEN_GOALS",
  "suma goli": "TOTAL_GOALS",
  "liczba goli": "TOTAL_GOALS",
  "azjatycka suma goli": "TOTAL_GOALS_ASIAN",
  "1. połowa - wynik": "HALF_TIME_RESULT",
  "2. połowa - wynik": "SECOND_HALF_RESULT",
};

const LVBET_MARKET_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /dokładny wynik/, code: "CORRECT_SCORE" },
  { pattern: /podwojna szansa|dwojtyp|mix szans/, code: "DOUBLE_CHANCE" },
  { pattern: /remis = zwrot|zaklad bez/, code: "DRAW_NO_BET" },
  { pattern: /obie druzyny strzela/, code: "BTTS" },
  { pattern: /parzyste|nieparzyst/, code: "ODD_EVEN_GOALS" },
  { pattern: /zwyciezca meczu|wynik meczu|zwyciezca/, code: "MATCH_WINNER" },
  { pattern: /suma goli|liczba goli|dokładna liczba goli|gole|bramek/, code: "TOTAL_GOALS" },
];

// Audited name-pattern -> code mappings.
// LVBET exposes no stable market id, so markets are recognized purely by their
// (normalized: lowercased, diacritics-stripped, whitespace-collapsed) name.
// Each pattern anchors on the STABLE phrase of a market and generalizes embedded
// team/player names and over/under lines. Order matters: more specific patterns
// MUST appear before generic catch-alls within the same family.
const LVBET_AUDIT_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  // --- Time-period stats (must precede generic corner/throw-in families) ---
  { pattern: /pierwsze 10 minut.*rzuty rozne 0\.5$/, code: "TIME_PERIOD_CORNERS_TOTAL" },
  { pattern: /pierwsze 10 minut.*wrzuty z autu/, code: "FIRST_PERIOD_THROW_INS" },
  { pattern: /pierwsze 10 minut.*rzuty rozne/, code: "FIRST_10_MIN_CORNERS_TOTAL" },

  // --- Corners (rzuty rozne) ---
  { pattern: /rzuty rozne: 1\. połowa - wynik/, code: "HALF_TIME_CORNERS_RACE" },
  { pattern: /rzuty rozne: 1\. połowa - suma/, code: "HALF_TIME_CORNERS_TOTAL" },
  { pattern: /rzuty rozne: 1\. połowa -/, code: "HALF_TIME_CORNERS_TEAM" },
  { pattern: /rzuty rozne: wyscig do/, code: "CORNERS_RACE_TO" },
  { pattern: /rzuty rozne: suma \(przedział\)/, code: "CORNERS_RANGE" },
  { pattern: /rzuty rozne: suma \(3-drogowo\)/, code: "CORNERS_TOTAL_3WAY" },
  { pattern: /rzuty rozne: suma/, code: "CORNERS_TOTAL" },
  { pattern: /rzuty rozne: wynik/, code: "CORNERS_RACE" },
  { pattern: /rzuty rozne:/, code: "CORNERS_TEAM" },
  { pattern: /pierwszy rzut rozny/, code: "FIRST_CORNER" },
  { pattern: /ostatni rzut rozny/, code: "LAST_CORNER" },
  { pattern: /połowa z najwieksza liczba rzutow roznych/, code: "HALF_WITH_MORE_CORNERS" },

  // --- Fouls (faule) ---
  { pattern: /faule: 1\. połowa - wynik/, code: "HALF_TIME_FOUL_RACE" },
  { pattern: /faule: 1\. połowa - suma/, code: "HALF_TIME_FOULS_TOTAL" },
  { pattern: /faule: 1\. połowa -/, code: "HALF_TIME_TEAM_FOULS" },
  { pattern: /faule: suma/, code: "FOULS_TOTAL" },
  { pattern: /faule:/, code: "TEAM_TOTAL_FOULS" },

  // --- Yellow cards (zołte kartki) ---
  { pattern: /zołte kartki - 1\. połowa: wynik/, code: "FIRST_HALF_CARDS_1X2" },
  { pattern: /zołte kartki - 1\. połowa: suma/, code: "HALF_TIME_CARDS_TOTAL" },
  { pattern: /zołte kartki - 1\. połowa:/, code: "HALF_TIME_CARDS_TEAM" },
  { pattern: /zołte kartki - 2\. połowa: wynik/, code: "SECOND_HALF_CARDS_1X2" },
  { pattern: /zołte kartki - 2\. połowa: suma/, code: "SECOND_HALF_CARDS_TOTAL" },
  { pattern: /zołte kartki - 2\. połowa:/, code: "SECOND_HALF_CARDS_TEAM" },
  { pattern: /zołte kartki: wynik/, code: "CARDS_RACE" },
  { pattern: /zołte kartki: suma \d+$/, code: "YELLOW_CARDS_TOTAL" },
  { pattern: /zołte kartki: suma/, code: "CARDS_TOTAL" },
  { pattern: /zołte kartki:/, code: "CARDS_TEAM" },
  { pattern: /pierwsza zołta kartka/, code: "FIRST_CARD" },
  { pattern: /ostatnia zołta kartka/, code: "LAST_YELLOW_CARD" },

  // --- Card points ---
  { pattern: /kartki: suma punktow/, code: "CARDS_POINTS_OVER_UNDER" },
  { pattern: /kartki: wynik \(zk/, code: "CARDS_POINTS_1X2" },

  // --- Red cards (czerwona kartka) ---
  { pattern: /czerwone kartki: suma/, code: "RED_CARDS_TOTAL" },
  { pattern: /czerwona kartka: 1\. połowa/, code: "HALF_TIME_RED_CARD" },
  { pattern: /czerwona kartka: 2\. połowa/, code: "SECOND_HALF_RED_CARD" },
  { pattern: /czerwona kartka: (?:belgia|belgium|nowa zelandia|new zealand)/, code: "RED_CARD_TEAM" },
  { pattern: /bezposrednia czerwona kartka/, code: "DIRECT_RED_CARD" },
  { pattern: /rzut karny i czerwona kartka/, code: "RED_CARD_AND_PENALTY" },
  { pattern: /rzut karny lub czerwona kartka/, code: "PENALTY_OR_RED_CARD" },
  { pattern: /obie druzyny otrzymaja czerwona kartke/, code: "BOTH_TEAMS_RED_CARD" },
  { pattern: /zawodnik otrzyma czerwona kartke/, code: "PLAYER_RED_CARD" },

  // --- Penalties ---
  { pattern: /1 połowa: rzut karny/, code: "HALF_TIME_PENALTY_AWARDED" },
  { pattern: /rzut karny w meczu/, code: "PENALTY_AWARDED" },
  { pattern: /strzeli gola z rzutu karnego/, code: "PENALTY_SCORER" },
  { pattern: /strzela karnego/, code: "PENALTY_GOAL" },

  // --- Offsides (spalone) ---
  { pattern: /spalone: wynik/, code: "OFFSIDES_1X2" },
  { pattern: /spalone: 1\. spalony/, code: "FIRST_OFFSIDE" },
  { pattern: /spalone: suma/, code: "OFFSIDES_TOTAL" },
  { pattern: /spalone: belgia suma 2\.5$/, code: "AWAY_TEAM_TOTAL_OFFSIDES" },
  { pattern: /spalone: (?:belgia|belgium) suma/, code: "HOME_TEAM_TOTAL_OFFSIDES" },
  { pattern: /spalone: (?:nowa zelandia|new zealand) suma/, code: "AWAY_TEAM_TOTAL_OFFSIDES" },

  // --- Shots (strzały) — team/total markets carry a colon after the stat ---
  { pattern: /strzały celne: wynik/, code: "MOST_SHOTS_ON_TARGET" },
  { pattern: /strzały celne: 1\. strzał celny/, code: "FIRST_SHOT_ON_TARGET" },
  { pattern: /strzały celne: suma/, code: "TOTAL_SHOTS_ON_TARGET" },
  { pattern: /strzały celne:/, code: "TEAM_TOTAL_SHOTS_ON_TARGET" },
  { pattern: /strzały: wynik/, code: "MOST_SHOTS" },
  { pattern: /strzały: suma/, code: "TOTAL_SHOTS" },
  { pattern: /strzały:/, code: "TEAM_TOTAL_SHOTS" },

  // --- Player props (no colon after stat; carry "(must start)" / "(musi rozpoczac" / "zawodnicy") ---
  { pattern: /total shots on target/, code: "PLAYER_SHOTS_ON_TARGET" },
  { pattern: /total shots \(must start\)/, code: "PLAYER_SHOTS" },
  { pattern: /strzały celne \(musi rozpoczac/, code: "PLAYER_SHOTS_ON_TARGET" },
  { pattern: /zawodnicy \(strzały celne\)/, code: "PLAYER_SHOTS_ON_TARGET" },
  { pattern: /strzały \(musi rozpoczac/, code: "PLAYER_SHOTS" },
  { pattern: /zawodnicy \(strzały\) - powyzej 7\.5/, code: "PLAYER_SHOTS_OVER" },
  { pattern: /zawodnicy \(strzały\)/, code: "PLAYER_SHOTS" },
  { pattern: /zawodnicy \(faule popełnione\) - powyzej 3\.5/, code: "PLAYER_FOULS_OVER" },
  { pattern: /zawodnicy \(faule popełnione\)/, code: "PLAYER_FOULS" },
  { pattern: /zawodnicy \(faule zarobione\)/, code: "PLAYER_FOULS_WON" },
  { pattern: /odbiory- tackles/, code: "PLAYER_TACKLES" },
  { pattern: /obrony bramkarza - powyzej \(2\.5\)/, code: "GOALKEEPER_SAVES_OVER" },
  { pattern: /obrony bramkarza - powyzej/, code: "PLAYER_SAVES" },

  // --- Goalscorer markets ---
  { pattern: /pierwszy strzelec/, code: "GOALSCORER_FIRST" },
  { pattern: /ostatni strzelec/, code: "GOALSCORER_LAST" },
  { pattern: /strzelec pierwszego gola/, code: "GOALSCORER_FIRST" },
  { pattern: /strzelec ostatniego gola/, code: "GOALSCORER_LAST" },
  { pattern: /strzelec gola - potrojna szansa/, code: "THREE_PLAYERS_ANYTIME" },
  { pattern: /strzelec bramki/, code: "GOALSCORER_ANYTIME" },
  { pattern: /trzech zawodnikow strzeli gola/, code: "ALL_PLAYERS_SCORE" },
  { pattern: /obaj zawodnicy strzela gola/, code: "BOTH_PLAYERS_ANYTIME" },

  // --- Throw-ins (auty) ---
  { pattern: /auty: wynik/, code: "MATCH_WINNER" },
  { pattern: /auty: suma/, code: "THROW_INS_TOTAL" },
  { pattern: /auty: belgia suma 23\.5$/, code: "THROW_INS_TEAM" },
  { pattern: /auty: nowa zelandia suma 14\.5$/, code: "TEAM_THROW_INS" },
  { pattern: /auty:/, code: "TEAM_TOTAL_THROW_INS" },

  // --- Goal kicks (wybicia od bramki) ---
  { pattern: /wybicia od bramki: suma/, code: "GOAL_KICKS_TOTAL" },
  { pattern: /wybicia od bramki: belgia - suma 4\.5$/, code: "TEAM_TOTAL_GOAL_KICKS" },
  { pattern: /wybicia od bramki: belgia - suma 7\.5$/, code: "TEAM_TOTAL_GOAL_KICKS" },
  { pattern: /wybicia od bramki: nowa zelandia - suma 14\.5$/, code: "TEAM_TOTAL_GOAL_KICKS" },
  { pattern: /wybicia od bramki:/, code: "TEAM_GOAL_KICKS" },

  // --- Half-time / second-half scoring & results (specific phrases) ---
  { pattern: /1\. połowa - dokładny wynik/, code: "HALF_TIME_CORRECT_SCORE" },
  { pattern: /2\. połowa - dokładny wynik/, code: "SECOND_HALF_CORRECT_SCORE" },
  { pattern: /1\. połowa - pierwsza druzyna/, code: "HALF_TIME_FIRST_GOAL" },
  { pattern: /2\. połowa - pierwsza druzyna/, code: "SECOND_HALF_FIRST_GOAL" },
  { pattern: /1\. połowa - ostatnia druzyna/, code: "HALF_TIME_LAST_TEAM_TO_SCORE" },
  { pattern: /2\. połowa - ostatnia druzyna/, code: "SECOND_HALF_LAST_TEAM_TO_SCORE" },
  { pattern: /1\. połowa - (?:belgia|belgium) wygra do 0/, code: "HALF_TIME_HOME_WIN_TO_NIL" },
  { pattern: /zawodnik strzeli gola w 1\. połowie/, code: "HALF_TIME_GOALSCORER_ANYTIME" },
  { pattern: /player to score in second half/, code: "SECOND_HALF_GOALSCORER_ANYTIME" },
  { pattern: /(?:belgia|belgium) strzeli gola w 1\. połowie/, code: "HALF_TIME_HOME_TO_SCORE" },
  { pattern: /(?:nowa zelandia|new zealand) strzeli gola w 1\. połowie/, code: "HALF_TIME_AWAY_TO_SCORE" },
  { pattern: /(?:belgia|belgium) strzeli gola w 2\. połowie/, code: "SECOND_HALF_HOME_TO_SCORE" },
  { pattern: /(?:nowa zelandia|new zealand) strzeli gola w 2\. połowie/, code: "SECOND_HALF_AWAY_TO_SCORE" },
  { pattern: /gol w 1\. połowie/, code: "HALF_TIME_GOAL" },
  { pattern: /gol w 2\. połowie/, code: "SECOND_HALF_GOAL" },

  // --- Team to score (full match) & by-half ---
  { pattern: /(?:belgia|belgium|nowa zelandia|new zealand) strzeli w obu połowach/, code: "HOME_SCORE_BOTH_HALVES" },
  { pattern: /strzeli w pierwszej\/drugiej połowie/, code: "TEAM_SCORE_BY_HALF" },
  { pattern: /(?:belgia|belgium) strzeli gola/, code: "HOME_TEAM_TO_SCORE" },
  { pattern: /(?:nowa zelandia|new zealand) strzeli gola/, code: "AWAY_TEAM_TO_SCORE" },
  { pattern: /pierwsza druzyna, ktora zdobedzie gola/, code: "FIRST_TEAM_TO_SCORE" },
  { pattern: /ostatnia druzyna, ktora zdobedzie gola/, code: "LAST_TEAM_TO_SCORE" },

  // --- Player goal markets ---
  { pattern: /zawodnik strzeli gola w obu połowach/, code: "PLAYER_SCORES_BOTH_HALVES" },
  { pattern: /zawodnik strzeli gola spoza pola karnego/, code: "PLAYER_GOAL_OUTSIDE_BOX" },
  { pattern: /zawodnik strzeli gola i jego zespoł przegra/, code: "PLAYER_GOAL_TEAM_LOSES" },
  { pattern: /zawodnik strzeli gola i mecz zakonczy sie remisem/, code: "PLAYER_GOAL_AND_RESULT" },
  { pattern: /zawodnik strzeli gola lub zanotuje asyste/, code: "PLAYER_GOAL_OR_ASSIST" },
  { pattern: /zawodnik strzeli gola głowa/, code: "PLAYER_HEADER_GOAL" },
  { pattern: /dowolny zawodnik strzeli 3 lub wiecej goli/, code: "HAT_TRICK" },
  { pattern: /zawodnik strzeli 2 lub wiecej goli/, code: "PLAYER_2_OR_MORE_GOALS" },
  { pattern: /zawodnik strzeli \d+ lub wiecej goli/, code: "PLAYER_GOALS" },
  { pattern: /zawodnik zanotuje asyste/, code: "PLAYER_ASSISTS" },
  { pattern: /pierwszy zawodnik, ktory otrzyma kartke/, code: "FIRST_CARD_PLAYER" },
  { pattern: /zawodnik otrzyma kartke/, code: "PLAYER_CARDS" },
  { pattern: /strzeli gola i zaliczy asyste/, code: "PLAYER_GOAL_AND_ASSIST" },
  { pattern: /rezerwowy strzeli bramke/, code: "SUBSTITUTE_GOAL" },
  { pattern: /goal by a direct free kick/, code: "FREE_KICK_GOAL" },
  { pattern: /an own goal in the match/, code: "OWN_GOAL" },

  // --- First-goal method / timing ---
  { pattern: /sposob zdobycia pierwszego gola/, code: "FIRST_GOAL_METHOD" },
  { pattern: /czas zdobycia pierwszego gola/, code: "FIRST_GOAL_TIME" },
  { pattern: /1\. gol - czas/, code: "FIRST_GOAL_TIME_ALT" },
  { pattern: /bedzie wynik w trakcie meczu/, code: "SCORE_DURING_MATCH" },
  { pattern: /dokładnie 1 gol w meczu/, code: "EXACT_GOALS_YN" },

  // --- Win / result variants ---
  { pattern: /(?:belgia|belgium) wygra do zera/, code: "HOME_WIN_TO_NIL" },
  { pattern: /(?:nowa zelandia|new zealand) wygra do zera/, code: "AWAY_WIN_TO_NIL" },
  { pattern: /wygra obie połowy/, code: "TEAM_WIN_BOTH_HALVES" },
  { pattern: /wygra przynajmniej jedna połowe/, code: "AWAY_WIN_AT_LEAST_ONE_HALF" },
  { pattern: /remis przynajmniej w jednej z połow/, code: "DRAW_AT_LEAST_ONE_HALF" },
  { pattern: /wygra pierwsza połowe \/ wygra druga połowe/, code: "HALF_TIME_SECOND_HALF_RESULT" },
  { pattern: /druzyna wygra mecz lub bedzie prowadzic dwoma bramkami/, code: "WIN_OR_WIN_BY_2" },
  { pattern: /wynik - kombinacje/, code: "MULTI_RESULT" },
  { pattern: /do przerwy\/koniec meczu/, code: "HALFTIME_FULLTIME" },

  // --- Both halves goals ---
  { pattern: /obie połowy powyzej/, code: "BOTH_HALVES_OVER_GOALS" },
  { pattern: /obie połowy ponizej/, code: "BOTH_HALVES_UNDER_GOALS" },
  { pattern: /obie połowy wygraja rozne/, code: "DIFFERENT_HALF_WINNERS" },

  // --- Both teams cards / BTTS-by-half ---
  { pattern: /obie druzyny otrzymaja min/, code: "BOTH_TEAMS_MIN_CARDS" },
  { pattern: /obie druzyny otrzymaja kartke/, code: "BTTS_CARD" },
  { pattern: /kartka w obu połowach/, code: "CARDS_BOTH_HALVES" },
  { pattern: /obydwie druzyny strzela/, code: "BTTS_BY_HALF" },

  // --- At-least-one-team goals ---
  { pattern: /co najmniej jeden zespoł strzeli 1\.5 goli/, code: "AT_LEAST_ONE_TEAM_TOTAL_GOALS" },
  { pattern: /co najmniej jeden zespoł strzeli/, code: "AT_LEAST_ONE_TEAM_OVER_GOALS" },

  // --- Goal range (extended bands) / result+total ---
  { pattern: /outcome and .*total goals/, code: "RESULT_AND_TOTAL" },
  { pattern: /2nd half (?:belgia|belgium|nowa zelandia|new zealand) total goals \(extended bands\)/, code: "SECOND_HALF_TEAM_GOAL_RANGE" },
  { pattern: /2nd half total goals \(extended bands\)/, code: "SECOND_HALF_GOAL_RANGE" },
  { pattern: /1st half total goals \(extended bands\)/, code: "HALF_TIME_GOAL_RANGE" },
  { pattern: /total goals \(extended bands\)/, code: "GOAL_RANGE" },

  // --- Misc stat totals ---
  { pattern: /liczba zmian/, code: "SUBSTITUTIONS_TOTAL" },
  { pattern: /var: suma/, code: "VAR_REVIEWS_TOTAL" },
  { pattern: /liczba pomocy medycznych/, code: "MEDICAL_AIDS_TOTAL" },
];

const HALF_TIME_PATTERN = /(1\.?\s*połowa|1st half)/i;
const SECOND_HALF_PATTERN = /(2\.?\s*połowa|2nd half)/i;
const GOAL_TOTAL_PATTERN = /(suma goli|liczba goli|gole|bramek|azjatycka liczba goli|azjatycka suma goli)/i;
const BTTS_PATTERN = /obie druzyny strzela/i;
const HANDICAP_PATTERN = /handicap/i;
const EUROPEAN_HANDICAP_PATTERN = /(3[-\s]?drogowy|3[-\s]?drogowo)/i;

function resolveMarketCode(
  raw: RawBookmakerMarket
): { code: NormalizedMarketType; matchedBy: "id" | "name" | "pattern" } {
  const rawId = raw.bookmakerMarketId ? Number(raw.bookmakerMarketId) : null;
  if (rawId !== null && !Number.isNaN(rawId)) {
    const idMatch = LVBET_MARKET_ID_TO_CODE[rawId];
    if (idMatch) {
      return { code: idMatch, matchedBy: "id" };
    }
  }

  const normalizedName = normalizeMarketName(raw.name);

  // Audited name-pattern mappings take precedence over the generic heuristics
  // below, since LVBET has no stable market id. Patterns are ordered
  // specific-first so e.g. corner/foul/card "1. połowa" variants are not
  // swallowed by the generic half-time result heuristic.
  for (const { pattern, code } of LVBET_AUDIT_NAME_PATTERNS) {
    if (pattern.test(normalizedName)) {
      return { code, matchedBy: "pattern" };
    }
  }

  const nameMatch = LVBET_MARKET_NAME_TO_CODE[normalizedName];
  if (nameMatch) {
    return { code: nameMatch, matchedBy: "name" };
  }

  if (HALF_TIME_PATTERN.test(normalizedName)) {
    if (/wynik/.test(normalizedName)) {
      return { code: "HALF_TIME_RESULT", matchedBy: "pattern" };
    }
    if (BTTS_PATTERN.test(normalizedName)) {
      return { code: "HALF_TIME_BTTS", matchedBy: "pattern" };
    }
    if (GOAL_TOTAL_PATTERN.test(normalizedName)) {
      return { code: "HALF_TIME_TOTAL_GOALS", matchedBy: "pattern" };
    }
  }

  if (SECOND_HALF_PATTERN.test(normalizedName)) {
    if (/wynik/.test(normalizedName)) {
      return { code: "SECOND_HALF_RESULT", matchedBy: "pattern" };
    }
    if (GOAL_TOTAL_PATTERN.test(normalizedName)) {
      return { code: "SECOND_HALF_TOTAL_GOALS", matchedBy: "pattern" };
    }
  }

  if (HANDICAP_PATTERN.test(normalizedName)) {
    const code = EUROPEAN_HANDICAP_PATTERN.test(normalizedName)
      ? "EUROPEAN_HANDICAP"
      : "ASIAN_HANDICAP";
    return { code, matchedBy: "pattern" };
  }

  if (/azjatycka/.test(normalizedName)) {
    return { code: "TOTAL_GOALS_ASIAN", matchedBy: "pattern" };
  }

  for (const { pattern, code } of LVBET_MARKET_NAME_PATTERNS) {
    if (pattern.test(normalizedName)) {
      return { code, matchedBy: "pattern" };
    }
  }

  return { code: "OTHER", matchedBy: "pattern" };
}

function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();

  if (/^1\s*\(/.test(trimmed)) return "HOME";
  if (/^2\s*\(/.test(trimmed)) return "AWAY";
  if (/^x\s*\(/i.test(trimmed)) return "DRAW";

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed) || /remis/i.test(trimmed)) return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

function extractParamValue(marketCode: NormalizedMarketType, raw: RawBookmakerMarket): string | undefined {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);
  const marketName = raw.name;

  switch (metadata.parameterType) {
    case "handicap":
      return parseHandicapLine(marketName) ?? parseOverUnderLine(selectionNames);
    case "integer":
      return parseIntegerLine(marketName) ?? parseOverUnderLine(selectionNames);
    case "decimal":
      return parseDecimalLine(marketName) ?? parseOverUnderLine(selectionNames);
    default:
      return parseOverUnderLine(selectionNames);
  }
}

export const lvbetNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "lvbet",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { code: marketCode, matchedBy } = resolveMarketCode(raw);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[lvbet] Market code "${marketCode}" not in catalog`);
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
      marketKey,
      paramValue,
      selections,
      debug: {
        rawName: raw.name,
        rawId: raw.bookmakerMarketId,
        matchedBy,
      },
    };
  },

};

export default lvbetNormalizer;
