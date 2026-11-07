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
  ["Liczba spalonych w meczu - Arsenal (OPTA)", [["Powyżej 2,5", 1.85], ["Poniżej 2,5", 1.62]], "HOME_TEAM_TOTAL_OFFSIDES", "HOME_TEAM_TOTAL_OFFSIDES:2.5", ["OVER", "UNDER"]],
  ["Liczba spalonych w meczu - Hull (OPTA)", [["Powyżej 0,5", 1.32], ["Poniżej 0,5", 2.55]], "AWAY_TEAM_TOTAL_OFFSIDES", "AWAY_TEAM_TOTAL_OFFSIDES:0.5", ["OVER", "UNDER"]],
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

    const offsides = betclicNormalizer.normalizeMarket({ name: "Liczba spalonych w meczu - Manchester United (OPTA)", selections: ou("1,5") }, derby);
    expect(offsides?.marketCode).toBe("OTHER");
    expect(offsides?.marketKey).toBe("OTHER");

    const homeFouls = betclicNormalizer.normalizeMarket({ name: "Liczba fauli (OPTA) - Newcastle (z dogrywką)", selections: ou("10,5") }, derby);
    expect(homeFouls?.marketCode).toBe("HOME_TEAM_TOTAL_FOULS");
    expect(homeFouls?.marketKey).toBe("HOME_TEAM_TOTAL_FOULS:10.5");
    expect(homeFouls?.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);

    const homeOffsides = betclicNormalizer.normalizeMarket({ name: "Liczba spalonych w meczu - Newcastle (OPTA)", selections: ou("1,5") }, derby);
    expect(homeOffsides?.marketCode).toBe("HOME_TEAM_TOTAL_OFFSIDES");
    expect(homeOffsides?.marketKey).toBe("HOME_TEAM_TOTAL_OFFSIDES:1.5");
    expect(homeOffsides?.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);
  });
});
