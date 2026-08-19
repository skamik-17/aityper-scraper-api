import { describe, it, expect } from "vitest";
import { reconcilePlayerNameVariants } from "../market-type-grouper.js";

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
});
