import { describe, it, expect } from "vitest";
import { parseAllMarkets, parseTierLabel } from "../parser.js";
import type { SwarmGame } from "../types.js";
import { loadFixture } from "./helpers/fake-swarm-page.js";

// Everton - Coventry City (31321159), trimmed to the renamed Swarm stats-family
// tier-ladder markets plus a few untouched neighbours. Events are unmodified.
const game = loadFixture<{ game: SwarmGame }>("match-31321159-stat-ladders.json").game;
const out = parseAllMarkets(game);
const byType = (t: string) => out.filter((m) => m.bookmakerMarketId === t);

describe("betcris parser: tier ladders", () => {
  it("betcris parser: parseTierLabel reads team and player tiers", () => {
    expect(parseTierLabel("22+")).toEqual({ subject: null, tier: 22 });
    expect(parseTierLabel(" Ainsley Maitland-Niles  2+ ")).toEqual({ subject: "Ainsley Maitland-Niles", tier: 2 });
    expect(parseTierLabel("Tak")).toBeNull();
    expect(parseTierLabel("Powyżej 2.5")).toBeNull();
  });

  it("betcris parser: splits FoulsTotal 22+..26+ into OVER rungs 21.5..25.5", () => {
    expect(byType("FoulsTotal").map((m) => [m.paramValue, m.selections[0].name, m.selections[0].odds]))
      .toEqual([["21.5", "Powyżej", 1.46], ["22.5", "Powyżej", 1.64], ["23.5", "Powyżej", 1.9], ["24.5", "Powyżej", 2.24], ["25.5", "Powyżej", 2.7]]);
    expect(byType("ShotsTeam1Total").map((m) => m.paramValue)).toEqual(["14.5", "15.5", "16.5", "17.5", "18.5", "19.5", "20.5"]);
    expect(byType("ThrowInsTotal").map((m) => [m.paramValue, m.selections[0].odds])).toEqual([["39.5", 1.76], ["40.5", 1.94], ["41.5", 2.15]]);
  });

  it("betcris parser: splits PlayerShots into one entry per player with N+ selections", () => {
    const shots = byType("PlayerShots");
    expect(shots).toHaveLength(33);
    const amn = shots.find((m) => m.paramValue === "Ainsley Maitland-Niles")!;
    expect(amn.name).toBe("Zawodnik - strzały");
    expect(amn.selections.map((s) => [s.name, s.odds])).toEqual([["1+", 1.46], ["2+", 3.1], ["3+", 7.8], ["4+", 19]]);
    expect(byType("PlayerSaves").find((m) => m.paramValue === "Jordan Pickford")!.selections.map((s) => [s.name, s.odds]))
      .toEqual([["2+", 1.34], ["3+", 2.01], ["4+", 3.55], ["5+", 7.2]]);
  });

  it("betcris parser: splits PlayerHeadedShotsonTarget per player, keeping every raw tier", () => {
    const headed = byType("PlayerHeadedShotsonTarget");
    expect(headed).toHaveLength(33);
    expect(headed.find((m) => m.paramValue === "Thierno Barry")!.selections.map((s) => [s.name, s.odds]))
      .toEqual([["1+", 2.05], ["2+", 6.2], ["3+", 15], ["4+", 31]]); // the parser does not gate; Task 4 drops 4+
  });

  it("betcris parser: PlayerShotsAgainstWoodwork becomes one player-name list", () => {
    const [ww] = byType("PlayerShotsAgainstWoodwork");
    expect(byType("PlayerShotsAgainstWoodwork")).toHaveLength(1);
    expect(ww.selections).toHaveLength(33);
    expect(ww.selections).toContainEqual(expect.objectContaining({ name: "Thierno Barry", odds: 7.5 }));
  });

  it("betcris parser: a woodwork tier other than 1+ goes to the residual entry, never into the list", () => {
    const g = { ...game, market: { w: { id: 2, type: "PlayerShotsAgainstWoodwork", name: "Zawodnik - strzały w obramowanie bramki", order: 1, col_count: 1,
      event: { a: { id: 21, name: "Thierno Barry 1+", price: 7.5, order: 1 }, b: { id: 22, name: "Thierno Barry 2+", price: 41, order: 2 } } } } };
    expect(parseAllMarkets(g as any).map((m) => [m.paramValue, m.selections.map((s) => s.name)]))
      .toEqual([[undefined, ["Thierno Barry"]], [undefined, ["Thierno Barry 2+"]]]);
  });

  it("betcris parser: keeps non-tier events of a ladder market in one residual entry", () => {
    const g = { ...game, market: { m: { id: 1, type: "FoulsTotal", name: "Faule. Suma", order: 1, col_count: 1,
      event: { a: { id: 11, name: "22+", price: 1.46, order: 1, type_1: "22+" }, b: { id: 12, name: "Tak", price: 1.9, order: 2, type_1: "Tak" } } } } };
    const res = parseAllMarkets(g as any);
    expect(res.map((m) => [m.paramValue, m.selections.map((s) => s.name)])).toEqual([["21.5", ["Powyżej"]], [undefined, ["Tak"]]]);
  });

  it("betcris parser: total entry count on the 32-market ladder fixture", () => {
    expect(out).toHaveLength(372); // 67 team rungs + 297 player entries (264 + 33 headed) + 1 woodwork list + 7 untouched markets
    expect(byType("PlayerShotsOutsidetheBox")).toHaveLength(1); // not split: catalog PLAYER_SHOTS_OUTSIDE_BOX has hasParameter:false
  });
});
