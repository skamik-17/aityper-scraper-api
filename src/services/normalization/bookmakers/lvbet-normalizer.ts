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
  normalize1x2Selection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  parseScoreSelection,
  parseHtFtSelection,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";
import { matchToCanonical } from "../../../utils/team-matcher.js";

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

  // --- Time-window handicaps ("1-75 min. - Handicap") ---
  // These must never reach the generic goal-handicap family: the minute
  // window used to be parsed as the handicap line, producing absurd
  // ASIAN_HANDICAP params (-15/-30/-60/-75). Only the 1-15 min window has a
  // catalog code; the wider windows are excluded until codes exist.
  { pattern: /^1\s*-\s*15\s*min\b.*handicap|^handicap.*\b1\s*-\s*15\s*min\b/, code: "FIRST_15_MIN_HANDICAP" },
  { pattern: /^\d+\s*-\s*\d+\s*min\b.*handicap|^handicap.*\b\d+\s*-\s*\d+\s*min\b/, code: "OTHER" },

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
  // Offsides handicap is a prop handicap — it must never fall through to the
  // generic goal ASIAN_HANDICAP family. No catalog code exists for the
  // half-time variant yet, so it is excluded (OTHER) instead of misrouted.
  { pattern: /spalone: [12]\.\s*połowa.*handicap/, code: "OTHER" },
  { pattern: /spalone:.*handicap/, code: "OFFSIDES_HANDICAP" },
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
  // "Podwójna szansa" player combos are two-player OR bets — structurally
  // different from single-player markets; route them to pair codes first.
  { pattern: /strzelec pierwszego gola - podwojna szansa/, code: "ANY_PLAYER_FIRST_GOAL" },
  { pattern: /strzelec bramki - podwojna szansa/, code: "TWO_PLAYERS_ANYTIME" },
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
  // Result + BTTS combos must run before the generic "połowa ... wynik" heuristic
  { pattern: /1\. połowa - wynik i obie druzyny strzela/, code: "HALF_TIME_RESULT_AND_BTTS" },
  { pattern: /2\. połowa - wynik i obie druzyny strzela/, code: "SECOND_HALF_RESULT_AND_BTTS" },
  { pattern: /wynik i obie druzyny strzela/, code: "RESULT_AND_BTTS" },
  // Odd/even goal counts phrased as "Liczba goli: nieparzysta/parzysta" must not
  // fall into the over/under TOTAL_GOALS family
  { pattern: /1\. połowa - liczba goli: nieparzysta/, code: "HALF_TIME_ODD_EVEN_GOALS" },
  { pattern: /2\. połowa - liczba goli: nieparzysta/, code: "SECOND_HALF_ODD_EVEN_GOALS" },
  { pattern: /liczba goli: nieparzysta/, code: "ODD_EVEN_GOALS" },
  // "Gole w obu połowach" is a YES/NO market, not a goals total
  { pattern: /gole w obu połowach/, code: "BOTH_HALVES_GOALS" },
  // "Rezultat i dokładny wynik" is a combined result-or-exact-score YES/NO
  // market with no catalog equivalent — exclude it from CORRECT_SCORE.
  { pattern: /rezultat i dokładny wynik/, code: "OTHER" },
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
  // Two-player OR combos ("Podwójna szansa") must not pollute single-player markets
  { pattern: /zawodnik zanotuje asyste - podwojna szansa/, code: "PLAYER_ASSIST_PAIRS" },
  { pattern: /zawodnik zanotuje asyste/, code: "PLAYER_ASSISTS" },
  { pattern: /pierwszy zawodnik, ktory otrzyma kartke/, code: "FIRST_CARD_PLAYER" },
  // No catalog code exists for a two-player OR card combo yet — exclude it
  // from PLAYER_CARDS instead of mixing combo odds with single-player odds.
  { pattern: /zawodnik otrzyma kartke - podwojna szansa/, code: "OTHER" },
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
  // Other exact counts ("Dokładnie 3 gole w meczu") cannot share
  // EXACT_GOALS_YN (hasParameter=false — different counts would collide on
  // one market key) and are not over/under bets — exclude them instead of
  // letting the generic goals patterns drop them into TOTAL_GOALS.
  { pattern: /dokładnie \d+ gol\w* w meczu/, code: "OTHER" },

  // --- Win / result variants ---
  { pattern: /(?:belgia|belgium) wygra do zera/, code: "HOME_WIN_TO_NIL" },
  { pattern: /(?:nowa zelandia|new zealand) wygra do zera/, code: "AWAY_WIN_TO_NIL" },
  { pattern: /wygra obie połowy/, code: "TEAM_WIN_BOTH_HALVES" },
  { pattern: /wygra przynajmniej jedna połowe/, code: "AWAY_WIN_AT_LEAST_ONE_HALF" },
  { pattern: /remis przynajmniej w jednej z połow/, code: "DRAW_AT_LEAST_ONE_HALF" },
  { pattern: /wygra pierwsza połowe \/ wygra druga połowe/, code: "HALF_TIME_SECOND_HALF_RESULT" },
  // "LV Zaliczka" is a 3-way (HOME/DRAW/AWAY) insured-1X2 promo product; the
  // catalog's WIN_OR_WIN_BY_2 is strictly binary HOME/AWAY, so mapping it
  // there contaminated best odds with a structurally different bet. Excluded
  // until a dedicated 3-way "win or 2-goal lead" code exists.
  { pattern: /druzyna wygra mecz lub bedzie prowadzic dwoma bramkami/, code: "OTHER" },
  { pattern: /wynik - kombinacje/, code: "MULTI_RESULT" },
  // "(Do przerwy / koniec meczu) i suma goli X" is an HT/FT + total-goals
  // combo, not an over/under market — it must not fall through to
  // TOTAL_GOALS. The HALFTIME_FULLTIME_AND_TOTAL catalog code exists, but
  // LVBet's combo selection format is unverified, so the market is excluded
  // rather than risking a wrong selection mapping.
  { pattern: /do przerwy\s*\/\s*koniec meczu.*suma goli/, code: "OTHER" },
  { pattern: /do przerwy\s*\/\s*koniec meczu/, code: "HALFTIME_FULLTIME" },

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

  // --- Result+total combos ---
  // NOTE: "Total Goals (Extended Bands)" markets are routed via the ctx-aware
  // extended-bands block in resolveMarketCode (team-scoped variants need the
  // home/away context, so a static pattern cannot classify them).
  { pattern: /outcome and .*total goals/, code: "RESULT_AND_TOTAL" },

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

/**
 * Detects whether a raw market name is scoped to the home or away team.
 * Fast path: normalized substring match against the context team names.
 * Fallback: strips known market phrases/numbers from the ORIGINAL name and
 * resolves the remaining fragment via the league alias map (bookmaker names
 * are Polish, context names are canonical English — e.g. "Republika
 * Zielonego Przylądka" -> "Cape Verde").
 */
function detectTeamSide(
  rawName: string,
  ctx: NormalizationContext
): "HOME" | "AWAY" | null {
  const normalizedName = normalizeMarketName(rawName);
  const home = normalizeMarketName(ctx.homeTeam ?? "");
  const away = normalizeMarketName(ctx.awayTeam ?? "");
  if (home && normalizedName.includes(home)) return "HOME";
  if (away && normalizedName.includes(away)) return "AWAY";

  if (!ctx.league) return null;

  const fragment = rawName
    .replace(/\b(1st|2nd)\s+half\b/gi, " ")
    .replace(/[12]\.\s*połowa/gi, " ")
    .replace(/\(extended bands\)/gi, " ")
    .replace(/\(przedział\)/gi, " ")
    .replace(/połowa z większą liczbą goli/gi, " ")
    .replace(/dokładna liczba goli/gi, " ")
    .replace(/suma goli|liczba goli|total goals/gi, " ")
    .replace(/[+-]?\d+(?:[.,]\d+)?/g, " ")
    .replace(/[–:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (fragment.length < 3) return null;

  const fragMatch = matchToCanonical(fragment, ctx.league);
  if (!fragMatch) return null;
  const homeMatch = ctx.homeTeam ? matchToCanonical(ctx.homeTeam, ctx.league) : null;
  const awayMatch = ctx.awayTeam ? matchToCanonical(ctx.awayTeam, ctx.league) : null;
  if (homeMatch && fragMatch.name === homeMatch.name) return "HOME";
  if (awayMatch && fragMatch.name === awayMatch.name) return "AWAY";
  return null;
}

function resolveMarketCode(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
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

  // "Total Goals (Extended Bands)" family — team-scoped variants need ctx to
  // resolve the side, so they cannot be routed by static patterns.
  if (/total goals \(extended bands\)/.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    if (/2nd half/.test(normalizedName)) {
      return {
        code: side ? "SECOND_HALF_TEAM_GOAL_RANGE" : "SECOND_HALF_GOAL_RANGE",
        matchedBy: "pattern",
      };
    }
    if (/1st half/.test(normalizedName)) {
      // No catalog code exists for 1st-half team goal bands — exclude instead
      // of polluting the match-level HALF_TIME_GOAL_RANGE.
      return { code: side ? "OTHER" : "HALF_TIME_GOAL_RANGE", matchedBy: "pattern" };
    }
    if (side) {
      return {
        code: side === "HOME" ? "HOME_GOAL_RANGE" : "AWAY_GOAL_RANGE",
        matchedBy: "pattern",
      };
    }
    return { code: "GOAL_RANGE", matchedBy: "pattern" };
  }

  // "<Team> Połowa z większą liczbą goli" (half-with-more-goals comparison,
  // optionally team-scoped) — a comparison market, never a goals total.
  if (/połowa z wieksza liczba goli/.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    if (side === "HOME") return { code: "HOME_HALF_WITH_MOST_GOALS", matchedBy: "pattern" };
    if (side === "AWAY") return { code: "AWAY_HALF_WITH_MOST_GOALS", matchedBy: "pattern" };
    return { code: "HALF_WITH_MORE_GOALS", matchedBy: "pattern" };
  }

  // Team-scoped goal totals ("Austria - Suma goli", "2. Połowa - Argentyna
  // liczba goli", "2. Połowa - <Team> dokładna liczba goli (przedział)") must
  // not be merged into the match-level TOTAL_GOALS family.
  if (GOAL_TOTAL_PATTERN.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    if (side) {
      const secondHalf = SECOND_HALF_PATTERN.test(normalizedName);
      const firstHalf = HALF_TIME_PATTERN.test(normalizedName);
      if (/dokładna liczba goli/.test(normalizedName)) {
        if (secondHalf) {
          return { code: "SECOND_HALF_TEAM_GOAL_RANGE", matchedBy: "pattern" };
        }
        if (firstHalf) {
          // Only the home-team 1st-half exact-goals code exists in the catalog
          return {
            code: side === "HOME" ? "HALF_TIME_HOME_EXACT_GOALS" : "OTHER",
            matchedBy: "pattern",
          };
        }
        return {
          code: side === "HOME" ? "HOME_EXACT_GOALS" : "AWAY_EXACT_GOALS",
          matchedBy: "pattern",
        };
      }
      if (secondHalf) {
        return {
          code:
            side === "HOME"
              ? "SECOND_HALF_HOME_TEAM_TOTAL_GOALS"
              : "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
          matchedBy: "pattern",
        };
      }
      if (firstHalf) {
        return {
          code:
            side === "HOME"
              ? "HALF_TIME_HOME_TEAM_TOTAL_GOALS"
              : "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
          matchedBy: "pattern",
        };
      }
      return {
        code: side === "HOME" ? "HOME_TEAM_TOTAL_GOALS" : "AWAY_TEAM_TOTAL_GOALS",
        matchedBy: "pattern",
      };
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
    if (GOAL_TOTAL_PATTERN.test(normalizedName) && !HANDICAP_PATTERN.test(normalizedName)) {
      return { code: "HALF_TIME_TOTAL_GOALS", matchedBy: "pattern" };
    }
  }

  if (SECOND_HALF_PATTERN.test(normalizedName)) {
    if (/wynik/.test(normalizedName)) {
      return { code: "SECOND_HALF_RESULT", matchedBy: "pattern" };
    }
    if (GOAL_TOTAL_PATTERN.test(normalizedName) && !HANDICAP_PATTERN.test(normalizedName)) {
      return { code: "SECOND_HALF_TOTAL_GOALS", matchedBy: "pattern" };
    }
  }

  if (HANDICAP_PATTERN.test(normalizedName)) {
    const european = EUROPEAN_HANDICAP_PATTERN.test(normalizedName);
    // Half-scoped handicaps must not land in the full-match markets
    if (HALF_TIME_PATTERN.test(normalizedName)) {
      return {
        code: european ? "FIRST_HALF_EUROPEAN_HANDICAP" : "FIRST_HALF_ASIAN_HANDICAP",
        matchedBy: "pattern",
      };
    }
    if (SECOND_HALF_PATTERN.test(normalizedName)) {
      return {
        code: european ? "SECOND_HALF_EUROPEAN_HANDICAP" : "SECOND_HALF_ASIAN_HANDICAP",
        matchedBy: "pattern",
      };
    }
    return {
      code: european ? "EUROPEAN_HANDICAP" : "ASIAN_HANDICAP",
      matchedBy: "pattern",
    };
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

/**
 * True when the catalog defines `code` as a selection of `marketCode`.
 * Used to drop LVBet-only buckets (e.g. extended-band combos "1-4"/"2-4",
 * "Każdy inny", "4+") that would otherwise surface as orphan selections no
 * other bookmaker quotes.
 */
function isCatalogSelection(marketCode: NormalizedMarketType, code: string): boolean {
  const metadata = getMarketMetadata(marketCode);
  return metadata ? metadata.selections.includes(code) : false;
}

/**
 * Maps a raw LVBet selection label to a canonical selection code.
 * Returns null when the label has no catalog counterpart for the market —
 * such selections are dropped instead of leaking raw text or colliding on a
 * shared UNKNOWN code.
 */
function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext,
  rawMarketName?: string
): NormalizedSelection | null {
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
    case "HALF_TIME_DOUBLE_CHANCE":
    case "SECOND_HALF_DOUBLE_CHANCE": {
      // LVBet phrases double chance with team names: "<TeamA> lub remis",
      // "<TeamA> lub <TeamB>", "remis lub <TeamB>".
      const lowerSel = trimmed.toLowerCase();
      const lubIdx = lowerSel.lastIndexOf(" lub ");
      if (lubIdx > 0) {
        const left = normalize1x2Selection(
          trimmed.slice(0, lubIdx).trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        const right = normalize1x2Selection(
          trimmed.slice(lubIdx + 5).trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        const sides = new Set([left, right]);
        if (sides.has("HOME") && sides.has("DRAW")) return "HOME_OR_DRAW";
        if (sides.has("DRAW") && sides.has("AWAY")) return "DRAW_OR_AWAY";
        if (sides.has("HOME") && sides.has("AWAY")) return "HOME_OR_AWAY";
      }
      return normalizeDoubleChanceSelection(trimmed);
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
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
    case "OWN_GOAL":
    case "SUBSTITUTE_GOAL":
    case "TEAM_WIN_BOTH_HALVES":
    case "BOTH_HALVES_GOALS":
    case "BOTH_HALVES_UNDER_GOALS":
    case "BOTH_HALVES_OVER_GOALS":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
    case "HALF_TIME_ODD_EVEN_GOALS":
    case "SECOND_HALF_ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "FIRST_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_EUROPEAN_HANDICAP": {
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed) || /remis/i.test(trimmed)) return "DRAW";
      // Labels that repeat the market name end with the side index,
      // e.g. "Handicap (3-drogowy) 1" -> HOME, "... 2" -> AWAY
      if (/handicap/i.test(trimmed)) {
        if (/\b1$/.test(trimmed)) return "HOME";
        if (/\b2$/.test(trimmed)) return "AWAY";
      }
      // Team-name labels may carry the line in parentheses, e.g. "Austria (+2.5)"
      const teamPart = trimmed.replace(/\s*\([+-]?\d+(?:[.,]\d+)?\)\s*$/, "").trim();
      return normalize1x2Selection(teamPart, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "CORRECT_SCORE":
    case "HALF_TIME_CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    case "FIRST_TEAM_TO_SCORE":
    case "LAST_TEAM_TO_SCORE": {
      const normalized = normalizeMarketName(trimmed);
      if (/^(bez|brak)\s*gol/.test(normalized) || normalized === "zaden" || normalized === "nikt") {
        return "NONE";
      }
      if (/^(obie|obydwie|both)/.test(normalized)) return "BOTH" as NormalizedSelection;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "HALF_TIME_FIRST_GOAL":
    case "SECOND_HALF_FIRST_GOAL":
    case "HALF_TIME_LAST_TEAM_TO_SCORE":
    case "SECOND_HALF_LAST_TEAM_TO_SCORE":
    case "NEXT_GOAL": {
      const normalized = normalizeMarketName(trimmed);
      if (/^(bez|brak)\s*gol/.test(normalized)) return "NONE";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_TIME_ALT":
    case "HOME_FIRST_GOAL_TIME":
    case "AWAY_FIRST_GOAL_TIME": {
      const normalized = normalizeMarketName(trimmed);
      if (/^(bez|brak)/.test(normalized)) return "NONE";
      // "31-45+" / "76-90+" -> catalog codes without the trailing plus
      const rangeMatch = trimmed.match(/^(\d{1,2})\s*-\s*(\d{1,2})\+?$/);
      if (rangeMatch) return `${rangeMatch[1]}-${rangeMatch[2]}` as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "GOAL_RANGE":
    case "TEAM_GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
    case "HOME_GOAL_RANGE":
    case "AWAY_GOAL_RANGE": {
      const normalized = normalizeMarketName(trimmed);
      let code: string | null = null;
      if (/^(bez|brak)\s*gol/.test(normalized) || normalized === "0") code = "0";
      else if (/^\d+\+$/.test(trimmed)) code = trimmed;
      else if (/^\d+$/.test(trimmed)) code = trimmed;
      else {
        const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)\+?$/);
        if (rangeMatch) code = `${rangeMatch[1]}-${rangeMatch[2]}`;
      }
      // "Każdy inny" (LVBet's catch-all leftover band, spanning 0 AND 5+)
      // and any other unparsable label has no catalog counterpart — drop it
      // instead of leaking raw Polish text as a selection code.
      if (code === null) return null;
      // Only surface bands the catalog defines for this market: the team
      // ranges only support 0/1-2/1-3/2-3/4+, so LVBet's extended-band
      // extras (1-4, 2-4, 3-4) must not appear as orphan columns.
      return isCatalogSelection(marketCode, code) ? (code as NormalizedSelection) : null;
    }

    case "SECOND_HALF_TEAM_GOAL_RANGE": {
      // Catalog selections are side-prefixed ranges (HOME_1-2, AWAY_4+, ...)
      const side = detectTeamSide(rawMarketName ?? "", ctx) ?? "HOME";
      let code: string | null = null;
      if (/^\d+\+$/.test(trimmed)) code = `${side}_${trimmed}`;
      else {
        const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)\+?$/);
        if (rangeMatch) code = `${side}_${rangeMatch[1]}-${rangeMatch[2]}`;
      }
      // Drop "Każdy inny"/unparsable labels and bands the catalog does not
      // define (e.g. 2-4, 3-4) instead of leaking raw or orphan codes.
      if (code === null) return null;
      return isCatalogSelection(marketCode, code) ? (code as NormalizedSelection) : null;
    }

    case "HALF_WITH_MORE_GOALS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS": {
      // LVBet renders half comparison as "1 > 2" / "1 = 2" / "1 < 2"
      if (/^1\s*>\s*2$/.test(trimmed)) return "1st" as NormalizedSelection;
      if (/^1\s*<\s*2$/.test(trimmed)) return "2nd" as NormalizedSelection;
      if (/^1\s*=\s*2$/.test(trimmed)) return "Draw" as NormalizedSelection;
      const normalized = normalizeMarketName(trimmed);
      if (normalized.includes("1. połowa")) return "1st" as NormalizedSelection;
      if (normalized.includes("2. połowa")) return "2nd" as NormalizedSelection;
      if (normalized.includes("remis") || normalized.includes("rowno")) {
        return "Draw" as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "BTTS_BY_HALF": {
      // "Tak/Tak" = both halves, "Tak/Nie" = 1st only, "Nie/Tak" = 2nd only
      if (/^tak\s*\/\s*tak$/i.test(trimmed)) return "Both" as NormalizedSelection;
      if (/^tak\s*\/\s*nie$/i.test(trimmed)) return "1st" as NormalizedSelection;
      if (/^nie\s*\/\s*tak$/i.test(trimmed)) return "2nd" as NormalizedSelection;
      if (/^nie\s*\/\s*nie$/i.test(trimmed)) return "None" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "TEAM_SCORE_BY_HALF": {
      // "Tak/Nie" pairs = (scores in 1st half)/(scores in 2nd half); the
      // catalog vocabulary is YES_YES/YES_NO/NO_YES/NO_NO.
      if (/^tak\s*\/\s*tak$/i.test(trimmed)) return "YES_YES";
      if (/^tak\s*\/\s*nie$/i.test(trimmed)) return "YES_NO";
      if (/^nie\s*\/\s*tak$/i.test(trimmed)) return "NO_YES";
      if (/^nie\s*\/\s*nie$/i.test(trimmed)) return "NO_NO";
      return "UNKNOWN";
    }

    case "PENALTY_GOAL":
    case "HALF_TIME_PENALTY_GOAL":
    case "SECOND_HALF_PENALTY_GOAL": {
      // Catalog vocabulary for penalty-goal markets is TEAM_HOME/TEAM_AWAY/
      // ANY/NONE — plain HOME/AWAY codes are orphaned by the aggregator.
      const normalized = normalizeMarketName(trimmed);
      if (/\b(ktorakolwiek|ktorykolwiek|ktokolwiek|dowolna|dowolny|any)\b/.test(normalized)) {
        return "ANY";
      }
      if (/^(nie|no|brak|zaden|zadna|nikt)\b/.test(normalized)) return "NONE";
      const side = normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
      if (side === "HOME") return "TEAM_HOME";
      if (side === "AWAY") return "TEAM_AWAY";
      return "UNKNOWN";
    }

    case "EXACT_GOALS":
    case "HOME_EXACT_GOALS":
    case "AWAY_EXACT_GOALS":
    case "HALF_TIME_EXACT_GOALS":
    case "SECOND_HALF_EXACT_GOALS":
    case "HALF_TIME_HOME_EXACT_GOALS":
    case "SECOND_HALF_HOME_EXACT_GOALS": {
      // Exact-goal labels are numeric ("0", "1", "2", "3", "4+") — they must
      // NOT fall through to the 1X2 fallback, which mis-coded them as
      // HOME/AWAY/DRAW. Only buckets the catalog defines for this market are
      // emitted; LVBet's grouped bands ("0 lub 1", "4 do 6", "7 lub więcej")
      // and unsupported buckets ("4+") have no catalog counterpart and are
      // dropped rather than surfaced as UNKNOWN/orphan codes.
      const compact = trimmed.replace(/\s+/g, "");
      if (/^\d+\+?$/.test(compact) && isCatalogSelection(marketCode, compact)) {
        return compact as NormalizedSelection;
      }
      return null;
    }

    case "RESULT_AND_BTTS":
    case "HALF_TIME_RESULT_AND_BTTS":
    case "SECOND_HALF_RESULT_AND_BTTS": {
      // "Argentyna i Tak" / "Remis i Nie" -> HOME_YES / DRAW_NO ...
      const lowerSel = trimmed.toLowerCase();
      const andIdx = lowerSel.lastIndexOf(" i ");
      if (andIdx > 0) {
        const sidePart = normalize1x2Selection(
          trimmed.slice(0, andIdx).trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        const ynPart = normalizeYesNoSelection(trimmed.slice(andIdx + 3).trim());
        if (
          (sidePart === "HOME" || sidePart === "DRAW" || sidePart === "AWAY") &&
          (ynPart === "YES" || ynPart === "NO")
        ) {
          return `${sidePart}_${ynPart}` as NormalizedSelection;
        }
      }
      return trimmed as NormalizedSelection;
    }

    // Single-player markets: keep each player as its own selection code (the
    // raw label is the player name) instead of collapsing all into UNKNOWN.
    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
    case "HALF_TIME_GOALSCORER_ANYTIME":
    case "SECOND_HALF_GOALSCORER_ANYTIME":
    case "PLAYER_GOALS":
    case "PLAYER_CARDS":
    case "PLAYER_ASSISTS":
    case "PLAYER_FOULS":
    case "PLAYER_FOULS_WON":
    case "PLAYER_FOULS_OVER":
    case "PLAYER_SHOTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_SHOTS_OVER":
    case "PLAYER_TACKLES":
    case "PLAYER_SAVES":
    case "GOALKEEPER_SAVES_OVER":
    case "PLAYER_RED_CARD":
    case "PLAYER_HEADER_GOAL":
    case "PLAYER_GOAL_AND_ASSIST":
    case "PLAYER_GOAL_OR_ASSIST":
    case "PLAYER_GOAL_OUTSIDE_BOX":
    case "PLAYER_SCORES_BOTH_HALVES":
    case "PLAYER_2_OR_MORE_GOALS":
    case "PENALTY_SCORER":
    case "FIRST_CARD_PLAYER": {
      const normalized = normalizeMarketName(trimmed);
      if (/^(nikt|zaden|zadny|bez gola|bez goli|brak gola|brak goli)$/.test(normalized)) {
        return "NONE";
      }
      return trimmed as NormalizedSelection;
    }

    // Player pair/trio combos: keep the pair label as the selection code so
    // distinct combinations do not collapse into a single UNKNOWN row.
    case "BOTH_PLAYERS_ANYTIME":
    case "TWO_PLAYERS_ANYTIME":
    case "THREE_PLAYERS_ANYTIME":
    case "ALL_PLAYERS_SCORE":
    case "ANY_PLAYER_FIRST_GOAL":
    case "PLAYER_ASSIST_PAIRS":
      return trimmed as NormalizedSelection;

    default: {
      // Generic fallback: LVBet exposes many YES/NO prop markets ("Tak"/"Nie")
      // that have no dedicated case — resolve those before trying 1X2/team names.
      const yesNo = normalizeYesNoSelection(trimmed);
      if (yesNo !== "UNKNOWN") return yesNo;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }
  }
}

/**
 * Extracts the handicap line from an LVBet market name. The scraper appends
 * the line value at the END of the name ("1. Połowa - Handicap 2",
 * "Handicap (3-drogowy) 1", "Handicap -2.5"), so the LAST number is the line.
 * Digits of the "3-drogowy" qualifier, the "1./2. Połowa" prefix and minute
 * windows ("1-15 min.") are stripped first so they are never mistaken for
 * the line.
 *
 * IMPORTANT: LVBet labels its handicap lines with the sign convention
 * INVERTED relative to the catalog/peers — its "Handicap (3-drogowy) -1"
 * prices exactly the outcomes peers price at "+1" (verified across the
 * full-match, 1st-half and 2nd-half 2-way and 3-way goal handicaps, where
 * the whole HOME/DRAW/AWAY triple matches the peers' opposite-sign bucket).
 * The extracted line is therefore negated before being used as the param.
 */
function parseLvbetHandicapParam(name: string): string | undefined {
  const cleaned = name
    .replace(/3[-\s]?drogow\w*/gi, "")
    .replace(/[12]\.\s*połowa/gi, "")
    .replace(/\d+\s*-\s*\d+\s*min\.?/gi, "");
  const matches = cleaned.match(/[+-]?\d+(?:[.,]\d+)?/g);
  if (!matches || matches.length === 0) return undefined;
  const value = parseFloat(matches[matches.length - 1].replace(",", "."));
  if (Number.isNaN(value)) return undefined;
  const inverted = -value;
  if (inverted > 0) return `+${inverted}`;
  return `${inverted}`;
}

function extractParamValue(marketCode: NormalizedMarketType, raw: RawBookmakerMarket): string | undefined {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);
  const marketName = raw.name;

  switch (metadata.parameterType) {
    case "handicap":
      return parseLvbetHandicapParam(marketName) ?? parseOverUnderLine(selectionNames);
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
    const { code: marketCode, matchedBy } = resolveMarketCode(raw, ctx);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[lvbet] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const paramValue = extractParamValue(marketCode, raw);
    const marketKey = buildMarketKey(marketCode, paramValue);

    // Selections that resolve to null have no catalog counterpart (grouped
    // bands, catch-all buckets, ...) and are dropped so they never leak raw
    // labels or orphan codes into the cross-bookmaker aggregation.
    const selections = raw.selections.flatMap((sel) => {
      const code = normalizeSelectionForMarket(sel.name, marketCode, ctx, raw.name);
      if (code === null) return [];
      return [{ code, label: sel.name, odds: sel.odds }];
    });

    // A market whose every selection was dropped carries no usable data
    // (e.g. LVBet's grouped-band exact-goals product) — exclude it entirely.
    if (selections.length === 0) return null;

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
