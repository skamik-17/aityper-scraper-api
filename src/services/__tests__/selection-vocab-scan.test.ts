import { describe, it, expect } from "vitest";
import {
  findIsolated,
  findPlayerAxisSplit,
  findMixedRangeVocabulary,
  findTopBucketMismatch,
  findOffCatalogSelections,
  findProductDivergence,
  isCumulativeRangeSet,
  isDisjointRangeSet,
  looksLikePlayerName,
} from "../../../scripts/selection-vocab-scan.js";

const ARGS = { bookDev: 0.25, minBooks: 3 } as Parameters<typeof findIsolated>[2];

function market(overrides: Record<string, unknown> = {}) {
  return {
    marketKey: "PLAYER_SHOTS",
    type: "PLAYER_SHOTS",
    category: "ZAWODNICY",
    label: "Strzały zawodnika",
    parameters: [],
    ...overrides,
  } as Parameters<typeof findIsolated>[0];
}

function param(value: string, quotes: Array<[string, string, number]>) {
  const byBookmaker = new Map<
    string,
    { bookmaker: string; selections: { type: string; odds: number }[] }
  >();
  for (const [bookmaker, type, odds] of quotes) {
    const entry = byBookmaker.get(bookmaker) ?? { bookmaker, selections: [] };
    entry.selections.push({ type, odds });
    byBookmaker.set(bookmaker, entry);
  }
  return { value, label: value, bookmakers: [...byBookmaker.values()] };
}

describe("looksLikePlayerName", () => {
  it("recognises a player row that leaked into the selection axis", () => {
    expect(looksLikePlayerName("Bukayo Saka")).toBe(true);
    expect(looksLikePlayerName("V. Gyokeres")).toBe(true);
    expect(looksLikePlayerName("Gabriel Martinelli")).toBe(true);
  });

  it("leaves outcome codes alone", () => {
    expect(looksLikePlayerName("OVER")).toBe(false);
    expect(looksLikePlayerName("HOME_YES")).toBe(false);
    expect(looksLikePlayerName("PLAYER_NAME")).toBe(false);
    expect(looksLikePlayerName("1+")).toBe(false);
    expect(looksLikePlayerName("0-1")).toBe(false);
    expect(looksLikePlayerName("2:1")).toBe(false);
  });
});

describe("findIsolated", () => {
  // betcris and lvbet published one undifferentiated OVER per player while the
  // rest published the real 1+/2+/3+ ladder.
  it("names a bookmaker whose rows can never line up with the field", () => {
    const m = market({
      parameters: [
        param("Bukayo Saka", [
          ["sts", "1+", 1.5],
          ["etoto", "1+", 1.52],
          ["forbet", "1+", 1.48],
          ["betcris", "OVER", 1.51],
        ]),
      ],
    });
    const findings = findIsolated(m, "ZAWODNICY/PLAYER_SHOTS", ARGS);
    expect(findings).toHaveLength(1);
    expect(findings[0].bookmaker).toBe("betcris");
    expect(findings[0].severity).toBe("BROKEN");
  });

  it("stays quiet when everybody speaks the same vocabulary", () => {
    const m = market({
      parameters: [
        param("Bukayo Saka", [
          ["sts", "1+", 1.5],
          ["etoto", "1+", 1.52],
          ["forbet", "1+", 1.48],
        ]),
      ],
    });
    expect(findIsolated(m, "ZAWODNICY/PLAYER_SHOTS", ARGS)).toHaveLength(0);
  });

  it("does not judge a market thinner than --min-books", () => {
    const m = market({
      parameters: [
        param("Bukayo Saka", [
          ["sts", "1+", 1.5],
          ["betcris", "OVER", 1.51],
        ]),
      ],
    });
    expect(findIsolated(m, "ZAWODNICY/PLAYER_SHOTS", ARGS)).toHaveLength(0);
  });
});

describe("findPlayerAxisSplit", () => {
  // fortuna publishes the player as the selection; everybody else keeps the
  // player in the parameter and says PLAYER.
  it("flags a market where the player sits on two different axes", () => {
    const m = market({
      marketKey: "GOALSCORER_FIRST",
      parameters: [
        param("Bukayo Saka", [
          ["sts", "PLAYER", 5.0],
          ["betcris", "PLAYER", 5.5],
        ]),
        param("base", [["fortuna", "Bukayo Saka", 5.25]]),
      ],
    });
    const findings = findPlayerAxisSplit(m, "ZAWODNICY/GOALSCORER_FIRST");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("BROKEN");
    expect(findings[0].bookmaker).toBe("fortuna");
  });

  it("accepts a market where every bookmaker uses the name axis", () => {
    const m = market({
      marketKey: "PLAYER_GOAL_AND_ASSIST",
      parameters: [
        param("base", [
          ["fortuna", "Bukayo Saka", 12],
          ["betcris", "Bukayo Saka", 13],
        ]),
      ],
    });
    expect(findPlayerAxisSplit(m, "ZAWODNICY/PLAYER_GOAL_AND_ASSIST")).toHaveLength(0);
  });
});

describe("range vocabulary", () => {
  it("tells a cumulative ladder from a partition", () => {
    expect(isCumulativeRangeSet(["1-2", "1-3", "1-4"])).toBe(true);
    expect(isCumulativeRangeSet(["0-1", "2-3", "4-6"])).toBe(false);
    expect(isDisjointRangeSet(["0-1", "2-3", "4-6"])).toBe(true);
    expect(isDisjointRangeSet(["1-2", "1-3", "1-4"])).toBe(false);
  });

  it("flags a code that carries both kinds at once", () => {
    const m = market({
      marketKey: "GOAL_RANGE",
      parameters: [
        param("base", [
          ["sts", "1-2", 2.1],
          ["sts", "1-3", 1.5],
          ["sts", "1-4", 1.2],
          ["fuksiarz", "0-1", 3.2],
          ["fuksiarz", "2-3", 2.1],
          ["fuksiarz", "4-6", 4.5],
        ]),
      ],
    });
    const findings = findMixedRangeVocabulary(m, "GOLE/GOAL_RANGE");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("BROKEN");
  });

  it("stays quiet when every bookmaker uses the same kind", () => {
    const m = market({
      marketKey: "GOAL_RANGE",
      parameters: [
        param("base", [
          ["sts", "0-1", 3.2],
          ["sts", "2-3", 2.1],
          ["fuksiarz", "0-1", 3.3],
          ["fuksiarz", "2-3", 2.05],
        ]),
      ],
    });
    expect(findMixedRangeVocabulary(m, "GOLE/GOAL_RANGE")).toHaveLength(0);
  });
});

describe("findTopBucketMismatch", () => {
  it("flags exactly-N standing next to N-or-more", () => {
    const m = market({
      marketKey: "HOME_EXACT_GOALS",
      parameters: [
        param("base", [
          ["sts", "0", 5],
          ["sts", "1", 3],
          ["sts", "2", 4],
          ["sts", "3+", 6],
          ["lvbet", "0", 5.1],
          ["lvbet", "1", 3.1],
          ["lvbet", "2", 4.1],
          ["lvbet", "3", 9],
        ]),
      ],
    });
    const findings = findTopBucketMismatch(m, "GOLE/HOME_EXACT_GOALS");
    expect(findings).toHaveLength(1);
    expect(findings[0].bookmaker).toBe("lvbet");
  });

  it("accepts a market where the top bucket agrees", () => {
    const m = market({
      marketKey: "HOME_EXACT_GOALS",
      parameters: [
        param("base", [
          ["sts", "0", 5],
          ["sts", "3+", 6],
          ["lvbet", "0", 5.1],
          ["lvbet", "3+", 6.1],
        ]),
      ],
    });
    expect(findTopBucketMismatch(m, "GOLE/HOME_EXACT_GOALS")).toHaveLength(0);
  });
});

describe("findOffCatalogSelections", () => {
  it("names the bookmaker emitting a selection the catalog does not declare", () => {
    const m = market({
      parameters: [
        param("base", [
          ["sts", "OVER", 1.9],
          ["fuksiarz", "0-1", 3.2],
        ]),
      ],
    });
    const findings = findOffCatalogSelections(m, "GOLE/HOME_TEAM_TOTAL_GOALS", ["OVER", "UNDER"], undefined);
    expect(findings).toHaveLength(1);
    expect(findings[0].bookmaker).toBe("fuksiarz");
  });

  it("blames the catalog, not one bookmaker, when nobody matches it", () => {
    const m = market({
      parameters: [
        param("base", [
          ["sts", "1st", 2.1],
          ["lvbet", "1st", 2.15],
        ]),
      ],
    });
    const findings = findOffCatalogSelections(m, "GOLE/HALF_WITH_MORE_GOALS", ["FIRST", "SECOND"], undefined);
    expect(findings).toHaveLength(1);
    expect(findings[0].bookmaker).toBeNull();
    expect(findings[0].severity).toBe("MAJOR");
  });

  it("is a no-op for a market with an open selection list", () => {
    const m = market({ parameters: [param("base", [["sts", "WHATEVER", 2]])] });
    expect(findOffCatalogSelections(m, "INNE/OTHER", [], undefined)).toHaveLength(0);
    expect(findOffCatalogSelections(m, "INNE/OTHER", undefined, undefined)).toHaveLength(0);
  });
});

describe("findProductDivergence", () => {
  // pzbuk's "player (or his substitute) scores" sat in GOALSCORER_ANYTIME: the
  // labels matched, the book sum did not.
  it("flags a bookmaker pricing a likelier event under the same labels", () => {
    const players = ["A", "B", "C", "D", "E"];
    const m = market({
      marketKey: "GOALSCORER_ANYTIME",
      parameters: players.map((p, i) =>
        param(p, [
          ["sts", "PLAYER", 3 + i],
          ["betcris", "PLAYER", 3 + i],
          ["etoto", "PLAYER", 3 + i],
          ["pzbuk", "PLAYER", (3 + i) / 1.7],
        ]),
      ),
    });
    const findings = findProductDivergence(m, "ZAWODNICY/GOALSCORER_ANYTIME", ARGS);
    expect(findings).toHaveLength(1);
    expect(findings[0].bookmaker).toBe("pzbuk");
    expect(findings[0].severity).toBe("BROKEN");
  });

  it("accepts ordinary margin differences", () => {
    const players = ["A", "B", "C", "D", "E"];
    const m = market({
      marketKey: "GOALSCORER_ANYTIME",
      parameters: players.map((p, i) =>
        param(p, [
          ["sts", "PLAYER", 3 + i],
          ["betcris", "PLAYER", (3 + i) * 1.04],
          ["etoto", "PLAYER", (3 + i) * 0.97],
          ["pzbuk", "PLAYER", (3 + i) * 1.02],
        ]),
      ),
    });
    expect(findProductDivergence(m, "ZAWODNICY/GOALSCORER_ANYTIME", ARGS)).toHaveLength(0);
  });

  it("refuses to judge on fewer than four shared cells", () => {
    const m = market({
      marketKey: "GOALSCORER_ANYTIME",
      parameters: ["A", "B"].map((p) =>
        param(p, [
          ["sts", "PLAYER", 4],
          ["betcris", "PLAYER", 4],
          ["pzbuk", "PLAYER", 1.5],
        ]),
      ),
    });
    expect(findProductDivergence(m, "ZAWODNICY/GOALSCORER_ANYTIME", ARGS)).toHaveLength(0);
  });
});
