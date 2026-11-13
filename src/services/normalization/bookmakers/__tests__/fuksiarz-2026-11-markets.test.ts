// Regression tests for the 2026-11 fuksiarz scraper recovery, Task 4
// (docs/superpowers/plans/2026-11-06-scraper-recovery/fuksiarz.md).
// The fixture is a trimmed Leeds v Tottenham event payload captured
// 2026-11-06: gameTypes -4895/-4896 (header shots on target, one raw market
// per player after parsing), -30640 (each team over X corners, 4 lines) and
// the single-selection special -30061, which must stay OTHER.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseAllMarkets, parseTeamNames } from "../../../../scrapers/bookmakers/fuksiarz/parser.js";
import { fuksiarzNormalizer } from "../fuksiarz-normalizer.js";
import type { NormalizationContext, RawBookmakerMarket } from "../../types.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/fuksiarz-leeds-tottenham-2026-11-06.json", import.meta.url), "utf8"),
);
const markets = parseAllMarkets(fixture.data, parseTeamNames(fixture.data.eventName)) as unknown as RawBookmakerMarket[];
const ctx = { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", league: "premier-league" } as NormalizationContext;

describe("fuksiarz 2026-11 gameTypes (Leeds v Tottenham fixture)", () => {
  it("parses the trimmed fixture into 22 raw markets", () => {
    expect(markets).toHaveLength(22);
  });

  it("maps 'Odda co najmniej 1 celny strzał głową' (-4895) to PLAYER_HEADER_SHOTS_ON_TARGET per player", () => {
    const raw = markets.find((m) => m.bookmakerMarketId === "-4895" && m.selections[0].name === "E. Ampadu")!;
    const out = fuksiarzNormalizer.normalizeMarket(raw, ctx)!;
    expect(out.marketCode).toBe("PLAYER_HEADER_SHOTS_ON_TARGET");
    expect(out.paramValue).toBe("E. Ampadu");
    expect(out.marketKey).toBe("PLAYER_HEADER_SHOTS_ON_TARGET:E. Ampadu");
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["1+", 11]]);
  });

  it("maps the 2-shot header line (-4896) to tier 2+", () => {
    const raw = markets.find((m) => m.bookmakerMarketId === "-4896" && m.selections[0].name === "D. Calvert-Lewin")!;
    expect(fuksiarzNormalizer.normalizeMarket(raw, ctx)!.selections.map((s) => [s.code, s.odds])).toEqual([["2+", 7.3]]);
  });

  it("maps 'Każda drużyna powyżej X rzutu rożnego' (-30640) to EACH_TEAM_TOTAL_CORNERS_OVER:X", () => {
    const outs = markets.filter((m) => m.bookmakerMarketId === "-30640").map((m) => fuksiarzNormalizer.normalizeMarket(m, ctx)!);
    expect(outs.map((o) => [o.marketKey, o.selections.map((s) => [s.code, s.odds])])).toEqual([
      ["EACH_TEAM_TOTAL_CORNERS_OVER:1.5", [["OVER", 1.1]]],
      ["EACH_TEAM_TOTAL_CORNERS_OVER:2.5", [["OVER", 1.4]]],
      ["EACH_TEAM_TOTAL_CORNERS_OVER:3.5", [["OVER", 2]]],
      ["EACH_TEAM_TOTAL_CORNERS_OVER:4.5", [["OVER", 3.1]]],
    ]);
  });

  it("keeps 'Zakłady specjalne #4.1' (-30061) as OTHER", () => {
    const raw = markets.find((m) => m.bookmakerMarketId === "-30061")!;
    const out = fuksiarzNormalizer.normalizeMarket(raw, ctx);
    expect(out === null || out.marketCode === "OTHER").toBe(true);
  });
});

describe("fuksiarz each-team OVER-only codes never publish UNDER", () => {
  // The catalog codes are OVER-only SINGLE_SELECTION / STAT_RANGE markets.
  // "Each team under X" is not the complement of "each team over X", so a
  // future "poniżej X" row must be dropped, not published as UNDER.
  // Synthetic rows: no "poniżej" row has been observed on these ids.
  const raw = (id: string, name: string, selections: [string, number][]): RawBookmakerMarket => ({
    bookmakerMarketId: id,
    name,
    selections: selections.map(([selName, odds]) => ({ name: selName, odds })),
  }) as RawBookmakerMarket;

  it.each([
    ["-30640", "Każda drużyna poniżej 2.5 rzutu rożnego"],
    ["-30607", "Każda drużyna poniżej 2.5 celnego strzału"],
    ["-30609", "Każda drużyna poniżej 1.5 spalonego"],
    ["-30608", "Każda drużyna poniżej 9.5 faulu"],
  ])("drops a 'poniżej' row on %s", (id, name) => {
    const line = name.match(/\d+\.\d/)![0];
    expect(fuksiarzNormalizer.normalizeMarket(raw(id, name, [[`poniżej ${line}`, 1.6]]), ctx)).toBeNull();
  });

  it("keeps only the OVER selection when a row mixes 'powyżej' and 'poniżej'", () => {
    const out = fuksiarzNormalizer.normalizeMarket(
      raw("-30640", "Każda drużyna powyżej 2.5 rzutu rożnego", [["powyżej 2.5", 1.4], ["poniżej 2.5", 2.7]]),
      ctx,
    )!;
    expect(out.marketKey).toBe("EACH_TEAM_TOTAL_CORNERS_OVER:2.5");
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["OVER", 1.4]]);
  });
});

// Same defect class as controller ruling 3 (superbet "3+" shown as "3"):
// HALF_TIME_HOME_EXACT_GOALS's bands are 0/1/2/2+/3 and "3" means exactly 3
// ("Gospodarze strzelą dokładnie 3 goli w 1. połowie"). Fuksiarz quotes the
// discrete counts 3, 4 and 5 (WC golden entry 198: 3 @19, 4 @30, 5 @30); the
// three used to be merged into one 3-or-more price (8.38) under "3". The real
// exactly-3 price is kept and 4/5, which have no catalog band, are dropped.
describe("fuksiarz HALF_TIME_HOME_EXACT_GOALS keeps exactly 3 apart from 4 and 5", () => {
  const ctxFM = { homeTeam: "France", awayTeam: "Morocco", league: "world-cup-2026" } as NormalizationContext;
  it("-4555 (golden #198) publishes 0/1/2/3 with the exactly-3 price", () => {
    const out = fuksiarzNormalizer.normalizeMarket({
      bookmakerMarketId: "-4555",
      name: "1. połowa - Francja - dokładna liczba goli",
      selections: [
        { name: "0", odds: 1.98 }, { name: "1", odds: 2.55 }, { name: "2", odds: 6 },
        { name: "3", odds: 19 }, { name: "4", odds: 30 }, { name: "5", odds: 30 },
      ],
    }, ctxFM)!;
    expect(out.marketCode).toBe("HALF_TIME_HOME_EXACT_GOALS");
    expect(out.selections.map((s) => [s.code, s.label, s.odds])).toEqual([
      ["0", "0", 1.98], ["1", "1", 2.55], ["2", "2", 6], ["3", "3", 19],
    ]);
  });
});
