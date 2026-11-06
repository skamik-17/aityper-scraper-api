import { describe, it, expect } from "vitest";
import { groupMarketsByTypeWithParameters, reconcilePlayerNameVariants } from "../market-type-grouper.js";
import type { ScrapedMarket } from "../../types/full-offer.js";

/**
 * Cases taken verbatim from the /audit-match run on premier-league
 * Arsenal vs Coventry City (2026-08-19), where each pair rendered as two
 * separate rows of the same player dropdown with the odds split between them.
 */
function names(entries: Array<[string, string[]]>): Map<string, Set<string>> {
  return new Map(entries.map(([name, bms]) => [name, new Set(bms)]));
}

describe("reconcilePlayerNameVariants", () => {
  it("folds a reversed name order into the majority spelling", () => {
    const alias = reconcilePlayerNameVariants(
      names([
        ["Aurele Amenda", ["betcris", "lvbet", "forbet", "fortuna"]],
        ["Amenda Aurele", ["sts"]],
      ]),
    );
    expect(alias.get("Amenda Aurele")).toBe("Aurele Amenda");
    expect(alias.has("Aurele Amenda")).toBe(false);
  });

  it("folds an abbreviated first name into the full one", () => {
    const alias = reconcilePlayerNameVariants(
      names([
        ["Matt Grimes", ["betcris", "lvbet"]],
        ["M Grimes", ["fuksiarz"]],
      ]),
    );
    expect(alias.get("M Grimes")).toBe("Matt Grimes");
  });

  it("folds a dropped second surname into the full name", () => {
    const alias = reconcilePlayerNameVariants(
      names([
        ["Victor Torp", ["betfan", "superbet"]],
        ["Victor Torp Overgaard", ["betcris", "lvbet"]],
      ]),
    );
    expect(alias.get("Victor Torp")).toBe("Victor Torp Overgaard");
  });

  it("folds a dropped middle name into the full name", () => {
    const alias = reconcilePlayerNameVariants(
      names([
        ["Caleb Yirenkyi", ["betcris"]],
        ["Caleb Marfo Yirenkyi", ["sts"]],
      ]),
    );
    expect(alias.get("Caleb Yirenkyi")).toBe("Caleb Marfo Yirenkyi");
  });

  it("leaves an ambiguous prefix alone rather than guessing", () => {
    // "Gabriel" could be either player — folding it would invent odds.
    const alias = reconcilePlayerNameVariants(
      names([
        ["Gabriel", ["betfan"]],
        ["Gabriel Jesus", ["betcris"]],
        ["Gabriel Magalhaes", ["lvbet"]],
      ]),
    );
    expect(alias.has("Gabriel")).toBe(false);
  });

  it("keeps genuinely different players apart", () => {
    const alias = reconcilePlayerNameVariants(
      names([
        ["Ben White", ["betcris", "sts"]],
        ["Bukayo Saka", ["betcris", "sts"]],
        ["Declan Rice", ["betcris"]],
      ]),
    );
    expect(alias.size).toBe(0);
  });

  it("chains through an intermediate spelling", () => {
    // fuksiarz abbreviates AND sts adds a middle name, so neither variant
    // matches the other directly — both must land on the same row.
    const alias = reconcilePlayerNameVariants(
      names([
        ["C Marfo Yirenkyi", ["fuksiarz"]],
        ["Caleb Yirenkyi", ["betcris", "lvbet"]],
      ]),
    );
    expect(alias.get("C Marfo Yirenkyi")).toBe("Caleb Yirenkyi");
  });

  it("collapses a three-way variant cluster onto one row", () => {
    const alias = reconcilePlayerNameVariants(
      names([
        ["V Torp", ["fuksiarz"]],
        ["Victor Torp", ["betfan", "superbet"]],
        ["Victor Torp Overgaard", ["betcris", "lvbet"]],
      ]),
    );
    expect(alias.get("V Torp")).toBe("Victor Torp Overgaard");
    expect(alias.get("Victor Torp")).toBe("Victor Torp Overgaard");
  });

  it("refuses to bridge two players through a shared abbreviation", () => {
    // "J Silva" fits both, but "Joao Silva" and "Jorge Silva" do not fit each
    // other — merging the cluster would invent one player out of two.
    const alias = reconcilePlayerNameVariants(
      names([
        ["J Silva", ["fuksiarz"]],
        ["Joao Silva", ["betcris", "lvbet"]],
        ["Jorge Silva", ["sts", "betfan"]],
      ]),
    );
    expect(alias.size).toBe(0);
  });

  it("is a no-op below two names", () => {
    expect(reconcilePlayerNameVariants(names([["Ben White", ["sts"]]])).size).toBe(0);
    expect(reconcilePlayerNameVariants(new Map()).size).toBe(0);
  });

  it("prefers a spelled-out first name over an initial on a bookmaker-count tie", () => {
    const alias = reconcilePlayerNameVariants(names([["O. Zambrano", ["fuksiarz"]], ["Oscar Zambrano", ["superbet"]]]));
    expect(alias.get("O. Zambrano")).toBe("Oscar Zambrano");
    expect(alias.has("Oscar Zambrano")).toBe(false);
  });

  it("prefers the spelled-out first name even when the initial spelling has more bookmakers", () => {
    const alias = reconcilePlayerNameVariants(names([["M. Salmon", ["fuksiarz", "lvbet"]], ["Marli Salmon", ["superbet"]]]));
    expect(alias.get("M. Salmon")).toBe("Marli Salmon");
  });

  it("prefers the spelled-out first name over a longer initial spelling with a middle name", () => {
    const alias = reconcilePlayerNameVariants(names([["M. Bachir Belloumi", ["fuksiarz"]], ["Mohamed Belloumi", ["superbet"]]]));
    expect(alias.get("M. Bachir Belloumi")).toBe("Mohamed Belloumi");
  });

  it("folds a trailing-initial and a leading-initial spelling into the full name", () => {
    const alias = reconcilePlayerNameVariants(names([
      ["Bachir Belloumi M.", ["sts"]], ["M. Bachir Belloumi", ["fuksiarz"]], ["Mohamed Belloumi", ["superbet"]],
    ]));
    expect(alias.get("Bachir Belloumi M.")).toBe("Mohamed Belloumi");
    expect(alias.get("M. Bachir Belloumi")).toBe("Mohamed Belloumi");
  });

  it("prefers a leading initial over STS's trailing initial", () => {
    // Guard: passes today (localeCompare tie) and must keep passing. A first-token-only
    // abbreviation check would make "Zambrano O." win.
    const alias = reconcilePlayerNameVariants(names([["Zambrano O.", ["sts"]], ["O. Zambrano", ["fuksiarz"]]]));
    expect(alias.get("Zambrano O.")).toBe("O. Zambrano");
  });

  it("merges an accented initial and full name under the accent-folded full name", () => {
    const mk = (paramValue: string, odds: number): ScrapedMarket => ({
      name: "Celne strzały", type: "PLAYER_SHOTS_ON_TARGET", normalizedType: "PLAYER_SHOTS_ON_TARGET",
      marketKey: `PLAYER_SHOTS_ON_TARGET:${paramValue}`, paramValue,
      selections: [{ name: "1+", normalizedName: "1+", odds }],
    }) as ScrapedMarket;
    const out = groupMarketsByTypeWithParameters([
      { market: mk("A. Ömür", 2.1), bookmaker: "fuksiarz" },
      { market: mk("Abdulkadir Ömür", 2.05), bookmaker: "superbet" },
    ]);
    const market = out.find((m) => m.type === "PLAYER_SHOTS_ON_TARGET")!;
    expect(market.parameters.map((p) => p.value)).toEqual(["Abdulkadir Omur"]);
    expect(market.parameters[0].bookmakers.map((b) => b.bookmaker).sort()).toEqual(["fuksiarz", "superbet"]);
  });
});
