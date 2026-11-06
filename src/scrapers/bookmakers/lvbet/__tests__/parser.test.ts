import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseAllMarkets, parseExtendedMarkets } from "../parser.js";
import type { LVBetMarket } from "../types.js";

/**
 * These tests run the parser over a verbatim capture of the LVBet
 * client-api/v5 markets/search payload (Arsenal vs Hull City, 2026-11-06,
 * 39 raw markets in payload order). The real payload carries `market_id`,
 * `selection_id`, `markets_class_id` and a numeric `line`; the old synthetic
 * `{ id, line: "2.5" }` shape hid every mismatch between our types and the
 * API.
 */
const evidence = JSON.parse(
  readFileSync(new URL("./fixtures/markets-search-arsenal-hull-2026-11-06.json", import.meta.url), "utf8")
) as LVBetMarket[];
const teams = { homeTeam: "Arsenal", awayTeam: "Hull City" };

describe("LVBet parser - v5 payload shape", () => {
  it("keeps both same-named 'Arsenal - Dokładna liczba goli' variants (de-duplicates by market_id)", () => {
    const parsed = parseAllMarkets(evidence, teams).filter((m) => m.name === "Arsenal - Dokładna liczba goli");
    expect(parsed.map((m) => m.selections.map((s) => s.name))).toEqual([
      ["0 lub 1", "2 lub 3", "4 do 6", "7 lub więcej"],
      ["0", "1", "2", "3", "4+"],
    ]);
    expect(parsed[1].selections.map((s) => s.odds)).toEqual([7.25, 4.75, 3.4, 3.8, 3.1]);
  });

  it("keeps both 'Dokładna liczba goli' and both '1. Połowa - Arsenal dokładna liczba goli' variants", () => {
    const names = parseAllMarkets(evidence, teams).map((m) => m.name);
    expect(names.filter((n) => n === "Dokładna liczba goli")).toHaveLength(2);
    expect(names.filter((n) => n === "1. Połowa - Arsenal dokładna liczba goli")).toHaveLength(2);
  });

  it("carries markets_class_id as bookmakerMarketId and selection_id as externalId", () => {
    const ou = parseAllMarkets(evidence, teams).find((m) => m.name === "Liczba goli 2.5")!;
    expect(ou.bookmakerMarketId).toBe("3499");
    expect(ou.selections.map((s) => [s.name, s.odds, s.externalId])).toEqual([
      ["Powyżej (2.5)", 1.55, "bc:7392415565"],
      ["Poniżej (2.5)", 2.5, "bc:7392415566"],
    ]);
  });

  it("never emits the literal externalId 'undefined'", () => {
    for (const m of parseAllMarkets(evidence, teams)) for (const s of m.selections) expect(s.externalId).not.toBe("undefined");
  });

  it("parseExtendedMarkets accepts a numeric line", () => {
    const ext = parseExtendedMarkets(evidence);
    expect(ext.marketOverUnder?.["2.5"]).toMatchObject({ over: 1.55, under: 2.5 });
  });
});

describe("LVBet parser - 'Zawodnicy - statystyki' player ladders", () => {
  it("splits 'Strzały' (Zawodnicy - statystyki) into one market per player with 'Powyzej N-0.5' tiers", () => {
    const rows = parseAllMarkets(evidence, teams).filter((m) => m.name === "Strzały");
    const vg = rows.find((m) => m.paramValue === "Viktor Gyokeres")!;
    expect(vg.bookmakerMarketId).toBe("12238");
    expect(vg.selections.map((s) => [s.name, s.odds])).toEqual([
      ["Powyzej 2.5", 1.35], ["Powyzej 3.5", 1.88], ["Powyzej 4.5", 2.95], ["Powyzej 5.5", 5.2],
    ]);
    expect(rows.map((m) => m.paramValue).sort()).toEqual(["Abdulkadir Omur", "Ben White", "Tim Iroegbunam", "Viktor Gyokeres"]);
  });

  it("leaves unmapped ladder siblings unsplit", () => {
    const raw = parseAllMarkets(evidence, teams).filter((m) => m.name === "Podania celne");
    expect(raw).toHaveLength(1);
    expect(raw[0].paramValue).toBeUndefined();
  });

  it("carries each tier's selection_id as externalId", () => {
    const vg = parseAllMarkets(evidence, teams).find((m) => m.name === "Strzały" && m.paramValue === "Viktor Gyokeres")!;
    expect(vg.selections.map((s) => s.externalId)).toEqual(["bc:7444768935", "bc:7444768936", "bc:7444768937", "bc:7444768938"]);
  });

  it("leaves a ladder unsplit when a tier label is off the pattern or a player repeats a tier", () => {
    const ladder = evidence.find((m) => m.name === "Strzały")!;
    const offPattern: LVBetMarket = {
      ...ladder,
      market_id: "bc:off",
      selections: [
        { selection_id: "bc:1", name: "Ben White 1+", order: 0, rate: { decimal: 1.57 } },
        { selection_id: "bc:2", name: "Ben White", order: 1, rate: { decimal: 3.75 } },
      ],
    };
    const repeated: LVBetMarket = {
      ...ladder,
      market_id: "bc:rep",
      selections: [
        { selection_id: "bc:3", name: "Ben White 1+", order: 0, rate: { decimal: 1.57 } },
        { selection_id: "bc:4", name: "Ben White 1+", order: 1, rate: { decimal: 1.9 } },
      ],
    };
    for (const market of [offPattern, repeated]) {
      const rows = parseAllMarkets([market], teams);
      expect(rows).toHaveLength(1);
      expect(rows[0].paramValue).toBeUndefined();
    }
  });
});
