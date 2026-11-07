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

describe("reconcilePlayerNameVariants - stranded abbreviated rows (2026-11)", () => {
  it("folds an initial when peers disagree only on hyphen and case", () => {
    const alias = reconcilePlayerNameVariants(names([
      ["J. van Hecke", ["fuksiarz"]],
      ["Jan Paul van Hecke", ["betcris", "fortuna", "lvbet"]],
      ["Jan-Paul van Hecke", ["betfan", "etoto", "superbet"]],
    ]));
    expect(alias.get("J. van Hecke")).toBe("Jan Paul van Hecke");
    expect(alias.get("Jan-Paul van Hecke")).toBe("Jan Paul van Hecke");
  });
  it("merges a hyphenated and a spaced double surname", () => {
    const alias = reconcilePlayerNameVariants(names([["Jens Hjerto-Dahl", ["betfan", "sts"]], ["Jens Hjerto Dahl", ["fortuna"]]]));
    expect(alias.get("Jens Hjerto Dahl")).toBe("Jens Hjerto-Dahl");
  });
  it("does not let a hyphen create a new surname match", () => {
    const alias = reconcilePlayerNameVariants(names([["D. Lewin", ["fuksiarz"]], ["Dominic Calvert-Lewin", ["betfan"]]]));
    expect(alias.size).toBe(0);
  });
  it("ignores LVBet combo params when clustering", () => {
    const alias = reconcilePlayerNameVariants(names([
      ["D. Calvert-Lewin", ["fuksiarz"]],
      ["Dominic Calvert-Lewin", ["betcris", "betfan", "forbet", "fortuna", "lvbet", "superbet"]],
      ["Dominic Solanke or Dominic Calvert-Lewin", ["lvbet"]],
      ["Omar Marmoush or Dominic Calvert-Lewin", ["lvbet"]],
      ["Dominic Calvert-Lewin or Harry Wilson", ["lvbet"]],
    ]));
    expect(alias.get("D. Calvert-Lewin")).toBe("Dominic Calvert-Lewin");
    expect(alias.has("Dominic Solanke or Dominic Calvert-Lewin")).toBe(false);
  });
  it("never folds a combo into a single player", () => {
    // lvbet quotes "Jayden Bogle" @4.75 and "Jayden Bogle or Mohammed Kudus" @2.0.
    const alias = reconcilePlayerNameVariants(names([
      ["Jayden Bogle", ["betcris", "lvbet"]], ["J. Bogle", ["fuksiarz"]], ["Jayden Bogle or Mohammed Kudus", ["lvbet"]],
    ]));
    expect(alias.has("Jayden Bogle or Mohammed Kudus")).toBe(false);
    expect(alias.get("J. Bogle")).toBe("Jayden Bogle");
  });
  it("folds an initial out of a non-clique cluster when its full-name candidates agree", () => {
    // Lee-Tot PLAYER_RED_CARD: fortuna's sentence param fits "Jan Paul van Hecke" but not "J. van Hecke".
    const alias = reconcilePlayerNameVariants(names([
      ["J. van Hecke", ["fuksiarz"]],
      ["Jan Paul van Hecke", ["betcris", "lvbet"]],
      ["Jan-Paul van Hecke", ["betfan", "superbet"]],
      ["Jan Paul van Hecke wyrzucony z boiska", ["fortuna"]],
    ]));
    expect(alias.get("J. van Hecke")).toBe("Jan Paul van Hecke");
  });
  it("keeps folding Fortuna's red-card sentence into the player (guard)", () => {
    const alias = reconcilePlayerNameVariants(names([
      ["Bruno Guimaraes", ["betfan", "superbet"]], ["Bruno Guimaraes wyrzucony z boiska", ["fortuna"]],
    ]));
    expect(alias.get("Bruno Guimaraes wyrzucony z boiska")).toBe("Bruno Guimaraes");
  });
  it("leaves an initial alone when its candidates are different first names (guard)", () => {
    // Tim / Timothy: needs a nickname table, out of scope.
    const alias = reconcilePlayerNameVariants(names([
      ["T. Iroegbunam", ["fuksiarz"]], ["Tim Iroegbunam", ["betfan"]], ["Timothy Iroegbunam", ["betcris", "lvbet"]],
    ]));
    expect(alias.size).toBe(0);
  });
});

describe("reconcilePlayerNameVariants - hyphen spellings merged in step 1 (2026-11 review)", () => {
  it("folds an initial that fits only the hyphenated spelling the spaced one absorbed", () => {
    // Ars-Hul PLAYER_ASSISTS: the spaced spelling wins step 1 on token count,
    // and "J. Hjerto-Dahl" fits only the hyphenated spelling it absorbed.
    const alias = reconcilePlayerNameVariants(names([
      ["J. Hjerto-Dahl", ["fuksiarz"]], ["Jens Hjerto-Dahl", ["betfan"]], ["Jens Hjerto Dahl", ["fortuna"]],
    ]));
    expect(alias.get("Jens Hjerto-Dahl")).toBe("Jens Hjerto Dahl");
    expect(alias.get("J. Hjerto-Dahl")).toBe("Jens Hjerto Dahl");
    expect(alias.has("Jens Hjerto Dahl")).toBe(false);
  });
  it("folds a spaced initial spelling into a hyphenated step-1 winner", () => {
    const alias = reconcilePlayerNameVariants(names([
      ["J. Hjerto Dahl", ["fuksiarz"]], ["Jens Hjerto-Dahl", ["betfan", "sts"]], ["Jens Hjerto Dahl", ["fortuna"]],
    ]));
    expect(alias.get("Jens Hjerto Dahl")).toBe("Jens Hjerto-Dahl");
    expect(alias.get("J. Hjerto Dahl")).toBe("Jens Hjerto-Dahl");
  });
  it("puts the three Hjerto-Dahl spellings in one grouped row", () => {
    const mk = (paramValue: string, odds: number): ScrapedMarket => ({
      name: "Asysta", type: "PLAYER_ASSISTS", normalizedType: "PLAYER_ASSISTS",
      marketKey: `PLAYER_ASSISTS:${paramValue}`, paramValue,
      selections: [{ name: "1+", normalizedName: "1+", odds }],
    }) as ScrapedMarket;
    const out = groupMarketsByTypeWithParameters([
      { market: mk("J. Hjerto-Dahl", 11), bookmaker: "fuksiarz" },
      { market: mk("Jens Hjerto-Dahl", 12.5), bookmaker: "betfan" },
      { market: mk("Jens Hjerto Dahl", 10), bookmaker: "fortuna" },
    ]);
    const market = out.find((m) => m.type === "PLAYER_ASSISTS")!;
    expect(market.parameters.map((p) => p.value)).toEqual(["Jens Hjerto Dahl"]);
    expect(market.parameters[0].bookmakers.map((b) => b.bookmaker).sort()).toEqual(["betfan", "fortuna", "fuksiarz"]);
  });
  it("does not match an initial through a reversed-order step-1 spelling (guard)", () => {
    // STS sends "Surname Firstname". Its reversed tokens [justin, james] would
    // let a different player's "J. James" fit "James Justin" by surname.
    const alias = reconcilePlayerNameVariants(names([
      ["J. James", ["fuksiarz"]], ["James Justin", ["betfan"]], ["Justin James", ["sts"]],
    ]));
    expect(alias.get("Justin James")).toBe("James Justin");
    expect(alias.has("J. James")).toBe(false);
  });
});
