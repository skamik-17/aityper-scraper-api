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
        bookmakerMarketId: "ufo:mtyp:00-0v",
        name: "Handicap azjatycki",
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
        bookmakerMarketId: "ufo:mtyp:00-0w",
        name: "Handicap europejski",
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
    expect(fouls?.paramValue).toBe("Zerrouki, Ramiz");
    expect(fouls?.selections.map((s) => s.code)).toEqual(["2+", "3+", "4+"]);

    const cards = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-lk",
        name: "Mwene, Philipp - otrzyma Żółtą Kartkę (OPTA)",
        selections: [{ name: "1+", odds: 5.5 }],
      },
      ctxDZA
    );
    expect(cards?.paramValue).toBe("Mwene, Philipp");
    expect(cards?.selections[0].code).toBe("YES");

    const assists = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-la",
        name: "Otamendi, Nicolas - asystuje (OPTA)",
        selections: [{ name: "1+", odds: 10 }],
      },
      ctxARG
    );
    expect(assists?.paramValue).toBe("Otamendi, Nicolas");
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
    expect(header?.selections[0].code).toBe("Chukwuemeka, Carney");

    const firstScorer = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-nf",
        name: "W.Ziel.Przyl. Cabral, Jovane strzeli pierwszego gola w meczu (OPTA)",
        selections: [{ name: "Tak", odds: 15 }],
      },
      ctxARG
    );
    expect(firstScorer?.selections[0].code).toBe("Cabral, Jovane");
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

  it("drops unmapped mtyp 00-61 instead of poisoning MATCH_WINNER", () => {
    const out = fortunaNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "ufo:mtyp:00-61",
        name: "Rynek ufo:mtyp:00-61",
        selections: [
          { name: "Argentyna", odds: 2.28 },
          { name: "Remis", odds: 3.85 },
          { name: "W.Ziel.Przyl.", odds: 2.55 },
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
        bookmakerMarketId: "ufo:mtyp:00-0v",
        name: "Handicap azjatycki",
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
        bookmakerMarketId: "ufo:mtyp:00-0w",
        name: "Handicap europejski",
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
        bookmakerMarketId: "ufo:mtyp:00-0v",
        name: "Handicap azjatycki",
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

  it("maps TOTAL_GOALS_MINIMUM thresholds to catalog codes without a param", () => {
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
    expect(out?.marketCode).toBe("TOTAL_GOALS_MINIMUM");
    expect(out?.paramValue).toBeUndefined();
    expect(out?.marketKey).toBe("TOTAL_GOALS_MINIMUM");
    expect(out?.selections.map((s) => s.code)).toEqual(["1+", "2+", "3+"]);
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

  it("drops unmapped mtyp 00-gg instead of poisoning MATCH_WINNER", () => {
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
    expect(out).toBeNull();
  });
});
