import { describe, expect, it } from "vitest";
import type { ScrapedMarket } from "../../types/full-offer.js";
import { summarizeMainMarkets } from "../main-markets-summary.js";

const m = (normalizedType: string, sels: Array<[string, number]>, paramValue?: string): ScrapedMarket =>
  ({
    name: normalizedType,
    normalizedType,
    ...(paramValue === undefined ? {} : { paramValue }),
    selections: sels.map(([normalizedName, odds]) => ({ name: normalizedName, normalizedName, odds })),
  }) as ScrapedMarket;

describe("summarizeMainMarkets", () => {
  it("reads 1X2, BTTS, O/U 2.5 and DC", () => {
    expect(
      summarizeMainMarkets([
        m("MATCH_WINNER", [["HOME", 2.75], ["DRAW", 3.3], ["AWAY", 2.55]]),
        m("BTTS", [["YES", 1.7], ["NO", 2.05]]),
        m("TOTAL_GOALS", [["OVER", 1.9], ["UNDER", 1.85]], "2.5"),
        m("TOTAL_GOALS", [["OVER", 1.3], ["UNDER", 3.4]], "1.5"),
        m("DOUBLE_CHANCE", [["HOME_OR_DRAW", 1.5], ["DRAW_OR_AWAY", 1.45], ["HOME_OR_AWAY", 1.33]]),
      ]),
    ).toEqual({
      x12: { home: 2.75, draw: 3.3, away: 2.55 },
      btts: { yes: 1.7, no: 2.05 },
      ou25: { over: 1.9, under: 1.85 },
      ouLines: ["1.5", "2.5"],
      dc: { homeOrDraw: 1.5, drawOrAway: 1.45, homeOrAway: 1.33 },
    });
  });

  it("lists O/U lines numerically", () =>
    expect(
      summarizeMainMarkets(["10.5", "2.5", "0.5", "1.5"].map((p) => m("TOTAL_GOALS", [["OVER", 2], ["UNDER", 2]], p))).ouLines,
    ).toEqual(["0.5", "1.5", "2.5", "10.5"]));

  it("missing markets stay undefined", () =>
    expect(summarizeMainMarkets([m("TOTAL_GOALS", [["OVER", 1.3], ["UNDER", 3.4]], "1.5")])).toEqual({ ouLines: ["1.5"] }));

  it("ignores HALF_TIME_RESULT", () =>
    expect(summarizeMainMarkets([m("HALF_TIME_RESULT", [["HOME", 3], ["DRAW", 2], ["AWAY", 4]])])).toEqual({ ouLines: [] }));

  it("a market missing a selection is left out", () =>
    expect(summarizeMainMarkets([m("MATCH_WINNER", [["HOME", 2.75], ["AWAY", 2.55]])]).x12).toBeUndefined());
});
