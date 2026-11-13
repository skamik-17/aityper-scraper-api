import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

// Derby guard for side-coded markets. normalizeBetclic1x2Selection and
// normalizePenaltyGoalSelection test the home side first through a matcher
// that accepts one shared word, so in derbies such as Newcastle United v
// Manchester United both team legs come out on the home side in either leg
// order. Publishing such a set would show the away price on the HOME side, or
// store a second HOME row carrying it, so the market must fall back to OTHER.
const NEWCASTLE_MAN_UTD = { homeTeam: "Newcastle United", awayTeam: "Manchester United", league: "premier-league" };
const MANCHESTER_DERBY = { homeTeam: "Manchester United", awayTeam: "Manchester City", league: "premier-league" };
const NON_DERBY = { homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" };

type Ctx = typeof NON_DERBY;
type DerbyRow = [name: string, ctx: Ctx, legs: [string, number][]];

const PENALTY_LEGS = (home: string, away: string): [string, number][] => [
  [`${home} strzeli rzut karny`, 4.25],
  [`${away} strzeli rzut karny`, 5.5],
  ["Którakolwiek drużyna strzeli gola z rzutu karnego", 3.5],
  ["Żaden zespól nie strzeli rzutu karnego", 1.2],
];

const DERBY_ROWS: DerbyRow[] = [
  ["Wynik meczu", NEWCASTLE_MAN_UTD, [["Newcastle", 2.6], ["Remis", 3.4], ["Manchester United", 2.7]]],
  ["Wynik meczu", NEWCASTLE_MAN_UTD, [["Manchester United", 2.7], ["Remis", 3.4], ["Newcastle", 2.6]]],
  ["Wynik meczu (z wyłączeniem dogrywki)", MANCHESTER_DERBY, [["Manchester United", 3.1], ["Remis", 3.6], ["Manchester City", 2.2]]],
  ["Faule 1X2 (OPTA)", NEWCASTLE_MAN_UTD, [["Newcastle", 1.9], ["Remis", 9], ["Manchester United", 2]]],
  ["Faule 1X2 (OPTA)", NEWCASTLE_MAN_UTD, [["Manchester United", 2], ["Remis", 9], ["Newcastle", 1.9]]],
  ["Gol z rzutu karnego", NEWCASTLE_MAN_UTD, PENALTY_LEGS("Newcastle", "Manchester United")],
  ["Gol z rzutu karnego", NEWCASTLE_MAN_UTD, PENALTY_LEGS("Manchester United", "Newcastle")],
  ["Gol z rzutu karnego- 1. połowa", NEWCASTLE_MAN_UTD, PENALTY_LEGS("Newcastle", "Manchester United").slice(0, 3)],
  ["Gol z rzutu karnego- 2. połowa", NEWCASTLE_MAN_UTD, PENALTY_LEGS("Manchester United", "Newcastle").slice(0, 3)],
  ["1. połowa wynik", NEWCASTLE_MAN_UTD, [["Newcastle", 3.3], ["Remis", 2.1], ["Manchester United", 3.4]]],
  ["2. połowa wynik", NEWCASTLE_MAN_UTD, [["Newcastle", 3.1], ["Remis", 2.4], ["Manchester United", 3.2]]],
  ["Remis bez zakładu", NEWCASTLE_MAN_UTD, [["Newcastle", 1.9], ["Manchester United", 1.95]]],
  ["1X2 Strzały (120 min)", NEWCASTLE_MAN_UTD, [["Newcastle", 1.8], ["Remis", 12], ["Manchester United", 2.1]]],
  ["Strzały celne - 1X2 (OPTA)", NEWCASTLE_MAN_UTD, [["Newcastle", 1.9], ["Remis", 8], ["Manchester United", 2.1]]],
  ["Więcej kartek", NEWCASTLE_MAN_UTD, [["Newcastle", 2.2], ["Remis", 5], ["Manchester United", 2.1]]],
  ["Więcej rzutów rożnych", NEWCASTLE_MAN_UTD, [["Newcastle", 1.9], ["Remis", 9], ["Manchester United", 2.2]]],
  ["Przewaga dwoma bramkami lub wygrana w meczu (reg. czas)", NEWCASTLE_MAN_UTD, [["Newcastle", 2.4], ["Manchester United", 2.5]]],
];

describe("betclic side-coded markets in shared-word derbies", () => {
  it.each(DERBY_ROWS)("keeps %s OTHER in derby #%#", (name, ctx, legs) => {
    const out = betclicNormalizer.normalizeMarket({ name, selections: legs.map(([n, odds]) => ({ name: n, odds })) }, ctx);
    expect(out?.marketCode).toBe("OTHER");
    expect(out?.marketKey).toBe("OTHER");
    expect(out?.paramValue).toBeUndefined();
    expect(out?.selections.map((s) => [s.code, s.label, s.odds])).toEqual(legs.map(([n, odds]) => [n.trim(), n, odds]));
  });

  // Non-derby offers must still publish, in either leg order.
  type PublishRow = [name: string, marketCode: string, legs: [label: string, odds: number, code: string][]];
  const PUBLISH_ROWS: PublishRow[] = [
    ["Wynik meczu", "MATCH_WINNER", [["Arsenal", 1.25, "HOME"], ["Remis", 6, "DRAW"], ["Hull", 11, "AWAY"]]],
    ["Wynik meczu", "MATCH_WINNER", [["Hull", 11, "AWAY"], ["Remis", 6, "DRAW"], ["Arsenal", 1.25, "HOME"]]],
    ["Faule 1X2 (OPTA)", "FOUL_RACE", [["Arsenal", 2.3, "HOME"], ["Remis", 9, "DRAW"], ["Hull", 1.6, "AWAY"]]],
    ["Gol z rzutu karnego", "PENALTY_GOAL", [["Arsenal strzeli rzut karny", 4.25, "TEAM_HOME"], ["Hull strzeli rzut karny", 14, "TEAM_AWAY"], ["Którakolwiek drużyna strzeli gola z rzutu karnego", 3.5, "ANY"], ["Żaden zespól nie strzeli rzutu karnego", 1.2, "NONE"]]],
    ["Gol z rzutu karnego- 1. połowa", "HALF_TIME_PENALTY_GOAL", [["Hull strzeli rzut karny", 25, "TEAM_AWAY"], ["Arsenal strzeli rzut karny", 7.5, "TEAM_HOME"], ["Którakolwiek drużyna strzeli gola z rzutu karnego", 5.75, "ANY"]]],
    ["Remis bez zakładu", "DRAW_NO_BET", [["Arsenal", 1.08, "HOME"], ["Hull", 7.5, "AWAY"]]],
    ["Przewaga dwoma bramkami lub wygrana w meczu (reg. czas)", "WIN_OR_WIN_BY_2", [["Arsenal", 1.2, "HOME"], ["Hull", 5.2, "AWAY"]]],
  ];
  it.each(PUBLISH_ROWS)("still publishes %s outside derbies (%s) #%#", (name, marketCode, legs) => {
    const out = betclicNormalizer.normalizeMarket({ name, selections: legs.map(([n, odds]) => ({ name: n, odds })) }, NON_DERBY);
    expect(out?.marketCode).toBe(marketCode);
    expect(out?.marketKey).toBe(marketCode);
    expect(out?.selections.map((s) => [s.label, s.odds, s.code])).toEqual(legs);
  });

  // A derby whose legs still resolve to distinct sides publishes: the guard
  // only drops a set that repeats a side.
  it("still publishes FIRST_OFFSIDE in a derby when the full names resolve to distinct sides", () => {
    const out = betclicNormalizer.normalizeMarket(
      { name: "Pierwsza drużyna, która zostanie złapana na pozycji spalonej w meczu", selections: [{ name: "Manchester United", odds: 1.7 }, { name: "Newcastle United", odds: 2.1 }] },
      NEWCASTLE_MAN_UTD,
    );
    expect(out?.marketCode).toBe("FIRST_OFFSIDE");
    expect(out?.selections.map((s) => [s.code, s.odds])).toEqual([["AWAY", 1.7], ["HOME", 2.1]]);
  });
});
