import { describe, it, expect, vi } from "vitest";
import { parseAllMarkets, parseTierLabel } from "../parser.js";
import type { SwarmGame } from "../types.js";
import { loadFixture } from "./helpers/fake-swarm-page.js";
import { TEAM_TIER_LADDER_TYPES, PLAYER_TIER_LADDER_TYPES, PLAYER_TIER_LIST_TYPES } from "../constants.js";
import { betcrisNormalizer } from "../../../../services/normalization/bookmakers/betcris-normalizer.js";
import type { NormalizedMarketOutput, RawBookmakerMarket } from "../../../../services/normalization/types.js";

// Everton - Coventry City (31321159), trimmed to the renamed Swarm stats-family
// tier-ladder markets plus a few untouched neighbours. Events are unmodified.
const game = loadFixture<{ game: SwarmGame }>("match-31321159-stat-ladders.json").game;
const out = parseAllMarkets(game);
const byType = (t: string) => out.filter((m) => m.bookmakerMarketId === t);
// Leeds - Tottenham (31333513) on match day, trimmed to its two team shot
// ladders. ShotsTeam2Total appeared only once the match-day offer opened.
const matchDay = loadFixture<{ game: SwarmGame }>("match-31333513-shots-team-ladders.json").game;
const matchDayOut = parseAllMarkets(matchDay);

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

  it("betcris parser: splits the match-day ShotsTeam2Total 12+..18+ into OVER rungs 11.5..17.5", () => {
    const away = matchDayOut.filter((m) => m.bookmakerMarketId === "ShotsTeam2Total");
    expect(away.map((m) => [m.paramValue, m.selections.map((s) => s.name), m.selections[0].odds]))
      .toEqual([["11.5", ["Powyżej"], 1.38], ["12.5", ["Powyżej"], 1.56], ["13.5", ["Powyżej"], 1.79], ["14.5", ["Powyżej"], 2.11],
        ["15.5", ["Powyżej"], 2.55], ["16.5", ["Powyżej"], 3.15], ["17.5", ["Powyżej"], 3.95]]);
    expect(away[0].name).toBe("Strzały. Team 2. Suma.");
    // 7 home + 7 away rungs, and no residual entry without a line
    expect(matchDayOut).toHaveLength(14);
    expect(matchDayOut.filter((m) => m.paramValue === undefined)).toEqual([]);
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

const norm = (m: RawBookmakerMarket) =>
  betcrisNormalizer.normalizeMarket(m, { homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league", leagueName: "premier-league" });
// The Task 3 parser entry for one ladder id and line/player (undefined = the woodwork list).
const pick = (type: string, param?: string) => {
  const m = out.find((x) => x.bookmakerMarketId === type && x.paramValue === param);
  if (!m) throw new Error(`no parser entry ${type} ${param}`);
  return m;
};
const view = (o: NormalizedMarketOutput | null) => o && { key: o.marketKey, sel: o.selections.map((s) => [s.code, s.odds]) };
// A parser residual: same id and name as a real entry, but no paramValue.
const residualOf = (type: string, param: string, selections: RawBookmakerMarket["selections"]) => {
  const { paramValue: _param, ...rest } = pick(type, param);
  return { ...rest, selections };
};

describe("betcris normalizer: tier ladders", () => {
  it("betcris normalizer: team ladders land on existing O/U codes with side-scoped params", () => {
    expect(view(norm(pick("FoulsTotal", "21.5")))).toEqual({ key: "FOULS_TOTAL:21.5", sel: [["OVER", 1.46]] });
    expect(view(norm(pick("FoulsTeam1Total", "9.5")))).toEqual({ key: "HOME_TEAM_TOTAL_FOULS:9.5", sel: [["OVER", 1.35]] });
    expect(view(norm(pick("ShotsTeam1Total", "14.5")))).toEqual({ key: "TEAM_TOTAL_SHOTS:HOME:14.5", sel: [["OVER", 1.39]] });
    expect(view(norm(pick("ShotsonTargetTeam2Total", "2.5")))).toEqual({ key: "TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:2.5", sel: [["OVER", 1.38]] });
    expect(view(norm(pick("OffsidesTeam1Total", "1.5")))).toEqual({ key: "HOME_TEAM_TOTAL_OFFSIDES:1.5", sel: [["OVER", 1.24]] });
    expect(view(norm(pick("ShotsonTarget1stHalfTotal", "2.5")))).toEqual({ key: "HALF_TIME_TOTAL_SHOTS_ON_TARGET:2.5", sel: [["OVER", 1.2]] });
    expect(view(norm(pick("ThrowInsTotal", "39.5")))).toEqual({ key: "THROW_INS_TOTAL:39.5", sel: [["OVER", 1.76]] });
    // A residual (non-tier event, no line) must not publish as a lineless FOULS_TOTAL row.
    expect(norm(residualOf("FoulsTotal", "21.5", [{ name: "Tak", odds: 1.9 }]))).toBeNull();
  });

  it("betcris normalizer: new FoulsTotal rung equals the August FoulsOver/Under shape", () => {
    const rung = pick("FoulsTotal", "21.5");
    const { debug: _a, ...fresh } = norm(rung)!;
    const { debug: _b, ...old } = norm({ ...rung, bookmakerMarketId: "FoulsOver/Under" })!;
    expect(fresh).toEqual(old);
  });

  it("betcris normalizer: match-day ShotsTeam2Total lands on TEAM_TOTAL_SHOTS with the AWAY scope", () => {
    const normLT = (m: RawBookmakerMarket) =>
      betcrisNormalizer.normalizeMarket(m, { homeTeam: "Leeds", awayTeam: "Tottenham", league: "premier-league", leagueName: "premier-league" });
    const rung = (type: string, line: string) => {
      const m = matchDayOut.find((x) => x.bookmakerMarketId === type && x.paramValue === line);
      if (!m) throw new Error(`no parser entry ${type} ${line}`);
      return m;
    };
    expect(view(normLT(rung("ShotsTeam2Total", "11.5")))).toEqual({ key: "TEAM_TOTAL_SHOTS:AWAY:11.5", sel: [["OVER", 1.38]] });
    expect(view(normLT(rung("ShotsTeam2Total", "17.5")))).toEqual({ key: "TEAM_TOTAL_SHOTS:AWAY:17.5", sel: [["OVER", 3.95]] });
    // Same line, other side: the home ladder keeps its own HOME-scoped key and price.
    expect(view(normLT(rung("ShotsTeam1Total", "11.5")))).toEqual({ key: "TEAM_TOTAL_SHOTS:HOME:11.5", sel: [["OVER", 1.47]] });
    // Byte-identical to the August "Shots:Team2Total" path on the same rung.
    const { debug: _a, ...fresh } = normLT(rung("ShotsTeam2Total", "11.5"))!;
    const { debug: _b, ...old } = normLT({ ...rung("ShotsTeam2Total", "11.5"), bookmakerMarketId: "Shots:Team2Total" })!;
    expect(fresh).toEqual(old);
    // A residual (no line) must not publish as a lineless TEAM_TOTAL_SHOTS row.
    const { paramValue: _p, ...lineless } = rung("ShotsTeam2Total", "11.5");
    expect(normLT({ ...lineless, selections: [{ name: "12+", odds: 1.38 }] })).toBeNull();
  });

  it("betcris normalizer: every id the parser splits as a ladder has a catalog code", () => {
    const shaped = (id: string): RawBookmakerMarket =>
      TEAM_TIER_LADDER_TYPES.has(id)
        ? { bookmakerMarketId: id, name: id, paramValue: "1.5", selections: [{ name: "Powyżej", odds: 2 }] }
        : PLAYER_TIER_LADDER_TYPES.has(id)
          ? { bookmakerMarketId: id, name: id, paramValue: "Jan Kowalski", selections: [{ name: "1+", odds: 2 }] }
          : { bookmakerMarketId: id, name: id, selections: [{ name: "Jan Kowalski", odds: 2 }] };
    const ids = [...TEAM_TIER_LADDER_TYPES, ...PLAYER_TIER_LADDER_TYPES, ...PLAYER_TIER_LIST_TYPES];
    expect(ids).toHaveLength(26); // 15 team + 10 player + 1 list
    expect(ids.filter((id) => norm(shaped(id)) === null)).toEqual([]);
  });

  it("betcris normalizer: player ladders key by canonical player and keep N+ tiers", () => {
    expect(view(norm(pick("PlayerShots", "Ainsley Maitland-Niles")))).toEqual({ key: "PLAYER_SHOTS:Ainsley Maitland-Niles", sel: [["1+", 1.46], ["2+", 3.1], ["3+", 7.8], ["4+", 19]] });
    expect(view(norm(pick("PlayerFouls", "Victor Torp Overgaard")))).toEqual({ key: "PLAYER_FOULS:Victor Torp", sel: [["1+", 1.17], ["2+", 1.74], ["3+", 3.3], ["4+", 7.2]] });
    expect(view(norm(pick("PlayerSaves", "Carl Rushworth")))).toEqual({ key: "PLAYER_SAVES:Carl Rushworth", sel: [["3+", 1.35], ["4+", 1.85], ["5+", 2.9], ["6+", 5]] });
    expect(view(norm(pick("PlayerAssists", "Kiernan Dewsbury-Hall")))).toEqual({ key: "PLAYER_ASSISTS:Kiernan Dewsbury-Hall", sel: [["1+", 3.7]] });
    expect(view(norm(pick("PlayerTackles", "Ainsley Maitland-Niles")))).toEqual({ key: "PLAYER_TACKLES:Ainsley Maitland-Niles", sel: [["2+", 1.48], ["3+", 2.43], ["4+", 4.75], ["5+", 10]] });
    expect(view(norm(pick("PlayerShotsonTargetOutsidetheBox", "Kiernan Dewsbury-Hall")))).toEqual({ key: "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX:Kiernan Dewsbury-Hall", sel: [["1+", 2.85], ["2+", 11], ["3+", 23]] });
    expect(view(norm(pick("PlayerOffsides", "Thierno Barry")))).toEqual({ key: "PLAYER_OFFSIDES:Thierno Barry", sel: [["1+", 1.53], ["2+", 3.5], ["3+", 9.5]] });
    // A residual (bare tier without a player, or a numeric param) must not publish as a playerless row.
    expect(norm(residualOf("PlayerShots", "Ainsley Maitland-Niles", [{ name: "2+", odds: 3.1 }]))).toBeNull();
    expect(norm({ ...pick("PlayerShots", "Ainsley Maitland-Niles"), paramValue: "2.5" })).toBeNull();
  });

  it("betcris normalizer: drops tiers the catalog does not declare", () => {
    expect(view(norm(pick("PlayerFouls", "Caleb Yirenkyi")))!.sel).toEqual([["2+", 1.4], ["3+", 2.2], ["4+", 4.2]]); // raw 5+ 8.6 dropped
    expect(norm({ ...pick("PlayerFouls", "Caleb Yirenkyi"), selections: [{ name: "5+", odds: 8.6 }] })).toBeNull();
    expect(view(norm(pick("PlayerHeadedShotsonTarget", "Thierno Barry"))))
      .toEqual({ key: "PLAYER_HEADER_SHOTS_ON_TARGET:Thierno Barry", sel: [["1+", 2.05], ["2+", 6.2], ["3+", 15]] }); // raw 4+ 31 dropped (catalog 1+..3+)
    expect(norm({ ...pick("PlayerAssists", "Kiernan Dewsbury-Hall"), selections: [{ name: "3+", odds: 41 }] })).toBeNull(); // catalog [YES, NO, 1+, 2+]
  });

  it("betcris normalizer: woodwork list keeps the August PLAYER_HIT_WOODWORK shape", () => {
    const o = norm(pick("PlayerShotsAgainstWoodwork"))!;
    expect(o.marketKey).toBe("PLAYER_HIT_WOODWORK");
    expect(o.selections).toHaveLength(33);
    expect(o.selections).toContainEqual(expect.objectContaining({ code: "Victor Torp", odds: 19 }));
    // a parser residual such as "Thierno Barry 2+" is not a player name: dropped, never treated as 1+
    expect(norm({ ...pick("PlayerShotsAgainstWoodwork"), selections: [{ name: "Thierno Barry 2+", odds: 41 }] })).toBeNull();
    // nor is a non-tier residual label that resolves to an outcome code ("Tak" -> YES)
    expect(norm({ ...pick("PlayerShotsAgainstWoodwork"), selections: [{ name: "Tak", odds: 2.5 }] })).toBeNull();
  });

  it("betcris normalizer: all 372 ladder-fixture entries normalize except one excluded and two unmapped types", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const outs = parseAllMarkets(game).map((m) => [m.bookmakerMarketId, norm(m)] as const);
      expect(outs).toHaveLength(372);
      expect(outs.filter(([, o]) => o === null).map(([id]) => id).sort())
        .toEqual(["ExactNumberOfGoals", "PlayerShotsOutsidetheBox", "ShotsonTarget2ndHalfTotal"]);
      // ExactNumberOfGoals is excluded on purpose (betcris-normalizer.ts BETCRIS_EXCLUDED_MARKET_IDS); the two
      // unmapped ids are the only "Unknown market" warnings
      expect(warn.mock.calls.map(([msg]) => String(msg).match(/type: (\S+?),/)?.[1]).sort())
        .toEqual(["PlayerShotsOutsidetheBox", "ShotsonTarget2ndHalfTotal"]);
    } finally {
      warn.mockRestore();
    }
  });
});
