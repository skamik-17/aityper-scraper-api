// Regression tests for forbet normalizer fixes from the 2026-06-27
// cross-bookmaker match audits (world-cup-2026: Algeria vs Austria,
// Argentina vs Cape Verde). Raw market names and selections mirror the
// actual scraped payloads captured in docs/match-audit/.
import { describe, it, expect } from "vitest";
import { forbetNormalizer } from "../forbet-normalizer.js";
import type { NormalizationContext, RawBookmakerMarket } from "../../types.js";

const ctxA: NormalizationContext = {
  homeTeam: "Algeria",
  awayTeam: "Austria",
  league: "world-cup-2026",
};
const ctxB: NormalizationContext = {
  homeTeam: "Argentina",
  awayTeam: "Cape Verde",
  league: "world-cup-2026",
};
const ctxC: NormalizationContext = {
  homeTeam: "Switzerland",
  awayTeam: "Colombia",
  league: "world-cup-2026",
};

function run(raw: RawBookmakerMarket, ctx: NormalizationContext) {
  const out = forbetNormalizer.normalizeMarket(raw, ctx);
  if (!out) throw new Error("normalizeMarket returned null");
  return out;
}

describe("forbet audit fixes", () => {
  it("routes player goals special to PLAYER_GOALS with player param", () => {
    const out = run(
      {
        bookmakerMarketId: "-99999",
        name: "Wanner, Paul - liczba goli (z ew. dogrywką; rozliczenie za soccerstats.info)",
        selections: [
          { name: "Wanner, Paul 1+", odds: 6.6 },
          { name: "Wanner, Paul 2+", odds: 80 },
          { name: "Wanner, Paul 3+", odds: 101 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("PLAYER_GOALS");
    expect(out.paramValue).toBe("Wanner, Paul");
    expect(out.selections.map((s) => s.code)).toEqual(["1+", "2+", "3+"]);
  });

  it("routes 2nd-half team totals away from TOTAL_GOALS", () => {
    const out = run(
      {
        bookmakerMarketId: "8",
        name: "2. połowa - Austria poniżej/powyżej 0.5 goli",
        selections: [
          { name: "poniżej 0.5", odds: 1.63 },
          { name: "powyżej 0.5", odds: 2.14 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("SECOND_HALF_AWAY_TEAM_TOTAL_GOALS");
    expect(out.paramValue).toBe("0.5");
    expect(out.selections.map((s) => s.code)).toEqual(["UNDER", "OVER"]);
  });

  it("maps FIRST_GOAL_TIME ranges and 'brak' to NONE", () => {
    const out = run(
      {
        bookmakerMarketId: "-2957",
        name: "Kiedy zostanie strzelony 1. gol (10 min)",
        selections: [
          { name: "1-10", odds: 3.1 },
          { name: "11-20", odds: 4.6 },
          { name: "brak", odds: 18 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("FIRST_GOAL_TIME");
    expect(out.selections.map((s) => s.code)).toEqual(["1-10", "11-20", "NONE"]);
  });

  it("extracts TIME_PERIOD_RESULT param from '10 minut' window", () => {
    const out = run(
      {
        bookmakerMarketId: "-2976",
        name: "10 minut – 1X2 od 1 do 10",
        selections: [
          { name: "1", odds: 12 },
          { name: "X", odds: 1.12 },
          { name: "2", odds: 9.4 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("TIME_PERIOD_RESULT");
    expect(out.paramValue).toBe("10");
  });

  it("routes 1st-half multi-gole to HALF_TIME_GOAL_RANGE with range codes", () => {
    const out = run(
      {
        bookmakerMarketId: "-88888",
        name: "1. Połowa - multi-gole",
        selections: [
          { name: "brak", odds: 4.2 },
          { name: "1-2", odds: 1.6 },
          { name: "1-3", odds: 1.4 },
          { name: "2-3", odds: 3.2 },
          { name: "4+", odds: 60 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("HALF_TIME_GOAL_RANGE");
    expect(out.selections.map((s) => s.code)).toEqual(["0", "1-2", "1-3", "2-3", "4+"]);
  });

  it("maps HALF_WITH_MORE_GOALS halves to 1st/2nd/Draw", () => {
    const out = run(
      {
        bookmakerMarketId: "38",
        name: "Połowa z większą liczbą goli",
        selections: [
          { name: "1 połowa", odds: 3.2 },
          { name: "2 połowa", odds: 2.45 },
          { name: "Remis", odds: 2.32 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("HALF_WITH_MORE_GOALS");
    expect(out.selections.map((s) => s.code)).toEqual(["1st", "2nd", "Draw"]);
  });

  it("routes 2H double chance + BTTS combo away from DOUBLE_CHANCE", () => {
    const out = run(
      {
        bookmakerMarketId: "4",
        name: "2. Połowa - Podwójna szansa + obie drużyny strzelą",
        selections: [
          { name: "1/X i tak", odds: 15 },
          { name: "1/X i nie", odds: 2.4 },
          { name: "X/2 i tak", odds: 12 },
          { name: "X/2 i nie", odds: 2.2 },
          { name: "1/2 i tak", odds: 9 },
          { name: "1/2 i nie", odds: 3 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("SECOND_HALF_DOUBLE_CHANCE_BTTS");
    expect(out.selections.map((s) => s.code)).toEqual([
      "1X_YES",
      "1X_NO",
      "X2_YES",
      "X2_NO",
      "12_YES",
      "12_NO",
    ]);
  });

  it("maps FIRST_TEAM_TO_SCORE 'brak' to NONE and teams to sides", () => {
    const out = run(
      {
        bookmakerMarketId: "-2967",
        name: "1. gol",
        selections: [
          { name: "Algieria", odds: 2.5 },
          { name: "Austria", odds: 2.08 },
          { name: "brak", odds: 4.8 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("FIRST_TEAM_TO_SCORE");
    expect(out.selections.map((s) => s.code)).toEqual(["HOME", "AWAY", "NONE"]);
  });

  it("maps LAST_TEAM_TO_SCORE 'Brak gola' to NONE", () => {
    const out = run(
      {
        bookmakerMarketId: "41",
        name: "Ostatni gol",
        selections: [
          { name: "Argentyna", odds: 1.15 },
          { name: "Wyspy Zielonego Przylądka", odds: 6.2 },
          { name: "Brak gola", odds: 15 },
        ],
      },
      ctxB
    );
    expect(out.selections.map((s) => s.code)).toEqual(["HOME", "AWAY", "NONE"]);
  });

  it("maps TEAMS_TO_SCORE vocabulary to canonical codes", () => {
    const out = run(
      {
        bookmakerMarketId: "-232",
        name: "Która drużyna zdobędzie gola",
        selections: [
          { name: "Żadna", odds: 16 },
          { name: "Tylko Argentyna", odds: 1.44 },
          { name: "Tylko Wyspy Zielonego Przylądka", odds: 30 },
          { name: "Obie drużyny", odds: 2.75 },
        ],
      },
      ctxB
    );
    expect(out.selections.map((s) => s.code)).toEqual([
      "ZERO_TEAMS",
      "ONE_TEAM_HOME",
      "ONE_TEAM_AWAY",
      "TWO_TEAMS",
    ]);
  });

  it("maps away-team half-with-more-goals to TEAM_HALF_WITH_MORE_GOALS param AWAY", () => {
    const out = run(
      {
        bookmakerMarketId: "-240",
        name: "Austria - połowa z większą liczbą goli",
        selections: [
          { name: "1 połowa", odds: 3.6 },
          { name: "2 połowa", odds: 3.05 },
          { name: "Remis", odds: 2.11 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("TEAM_HALF_WITH_MORE_GOALS");
    expect(out.paramValue).toBe("AWAY");
    expect(out.selections.map((s) => s.code)).toEqual([
      "AWAY_1ST",
      "AWAY_2ND",
      "AWAY_EQUAL",
    ]);
  });

  it("maps home-team half-with-more-goals to TEAM_HALF_WITH_MORE_GOALS param HOME", () => {
    const out = run(
      {
        bookmakerMarketId: "-239",
        name: "Argentyna - połowa z większą liczbą goli",
        selections: [
          { name: "1 połowa", odds: 2.85 },
          { name: "2 połowa", odds: 2.25 },
          { name: "Remis", odds: 3.5 },
        ],
      },
      ctxB
    );
    expect(out.marketCode).toBe("TEAM_HALF_WITH_MORE_GOALS");
    expect(out.paramValue).toBe("HOME");
    expect(out.selections.map((s) => s.code)).toEqual([
      "HOME_1ST",
      "HOME_2ND",
      "HOME_EQUAL",
    ]);
  });

  it("extracts signed handicap param and maps suffixed team selections", () => {
    const out = run(
      {
        bookmakerMarketId: "-2557",
        name: "1. połowa - handicap 0:2",
        selections: [
          { name: "Algieria (0:2)", odds: 70 },
          { name: "X (0:2)", odds: 11 },
          { name: "Austria (0:2)", odds: 1.01 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("FIRST_HALF_EUROPEAN_HANDICAP");
    expect(out.paramValue).toBe("-2");
    expect(out.selections.map((s) => s.code)).toEqual(["HOME", "DRAW", "AWAY"]);
  });

  it("routes '1. połowa/mecz' to HALFTIME_FULLTIME with combo codes", () => {
    const out = run(
      {
        bookmakerMarketId: "5",
        name: "1. połowa/mecz",
        selections: [
          { name: "Algieria / Algieria", odds: 5.4 },
          { name: "X / Algieria", odds: 6.4 },
          { name: "Austria / Algieria", odds: 50 },
          { name: "X / X", odds: 4.6 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("HALFTIME_FULLTIME");
    expect(out.selections.map((s) => s.code)).toEqual([
      "HOME_HOME",
      "DRAW_HOME",
      "AWAY_HOME",
      "DRAW_DRAW",
    ]);
  });

  it("routes HT/FT correct score combo to HT_FT_CORRECT_SCORE", () => {
    const out = run(
      {
        bookmakerMarketId: "2",
        name: "1. połowa dokładny wynik / dokładny wynik końcowy",
        selections: [
          { name: "0-0 / 0-0", odds: 3.6 },
          { name: "0-0 / 1-0", odds: 11 },
          { name: "4 + / 4 +", odds: 45 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("HT_FT_CORRECT_SCORE");
    expect(out.selections.map((s) => s.code)).toEqual([
      "0:0 / 0:0",
      "0:0 / 1:0",
      "4+ / 4+",
    ]);
  });

  it("maps WINNING_MARGIN Polish labels to canonical codes", () => {
    const out = run(
      {
        bookmakerMarketId: "12",
        name: "Różnica zwycięstwa",
        selections: [
          { name: "Remis", odds: 2.1 },
          { name: "Algieria 3 golami lub więcej", odds: 40 },
          { name: "Algieria 2 golami", odds: 13 },
          { name: "Algieria 1 golem", odds: 5.2 },
          { name: "Austria 1 golem", odds: 4.3 },
          { name: "Austria 2 golami", odds: 8.6 },
          { name: "Austria 3 golami lub więcej", odds: 19 },
        ],
      },
      ctxA
    );
    expect(out.selections.map((s) => s.code)).toEqual([
      "DRAW",
      "HOME_BY_3PLUS",
      "HOME_BY_2",
      "HOME_BY_1",
      "AWAY_BY_1",
      "AWAY_BY_2",
      "AWAY_BY_3PLUS",
    ]);
  });

  it("reroutes away 'wygra do zera' to AWAY_WIN_TO_NIL and home to HOME_WIN_TO_NIL", () => {
    const away = run(
      {
        bookmakerMarketId: "130",
        name: "Austria wygra do zera",
        selections: [
          { name: "tak", odds: 3.7 },
          { name: "nie", odds: 1.24 },
        ],
      },
      ctxA
    );
    expect(away.marketCode).toBe("AWAY_WIN_TO_NIL");
    expect(away.selections.map((s) => s.code)).toEqual(["YES", "NO"]);

    const home = run(
      {
        bookmakerMarketId: "48",
        name: "Argentyna wygra do zera",
        selections: [
          { name: "tak", odds: 1.5 },
          { name: "nie", odds: 2.42 },
        ],
      },
      ctxB
    );
    expect(home.marketCode).toBe("HOME_WIN_TO_NIL");
  });

  it("extracts BOTH_HALVES_OVER/UNDER_GOALS line param", () => {
    const over = run(
      {
        bookmakerMarketId: "-2959",
        name: "Obie połowy powyżej 1.5 goli",
        selections: [
          { name: "tak", odds: 8.6 },
          { name: "nie", odds: 1.04 },
        ],
      },
      ctxA
    );
    expect(over.marketCode).toBe("BOTH_HALVES_OVER_GOALS");
    expect(over.paramValue).toBe("1.5");

    const under = run(
      {
        bookmakerMarketId: "-2958",
        name: "Obie połowy poniżej 1.5 goli",
        selections: [
          { name: "tak", odds: 1.66 },
          { name: "nie", odds: 2.1 },
        ],
      },
      ctxA
    );
    expect(under.paramValue).toBe("1.5");
  });

  it("reroutes team 'wygra obie połowy' to home/away variants", () => {
    const away = run(
      {
        bookmakerMarketId: "126",
        name: "Austria wygra obie połowy",
        selections: [
          { name: "tak", odds: 8 },
          { name: "nie", odds: 1.05 },
        ],
      },
      ctxA
    );
    expect(away.marketCode).toBe("AWAY_WIN_BOTH_HALVES");
    expect(away.paramValue).toBeUndefined();

    const home = run(
      {
        bookmakerMarketId: "125",
        name: "Argentyna wygra obie połowy",
        selections: [
          { name: "tak", odds: 2.09 },
          { name: "nie", odds: 1.66 },
        ],
      },
      ctxB
    );
    expect(home.marketCode).toBe("HOME_WIN_BOTH_HALVES");
  });

  it("maps SECOND_HALF_GOAL_RANGE selections including 'brak'", () => {
    const out = run(
      {
        bookmakerMarketId: "-2903",
        name: "2. Połowa - multi-gole",
        selections: [
          { name: "brak", odds: 2.39 },
          { name: "1-2", odds: 1.67 },
          { name: "1-3", odds: 1.52 },
          { name: "2-3", odds: 3.3 },
          { name: "4+", odds: 40 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("SECOND_HALF_GOAL_RANGE");
    expect(out.selections.map((s) => s.code)).toEqual(["0", "1-2", "1-3", "2-3", "4+"]);
  });

  it("reroutes away-team multi-gole to AWAY_GOAL_RANGE", () => {
    const out = run(
      {
        bookmakerMarketId: "-2905",
        name: "Wyspy Zielonego Przylądka multi-gole",
        selections: [
          { name: "brak", odds: 1.39 },
          { name: "1-2", odds: 3.2 },
          { name: "4+", odds: 101 },
        ],
      },
      ctxB
    );
    expect(out.marketCode).toBe("AWAY_GOAL_RANGE");
    expect(out.selections.map((s) => s.code)).toEqual(["0", "1-2", "4+"]);
  });

  it("reroutes away-team 'strzeli gola w obu połowach' to AWAY_SCORE_BOTH_HALVES", () => {
    const out = run(
      {
        bookmakerMarketId: "107",
        name: "Austria strzeli gola w obu połowach",
        selections: [
          { name: "tak", odds: 5 },
          { name: "nie", odds: 1.14 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("AWAY_SCORE_BOTH_HALVES");
  });

  it("reroutes away-team 'strzeli gola' to AWAY_TEAM_TO_SCORE", () => {
    const out = run(
      {
        bookmakerMarketId: "-2983",
        name: "Wyspy Zielonego Przylądka - strzeli gola",
        selections: [
          { name: "tak", odds: 2.75 },
          { name: "nie", odds: 1.4 },
        ],
      },
      ctxB
    );
    expect(out.marketCode).toBe("AWAY_TEAM_TO_SCORE");
  });

  it("reroutes away-team 1st-half exact cards and maps numeric selections", () => {
    const out = run(
      {
        bookmakerMarketId: "-244",
        name: "Austria - liczba kartek w 1 połowie (czerwona kartka=2)",
        selections: [
          { name: "0", odds: 1.3 },
          { name: "1", odds: 2.75 },
          { name: "2", odds: 10 },
          { name: "3+", odds: 50 },
        ],
      },
      ctxA
    );
    expect(out.marketCode).toBe("HALF_TIME_AWAY_EXACT_CARDS");
    expect(out.selections.map((s) => s.code)).toEqual(["0", "1", "2", "3+"]);
  });

  it("maps PLAYER_CARDS special with player param and YES selection", () => {
    const out = run(
      {
        bookmakerMarketId: "-8213",
        name: "Wanner, Paul otrzyma kartkę (z ew. dogrywką; rozliczenie za soccerstats.info)",
        selections: [{ name: "Wanner, Paul 1+", odds: 6.6 }],
      },
      ctxA
    );
    expect(out.marketCode).toBe("PLAYER_CARDS");
    expect(out.paramValue).toBe("Wanner, Paul");
    expect(out.selections.map((s) => s.code)).toEqual(["YES"]);
  });

  it("maps PLAYER_ASSISTS thresholds with player param", () => {
    const out = run(
      {
        bookmakerMarketId: "-2412",
        name: "Da Costa, Nuno - liczba asyst (z ew. dogrywką; rozliczenie za soccerstats.info)",
        selections: [
          { name: "Da Costa, Nuno 1+", odds: 8.4 },
          { name: "Da Costa, Nuno 2+", odds: 45 },
        ],
      },
      ctxB
    );
    expect(out.marketCode).toBe("PLAYER_ASSISTS");
    expect(out.paramValue).toBe("Da Costa, Nuno");
    expect(out.selections.map((s) => s.code)).toEqual(["1+", "2+"]);
  });

  it("maps BOTH_PLAYERS_ANYTIME to the named pair selection", () => {
    const out = run(
      {
        bookmakerMarketId: "-30416",
        name: "R. De Paul & Lau. Martinez: obaj wymienieni zawodnicy strzelą co najmniej po jednym golu (muszą wyjść w pierwszym składzie)",
        selections: [{ name: "tak", odds: 11.5 }],
      },
      ctxB
    );
    expect(out.marketCode).toBe("BOTH_PLAYERS_ANYTIME");
    // Names are sorted alphabetically (mirrors betclic's normalizePlayerComboSelection)
    // so the same pair merges across bookmakers regardless of forBET's listing order.
    expect(out.selections.map((s) => s.code)).toEqual(["Lau. Martinez & R. De Paul"]);
  });

  it("routes 2H 1X2+BTTS combo away from BTTS", () => {
    const out = run(
      {
        bookmakerMarketId: "98",
        name: "2. Połowa – 1X2 + obie drużyny strzelą gola",
        selections: [
          { name: "Argentyna i tak", odds: 10 },
          { name: "Argentyna i nie", odds: 1.46 },
          { name: "remis i tak", odds: 12 },
          { name: "remis i nie", odds: 3.95 },
          { name: "Wyspy Zielonego Przylądka i tak", odds: 100 },
          { name: "Wyspy Zielonego Przylądka i nie", odds: 14 },
        ],
      },
      ctxB
    );
    expect(out.marketCode).toBe("SECOND_HALF_RESULT_AND_BTTS");
    expect(out.selections.map((s) => s.code)).toEqual([
      "HOME_YES",
      "HOME_NO",
      "DRAW_YES",
      "DRAW_NO",
      "AWAY_YES",
      "AWAY_NO",
    ]);
  });

  it("routes '1X2 i poniżej/powyżej' combo to RESULT_AND_TOTAL", () => {
    const out = run(
      {
        bookmakerMarketId: "8",
        name: "1X2 i poniżej/powyżej 2.5 goli",
        selections: [
          { name: "Argentyna i powyżej 2,5", odds: 2.3 },
          { name: "Argentyna i poniżej 2,5", odds: 2.4 },
          { name: "remis i powyżej 2,5", odds: 16 },
        ],
      },
      ctxB
    );
    expect(out.marketCode).toBe("RESULT_AND_TOTAL");
    expect(out.paramValue).toBe("2.5");
    expect(out.selections.map((s) => s.code)).toEqual([
      "HOME_OVER",
      "HOME_UNDER",
      "DRAW_OVER",
    ]);
  });

  it("does not hijack plain markets", () => {
    const total = run(
      {
        bookmakerMarketId: "8",
        name: "Poniżej/powyżej 5.5 goli",
        selections: [
          { name: "poniżej 5.5", odds: 1.01 },
          { name: "powyżej 5.5", odds: 14 },
        ],
      },
      ctxA
    );
    expect(total.marketCode).toBe("TOTAL_GOALS");
    expect(total.paramValue).toBe("5.5");
    expect(total.selections.map((s) => s.code)).toEqual(["UNDER", "OVER"]);

    const winner = run(
      {
        bookmakerMarketId: "1",
        name: "1X2",
        selections: [
          { name: "Algieria", odds: 3.95 },
          { name: "Remis", odds: 2.27 },
          { name: "Austria", odds: 2.8 },
        ],
      },
      ctxA
    );
    expect(winner.marketCode).toBe("MATCH_WINNER");
    expect(winner.selections.map((s) => s.code)).toEqual(["HOME", "DRAW", "AWAY"]);

    const dc = run(
      {
        bookmakerMarketId: "4",
        name: "Podwójna szansa",
        selections: [
          { name: "1/X", odds: 1.4 },
          { name: "X/2", odds: 1.3 },
          { name: "1/2", odds: 1.5 },
        ],
      },
      ctxA
    );
    expect(dc.marketCode).toBe("DOUBLE_CHANCE");
    expect(dc.selections.map((s) => s.code)).toEqual([
      "HOME_OR_DRAW",
      "DRAW_OR_AWAY",
      "HOME_OR_AWAY",
    ]);
  });

  it("keeps full-match european handicap buckets aligned (1:0 → +1, 0:2 → -2)", () => {
    const plus = run(
      {
        bookmakerMarketId: "6",
        name: "Handicap 1:0",
        selections: [
          { name: "Algieria (1:0)", odds: 1.43 },
          { name: "X (1:0)", odds: 4.4 },
          { name: "Austria (1:0)", odds: 6.2 },
        ],
      },
      ctxA
    );
    expect(plus.paramValue).toBe("+1");
    expect(plus.selections.map((s) => s.code)).toEqual(["HOME", "DRAW", "AWAY"]);

    const minus = run(
      {
        bookmakerMarketId: "6",
        name: "Handicap 0:2",
        selections: [
          { name: "Algieria (0:2)", odds: 28 },
          { name: "X (0:2)", odds: 9.8 },
          { name: "Austria (0:2)", odds: 1.05 },
        ],
      },
      ctxA
    );
    expect(minus.paramValue).toBe("-2");
    expect(minus.selections.map((s) => s.code)).toEqual(["HOME", "DRAW", "AWAY"]);
  });

  it("reroutes clean-sheet and win-at-least-one-half team markets", () => {
    const cs = run(
      {
        bookmakerMarketId: "-2546",
        name: "1. połowa - Austria czyste konto",
        selections: [
          { name: "tak", odds: 1.39 },
          { name: "nie", odds: 2.8 },
        ],
      },
      ctxA
    );
    expect(cs.marketCode).toBe("HALF_TIME_AWAY_CLEAN_SHEET");

    const half = run(
      {
        bookmakerMarketId: "128",
        name: "Austria wygra przynajmniej jedną połowę",
        selections: [
          { name: "tak", odds: 1.88 },
          { name: "nie", odds: 1.83 },
        ],
      },
      ctxA
    );
    expect(half.marketCode).toBe("AWAY_WIN_AT_LEAST_ONE_HALF");
    expect(half.paramValue).toBeUndefined();
  });

  // --- Round 2 fixes (Argentina vs Cape Verde re-run, Switzerland vs Colombia) ---

  it("routes team-less 2nd-half totals to SECOND_HALF_TOTAL_GOALS", () => {
    const out = run(
      {
        bookmakerMarketId: "8",
        name: "2. połowa - poniżej/powyżej 1.5 goli",
        selections: [
          { name: "poniżej 1.5", odds: 1.55 },
          { name: "powyżej 1.5", odds: 2.46 },
        ],
      },
      ctxC
    );
    expect(out.marketCode).toBe("SECOND_HALF_TOTAL_GOALS");
    expect(out.paramValue).toBe("1.5");
    expect(out.selections.map((s) => s.code)).toEqual(["UNDER", "OVER"]);
  });

  it("routes single-name player goals prop to PLAYER_GOALS, not TOTAL_GOALS", () => {
    const out = run(
      {
        bookmakerMarketId: "8",
        name: "Richard - liczba goli (z ew. dogrywką; rozliczenie za soccerstats.info)",
        selections: [{ name: "Richard 1+", odds: 8.4 }],
      },
      ctxC
    );
    expect(out.marketCode).toBe("PLAYER_GOALS");
    expect(out.paramValue).toBe("Richard");
    expect(out.selections.map((s) => s.code)).toEqual(["1+"]);
  });

  it("routes double chance + totals combo to DOUBLE_CHANCE_TOTAL", () => {
    const out = run(
      {
        bookmakerMarketId: "4",
        name: "Podwójna szansa i poniżej/powyżej 4.5 goli",
        selections: [
          { name: "Argentyna/remis i poniżej 4.5", odds: 1.38 },
          { name: "Argentyna/remis i powyżej 4.5", odds: 11 },
          { name: "remis/Wyspy Zielonego Przylądka i poniżej 4.5", odds: 3.4 },
          { name: "remis/Wyspy Zielonego Przylądka i powyżej 4.5", odds: 23 },
          { name: "Argentyna/Wyspy Zielonego Przylądka i poniżej 4.5", odds: 1.66 },
          { name: "Argentyna/Wyspy Zielonego Przylądka i powyżej 4.5", odds: 12 },
        ],
      },
      ctxB
    );
    expect(out.marketCode).toBe("DOUBLE_CHANCE_TOTAL");
    expect(out.paramValue).toBe("4.5");
    expect(out.selections.map((s) => s.code)).toEqual([
      "1X_UNDER",
      "1X_OVER",
      "X2_UNDER",
      "X2_OVER",
      "12_UNDER",
      "12_OVER",
    ]);
  });

  it("routes 1st/2nd-half BTTS combo to BTTS_BY_HALF, not BTTS", () => {
    const out = run(
      {
        bookmakerMarketId: "98",
        name: "1./2.Połowa - Obie drużyny strzelą gola",
        selections: [
          { name: "nie/nie", odds: 1.32 },
          { name: "tak/nie", odds: 5.4 },
          { name: "nie/tak", odds: 3.9 },
          { name: "tak/tak", odds: 20 },
        ],
      },
      ctxC
    );
    expect(out.marketCode).toBe("BTTS_BY_HALF");
    expect(out.selections.map((s) => s.code)).toEqual(["None", "1st", "2nd", "Both"]);
  });

  it("maps home-team goals before minute 30 with O/U codes and minute param", () => {
    const out = run(
      {
        bookmakerMarketId: "-30393",
        name: "Szwajcaria: Liczba bramek do 30 minuty meczu",
        selections: [
          { name: "Poniżej 0.5", odds: 1.21 },
          { name: "Powyżej 0.5", odds: 3.79 },
        ],
      },
      ctxC
    );
    expect(out.marketCode).toBe("TEAM_GOALS_BEFORE_MINUTE");
    expect(out.paramValue).toBe("30");
    expect(out.selections.map((s) => s.code)).toEqual(["UNDER", "OVER"]);
  });

  it("excludes away-team 30-min goal window from FIRST_30_MIN_TOTAL_GOALS", () => {
    const out = run(
      {
        bookmakerMarketId: "-30394",
        name: "Wyspy Zielonego Przylądka: Liczba bramek do 30 minuty meczu",
        selections: [
          { name: "Poniżej 0.5", odds: 1.32 },
          { name: "Powyżej 0.5", odds: 3.01 },
        ],
      },
      ctxB
    );
    expect(out.marketCode).toBe("OTHER");
  });

  it("keeps match-level 30-min totals in FIRST_30_MIN_TOTAL_GOALS with param 30", () => {
    const out = run(
      {
        bookmakerMarketId: "-30392",
        name: "Liczba bramek do 30 minuty meczu",
        selections: [
          { name: "Poniżej 0.5", odds: 1.85 },
          { name: "Powyżej 0.5", odds: 1.85 },
        ],
      },
      ctxB
    );
    expect(out.marketCode).toBe("FIRST_30_MIN_TOTAL_GOALS");
    expect(out.paramValue).toBe("30");
    expect(out.selections.map((s) => s.code)).toEqual(["UNDER", "OVER"]);
  });

  it("maps match-level 60-min totals with O/U codes and goal-line param", () => {
    const out = run(
      {
        bookmakerMarketId: "-30395",
        name: "Liczba bramek do 60 minuty meczu",
        selections: [
          { name: "Poniżej 2.5", odds: 1.5 },
          { name: "Powyżej 2.5", odds: 2.36 },
        ],
      },
      ctxB
    );
    expect(out.marketCode).toBe("TOTAL_GOALS_BY_60_MIN");
    expect(out.paramValue).toBe("2.5");
    expect(out.selections.map((s) => s.code)).toEqual(["UNDER", "OVER"]);
  });

  it("maps home-team 60-min totals to TEAM_TOTAL_GOALS_FIRST_60MIN HOME codes", () => {
    const out = run(
      {
        bookmakerMarketId: "-30396",
        name: "Szwajcaria: Liczba bramek do 60 minuty meczu",
        selections: [
          { name: "Poniżej 0.5", odds: 1.63 },
          { name: "Powyżej 0.5", odds: 2.1 },
        ],
      },
      ctxC
    );
    expect(out.marketCode).toBe("TEAM_TOTAL_GOALS_FIRST_60MIN");
    expect(out.paramValue).toBe("0.5");
    expect(out.selections.map((s) => s.code)).toEqual(["HOME_UNDER", "HOME_OVER"]);
  });

  it("reroutes away-team 60-min totals from TOTAL_GOALS_BY_60MIN to AWAY codes", () => {
    const out = run(
      {
        bookmakerMarketId: "-30397",
        name: "Kolumbia: Liczba bramek do 60 minuty meczu",
        selections: [
          { name: "Poniżej 0.5", odds: 1.21 },
          { name: "Powyżej 0.5", odds: 3.8 },
        ],
      },
      ctxC
    );
    expect(out.marketCode).toBe("TEAM_TOTAL_GOALS_FIRST_60MIN");
    expect(out.paramValue).toBe("0.5");
    expect(out.selections.map((s) => s.code)).toEqual(["AWAY_UNDER", "AWAY_OVER"]);
  });

  it("derives 1st-half asian handicap param from the home selection line", () => {
    const out = run(
      {
        bookmakerMarketId: "-6008",
        name: "1. połowa - handicap",
        selections: [
          { name: "1 (+1.5)", odds: 1.28 },
          { name: "2 (-1.5)", odds: 3.55 },
        ],
      },
      ctxC
    );
    expect(out.marketCode).toBe("FIRST_HALF_ASIAN_HANDICAP");
    expect(out.paramValue).toBe("+1.5");
    expect(out.selections.map((s) => s.code)).toEqual(["HOME", "AWAY"]);
  });
});

// Regression tests for round-5 fixes (world-cup-2026: France vs Morocco
// verification audit).
const ctxD: NormalizationContext = {
  homeTeam: "France",
  awayTeam: "Morocco",
  league: "world-cup-2026",
};

describe("forbet audit fixes round 5", () => {
  it("routes odd/even goals selections to ODD_EVEN_GOALS instead of UNKNOWN under TOTAL_GOALS", () => {
    const out = run(
      {
        bookmakerMarketId: "8",
        name: "Parzysta/nieparzysta - liczba goli",
        selections: [
          { name: "Nieparzyste", odds: 2.27 },
          { name: "Parzyste", odds: 1.56 },
        ],
      },
      ctxD
    );
    expect(out.marketCode).toBe("ODD_EVEN_GOALS");
    expect(out.selections.map((s) => s.code)).toEqual(["ODD", "EVEN"]);
  });

  it("does not hijack the corner odd/even market, which also says Parzyste/Nieparzyste", () => {
    const out = run(
      {
        bookmakerMarketId: "-262",
        name: "Parzysta/nieparzysta - liczba rzutów rożnych",
        selections: [
          { name: "Nieparzyste", odds: 1.9 },
          { name: "Parzyste", odds: 1.85 },
        ],
      },
      ctxD
    );
    expect(out.marketCode).toBe("CORNERS_ODD_EVEN");
    expect(out.selections.map((s) => s.code)).toEqual(["ODD", "EVEN"]);
  });

  it("accepts '&' as the RESULT_AND_TOTAL leg separator (not just 'i')", () => {
    const out = run(
      {
        bookmakerMarketId: "8",
        name: "1X2 i poniżej/powyżej 4.5 goli",
        selections: [
          { name: "Francja i powyżej 4,5", odds: 5.5 },
          { name: "remis & powyżej 4,5", odds: 22 },
          { name: "Maroko i powyżej 4,5", odds: 60 },
        ],
      },
      ctxD
    );
    expect(out.marketCode).toBe("RESULT_AND_TOTAL");
    expect(out.selections.map((s) => s.code)).toEqual(["HOME_OVER", "DRAW_OVER", "AWAY_OVER"]);
  });

  it("clamps a hidden 3/4+ split into a single merged 3+ bucket for half-time exact cards", () => {
    const out = run(
      {
        bookmakerMarketId: "-244",
        name: "1. połowa - Francja - dokładna liczba kartek (czerwona kartka=2)",
        selections: [
          { name: "0", odds: 1.34 },
          { name: "1", odds: 2.65 },
          { name: "2", odds: 9.8 },
          { name: "3", odds: 60 },
          { name: "4+", odds: 101 },
        ],
      },
      ctxD
    );
    expect(out.marketCode).toBe("HALF_TIME_HOME_EXACT_CARDS");
    expect(out.selections.map((s) => s.code)).toEqual(["0", "1", "2", "3+"]);
    const merged = out.selections.find((s) => s.code === "3+");
    // Combined via implied probability: 1 / (1/60 + 1/101)
    expect(merged?.odds).toBeCloseTo(37.64, 1);
  });

  it("sorts and diacritic-fixes TWO_PLAYERS_ANYTIME combos so they merge across bookmakers", () => {
    const out = run(
      {
        bookmakerMarketId: "-30415",
        name: "Którykolwiek z dwóch wymienionych zawodników strzeli gola",
        selections: [{ name: "K. Mbappe / B. Barcola", odds: 1.55 }],
      },
      ctxD
    );
    expect(out.marketCode).toBe("TWO_PLAYERS_ANYTIME");
    expect(out.selections.map((s) => s.code)).toEqual(["B. Barcola & K. Mbappé"]);
  });
});
