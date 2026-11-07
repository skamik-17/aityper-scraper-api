import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

const ctx = { homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" };
type Row = [name: string, selections: [string, number][], marketCode: string, marketKey: string, codes: string[]];
const ROWS: Row[] = [
  ["Gol z rzutu karnego", [["Arsenal strzeli rzut karny", 4.25], ["Hull strzeli rzut karny", 14], ["Którakolwiek drużyna strzeli gola z rzutu karnego", 3.5], ["Żaden zespól nie strzeli rzutu karnego", 1.2]], "PENALTY_GOAL", "PENALTY_GOAL", ["TEAM_HOME", "TEAM_AWAY", "ANY", "NONE"]],
  ["Gol z rzutu karnego- 1. połowa", [["Arsenal strzeli rzut karny", 7.5], ["Hull strzeli rzut karny", 25], ["Którakolwiek drużyna strzeli gola z rzutu karnego", 5.75]], "HALF_TIME_PENALTY_GOAL", "HALF_TIME_PENALTY_GOAL", ["TEAM_HOME", "TEAM_AWAY", "ANY"]],
  ["Gol z rzutu karnego- 2. połowa", [["Arsenal strzeli rzut karny", 6.25], ["Hull strzeli rzut karny", 20], ["Którakolwiek drużyna strzeli gola z rzutu karnego", 5]], "SECOND_HALF_PENALTY_GOAL", "SECOND_HALF_PENALTY_GOAL", ["TEAM_HOME", "TEAM_AWAY", "ANY"]],
  // WC label regression guard (golden #139)
  ["Gol z rzutu karnego", [["Którykolwiek zawodnik strzeli rzut karny", 3.4]], "PENALTY_GOAL", "PENALTY_GOAL", ["ANY"]],
  ["Liczba spalonych w meczu (OPTA)", [["Powyżej 3,5", 1.7], ["Poniżej 3,5", 1.78]], "OFFSIDES_TOTAL", "OFFSIDES_TOTAL:3.5", ["OVER", "UNDER"]],
  ["Liczba spalonych w meczu -\u00a0Arsenal (OPTA)", [["Powyżej 2,5", 1.85], ["Poniżej 2,5", 1.62]], "HOME_TEAM_TOTAL_OFFSIDES", "HOME_TEAM_TOTAL_OFFSIDES:2.5", ["OVER", "UNDER"]],
  ["Liczba spalonych w meczu -\u00a0Hull (OPTA)", [["Powyżej 0,5", 1.32], ["Poniżej 0,5", 2.55]], "AWAY_TEAM_TOTAL_OFFSIDES", "AWAY_TEAM_TOTAL_OFFSIDES:0.5", ["OVER", "UNDER"]],
  ["Spalone 1X2 (OPTA) (z dogrywką)", [["Arsenal", 1.32], ["Remis ", 5], ["Hull", 5]], "OFFSIDES_1X2", "OFFSIDES_1X2", ["HOME", "DRAW", "AWAY"]],
  ["Liczba fauli w meczu (OPTA) (z dogrywką)", [["Powyżej 21,5", 1.75], ["Poniżej 21,5", 1.75]], "FOULS_TOTAL", "FOULS_TOTAL:21.5", ["OVER", "UNDER"]],
  ["Liczba fauli (OPTA) - Arsenal (z dogrywką)", [["Powyżej 8,5", 1.7], ["Poniżej 8,5", 1.78]], "HOME_TEAM_TOTAL_FOULS", "HOME_TEAM_TOTAL_FOULS:8.5", ["OVER", "UNDER"]],
  ["Liczba fauli (OPTA) - Hull (z dogrywką)", [["Powyżej 12,5", 1.7], ["Poniżej 12,5", 1.78]], "AWAY_TEAM_TOTAL_FOULS", "AWAY_TEAM_TOTAL_FOULS:12.5", ["OVER", "UNDER"]],
  ["Pierwsza drużyna, która zostanie złapana na pozycji spalonej w meczu", [["Arsenal", 1.3], ["Hull", 2.9]], "FIRST_OFFSIDE", "FIRST_OFFSIDE", ["HOME", "AWAY"]],
  // synthetic third leg: "Nikt" was only seen on the sibling foul market (150); pins the NONE mapping
  ["Pierwsza drużyna, która zostanie złapana na pozycji spalonej w meczu", [["Arsenal", 1.3], ["Hull", 2.9], ["Nikt", 150]], "FIRST_OFFSIDE", "FIRST_OFFSIDE", ["HOME", "AWAY", "NONE"]],
  // no catalog code (open question 1): stays OTHER with raw labels as codes, like WC golden #263
  ["Pierwsza drużyna, która popełni faul", [["Arsenal", 2.15], ["Nikt", 150], ["Hull", 1.45]], "OTHER", "OTHER", ["Arsenal", "Nikt", "Hull"]],
];

describe("betclic OPTA offsides/fouls and penalty ANY", () => {
  it.each(ROWS)("betclic OPTA/penalty #%#: %s", (name, sels, marketCode, marketKey, codes) => {
    const out = betclicNormalizer.normalizeMarket({ name, selections: sels.map(([n, odds]) => ({ name: n, odds })) }, ctx);
    expect(out?.marketCode).toBe(marketCode);
    expect(out?.marketKey).toBe(marketKey);
    expect(out?.selections.map((s) => s.code)).toEqual(codes);
  });

  // Derby guard: "Manchester United" shares "united" with "Newcastle United", so
  // the team matcher reports both sides. A team line whose side is ambiguous
  // stays OTHER instead of being published under a guessed side.
  it("keeps team OPTA lines OTHER when the label matches both sides", () => {
    const derby = { homeTeam: "Newcastle United", awayTeam: "Manchester United", league: "premier-league" };
    const ou = (line: string): { name: string; odds: number }[] => [
      { name: `Powyżej ${line}`, odds: 1.8 },
      { name: `Poniżej ${line}`, odds: 1.9 },
    ];

    const fouls = betclicNormalizer.normalizeMarket({ name: "Liczba fauli (OPTA) - Manchester United (z dogrywką)", selections: ou("11,5") }, derby);
    expect(fouls?.marketCode).toBe("OTHER");
    expect(fouls?.marketKey).toBe("OTHER");

    const offsides = betclicNormalizer.normalizeMarket({ name: "Liczba spalonych w meczu -\u00a0Manchester United (OPTA)", selections: ou("1,5") }, derby);
    expect(offsides?.marketCode).toBe("OTHER");
    expect(offsides?.marketKey).toBe("OTHER");

    const homeFouls = betclicNormalizer.normalizeMarket({ name: "Liczba fauli (OPTA) - Newcastle (z dogrywką)", selections: ou("10,5") }, derby);
    expect(homeFouls?.marketCode).toBe("HOME_TEAM_TOTAL_FOULS");
    expect(homeFouls?.marketKey).toBe("HOME_TEAM_TOTAL_FOULS:10.5");
    expect(homeFouls?.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);

    const homeOffsides = betclicNormalizer.normalizeMarket({ name: "Liczba spalonych w meczu -\u00a0Newcastle (OPTA)", selections: ou("1,5") }, derby);
    expect(homeOffsides?.marketCode).toBe("HOME_TEAM_TOTAL_OFFSIDES");
    expect(homeOffsides?.marketKey).toBe("HOME_TEAM_TOTAL_OFFSIDES:1.5");
    expect(homeOffsides?.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);
  });

  // Derby guard for the 3-way offsides market: the shared 1X2 leg matcher
  // accepts one shared word, so in these derbies both team legs come out HOME
  // in either leg order. The market must stay OTHER rather than publish the
  // away price on the HOME side (or a second HOME row carrying it).
  type DerbyRow = [home: string, away: string, legs: [string, number][]];
  const DERBY_ROWS: DerbyRow[] = [
    ["Newcastle United", "Manchester United", [["Manchester United", 2], ["Remis", 3], ["Newcastle", 4]]],
    ["Newcastle United", "Manchester United", [["Newcastle", 2], ["Remis", 3], ["Manchester United", 4]]],
    ["Newcastle United", "Manchester United", [["Manchester United", 2], ["Newcastle", 3], ["Remis", 4]]],
    ["Manchester United", "Manchester City", [["Manchester United", 2], ["Remis", 3], ["Manchester City", 4]]],
  ];
  it.each(DERBY_ROWS)("keeps Spalone 1X2 OTHER in derby #%#: %s v %s", (homeTeam, awayTeam, legs) => {
    const derby = { homeTeam, awayTeam, league: "premier-league" };
    for (const name of ["Spalone 1X2 (OPTA) (z dogrywką)", "Spalone 1X2 (OPTA)"]) {
      const out = betclicNormalizer.normalizeMarket({ name, selections: legs.map(([n, odds]) => ({ name: n, odds })) }, derby);
      expect(out?.marketCode).toBe("OTHER");
      expect(out?.marketKey).toBe("OTHER");
      expect(out?.selections.map((s) => s.code)).toEqual(legs.map(([n]) => n));
      expect(out?.selections.map((s) => s.odds)).toEqual(legs.map(([, odds]) => odds));
    }
  });

  // FIRST_OFFSIDE has no distinct-sides guard of its own: it stays correct in
  // derbies only because normalizeFirstCardSelection tests the full home and
  // away names before the shared 1X2 fallback. These rows pin that order with
  // full, short and abbreviated labels in both leg orders; routing the market
  // through the one-shared-word 1X2 matcher would put both team legs on HOME.
  type FirstOffsideRow = [home: string, away: string, legs: [string, number, string][]];
  const FIRST_OFFSIDE_DERBY_ROWS: FirstOffsideRow[] = [
    ["Newcastle United", "Manchester United", [["Newcastle United", 2.1, "HOME"], ["Manchester United", 1.7, "AWAY"]]],
    ["Newcastle United", "Manchester United", [["Manchester United", 1.7, "AWAY"], ["Newcastle United", 2.1, "HOME"]]],
    ["Newcastle United", "Manchester United", [["Man Utd", 1.7, "AWAY"], ["Newcastle", 2.1, "HOME"], ["Nikt", 150, "NONE"]]],
    ["Manchester United", "Manchester City", [["Manchester City", 1.6, "AWAY"], ["Manchester United", 2.3, "HOME"]]],
    ["Hull City", "Manchester City", [["Manchester City", 1.5, "AWAY"], ["Hull", 2.5, "HOME"]]],
  ];
  it.each(FIRST_OFFSIDE_DERBY_ROWS)("codes FIRST_OFFSIDE legs by side in derby #%#: %s v %s", (homeTeam, awayTeam, legs) => {
    const out = betclicNormalizer.normalizeMarket(
      { name: "Pierwsza drużyna, która zostanie złapana na pozycji spalonej w meczu", selections: legs.map(([name, odds]) => ({ name, odds })) },
      { homeTeam, awayTeam, league: "premier-league" },
    );
    expect(out?.marketCode).toBe("FIRST_OFFSIDE");
    expect(out?.marketKey).toBe("FIRST_OFFSIDE");
    expect(out?.selections.map((s) => [s.label, s.code, s.odds])).toEqual(legs.map(([name, odds, code]) => [name, code, odds]));
  });

  // Leg order is not fixed on Betclic (the evidence lists "Odbiory 1X2" away
  // first), so an unambiguous away-first offer must still publish.
  it("still codes an away-first Spalone 1X2 offer when the sides are distinct", () => {
    const out = betclicNormalizer.normalizeMarket(
      { name: "Spalone 1X2 (OPTA) (z dogrywką)", selections: [{ name: "Hull", odds: 5 }, { name: "Arsenal", odds: 1.32 }, { name: "Remis ", odds: 5 }] },
      ctx,
    );
    expect(out?.marketCode).toBe("OFFSIDES_1X2");
    expect(out?.marketKey).toBe("OFFSIDES_1X2");
    expect(out?.selections.map((s) => [s.code, s.odds])).toEqual([["AWAY", 5], ["HOME", 1.32], ["DRAW", 5]]);
  });
});
