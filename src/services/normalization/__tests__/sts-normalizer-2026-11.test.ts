import { describe, it, expect } from "vitest";
import { stsNormalizer } from "../bookmakers/sts-normalizer.js";
import type { NormalizationContext, RawBookmakerMarket } from "../types.js";

// Every value below comes from the Arsenal vs Hull City snapshot f2921898
// (2026-11), handcrafted in the raw shape the STS parser emits: string market
// ids, O/U names suffixed with their line, folded "Zawodnik - <event>"
// dropdowns, and nameless outcome 26 already named "Tak".
const ctx: NormalizationContext = {
  homeTeam: "Arsenal",
  awayTeam: "Hull City",
  league: "premier-league",
};

interface Row {
  id: number;
  name: string;
  sels: Array<[string, number]>;
  code: string;
  key: string;
  expected: string[];
  matchedBy?: "id" | "name";
}

const CROOKS_SHOTS: Array<[string, number]> = [["1+", 1.55], ["2+", 4.25], ["3+", 15], ["4+", 35]];
const CROOKS_SHOTS_ON_TARGET: Array<[string, number]> = [["1+", 4.25], ["2+", 20], ["3+", 60]];
const CROOKS_ASSISTS: Array<[string, number]> = [["1+", 17.5]];

const newIdRows: Row[] = [
  {
    id: 2003,
    name: "Crooks Matt - strzały",
    sels: CROOKS_SHOTS,
    code: "PLAYER_SHOTS",
    key: "PLAYER_SHOTS:Matt Crooks",
    expected: ["1+@1.55", "2+@4.25", "3+@15", "4+@35"],
  },
  {
    id: 2008,
    name: "Crooks Matt - celne strzały",
    sels: CROOKS_SHOTS_ON_TARGET,
    code: "PLAYER_SHOTS_ON_TARGET",
    key: "PLAYER_SHOTS_ON_TARGET:Matt Crooks",
    expected: ["1+@4.25", "2+@20", "3+@60"],
  },
  {
    id: 2146,
    name: "Crooks Matt - asysty",
    sels: CROOKS_ASSISTS,
    code: "PLAYER_ASSISTS",
    key: "PLAYER_ASSISTS:Matt Crooks",
    expected: ["1+@17.5"],
  },
  {
    id: 2435,
    name: "Zawodnik - strzeli gola",
    sels: [["Crooks Matt", 10], ["Madueke Noni", 3]],
    code: "GOALSCORER_ANYTIME",
    key: "GOALSCORER_ANYTIME",
    expected: ["Matt Crooks@10", "Noni Madueke@3"],
  },
  {
    id: 2012,
    name: "Zawodnik - otrzyma kartkę",
    sels: [["Crooks Matt", 2.5]],
    code: "PLAYER_CARDS",
    key: "PLAYER_CARDS",
    expected: ["Matt Crooks@2.5"],
  },
  {
    id: 2436,
    name: "Zawodnik - gol lub asysta",
    sels: [["Crooks Matt", 6.5]],
    code: "PLAYER_GOAL_OR_ASSIST",
    key: "PLAYER_GOAL_OR_ASSIST",
    expected: ["Matt Crooks@6.5"],
  },
  {
    // "Butland Jack" is the known Firstname-Lastname flip (STS sends
    // "Jack Butland"), pinned on purpose until the owner decides on it.
    id: 2291,
    name: "Zawodnik - otrzyma 1. kartkę",
    sels: [["Egan John", 12.5], ["White Ben", 35], ["Jack Butland", 30]],
    code: "FIRST_PLAYER_CARDED",
    key: "FIRST_PLAYER_CARDED",
    expected: ["John Egan@12.5", "Ben White@35", "Butland Jack@30"],
  },
  {
    id: 2153,
    name: "Crooks Matt - otrzyma czerwoną kartkę|Crooks Matt",
    sels: [["Tak", 20]],
    code: "PLAYER_RED_CARD",
    key: "PLAYER_RED_CARD:Matt Crooks",
    expected: ["YES@20"],
  },
  {
    id: 188,
    name: "1. drużyna - liczba kartek 1.5",
    sels: [["+1.5", 3.4], ["-1.5", 1.28]],
    code: "CARDS_TEAM",
    key: "CARDS_TEAM:1.5",
    expected: ["HOME_OVER@3.4", "HOME_UNDER@1.28"],
  },
  {
    id: 191,
    name: "2. drużyna - liczba kartek 2.5",
    sels: [["+2.5", 2.55], ["-2.5", 1.45]],
    code: "CARDS_TEAM",
    key: "CARDS_TEAM:2.5",
    expected: ["AWAY_OVER@2.55", "AWAY_UNDER@1.45"],
  },
  {
    id: 231,
    name: "1. drużyna - liczba rzutów rożnych 8.5",
    sels: [["+8.5", 2.7], ["-8.5", 1.4]],
    code: "CORNERS_TEAM",
    key: "CORNERS_TEAM:HOME:8.5",
    expected: ["OVER@2.7", "UNDER@1.4"],
  },
  {
    id: 234,
    name: "2. drużyna - liczba rzutów rożnych 2.5",
    sels: [["+2.5", 1.75], ["-2.5", 1.9]],
    code: "CORNERS_TEAM",
    key: "CORNERS_TEAM:AWAY:2.5",
    expected: ["OVER@1.75", "UNDER@1.9"],
  },
  {
    id: 1287,
    name: "Rzuty rożne - każda drużyna -  4 lub więcej",
    sels: [["Tak", 2.9]],
    code: "EACH_TEAM_TOTAL_CORNERS_OVER",
    key: "EACH_TEAM_TOTAL_CORNERS_OVER:3.5",
    expected: ["OVER@2.9"],
  },
  {
    id: 2287,
    name: "Kartki - każda drużyna - 2 lub więcej",
    sels: [["Tak", 5]],
    code: "EACH_TEAM_TOTAL_CARDS_OVER",
    key: "EACH_TEAM_TOTAL_CARDS_OVER:1.5",
    expected: ["OVER@5"],
  },
  {
    id: 185,
    name: "Liczba kartek 2.5",
    sels: [["+2.5", 1.6], ["-2.5", 2.2]],
    code: "CARDS_TOTAL",
    key: "CARDS_TOTAL:2.5",
    expected: ["OVER@1.6", "UNDER@2.2"],
  },
];

// Pre-renumbering ids: if STS sends them again they must normalize exactly
// as they did before the 2026-11 ids were added.
const oldIdRows: Row[] = [
  {
    id: 54,
    name: "Zawodnik - strzeli gola",
    sels: [["Crooks Matt", 10], ["Madueke Noni", 3]],
    code: "GOALSCORER_ANYTIME",
    key: "GOALSCORER_ANYTIME",
    expected: ["Matt Crooks@10", "Noni Madueke@3"],
  },
  {
    id: 1894,
    name: "Zawodnik - otrzyma kartkę",
    sels: [["Crooks Matt", 2.5]],
    code: "PLAYER_CARDS",
    key: "PLAYER_CARDS",
    expected: ["Matt Crooks@2.5"],
    matchedBy: "name",
  },
  {
    id: 1896,
    name: "Zawodnik - otrzyma czerwoną kartkę",
    sels: [["Crooks Matt", 20]],
    code: "PLAYER_RED_CARD",
    key: "PLAYER_RED_CARD",
    expected: ["Matt Crooks@20"],
  },
  {
    id: 1903,
    name: "Zawodnik - gol lub asysta",
    sels: [["Crooks Matt", 6.5]],
    code: "PLAYER_GOAL_OR_ASSIST",
    key: "PLAYER_GOAL_OR_ASSIST",
    expected: ["Matt Crooks@6.5"],
  },
  {
    id: 2394,
    name: "Crooks Matt - strzały",
    sels: CROOKS_SHOTS,
    code: "PLAYER_SHOTS",
    key: "PLAYER_SHOTS:Matt Crooks",
    expected: ["1+@1.55", "2+@4.25", "3+@15", "4+@35"],
  },
  {
    id: 2395,
    name: "Crooks Matt - celne strzały",
    sels: CROOKS_SHOTS_ON_TARGET,
    code: "PLAYER_SHOTS_ON_TARGET",
    key: "PLAYER_SHOTS_ON_TARGET:Matt Crooks",
    expected: ["1+@4.25", "2+@20", "3+@60"],
  },
  {
    id: 2397,
    name: "Crooks Matt - asysty",
    sels: CROOKS_ASSISTS,
    code: "PLAYER_ASSISTS",
    key: "PLAYER_ASSISTS:Matt Crooks",
    expected: ["1+@17.5"],
  },
];

function toRaw(id: number, name: string, sels: Array<[string, number]>): RawBookmakerMarket {
  return {
    bookmakerMarketId: String(id),
    name,
    selections: sels.map(([selName, odds]) => ({ name: selName, odds })),
  };
}

function assertRow(row: Row): void {
  const out = stsNormalizer.normalizeMarket(toRaw(row.id, row.name, row.sels), ctx);
  expect(out).not.toBeNull();
  expect(out!.marketCode).toBe(row.code);
  expect(out!.marketKey).toBe(row.key);
  expect(out!.selections.map((s) => `${s.code}@${s.odds}`)).toEqual(row.expected);
  expect(out!.debug?.matchedBy).toBe(row.matchedBy ?? "id");
}

describe("stsNormalizer 2026-11 renumbered ids and team cards/corners", () => {
  it.each(newIdRows)("new id $id: $name -> $key", (row) => {
    assertRow(row);
  });

  it.each(oldIdRows)("old id $id: $name -> $key", (row) => {
    assertRow(row);
  });

  it("never invents a team side when the name does not say 1./2. drużyna", () => {
    const cards = stsNormalizer.normalizeMarket(
      toRaw(188, "Liczba kartek drużyny 1.5", [["+1.5", 3.4], ["-1.5", 1.28]]),
      ctx,
    );
    const corners = stsNormalizer.normalizeMarket(
      toRaw(231, "Liczba rzutów rożnych drużyny 8.5", [["+8.5", 2.7], ["-8.5", 1.4]]),
      ctx,
    );
    expect(cards!.marketKey).toBe("CARDS_TEAM:1.5");
    expect(cards!.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);
    expect(corners!.marketKey).toBe("CORNERS_TEAM:8.5");
    expect(corners!.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);
  });
});
