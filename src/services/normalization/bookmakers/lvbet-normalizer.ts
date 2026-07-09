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
  canonicalizePlayerName,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode, getMarketByCode } from "../../../data/market-catalog.js";
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
  // Team-scoped 10-minute corner props ("Pierwsze 10 minut (…) - Kolumbia:
  // Rzuty rożne") have no catalog code — exclude them instead of letting
  // them contaminate the match-total FIRST_10_MIN_CORNERS_TOTAL.
  { pattern: /pierwsze 10 minut.*\) - .*: rzuty rozne/, code: "OTHER" },
  { pattern: /pierwsze 10 minut.*rzuty rozne/, code: "FIRST_10_MIN_CORNERS_TOTAL" },

  // --- Time-window handicaps ("1-75 min. - Handicap") ---
  // These must never reach the generic goal-handicap family: the minute
  // window used to be parsed as the handicap line, producing absurd
  // ASIAN_HANDICAP params (-15/-30/-60/-75). Only the 1-15 min window has a
  // catalog code; the wider windows are excluded until codes exist.
  { pattern: /^1\s*-\s*15\s*min\b.*handicap|^handicap.*\b1\s*-\s*15\s*min\b/, code: "FIRST_15_MIN_HANDICAP" },
  { pattern: /^\d+\s*-\s*\d+\s*min\b.*handicap|^handicap.*\b\d+\s*-\s*\d+\s*min\b/, code: "OTHER" },

  // --- Corners (rzuty rozne) ---
  // Handicap / odd-even / 2nd-half sub-markets must run before the generic
  // corner catch-alls below so they are not swallowed by CORNERS_TEAM.
  { pattern: /rzuty rozne: 1\. połowa.*handicap/, code: "HALF_TIME_CORNERS_HANDICAP" },
  { pattern: /rzuty rozne:.*handicap/, code: "CORNERS_HANDICAP" },
  { pattern: /rzuty rozne:.*(parzyste|nieparzyste)/, code: "CORNERS_ODD_EVEN" },
  { pattern: /rzuty rozne: 2\. połowa - wynik/, code: "SECOND_HALF_CORNERS_RACE" },
  { pattern: /rzuty rozne: 2\. połowa - suma/, code: "SECOND_HALF_CORNERS_TOTAL" },
  { pattern: /rzuty rozne: 2\. połowa/, code: "SECOND_HALF_CORNERS_TEAM" },
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
  // Foul handicaps must not fall into the team/total foul buckets.
  { pattern: /faule: 1\. połowa.*handicap/, code: "HALF_TIME_FOULS_HANDICAP" },
  { pattern: /faule:.*handicap/, code: "FOULS_HANDICAP" },
  { pattern: /faule: 1\. połowa - wynik/, code: "HALF_TIME_FOUL_RACE" },
  { pattern: /faule: 1\. połowa - suma/, code: "HALF_TIME_FOULS_TOTAL" },
  { pattern: /faule: 1\. połowa -/, code: "HALF_TIME_TEAM_FOULS" },
  { pattern: /faule: suma/, code: "FOULS_TOTAL" },
  { pattern: /faule:/, code: "TEAM_TOTAL_FOULS" },

  // --- Yellow cards (zołte kartki) ---
  // Card handicaps and odd/even variants are distinct bet types — route them
  // to their dedicated catalog codes before the team/total card buckets.
  { pattern: /zołte kartki - 1\. połowa:.*handicap/, code: "HALF_TIME_CARDS_HANDICAP" },
  { pattern: /zołte kartki - 2\. połowa:.*handicap/, code: "SECOND_HALF_CARDS_HANDICAP" },
  { pattern: /zołte kartki:.*handicap/, code: "CARDS_HANDICAP" },
  { pattern: /zołte kartki:.*(parzyste|nieparzyste)/, code: "CARDS_ODD_EVEN" },
  { pattern: /zołte kartki - 1\. połowa: wynik/, code: "FIRST_HALF_CARDS_1X2" },
  { pattern: /zołte kartki - 1\. połowa: suma/, code: "HALF_TIME_CARDS_TOTAL" },
  { pattern: /zołte kartki - 1\. połowa:/, code: "HALF_TIME_CARDS_TEAM" },
  { pattern: /zołte kartki - 2\. połowa: wynik/, code: "SECOND_HALF_CARDS_1X2" },
  { pattern: /zołte kartki - 2\. połowa: suma/, code: "SECOND_HALF_CARDS_TOTAL" },
  { pattern: /zołte kartki - 2\. połowa:/, code: "SECOND_HALF_CARDS_TEAM" },
  // "Żółte kartki: Wynik" is a yellow-cards-only 1X2 — mapping it into the
  // all-cards CARDS_RACE mixed structurally different products (confirmed
  // odds outlier vs peers). No yellow-only 1X2 catalog code exists yet.
  { pattern: /zołte kartki: wynik/, code: "OTHER" },
  { pattern: /zołte kartki: suma \d+$/, code: "YELLOW_CARDS_TOTAL" },
  { pattern: /zołte kartki: suma/, code: "CARDS_TOTAL" },
  { pattern: /zołte kartki:/, code: "CARDS_TEAM" },
  { pattern: /pierwsza zołta kartka/, code: "FIRST_CARD" },
  { pattern: /ostatnia zołta kartka/, code: "LAST_YELLOW_CARD" },

  // --- Card points ---
  { pattern: /kartki: suma punktow/, code: "CARDS_POINTS_OVER_UNDER" },
  { pattern: /kartki: wynik \(zk/, code: "CARDS_POINTS_1X2" },
  // "Kartki: Handicap punktowy (ŻK - 1p, CzK - 2p)" is a disciplinary-points
  // handicap (yellow=1pt/red=2pt), a different statistic from the goal
  // ASIAN_HANDICAP family it used to fall through to via the generic
  // HANDICAP_PATTERN fallback. The catalog has a dedicated code for it.
  { pattern: /kartki: handicap punktowy/, code: "CARDS_POINTS_HANDICAP" },

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
  // Shot handicaps are spread bets, not totals — route them out first. The
  // half-scoped shots-on-target handicap has no catalog code yet.
  { pattern: /strzały celne: [12]\. połowa.*handicap/, code: "OTHER" },
  { pattern: /strzały celne:.*handicap/, code: "SHOTS_ON_TARGET_HANDICAP" },
  { pattern: /strzały: [12]\. połowa.*handicap/, code: "OTHER" },
  { pattern: /strzały:.*handicap/, code: "SHOTS_HANDICAP" },
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
  // Any "powyżej <line>" goalkeeper-saves market shares the same shape
  // (fixed threshold, per-keeper rows) regardless of the specific line — the
  // catalog's dedicated GOALKEEPER_SAVES_OVER code applies to all of them,
  // not just the 2.5 line that used to be hardcoded here.
  { pattern: /obrony bramkarza - powyzej/, code: "GOALKEEPER_SAVES_OVER" },

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
  { pattern: /auty:.*handicap/, code: "THROW_INS_HANDICAP" },
  // "Auty: Wynik" is the throw-ins 1X2, not the goal MATCH_WINNER.
  { pattern: /auty: wynik/, code: "THROW_INS_1X2" },
  // "Auty: 1. Połowa - Suma" is a first-half, BOTH-teams-combined total — a
  // different stat from the full-match TEAM_TOTAL_THROW_INS catch-all below
  // (no team qualifier, no catalog code for the half-scoped combined total
  // yet). Exclude it instead of letting it masquerade as the full-match code.
  { pattern: /auty: 1\. połowa - suma/, code: "OTHER" },
  { pattern: /auty: suma/, code: "THROW_INS_TOTAL" },
  { pattern: /auty: belgia suma 23\.5$/, code: "THROW_INS_TEAM" },
  { pattern: /auty: nowa zelandia suma 14\.5$/, code: "TEAM_THROW_INS" },
  { pattern: /auty:/, code: "TEAM_TOTAL_THROW_INS" },

  // --- Goal kicks (wybicia od bramki) ---
  { pattern: /wybicia od bramki:.*handicap/, code: "GOAL_KICKS_HANDICAP" },
  // "Wybicia od bramki: 1. Połowa - Suma" is a first-half segment total, not
  // the full-match team total the generic catch-all below represents — no
  // catalog code exists for the half-scoped variant yet.
  { pattern: /wybicia od bramki: 1\. połowa - suma/, code: "OTHER" },
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
  // "Zawodnik strzeli 3 lub więcej goli (Sub-Hero)" is a per-player YES-shaped
  // threshold market (same shape as PLAYER_2_OR_MORE_GOALS above — one row per
  // player, no split threshold parameter). Routing N=3 through the generic
  // \d+ PLAYER_GOALS pattern below collapsed it onto the SAME marketKey as the
  // unrelated N=4 "Zawodnik strzeli 4 lub więcej goli" markets (both carry no
  // paramValue), mixing two different thresholds' odds under one bucket. The
  // catalog's dedicated PLAYER_3_OR_MORE_GOALS code (already used the same way
  // by sts/betcris/superbet) keeps this threshold on its own marketKey.
  { pattern: /zawodnik strzeli 3 lub wiecej goli/, code: "PLAYER_3_OR_MORE_GOALS" },
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
  // "<Team> wygra przynajmniej jedną połowę" is routed team-aware further
  // down (via detectTeamSide) instead of a static pattern here, since a
  // static regex cannot tell which team's name appears in the raw label.
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
  // NOTE: "Total Goals (Extended Bands)" and "Outcome And … Total Goals"
  // markets are routed via ctx-aware blocks in resolveMarketCode (team-scoped
  // variants need the home/away context, so a static pattern cannot classify
  // them).

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

  // Stat sub-markets scope the team as an index ("Drużyna 1." / "Drużyna 2.")
  // instead of a name.
  if (/\b(druzyna|team)\s*1\b/.test(normalizedName)) return "HOME";
  if (/\b(druzyna|team)\s*2\b/.test(normalizedName)) return "AWAY";

  if (!ctx.league) return null;

  const fragment = rawName
    .replace(/\b(1st|2nd)\s+half\b/gi, " ")
    .replace(/[12]\.\s*połowa/gi, " ")
    .replace(/\(extended bands\)/gi, " ")
    .replace(/\(przedział\)/gi, " ")
    .replace(/połowa z większą liczbą goli/gi, " ")
    .replace(/dokładna liczba goli/gi, " ")
    .replace(/suma goli|liczba goli|total goals/gi, " ")
    // Stat-market phrases ("Faule: Kolumbia suma", "Auty: Kolumbia suma",
    // "Outcome And Szwajcaria Total Goals") must not pollute the team
    // fragment passed to the alias matcher.
    .replace(/rzuty ro[żz]ne|[żz][óo]łte kartki|czerwone kartki|kartki|faule|spalone|strza[łl]y celne|strza[łl]y|auty|wybicia od bramki|wrzuty z autu|pierwsze \d+ minut/gi, " ")
    .replace(/\b(outcome and|azjatycka|asian|suma|handicap|wynik|liczba|parzyste|nieparzyste)\b/gi, " ")
    .replace(/[+-]?\d+(?:[.,]\d+)?/g, " ")
    .replace(/[–:()\-–]/g, " ")
    // Leftover single letters ("(X)" placeholders) confuse the alias matcher
    .replace(/\b\p{L}\b/gu, " ")
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

/**
 * Refines generic team-stat buckets to the side-scoped catalog codes when the
 * raw name identifies the team ("Auty: Kolumbia suma" -> away throw-ins).
 * The generic codes stay as a fallback when no side can be resolved.
 */
function refineTeamScopedStatCode(
  code: NormalizedMarketType,
  rawName: string,
  ctx: NormalizationContext
): NormalizedMarketType {
  if (code === "TEAM_TOTAL_THROW_INS") {
    const side = detectTeamSide(rawName, ctx);
    if (side) return side === "HOME" ? "HOME_TEAM_TOTAL_THROW_INS" : "AWAY_TEAM_TOTAL_THROW_INS";
  }
  if (code === "TEAM_GOAL_KICKS") {
    const side = detectTeamSide(rawName, ctx);
    if (side) return side === "HOME" ? "HOME_TEAM_TOTAL_GOAL_KICKS" : "AWAY_TEAM_GOAL_KICKS";
  }
  return code;
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
      return { code: refineTeamScopedStatCode(code, raw.name, ctx), matchedBy: "pattern" };
    }
  }

  // "Outcome And <Team> Total Goals" is a result + TEAM-total combo with no
  // catalog code; only the match-total variant maps to RESULT_AND_TOTAL.
  if (/outcome and .*total goals/.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    return { code: side ? "OTHER" : "RESULT_AND_TOTAL", matchedBy: "pattern" };
  }

  // "<Team> wygra przynajmniej jedną połowę" (team wins at least one half) —
  // resolve the side from the raw name instead of a hardcoded AWAY code, so
  // the home team's own market never lands in the away bucket.
  if (/wygra przynajmniej jedna połowe/.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    return {
      code:
        side === "HOME"
          ? "HOME_WIN_AT_LEAST_ONE_HALF"
          : side === "AWAY"
            ? "AWAY_WIN_AT_LEAST_ONE_HALF"
            : "OTHER",
      matchedBy: "pattern",
    };
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
      // "Parzyste"/"Nieparzyste" (odd/even team goals) share the same
      // team+"gole" wording as the over/under family below but are a
      // distinct proposition — route them to the dedicated odd/even code
      // before the over/under branches, instead of letting them fall into
      // HOME/AWAY_TEAM_TOTAL_GOALS as unmapped UNKNOWN selections.
      const isOddEven =
        raw.selections.length > 0 &&
        raw.selections.every((s) => /^(parzyst|nieparzyst)/.test(normalizeMarketName(s.name)));
      if (isOddEven) {
        return {
          code: side === "HOME" ? "HOME_TEAM_ODD_EVEN_GOALS" : "AWAY_TEAM_ODD_EVEN_GOALS",
          matchedBy: "pattern",
        };
      }
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

  // Exact-goal-count selections ("0"/"1"/"2"/"3"/"4+") mark an exact-goals
  // product even when the raw name only says "liczba goli" — such markets
  // must not merge into the OVER/UNDER goal totals.
  const hasExactCountSelections =
    raw.selections.length > 0 &&
    raw.selections.every((s) => /^\d+\s*\+?$/.test(s.name.trim()));

  if (HALF_TIME_PATTERN.test(normalizedName)) {
    if (/wynik/.test(normalizedName)) {
      return { code: "HALF_TIME_RESULT", matchedBy: "pattern" };
    }
    if (BTTS_PATTERN.test(normalizedName)) {
      return { code: "HALF_TIME_BTTS", matchedBy: "pattern" };
    }
    if (GOAL_TOTAL_PATTERN.test(normalizedName) && !HANDICAP_PATTERN.test(normalizedName)) {
      return {
        code: hasExactCountSelections ? "HALF_TIME_EXACT_GOALS" : "HALF_TIME_TOTAL_GOALS",
        matchedBy: "pattern",
      };
    }
  }

  if (SECOND_HALF_PATTERN.test(normalizedName)) {
    if (/wynik/.test(normalizedName)) {
      return { code: "SECOND_HALF_RESULT", matchedBy: "pattern" };
    }
    if (GOAL_TOTAL_PATTERN.test(normalizedName) && !HANDICAP_PATTERN.test(normalizedName)) {
      return {
        code: hasExactCountSelections ? "SECOND_HALF_EXACT_GOALS" : "SECOND_HALF_TOTAL_GOALS",
        matchedBy: "pattern",
      };
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
 * Folds a bare numeric exact-goals selection ("2", "3", "5") that has no
 * literal catalog match into the market's own highest "N+" catch-all bucket
 * that it still satisfies (e.g. SECOND_HALF_EXACT_GOALS's "2+" swallows raw
 * "2"/"3"/"4+"; AWAY_EXACT_GOALS's "3+" swallows raw "4"/"5"/"6+"), instead of
 * silently dropping the whole tail the way a literal-only match would.
 */
function mergeIntoExactGoalsCatchAll(
  marketCode: NormalizedMarketType,
  compact: string
): NormalizedSelection | null {
  if (isCatalogSelection(marketCode, compact)) return compact as NormalizedSelection;
  const value = parseInt(compact.replace("+", ""), 10);
  if (Number.isNaN(value)) return null;
  const metadata = getMarketMetadata(marketCode);
  const catchAllThreshold = (metadata?.selections ?? [])
    .filter((s) => /^\d+\+$/.test(s))
    .map((s) => parseInt(s, 10))
    .sort((a, b) => b - a)
    .find((threshold) => value >= threshold);
  return catchAllThreshold !== undefined ? (`${catchAllThreshold}+` as NormalizedSelection) : null;
}

/**
 * Maps the synthetic "Powyżej X" / "Powyżej" marker the LVBet parser
 * synthesizes for bulk player-roster markets (see splitBulkPlayerListMarket
 * in the scraper's parser.ts) to the market's threshold-tiered catalog code
 * (e.g. PLAYER_SHOTS_ON_TARGET's "Powyżej 1.5" -> "2+"), falling back to the
 * market's own OVER selection when no numeric line is present or no
 * matching tier exists in the catalog. Returns null for any other text (a
 * real player name reaching this market's default case) so callers can fall
 * through to the normal player-name handling.
 */
function normalizeLvbetPlayerThreshold(
  marketCode: NormalizedMarketType,
  trimmed: string
): NormalizedSelection | null {
  const normalized = normalizeMarketName(trimmed);
  const match = normalized.match(/^powyzej\s*(\d+(?:[.,]\d+)?)?$/);
  if (!match) return null;
  const lineText = match[1];
  if (lineText) {
    const line = parseFloat(lineText.replace(",", "."));
    if (!Number.isNaN(line)) {
      const tierCode = `${Math.floor(line) + 1}+`;
      if (isCatalogSelection(marketCode, tierCode)) return tierCode as NormalizedSelection;
    }
  }
  return isCatalogSelection(marketCode, "OVER") ? "OVER" : null;
}

/**
 * Over/Under detection tolerant of LVBet's stat-market label variants:
 * "Powyżej (6.5)", "Poniżej 2,5", "Ponad 9", "Więcej"/"Mniej".
 * Returns null (not UNKNOWN) when the label is not an over/under phrase.
 */
function normalizeLvbetOverUnder(label: string): "OVER" | "UNDER" | null {
  const normalized = normalizeMarketName(label);
  if (/^(powyzej|ponad|wiecej|over)\b/.test(normalized)) return "OVER";
  if (/^(ponizej|mniej|under)\b/.test(normalized)) return "UNDER";
  return null;
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
  rawMarketName?: string,
  siblingSelectionNames?: string[]
): NormalizedSelection | null {
  const trimmed = selectionName.trim();

  // Literal catalog-code passthrough: band/range/exact markets often quote
  // raw selection text that IS the catalog selection code ("0-2", "7+", "1+"),
  // and per-market cases below may miss them (falling through to UNKNOWN).
  const literalCatalogCodes = getMarketByCode(marketCode)?.selections;
  if (literalCatalogCodes && literalCatalogCodes.length > 0 && literalCatalogCodes.includes(trimmed)) {
    return trimmed as NormalizedSelection;
  }

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
    // Stat over/under totals share the same "Powyżej (X)"/"Poniżej (X)"
    // vocabulary — without an explicit case they fell into the YES-NO/1X2
    // default and every line collapsed into a single UNKNOWN entry.
    case "TOTAL_SHOTS":
    case "TEAM_TOTAL_SHOTS":
    case "TOTAL_SHOTS_ON_TARGET":
    case "TEAM_TOTAL_SHOTS_ON_TARGET":
    case "CORNERS_TOTAL":
    case "CORNERS_TEAM":
    case "HALF_TIME_CORNERS_TOTAL":
    case "SECOND_HALF_CORNERS_TOTAL":
    case "FIRST_10_MIN_CORNERS_TOTAL":
    case "TIME_PERIOD_CORNERS_TOTAL":
    case "FOULS_TOTAL":
    case "TEAM_TOTAL_FOULS":
    case "HALF_TIME_FOULS_TOTAL":
    case "CARDS_TOTAL":
    case "YELLOW_CARDS_TOTAL":
    case "HALF_TIME_CARDS_TOTAL":
    case "SECOND_HALF_CARDS_TOTAL":
    case "RED_CARDS_TOTAL":
    case "CARDS_POINTS_OVER_UNDER":
    case "GOAL_KICKS_TOTAL":
    case "TEAM_GOAL_KICKS":
    case "TEAM_TOTAL_GOAL_KICKS":
    case "HOME_TEAM_TOTAL_GOAL_KICKS":
    case "AWAY_TEAM_GOAL_KICKS":
    case "THROW_INS_TOTAL":
    case "TEAM_TOTAL_THROW_INS":
    case "HOME_TEAM_TOTAL_THROW_INS":
    case "AWAY_TEAM_TOTAL_THROW_INS":
    case "FIRST_PERIOD_THROW_INS":
    case "OFFSIDES_TOTAL":
    case "HOME_TEAM_TOTAL_OFFSIDES":
    case "AWAY_TEAM_TOTAL_OFFSIDES":
    case "SUBSTITUTIONS_TOTAL":
    case "VAR_REVIEWS_TOTAL":
    case "MEDICAL_AIDS_TOTAL": {
      const overUnder = normalizeLvbetOverUnder(trimmed);
      if (overUnder) return overUnder;
      return normalizeOverUnderSelection(trimmed);
    }

    // 3-way corner totals add an EXACTLY leg to the over/under pair.
    case "CORNERS_TOTAL_3WAY": {
      const overUnder = normalizeLvbetOverUnder(trimmed);
      if (overUnder) return overUnder;
      if (/^(dokładnie|dokladnie|exactly)\b/.test(normalizeMarketName(trimmed))) {
        return "EXACTLY" as NormalizedSelection;
      }
      return normalizeOverUnderSelection(trimmed);
    }

    // LVBet quotes a 5-tier corner-range scale ("5 lub mniej", "6 - 8",
    // "9 - 11", "12 - 14", "15 lub więcej") with no direct catalog match —
    // collapse it onto the catalog's coarse 3-bucket scale (0-8/9-11/12+),
    // mirroring betcris' identical raw label set for this market.
    case "CORNERS_RANGE": {
      const compact = normalizeMarketName(trimmed).replace(/\s+/g, "");
      if (/^5lubmniej$/.test(compact) || /^6-8$/.test(compact)) return "0-8" as NormalizedSelection;
      if (/^9-11$/.test(compact)) return "9-11" as NormalizedSelection;
      if (/^12-14$/.test(compact) || /^15lubwiecej$/.test(compact)) return "12+" as NormalizedSelection;
      return null;
    }

    // Team-scoped stat totals whose catalog selections are side-prefixed
    // (HOME_OVER/...): derive the side from the raw market name (team name or
    // "Drużyna 1/2" index) and the direction from the selection label.
    case "CARDS_TEAM":
    case "HALF_TIME_CARDS_TEAM":
    case "SECOND_HALF_CARDS_TEAM":
    case "HALF_TIME_CORNERS_TEAM":
    case "SECOND_HALF_CORNERS_TEAM":
    case "HALF_TIME_TEAM_FOULS": {
      const overUnder = normalizeLvbetOverUnder(trimmed);
      if (!overUnder) {
        // Range buckets ("0-2", "7+") remain valid for CARDS_TEAM-style
        // catalogs — the literal passthrough above already resolved them.
        return null;
      }
      const side = detectTeamSide(rawMarketName ?? "", ctx);
      if (!side) return null;
      return `${side}_${overUnder}` as NormalizedSelection;
    }

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
    case "HOME_TEAM_ODD_EVEN_GOALS":
    case "AWAY_TEAM_ODD_EVEN_GOALS":
    case "CORNERS_ODD_EVEN":
    case "HALF_TIME_CORNERS_ODD_EVEN":
    case "CARDS_ODD_EVEN":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "FIRST_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_EUROPEAN_HANDICAP":
    // Stat-prop handicaps (corners/cards/fouls/shots/...) reuse the same
    // HOME/AWAY selection vocabulary and label formats.
    case "FIRST_15_MIN_HANDICAP":
    case "CORNERS_HANDICAP":
    case "HALF_TIME_CORNERS_HANDICAP":
    case "CARDS_HANDICAP":
    case "CARDS_POINTS_HANDICAP":
    case "HALF_TIME_CARDS_HANDICAP":
    case "SECOND_HALF_CARDS_HANDICAP":
    case "FOULS_HANDICAP":
    case "HALF_TIME_FOULS_HANDICAP":
    case "SHOTS_HANDICAP":
    case "SHOTS_ON_TARGET_HANDICAP":
    case "GOAL_KICKS_HANDICAP":
    case "THROW_INS_HANDICAP":
    case "OFFSIDES_HANDICAP": {
      const normalizedSel = normalizeMarketName(trimmed);
      if (/\b(druzyna|team)\s*1\b/.test(normalizedSel)) return "HOME";
      if (/\b(druzyna|team)\s*2\b/.test(normalizedSel)) return "AWAY";
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

    case "SCORE_DURING_MATCH": {
      // Raw labels are plain score pairs ("0-1", "2-1", ...) matching the
      // catalog's own code format — map them directly instead of collapsing
      // the whole grid into one UNKNOWN entry.
      const score = parseScoreSelection(trimmed);
      return score ? (score as NormalizedSelection) : null;
    }

    case "MULTI_RESULT": {
      // "1-0 / 2-0 / 3-0" -> catalog code "1:0, 2:0 lub 3:0" (mirrors the
      // betcris normalizer's transform for the identical raw grouping).
      const scores = trimmed.split("/").map((part) => part.trim());
      if (scores.length >= 2 && scores.every((s) => /^\d+\s*-\s*\d+$/.test(s))) {
        const colonScores = scores.map((s) => s.replace(/\s*-\s*/, ":"));
        const last = colonScores[colonScores.length - 1];
        return `${colonScores.slice(0, -1).join(", ")} lub ${last}` as NormalizedSelection;
      }
      if (/^(x|remis)$/i.test(trimmed)) return "X" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    // "Francja i 1" / "Remis i 0" / "Maroko i 2" -> HOME_1 / DRAW_0 / AWAY_2
    // (result + exact total-goals combo, redirected here from TOTAL_GOALS by
    // refineResultAndExactGoalsMisroutedAsTotalGoals).
    case "RESULT_AND_EXACT_GOALS": {
      const m = trimmed.match(/^(.+?)\s+i\s+(\d+)\s*(\+|lub\s*wi[eę]cej)?$/i);
      if (!m) return null;
      const side = normalize1x2Selection(m[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
      if (side !== "HOME" && side !== "DRAW" && side !== "AWAY") return null;
      const code = `${side}_${m[2]}${m[3] ? "+" : ""}`;
      return isCatalogSelection(marketCode, code) ? (code as NormalizedSelection) : null;
    }

    case "HALFTIME_FULLTIME":
    case "HALF_TIME_SECOND_HALF_RESULT": {
      const htft = parseHtFtSelection(trimmed);
      if (htft) return htft as NormalizedSelection;
      // LVBet phrases these combos with team names: "Szwajcaria/Remis",
      // "Remis/Kolumbia", ... — resolve each leg against the match context.
      const parts = trimmed.split("/");
      if (parts.length === 2) {
        const left = normalize1x2Selection(parts[0].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
        const right = normalize1x2Selection(parts[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
        if (left !== "UNKNOWN" && right !== "UNKNOWN") {
          return `${left}_${right}` as NormalizedSelection;
        }
      }
      // Unresolvable labels are dropped so raw team-pair strings never leak
      // as pseudo selection codes.
      return null;
    }

    // 3-way team races with a NONE leg ("Nikt", "Nie będzie strzału
    // celnego") — the negative outcome must map to NONE, not UNKNOWN.
    case "FIRST_SHOT_ON_TARGET":
    case "CORNERS_RACE_TO":
    case "FIRST_CORNER":
    case "LAST_CORNER":
    case "FIRST_CARD":
    case "LAST_YELLOW_CARD": {
      const normalized = normalizeMarketName(trimmed);
      if (/^(nikt|zaden|nie bedzie|brak)/.test(normalized)) return "NONE";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
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
    case "HALF_WITH_MORE_CORNERS":
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
      // HOME/AWAY/DRAW. LVBet's grouped bands ("0 lub 1", "4 do 6", "7 lub
      // więcej") have no catalog counterpart and are dropped, but a bare
      // numeric tail beyond the catalog's exact buckets ("2", "3", "5") is
      // folded into the market's own "N+" catch-all instead of being
      // silently discarded.
      const compact = trimmed.replace(/\s+/g, "");
      if (!/^\d+\+?$/.test(compact)) return null;
      // A raw "(n)+" tail (e.g. LVBet's "4+" meaning four-or-more) must not
      // fold into the catalog's lower "N+" catch-all (e.g. "3+", meaning
      // three-or-more to every peer bookmaker) when this SAME bookmaker
      // already reports its own literal exact selection below that
      // threshold (e.g. a separate literal "3") — colliding would silently
      // narrow the shared "3+" bucket's true meaning. Drop it instead
      // (matches betcris' convention for the identical LVBet-only gap).
      if (compact.endsWith("+")) {
        const value = parseInt(compact.slice(0, -1), 10);
        const hasLowerLiteralSibling = siblingSelectionNames?.some((name) => {
          const otherCompact = name.trim().replace(/\s+/g, "");
          return /^\d+$/.test(otherCompact) && parseInt(otherCompact, 10) < value;
        });
        if (hasLowerLiteralSibling) return null;
      }
      return mergeIntoExactGoalsCatchAll(marketCode, compact);
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
    case "PLAYER_3_OR_MORE_GOALS":
    case "PENALTY_SCORER":
    case "PLAYER_GOAL_TEAM_LOSES":
    case "PLAYER_GOAL_AND_RESULT":
    case "FIRST_CARD_PLAYER": {
      const normalized = normalizeMarketName(trimmed);
      if (/^(nikt|zaden|zadny|bez gola|bez goli|brak gola|brak goli)$/.test(normalized)) {
        return "NONE";
      }
      // Bulk player-roster markets are pre-split by the parser into one entry
      // per player, with the market's real threshold synthesized as a
      // "Powyżej X" marker (the raw player name moved to paramValue) — map it
      // to the market's threshold-tiered catalog code. A recognized marker
      // with no matching catalog tier is dropped (not a real player name)
      // instead of falling through to the player-name passthrough below.
      if (/^powyzej(\s*\d+(?:[.,]\d+)?)?$/.test(normalized)) {
        return normalizeLvbetPlayerThreshold(marketCode, trimmed);
      }
      // Same bulk-split convention for "Zawodnik strzeli gola i mecz zakończy
      // się remisem" (player scores AND match ends in a draw): every row
      // prices the fixed DRAW outcome, synthesized as the "Remis" marker.
      if (marketCode === "PLAYER_GOAL_AND_RESULT" && normalized === "remis") {
        return "DRAW";
      }
      // Unify player-name order via the shared canonical form
      // ("Lastname, Firstname" -> "Firstname Lastname") so lvbet merges with
      // bookmakers quoting the comma convention.
      return canonicalizePlayerName(trimmed) as NormalizedSelection;
    }

    // Player pair/trio combos: canonicalize and sort each member so the same
    // real-world combination merges across bookmakers regardless of raw
    // member order or "Lastname, Firstname" spelling (mirrors betclic's
    // normalizePlayerComboSelection for the identical market shape).
    case "BOTH_PLAYERS_ANYTIME":
    case "TWO_PLAYERS_ANYTIME":
    case "THREE_PLAYERS_ANYTIME":
    case "ALL_PLAYERS_SCORE":
    case "ANY_PLAYER_FIRST_GOAL":
    case "PLAYER_ASSIST_PAIRS": {
      const members = trimmed
        .split(/\s+(?:or|and|i)\s+|\s*[/&]\s*/i)
        .map((part) => canonicalizePlayerName(part.trim()))
        .filter((part) => part.length > 0);
      if (members.length < 2) {
        return canonicalizePlayerName(trimmed) as NormalizedSelection;
      }
      return members.sort((a, b) => a.localeCompare(b, "en")).join(" & ") as NormalizedSelection;
    }

    default: {
      // Generic fallback: LVBet exposes many YES/NO prop markets ("Tak"/"Nie")
      // that have no dedicated case — resolve those before trying 1X2/team names.
      const yesNo = normalizeYesNoSelection(trimmed);
      if (yesNo !== "UNKNOWN") return yesNo;
      // Over/Under wording appears on niche stat totals with no dedicated
      // case — resolve it before the 1X2 fallback so both legs do not
      // collapse into one shared UNKNOWN key.
      const overUnder = normalizeLvbetOverUnder(trimmed);
      if (overUnder) return overUnder;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }
  }
}

/**
 * 3-way (European) goal handicaps whose LVBet label sign is INVERTED relative
 * to the catalog/peers ("Handicap (3-drogowy) -1" prices what peers price at
 * "+1" — round-2 audit verification). The full-match 2-way Asian handicap is
 * NOT inverted: the full-data audit confirmed via 10-bookmaker consensus that
 * LVBet's "Handicap Azjatycki 0.5" prices the catalog's "+0.5" bucket, so
 * negating every line mirrored the whole market onto wrong params. That
 * verification does NOT extend to FIRST_HALF_ASIAN_HANDICAP, though: a
 * dedicated audit (round 3, reconfirmed round 5) found every non-zero
 * first-half line mirrored onto the wrong sign relative to peer consensus.
 * CARDS_HANDICAP was likewise found sign-inverted (its own line progression
 * trends the opposite direction from betcris/fuksiarz/superbet's).
 */
const LVBET_SIGN_INVERTED_HANDICAP_MARKETS = new Set<NormalizedMarketType>([
  "EUROPEAN_HANDICAP",
  "FIRST_HALF_EUROPEAN_HANDICAP",
  "SECOND_HALF_EUROPEAN_HANDICAP",
  "FIRST_HALF_ASIAN_HANDICAP",
  "CARDS_HANDICAP",
]);

/**
 * SECOND_HALF_ASIAN_HANDICAP markets whose raw label omits the sign on a
 * generic line ("Handicap 1", "Handicap 2", vs. the usual explicit
 * "Handicap -2.5"/"Handicap +0.5"). Cross-checked against 4 peer bookmakers'
 * monotonic line progression: an unsigned trailing number here means the
 * HOME side is favored by that amount (i.e. it should resolve as negative),
 * not the positive default parseLvbetHandicapParam would otherwise produce.
 */
const LVBET_HANDICAP_DEFAULT_NEGATIVE_UNSIGNED_MARKETS = new Set<NormalizedMarketType>([
  "SECOND_HALF_ASIAN_HANDICAP",
]);

/**
 * Extracts the handicap line from an LVBet market name. The scraper appends
 * the line value at the END of the name ("1. Połowa - Handicap 2",
 * "Handicap (3-drogowy) 1", "Handicap -2.5"), so the LAST number is the line.
 * Digits of the "3-drogowy" qualifier, the "1./2. Połowa" prefix and minute
 * windows ("1-15 min.") are stripped first so they are never mistaken for
 * the line. The sign is negated for the markets listed in
 * LVBET_SIGN_INVERTED_HANDICAP_MARKETS (see comment there); for markets in
 * LVBET_HANDICAP_DEFAULT_NEGATIVE_UNSIGNED_MARKETS, a trailing number with NO
 * explicit sign character defaults to negative instead of positive.
 */
function parseLvbetHandicapParam(
  name: string,
  invertSign: boolean,
  defaultNegativeWhenUnsigned: boolean
): string | undefined {
  const cleaned = name
    .replace(/3[-\s]?drogow\w*/gi, "")
    .replace(/[12]\.\s*połowa/gi, "")
    .replace(/\d+\s*-\s*\d+\s*min\.?/gi, "");
  const matches = cleaned.match(/[+-]?\d+(?:[.,]\d+)?/g);
  if (!matches || matches.length === 0) return undefined;
  const lastMatch = matches[matches.length - 1];
  const value = parseFloat(lastMatch.replace(",", "."));
  if (Number.isNaN(value)) return undefined;
  let line = invertSign ? -value : value;
  if (defaultNegativeWhenUnsigned && !/^[+-]/.test(lastMatch) && line > 0) {
    line = -line;
  }
  if (line > 0) return `+${line}`;
  return `${line}`;
}

/**
 * Extracts a whole-number over/under line from selection labels
 * ("Ponad 9" / "Powyżej (9)") — parseOverUnderLine only recognizes decimals,
 * so integer corner/card lines used to fall into the parameterless bucket.
 */
function parseLvbetStatLine(selectionNames: string[]): string | undefined {
  for (const name of selectionNames) {
    const normalized = normalizeMarketName(name);
    const match = normalized.match(/^(?:powyzej|ponizej|ponad|wiecej|mniej|over|under)\D*(\d+(?:\.\d+)?)/);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Team-scoped stat markets whose catalog selections are plain OVER/UNDER
 * (no side prefix). LVBet quotes each team's line as a SEPARATE raw market
 * ("Strzały: Maroko suma" / "Strzały: Francja suma"), so without a side
 * marker both teams' lines land in the same bare numeric bucket and their
 * odds silently collide. Prefixing paramValue with HOME:/AWAY: (the
 * betclic/betcris/forbet/fortuna/superbet convention) keeps them separate.
 */
const LVBET_TEAM_SCOPED_DECIMAL_MARKETS = new Set<NormalizedMarketType>([
  "TEAM_TOTAL_SHOTS",
  "TEAM_TOTAL_SHOTS_ON_TARGET",
  "CORNERS_TEAM",
  "TEAM_TOTAL_FOULS",
]);

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): string | undefined {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  // LVBet used to bundle a whole player roster under ONE raw market per stat
  // threshold ("Zawodnicy (strzały celne) - powyżej 4.5" lists every eligible
  // player). The PARSER now splits these into one synthetic raw market per
  // player (see splitBulkPlayerListMarket in the lvbet scraper's parser.ts),
  // carrying the player's raw name via raw.paramValue since there is no
  // numeric line to report for a player-keyed market. Prefer that pre-split
  // value for every player-parameterized code; markets the parser does not
  // split (e.g. GOALSCORER_ANYTIME, GOALKEEPER_SAVES_OVER) leave raw.paramValue
  // unset and fall through to the grouper's bundled-player-selection recovery.
  if (metadata.parameterType === "player" && raw.paramValue) {
    return canonicalizePlayerName(raw.paramValue);
  }

  const selectionNames = raw.selections.map((s) => s.name);
  const marketName = raw.name;

  switch (metadata.parameterType) {
    case "handicap":
      // A handicap name with no visible number is a level (0) line — LVBet
      // omits the zero instead of printing "Handicap 0".
      return (
        parseLvbetHandicapParam(
          marketName,
          LVBET_SIGN_INVERTED_HANDICAP_MARKETS.has(marketCode),
          LVBET_HANDICAP_DEFAULT_NEGATIVE_UNSIGNED_MARKETS.has(marketCode)
        ) ??
        parseOverUnderLine(selectionNames) ??
        "0"
      );
    case "integer":
      return parseIntegerLine(marketName) ?? parseOverUnderLine(selectionNames);
    case "decimal": {
      const line =
        parseDecimalLine(marketName) ??
        parseOverUnderLine(selectionNames) ??
        parseLvbetStatLine(selectionNames);
      if (line && LVBET_TEAM_SCOPED_DECIMAL_MARKETS.has(marketCode)) {
        const side = detectTeamSide(marketName, ctx);
        if (side) return `${side}:${line}`;
      }
      return line;
    }
    default:
      return parseOverUnderLine(selectionNames) ?? parseLvbetStatLine(selectionNames);
  }
}

/**
 * A handful of "who does more X" 3-way race markets (MOST_SHOTS_ON_TARGET,
 * MOST_SHOTS, CORNERS_RACE, FOUL_RACE) share a raw market-name prefix with
 * the corresponding team-total OVER/UNDER market ("Strzały celne: Wynik" vs
 * "Strzały celne: <Team> suma"). When the generic team-total name pattern
 * wins by mistake, its RAW SELECTIONS are team names / "Remis" instead of
 * "Powyżej"/"Poniżej" text — the OVER/UNDER catalog code cannot represent
 * that shape, so every selection ends up UNKNOWN. Detect the shape (exactly
 * 3 selections, all resolving to HOME/DRAW/AWAY) and redirect to the sibling
 * race code instead of leaking raw team names as UNKNOWN under a
 * numeric-parameter market.
 */
const TEAM_TOTAL_TO_RACE_CODE: Partial<Record<NormalizedMarketType, NormalizedMarketType>> = {
  TEAM_TOTAL_SHOTS_ON_TARGET: "MOST_SHOTS_ON_TARGET",
  TEAM_TOTAL_SHOTS: "MOST_SHOTS",
  CORNERS_TEAM: "CORNERS_RACE",
  TEAM_TOTAL_FOULS: "FOUL_RACE",
};

function refineRaceMisroutedAsTeamTotal(
  code: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): NormalizedMarketType {
  const raceCode = TEAM_TOTAL_TO_RACE_CODE[code];
  if (!raceCode || raw.selections.length !== 3) return code;
  const allResolve3Way = raw.selections.every((s) => {
    const side = normalize1x2Selection(s.name, ctx.homeTeam, ctx.awayTeam, ctx.league);
    return side === "HOME" || side === "DRAW" || side === "AWAY";
  });
  return allResolve3Way ? raceCode : code;
}

/**
 * "Wynik i dokładna liczba goli" combo selections ("Francja i 1", "Remis i
 * 0", "Maroko i 2") share the generic goals-total name pattern with
 * TOTAL_GOALS and land there by default, but their shape ("<team or draw> i
 * <exact count>") does not fit TOTAL_GOALS' OVER/UNDER catalog code at all
 * (every selection ends up UNKNOWN). Detect the shape from the selections
 * themselves and redirect to the dedicated RESULT_AND_EXACT_GOALS combo code.
 */
function refineResultAndExactGoalsMisroutedAsTotalGoals(
  code: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): NormalizedMarketType {
  if (code !== "TOTAL_GOALS" || raw.selections.length === 0) return code;
  const allMatch = raw.selections.every((sel) => {
    const m = sel.name.match(/^(.+?)\s+i\s+\d+\+?$/i);
    if (!m) return false;
    const side = normalize1x2Selection(m[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
    return side === "HOME" || side === "DRAW" || side === "AWAY";
  });
  return allMatch ? "RESULT_AND_EXACT_GOALS" : code;
}

export const lvbetNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "lvbet",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const resolved = resolveMarketCode(raw, ctx);
    let marketCode = refineRaceMisroutedAsTeamTotal(resolved.code, raw, ctx);
    marketCode = refineResultAndExactGoalsMisroutedAsTotalGoals(marketCode, raw, ctx);
    const { matchedBy } = resolved;

    // Deliberately excluded markets must not share the single "OTHER" market
    // key: unrelated YES/NO props (e.g. half-time exact-margin bets) were
    // merging with other bookmakers' props under one pseudo-market. Returning
    // null lets the factory key them per raw name instead.
    if (marketCode === "OTHER") {
      return null;
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[lvbet] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const paramValue = extractParamValue(marketCode, raw, ctx);
    const marketKey = buildMarketKey(marketCode, paramValue);

    // Selections that resolve to null have no catalog counterpart (grouped
    // bands, catch-all buckets, ...) and are dropped so they never leak raw
    // labels or orphan codes into the cross-bookmaker aggregation.
    const siblingSelectionNames = raw.selections.map((s) => s.name);
    const selections = raw.selections.flatMap((sel) => {
      const code = normalizeSelectionForMarket(sel.name, marketCode, ctx, raw.name, siblingSelectionNames);
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
