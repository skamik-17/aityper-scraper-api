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
