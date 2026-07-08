import { describe, it, expect } from "vitest";
import { fortunaNormalizer } from "../fortuna-normalizer.js";
import type { NormalizationContext } from "../../types.js";

const ctxDZA: NormalizationContext = {
  homeTeam: "Algeria",
  awayTeam: "Austria",
  league: "world-cup-2026",
};

const ctxARG: NormalizationContext = {
  homeTeam: "Argentina",
  awayTeam: "Cape Verde",
  league: "world-cup-2026",
};

describe("fortuna audit fixes", () => {
  it("maps 'więcej/mniej niż N' to OVER/UNDER with integer param", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-0u",
        name: "Liczba goli",
        selections: [
          { name: "więcej niż 2", odds: 2.2 },
          { name: "mniej niż 2", odds: 1.59 },
        ],
      },
      ctxDZA
    );
    expect(out?.paramValue).toBe("2");
    expect(out?.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);
  });

  it("routes 3-outcome handicap to ASIAN_HANDICAP_3WAY and keeps DRAW", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-0b",
        name: "Mecz: handicap",
        selections: [
          { name: "Algieria (0:0)", odds: 2.5 },
          { name: "Remis (0:0)", odds: 3.2 },
          { name: "Austria (0:0)", odds: 2.6 },
        ],
      },
      ctxDZA
    );
    expect(out?.marketCode).toBe("ASIAN_HANDICAP_3WAY");
    expect(out?.paramValue).toBe("0");
    expect(out?.selections.map((s) => s.code)).toEqual(["HOME", "DRAW", "AWAY"]);
  });

  it("parses score-style European handicap line and infers AWAY", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-61",
        name: "Mecz: handicap 0:1",
        selections: [
          { name: "Algieria (0:1)", odds: 3.1 },
          { name: "Remis (0:1)", odds: 3.9 },
          { name: "Austria (0:1)", odds: 1.9 },
        ],
      },
      ctxDZA
    );
    expect(out?.marketCode).toBe("EUROPEAN_HANDICAP");
    expect(out?.paramValue).toBe("-1");
    expect(out?.selections.map((s) => s.code)).toEqual(["HOME", "DRAW", "AWAY"]);
  });

  it("maps abbreviated away side on ASIAN_HANDICAP_PUSH and never mines param from placeholder id", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-37",
        name: "Rynek ufo:mtyp:00-37",
        selections: [
          { name: "Argentyna (-1)", odds: 1.7 },
          { name: "W.Ziel.Przyl. (+1)", odds: 1.95 },
        ],
      },
      ctxARG
    );
    expect(out?.marketCode).toBe("ASIAN_HANDICAP_PUSH");
    expect(out?.paramValue).toBe("-1");
    expect(out?.selections.map((s) => s.code)).toEqual(["HOME", "AWAY"]);
  });

  it("maps GOAL_RANGE dash selections as canonical codes", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-24",
        name: "Rynek ufo:mtyp:00-24",
        selections: [
          { name: "3-5", odds: 3.05 },
          { name: "1-2", odds: 1.7 },
          { name: "5-6", odds: 18 },
        ],
      },
      ctxDZA
    );
    expect(out?.selections.map((s) => s.code)).toEqual(["3-5", "1-2", "5-6"]);
  });

  it("maps FIRST_GOAL_TIME intervals and 'Nie padnie następny gol' -> NONE", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-7a",
        name: "Czas pierwszego gola",
        selections: [
          { name: "1-10", odds: 4 },
          { name: "61-70", odds: 12 },
          { name: "Nie padnie następny gol", odds: 17 },
        ],
      },
      ctxARG
    );
    expect(out?.selections.map((s) => s.code)).toEqual(["1-10", "61-70", "NONE"]);
  });

  it("maps HALF_WITH_MORE_GOALS Pierwszy/Drugi/Rowno", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1t",
        name: "Połowa z większą liczbą goli",
        selections: [
          { name: "Pierwszy", odds: 3.4 },
          { name: "Drugi", odds: 2.6 },
          { name: "Rowno", odds: 2.37 },
        ],
      },
      ctxDZA
    );
    expect(out?.selections.map((s) => s.code)).toEqual(["1st", "2nd", "Draw"]);
  });

  it("routes away-team half market to AWAY_HALF_WITH_MOST_GOALS with mapped selections", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1u",
        name: "W.Ziel.Przyl. połowa z wiekszą liczbą goli",
        selections: [
          { name: "Pierwsza", odds: 6 },
          { name: "Druga", odds: 4.8 },
          { name: "Równo", odds: 1.38 },
        ],
      },
      ctxARG
    );
    expect(out?.marketCode).toBe("AWAY_HALF_WITH_MOST_GOALS");
    expect(out?.selections.map((s) => s.code)).toEqual(["1st", "2nd", "Draw"]);
  });

  it("maps FIRST/LAST_TEAM_TO_SCORE 'Nikt' -> NONE and teams to sides", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-3a",
        name: "Ostatni gol w meczu",
        selections: [
          { name: "Algieria", odds: 3.5 },
          { name: "Austria", odds: 1.7 },
          { name: "Nikt", odds: 4.7 },
        ],
      },
      ctxDZA
    );
    expect(out?.selections.map((s) => s.code)).toEqual(["HOME", "AWAY", "NONE"]);
  });

  it("maps TEAMS_TO_SCORE vocabulary incl. abbreviated team", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1e",
        name: "Rynek ufo:mtyp:00-1e",
        selections: [
          { name: "Obie", odds: 2.65 },
          { name: "Żadna", odds: 18 },
          { name: "Tylko Argentyna", odds: 1.49 },
          { name: "Tylko W.Ziel.Przyl.", odds: 30 },
        ],
      },
      ctxARG
    );
    expect(out?.selections.map((s) => s.code)).toEqual([
      "TWO_TEAMS",
      "ZERO_TEAMS",
      "ONE_TEAM_HOME",
      "ONE_TEAM_AWAY",
    ]);
  });

  it("maps BTTS_BY_HALF Tak/Nie pairs", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-26",
        name: "Rynek ufo:mtyp:00-26",
        selections: [
          { name: "Tak/Tak", odds: 30 },
          { name: "Tak/Nie", odds: 6.6 },
          { name: "Nie/Tak", odds: 4.7 },
          { name: "Nie/Nie", odds: 1.25 },
        ],
      },
      ctxDZA
    );
    expect(out?.selections.map((s) => s.code)).toEqual(["Both", "1st", "2nd", "None"]);
  });

  it("maps SUBSTITUTE_GOAL Tak/Nie -> YES/NO", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-m7",
        name: "Rezerwowy strzeli gola",
        selections: [
          { name: "Tak", odds: 2.3 },
          { name: "Nie", odds: 1.53 },
        ],
      },
      ctxDZA
    );
    expect(out?.selections.map((s) => s.code)).toEqual(["YES", "NO"]);
  });

  it("uses player name as param for stat-line player markets", () => {
    const fouls = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-lg",
        name: "Zerrouki, Ramiz - liczba fauli (OPTA)",
        selections: [
          { name: "2+", odds: 1.45 },
          { name: "3+", odds: 2.35 },
          { name: "4+", odds: 4.25 },
        ],
      },
      ctxDZA
    );
    // Player params are canonicalized to "Firstname Lastname" so the same
    // player merges across bookmakers.
    expect(fouls?.paramValue).toBe("Ramiz Zerrouki");
    expect(fouls?.selections.map((s) => s.code)).toEqual(["2+", "3+", "4+"]);

    const cards = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-lk",
        name: "Mwene, Philipp - otrzyma Żółtą Kartkę (OPTA)",
        selections: [{ name: "1+", odds: 5.5 }],
      },
      ctxDZA
    );
    expect(cards?.paramValue).toBe("Philipp Mwene");
    expect(cards?.selections[0].code).toBe("YES");

    const assists = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-la",
        name: "Otamendi, Nicolas - asystuje (OPTA)",
        selections: [{ name: "1+", odds: 10 }],
      },
      ctxARG
    );
    expect(assists?.paramValue).toBe("Nicolas Otamendi");
    expect(assists?.selections[0].code).toBe("1+");
  });

  it("uses player name as selection for dropdown player markets", () => {
    const header = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-ox",
        name: "Chukwuemeka, Carney strzeli gola głową (OPTA)",
        selections: [{ name: "1+", odds: 30 }],
      },
      ctxDZA
    );
    expect(header?.selections[0].code).toBe("Carney Chukwuemeka");

    const firstScorer = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-nf",
        name: "W.Ziel.Przyl. Cabral, Jovane strzeli pierwszego gola w meczu (OPTA)",
        selections: [{ name: "Tak", odds: 15 }],
      },
      ctxARG
    );
    expect(firstScorer?.selections[0].code).toBe("Jovane Cabral");
  });

  it("excludes BTTS+scorer combo products from BTTS", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        name: "Obie drużyny strzelą gola , Alexis Mac Allister strzeli gola",
        selections: [{ name: "Tak", odds: 11 }],
      },
      ctxARG
    );
    expect(out).toBeNull();
  });

  it("drops the 00-0v goal-band market instead of poisoning ASIAN_HANDICAP", () => {
    // Live-verified: 00-0v ("ASIAN_HANDICAP" per legacy constants) actually
    // carries a 4-way goal-band book ("0-1"/"2"/"3"/"4+"), not a handicap.
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-0v",
        name: "Rynek ufo:mtyp:00-0v",
        selections: [
          { name: "0-1", odds: 2.08 },
          { name: "W.Ziel.Przyl.", odds: 3.6 },
          { name: "3", odds: 5.2 },
          { name: "4+", odds: 5.2 },
        ],
      },
      ctxARG
    );
    expect(out).toBeNull();
  });

  it("encodes quarter sub-markets with a q-prefixed param", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-rz",
        name: "2.kwarta",
        selections: [
          { name: "Argentyna", odds: 1.48 },
          { name: "Remis", odds: 5.1 },
          { name: "W.Ziel.Przyl.", odds: 4.65 },
        ],
      },
      ctxARG
    );
    expect(out?.paramValue).toBe("q2");
    expect(out?.marketKey).toBe("TIME_PERIOD_RESULT:q2");
  });

  // ===== Round 2 audit fixes =====

  const ctxSUI: NormalizationContext = {
    homeTeam: "Switzerland",
    awayTeam: "Colombia",
    league: "world-cup-2026",
  };

  it("maps short 'więcej/mniej N' (without 'niż') to OVER/UNDER", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-0u",
        name: "Liczba goli",
        selections: [
          { name: "więcej 1", odds: 1.28 },
          { name: "mniej 1", odds: 3.4 },
        ],
      },
      ctxARG
    );
    expect(out?.paramValue).toBe("1");
    expect(out?.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);
  });

  it("recognizes 'Równo' as the draw leg and redirects handicap to 3-way", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-0b",
        name: "Mecz: handicap",
        selections: [
          { name: "Równo (3:0)", odds: 5.2 },
          { name: "Kolumbia (3:0)", odds: 3.6 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("ASIAN_HANDICAP_3WAY");
    expect(out?.selections.map((s) => s.code)).toEqual(["DRAW", "AWAY"]);
  });

  it("resolves all three European handicap sides at pick'em via aliases", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-61",
        name: "Mecz: handicap 0:0",
        selections: [
          { name: "Szwajcaria (0:0)", odds: 2.55 },
          { name: "Równo (0:0)", odds: 4.7 },
          { name: "Kolumbia (0:0)", odds: 3.65 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("EUROPEAN_HANDICAP");
    expect(out?.selections.map((s) => s.code)).toEqual(["HOME", "DRAW", "AWAY"]);
  });

  it("drops handicap legs that cannot be resolved to a side", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-0b",
        name: "Mecz: handicap",
        selections: [{ name: "(-8,5)", odds: 1.01 }],
      },
      ctxSUI
    );
    expect(out).toBeNull();
  });

  it("routes away-team odd/even goals market to AWAY_TEAM_ODD_EVEN_GOALS", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1b",
        name: "Kolumbia Liczba goli P/N",
        selections: [
          { name: "Parz.", odds: 1.78 },
          { name: "Niep.", odds: 2.01 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("AWAY_TEAM_ODD_EVEN_GOALS");
    expect(out?.selections.map((s) => s.code)).toEqual(["EVEN", "ODD"]);
  });

  it("keeps home-team odd/even goals for the home team and maps 'Niep.'", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1b",
        name: "Szwajcaria Liczba goli P/N",
        selections: [
          { name: "Parz.", odds: 1.69 },
          { name: "Niep.", odds: 2.14 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("HOME_TEAM_ODD_EVEN_GOALS");
    expect(out?.selections.map((s) => s.code)).toEqual(["EVEN", "ODD"]);
  });

  it("maps 'Niep.' abbreviation on the match odd/even market", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1a",
        name: "Parzyste/Nieparzyste",
        selections: [
          { name: "Parz.", odds: 1.69 },
          { name: "Niep.", odds: 2.14 },
        ],
      },
      ctxSUI
    );
    expect(out?.selections.map((s) => s.code)).toEqual(["EVEN", "ODD"]);
  });

  it("maps GOAL_RANGE 'Nikt' to the zero-goals band", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-24",
        name: "Przedział goli",
        selections: [
          { name: "Nikt", odds: 16 },
          { name: "1-2", odds: 2.6 },
        ],
      },
      ctxARG
    );
    expect(out?.selections.map((s) => s.code)).toEqual(["0", "1-2"]);
  });

  it("excludes the 00-lo SuperSub combo from TOTAL_GOALS_MINIMUM", () => {
    // Live-verified: 00-lo is "SuperSub: Zawodnik i jego zmiennik - liczba
    // strzałów" (per-player combo), not the match goals-minimum market.
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-lo",
        name: "Rynek ufo:mtyp:00-lo",
        selections: [
          { name: "1+", odds: 1.28 },
          { name: "2+", odds: 2.35 },
          { name: "3+", odds: 5 },
        ],
      },
      ctxARG
    );
    expect(out).toBeNull();
  });

  it("routes home 'nie straci gola' to HOME_CLEAN_SHEET and drops away variant", () => {
    const home = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1f",
        name: "Argentyna nie straci gola",
        selections: [
          { name: "Tak", odds: 1.43 },
          { name: "Nie", odds: 2.6 },
        ],
      },
      ctxARG
    );
    expect(home?.marketCode).toBe("HOME_CLEAN_SHEET");
    expect(home?.selections.map((s) => s.code)).toEqual(["YES", "NO"]);

    const away = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1f",
        name: "W.Ziel.Przyl. nie straci gola",
        selections: [
          { name: "Tak", odds: 9 },
          { name: "Nie", odds: 1.04 },
        ],
      },
      ctxARG
    );
    expect(away).toBeNull();
  });

  it("excludes 'Wynik meczu lub 2 gol(e) przewagi' from MATCH_WINNER", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        name: "Wynik meczu lub 2 gol(e) PRZEWAGI",
        selections: [
          { name: "Argentyna", odds: 1.14 },
          { name: "Remis", odds: 7.9 },
          { name: "W.Ziel.Przyl.", odds: 19.5 },
        ],
      },
      ctxARG
    );
    expect(out).toBeNull();
  });

  it("routes 00-gg to MOST_SHOTS_ON_TARGET with the 'Równo' draw leg", () => {
    // Live-verified: 00-gg is "Mecz: więcej strzałów w światło bramki (OPTA)".
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-gg",
        name: "Rynek ufo:mtyp:00-gg",
        selections: [
          { name: "Szwajcaria", odds: 2.95 },
          { name: "Równo", odds: 8.5 },
          { name: "Kolumbia", odds: 1.58 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("MOST_SHOTS_ON_TARGET");
    expect(out?.selections.map((s) => s.code)).toEqual(["HOME", "DRAW", "AWAY"]);
  });

  // ===== Round 3 audit fixes (full-data wave, live-verified id identities) =====

  it("keeps home-perspective sign on 2-way handicap regardless of leg order", () => {
    // Away leg listed first previously flipped the param sign ("-1" while the
    // home team was actually getting +1).
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-0b",
        name: "Mecz: handicap",
        selections: [
          { name: "Kolumbia -1", odds: 3.65 },
          { name: "Szwajcaria +1", odds: 1.31 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("ASIAN_HANDICAP");
    expect(out?.paramValue).toBe("+1");
    expect(out?.selections.map((s) => s.code)).toEqual(["AWAY", "HOME"]);
  });

  it("maps DOUBLE_CHANCE_TOTAL '10 / +2.5' combos to catalog codes", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-23",
        name: "Rynek ufo:mtyp:00-23",
        selections: [
          { name: "10 / +2.5", odds: 4.6 },
          { name: "10 / -2.5", odds: 2.36 },
          { name: "02 / +2.5", odds: 3.2 },
          { name: "02 / -2.5", odds: 2.05 },
          { name: "12 / +2.5", odds: 2.55 },
          { name: "12 / -2.5", odds: 2.7 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("DOUBLE_CHANCE_TOTAL");
    expect(out?.paramValue).toBe("2.5");
    expect(out?.selections.map((s) => s.code)).toEqual([
      "1X_OVER",
      "1X_UNDER",
      "X2_OVER",
      "X2_UNDER",
      "12_OVER",
      "12_UNDER",
    ]);
  });

  it("maps RESULT_AND_TOTAL 'Team/± line' combos incl. the '0' draw leg", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1l",
        name: "Rynek ufo:mtyp:00-1l",
        selections: [
          { name: "Kolumbia/- 2.5 ", odds: 4.2 },
          { name: "Kolumbia/+ 2.5 ", odds: 3.8 },
          { name: "0/- 2.5 ", odds: 3.35 },
          { name: "0/+ 2.5 ", odds: 14 },
          { name: "Szwajcaria/- 2.5 ", odds: 6 },
          { name: "Szwajcaria/+ 2.5 ", odds: 6.2 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("RESULT_AND_TOTAL");
    expect(out?.paramValue).toBe("2.5");
    expect(out?.selections.map((s) => s.code)).toEqual([
      "AWAY_UNDER",
      "AWAY_OVER",
      "DRAW_UNDER",
      "DRAW_OVER",
      "HOME_UNDER",
      "HOME_OVER",
    ]);
  });

  it("maps TOTAL_GOALS_AND_BTTS 'Tak/+ 2.5' combos", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1k",
        name: "Rynek ufo:mtyp:00-1k",
        selections: [
          { name: "Tak/+ 2.5 ", odds: 2.55 },
          { name: "Nie/- 2.5 ", odds: 2.02 },
          { name: "Nie/+ 2.5 ", odds: 11 },
          { name: "Tak/- 2.5 ", odds: 5.8 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("TOTAL_GOALS_AND_BTTS");
    expect(out?.selections.map((s) => s.code)).toEqual([
      "OVER_YES",
      "UNDER_NO",
      "OVER_NO",
      "UNDER_YES",
    ]);
  });

  it("maps HALFTIME_FULLTIME 'Team/Team' pairs to canonical codes", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1n",
        name: "1.połowa/wynik meczu",
        selections: [
          { name: "Kolumbia/Kolumbia", odds: 3.5 },
          { name: "Remis/Szwajcaria", odds: 7.6 },
          { name: "Remis/Remis", odds: 4.3 },
          { name: "Szwajcaria/Kolumbia", odds: 35 },
        ],
      },
      ctxSUI
    );
    expect(out?.selections.map((s) => s.code)).toEqual([
      "AWAY_AWAY",
      "DRAW_HOME",
      "DRAW_DRAW",
      "HOME_AWAY",
    ]);
  });

  it("routes 00-2q to HALF_TIME_RESULT_AND_BTTS with mapped Team/Tak pairs", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-2q",
        name: "Rynek ufo:mtyp:00-2q",
        selections: [
          { name: "Szwajcaria/Nie", odds: 4.2 },
          { name: "Remis/Tak", odds: 8 },
          { name: "Kolumbia/Tak", odds: 21 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("HALF_TIME_RESULT_AND_BTTS");
    expect(out?.selections.map((s) => s.code)).toEqual([
      "HOME_NO",
      "DRAW_YES",
      "AWAY_YES",
    ]);
  });

  it("maps full-match RESULT_AND_BTTS via 00-1j", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1j",
        name: "Mecz: wynik/obie drużyny strzelą gola",
        selections: [
          { name: "Remis/Nie", odds: 12 },
          { name: "Kolumbia/Tak", odds: 3.2 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("RESULT_AND_BTTS");
    expect(out?.selections.map((s) => s.code)).toEqual(["DRAW_NO", "AWAY_YES"]);
  });

  it("maps MULTI_RESULT space-separated score groups and the 'Remis' leg", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-28",
        name: "Mecz: multiwynik",
        selections: [
          { name: "1:0 2:0 3:0", odds: 5.4 },
          { name: "3:2 4:2 4:3 5:1", odds: 40 },
          { name: "Remis", odds: 2.75 },
        ],
      },
      ctxSUI
    );
    expect(out?.selections.map((s) => s.code)).toEqual([
      "1:0, 2:0 lub 3:0",
      "3:2, 4:2, 4:3 lub 5:1",
      "X",
    ]);
  });

  it("maps DOUBLE_CHANCE_BTTS '10/Tak' combos on the verified full-match ids", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-21",
        name: "Rynek ufo:mtyp:00-21",
        selections: [
          { name: "10/Tak", odds: 3.2 },
          { name: "02/Nie", odds: 2.4 },
          { name: "12/Tak", odds: 2.9 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("DOUBLE_CHANCE_BTTS");
    expect(out?.selections.map((s) => s.code)).toEqual(["1X_YES", "X2_NO", "12_YES"]);
  });

  it("excludes the half-scoped 00-1y variant from DOUBLE_CHANCE_BTTS", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-1y",
        name: "Rynek ufo:mtyp:00-1y",
        selections: [{ name: "10/Tak", odds: 6.6 }],
      },
      ctxSUI
    );
    expect(out).toBeNull();
  });

  it("maps TEAM_WIN_OR_* 'Tak (przynajmniej...)' selections to YES/NO", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-7e",
        name: "Kolumbia wygra / poniżej 2.5 goli",
        selections: [
          { name: "Tak (przynajmniej 1 warunek zostanie spełniony)", odds: 1.19 },
          { name: "Nie (oba warunki nie zostaną spełnione)", odds: 4.4 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("TEAM_WIN_OR_TOTAL_UNDER");
    expect(out?.selections.map((s) => s.code)).toEqual(["YES", "NO"]);
  });

  it("passes CORNERS_RANGE literal band codes through", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-0l",
        name: "Rynek ufo:mtyp:00-0l",
        selections: [
          { name: "0-8", odds: 2.07 },
          { name: "9-11", odds: 2.85 },
          { name: "12+", odds: 3.8 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("CORNERS_RANGE");
    expect(out?.selections.map((s) => s.code)).toEqual(["0-8", "9-11", "12+"]);
  });

  it("maps literal '1+' thresholds on single-line player prop markets", () => {
    const footGoal = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-ow",
        name: "Jashari, Ardon strzeli gola nogą (OPTA)",
        selections: [{ name: "1+", odds: 20 }],
      },
      ctxSUI
    );
    expect(footGoal?.marketCode).toBe("PLAYER_FOOT_GOAL");
    expect(footGoal?.paramValue).toBe("Ardon Jashari");
    expect(footGoal?.selections[0].code).toBe("1+");

    const offsides1h = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-pn",
        name: "Widmer, Silvan liczba spalonych w 1.połowie (OPTA)",
        selections: [{ name: "1+", odds: 13 }],
      },
      ctxSUI
    );
    expect(offsides1h?.marketCode).toBe("PLAYER_OFFSIDES_1H");
    expect(offsides1h?.paramValue).toBe("Silvan Widmer");
    expect(offsides1h?.selections[0].code).toBe("1+");
  });

  it("keeps distinct '1+'/'2+' tiers on PLAYER_SHOTS_IN_BOX with player param", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-oe",
        name: "Ditta, Willer liczba strzałów z pola karnego (OPTA)",
        selections: [
          { name: "1+", odds: 2.5 },
          { name: "2+", odds: 8.5 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("PLAYER_SHOTS_IN_BOX");
    expect(out?.paramValue).toBe("Willer Ditta");
    expect(out?.selections.map((s) => s.code)).toEqual(["1+", "2+"]);
  });

  it("uses the canonical player name as selection for goal-outside-box and offsides", () => {
    const outsideBox = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-oz",
        name: "Zakaria, Denis strzeli gola spoza pola karnego (OPTA)",
        selections: [{ name: "1+", odds: 50 }],
      },
      ctxSUI
    );
    expect(outsideBox?.marketCode).toBe("PLAYER_GOAL_OUTSIDE_BOX");
    expect(outsideBox?.selections[0].code).toBe("Denis Zakaria");

    const offsides = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-nw",
        name: "Machado, Deiver liczba spalonych (reg.czas) (OPTA)",
        selections: [{ name: "1+", odds: 3.2 }],
      },
      ctxSUI
    );
    expect(offsides?.marketCode).toBe("PLAYER_OFFSIDES");
    expect(offsides?.selections[0].code).toBe("Deiver Machado");
  });

  it("routes stat totals to their live-verified codes", () => {
    // 00-2i = "1.połowa: liczba goli", was wrongly merged into TOTAL_GOALS.
    const htGoals = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-2i",
        name: "1.połowa: liczba goli 1.5",
        selections: [
          { name: "więcej niż 1.5", odds: 2.2 },
          { name: "mniej niż 1.5", odds: 1.62 },
        ],
      },
      ctxSUI
    );
    expect(htGoals?.marketCode).toBe("HALF_TIME_TOTAL_GOALS");
    expect(htGoals?.paramValue).toBe("1.5");

    // 00-h7 = "Mecz: liczba strzałów w światło bramki", was CORNERS_TOTAL.
    const sot = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-h7",
        name: "Mecz: liczba strzałów w światło bramki 7.5 (OPTA)",
        selections: [
          { name: "Wiecej 7.5", odds: 1.3 },
          { name: "Mniej 7.5", odds: 3.1 },
        ],
      },
      ctxSUI
    );
    expect(sot?.marketCode).toBe("TOTAL_SHOTS_ON_TARGET");
    expect(sot?.paramValue).toBe("7.5");
    expect(sot?.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);

    // 00-kn = "Mecz: <team1> - liczba fauli", was CORNERS_TOTAL.
    const fouls = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-kn",
        name: "Mecz: Szwajcaria - liczba fauli (OPTA)",
        selections: [
          { name: "więcej niż 12.5", odds: 2.1 },
          { name: "mniej niż 12.5", odds: 1.65 },
        ],
      },
      ctxSUI
    );
    expect(fouls?.marketCode).toBe("HOME_TEAM_TOTAL_FOULS");
    expect(fouls?.paramValue).toBe("12.5");
  });

  it("flips side-directional team codes when the label names the other team", () => {
    // 00-kn is positionally the home team, but the label is authoritative.
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-kn",
        name: "Mecz: Kolumbia - liczba fauli (OPTA)",
        selections: [
          { name: "więcej niż 14.5", odds: 2.35 },
          { name: "mniej niż 14.5", odds: 1.5 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("AWAY_TEAM_TOTAL_FOULS");
  });

  it("encodes team corners/shots sides in the parameter", () => {
    const corners = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-0k",
        name: "Mecz: Kolumbia - liczba rzutów rożnych",
        selections: [
          { name: "Więcej niż 4.5", odds: 1.62 },
          { name: "Mniej niż 4.5", odds: 2.1 },
        ],
      },
      ctxSUI
    );
    expect(corners?.marketCode).toBe("CORNERS_TEAM");
    expect(corners?.paramValue).toBe("AWAY:4.5");
    expect(corners?.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);
  });

  it("maps CARDS_TEAM selections with the side prefix", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-l6",
        name: "Rynek ufo:mtyp:00-l6",
        selections: [
          { name: "mniej niż 1.5", odds: 1.55 },
          { name: "więcej niż 1.5", odds: 2.3 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("CARDS_TEAM");
    // Side-scoped param: home/away lines must not collide on the market key.
    expect(out?.paramValue).toBe("AWAY:1.5");
    expect(out?.selections.map((s) => s.code)).toEqual(["AWAY_UNDER", "AWAY_OVER"]);
  });

  it("routes 00-hu (więcej fauli) to FOUL_RACE, not MATCH_WINNER", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-hu",
        name: "Rynek ufo:mtyp:00-hu",
        selections: [
          { name: "Szwajcaria", odds: 2.35 },
          { name: "Rowno", odds: 12 },
          { name: "Kolumbia", odds: 1.68 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("FOUL_RACE");
    expect(out?.selections.map((s) => s.code)).toEqual(["HOME", "DRAW", "AWAY"]);
  });

  it("routes 00-3j to SECOND_HALF_CORRECT_SCORE and 00-6w to full CORRECT_SCORE", () => {
    const secondHalf = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-3j",
        name: "Dokładny wynik",
        selections: [
          { name: "0:0", odds: 3.3 },
          { name: "inny", odds: 14 },
        ],
      },
      ctxSUI
    );
    expect(secondHalf?.marketCode).toBe("SECOND_HALF_CORRECT_SCORE");
    expect(secondHalf?.selections.map((s) => s.code)).toEqual(["0-0", "inny"]);

    const full = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-6w",
        name: "Mecz: dokładny wynik",
        selections: [{ name: "0:0", odds: 12 }],
      },
      ctxSUI
    );
    expect(full?.marketCode).toBe("CORRECT_SCORE");
  });

  it("routes 00-ru (1.kwarta) to TIME_PERIOD_RESULT with the q1 param", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-ru",
        name: "1.kwarta (od 00:00 do 1.przerwy na nawodnienie)",
        selections: [
          { name: "Szwajcaria", odds: 4.7 },
          { name: "Remis", odds: 1.62 },
          { name: "Kolumbia", odds: 3.9 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("TIME_PERIOD_RESULT");
    expect(out?.paramValue).toBe("q1");
  });

  it("routes 00-o0 (pierwsza żółta kartka) to FIRST_CARD, not FIRST_TEAM_TO_SCORE", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-o0",
        name: "Mecz: pierwsza żółta kartka (reg.czas)(OPTA)",
        selections: [
          { name: "Szwajcaria", odds: 2.1 },
          { name: "Nikt", odds: 8.5 },
          { name: "Kolumbia", odds: 2 },
        ],
      },
      ctxSUI
    );
    expect(out?.marketCode).toBe("FIRST_CARD");
    expect(out?.selections.map((s) => s.code)).toEqual(["HOME", "NONE", "AWAY"]);
  });
});
