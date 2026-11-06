// Regression tests for the 2026-11 betfan scraper recovery
// (docs/superpowers/plans/2026-11-06-scraper-recovery/betfan.md).
// The capture tests run the real parser + normalizer over a trimmed betfan
// event payload (Everton v Coventry City, captured 2026-11-06); the raw
// shapes of the single-market tests mirror betfan golden entries
// #60/#67 and #294 (France v Morocco).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { betfanNormalizer } from "../betfan-normalizer.js";
import { parseAllMarkets } from "../../../../scrapers/bookmakers/betfan/parser.js";
import type { BetfanEvent } from "../../../../scrapers/bookmakers/betfan/types.js";
import type { NormalizationContext, NormalizedMarketOutput, RawBookmakerMarket } from "../../types.js";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "betfan-event-40932978-everton-coventry.trimmed.json"
);

const ctxEC: NormalizationContext = { homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league" };
const ctxFM: NormalizationContext = { homeTeam: "France", awayTeam: "Morocco", league: "world-cup-2026" };

/**
 * Parse the captured event and normalize every market, building each raw
 * the way production does (factory.ts): name, selections, paramValue and a
 * numeric bookmakerMarketId, with no groupName. Null outputs are dropped.
 */
function normalizeCapture(ctx: NormalizationContext): NormalizedMarketOutput[] {
  const event = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as BetfanEvent;
  return parseAllMarkets(event)
    .map((m) => {
      const raw: RawBookmakerMarket = {
        name: m.name,
        selections: m.selections,
        paramValue: m.paramValue,
        bookmakerMarketId: Number(m.bookmakerMarketId),
      };
      return betfanNormalizer.normalizeMarket(raw, ctx);
    })
    .filter((o): o is NormalizedMarketOutput => o !== null);
}

const keyedBy = (outs: NormalizedMarketOutput[], codes: string[]) =>
  Object.fromEntries(
    outs
      .filter((o) => codes.includes(o.marketCode))
      .map((o) => [o.marketKey, o.selections.map((s) => [s.code, s.odds])])
  );

describe("betfan recovery 2026-11", () => {
  it("betfan team shot lines carry the team side (Everton v Coventry capture)", () => {
    expect(keyedBy(normalizeCapture(ctxEC), ["TEAM_TOTAL_SHOTS", "TEAM_TOTAL_SHOTS_ON_TARGET"])).toEqual({
      "TEAM_TOTAL_SHOTS_ON_TARGET:HOME:4.5": [["UNDER", 2.4], ["OVER", 1.5]],
      "TEAM_TOTAL_SHOTS_ON_TARGET:HOME:5.5": [["UNDER", 1.72], ["OVER", 2]],
      "TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:2.5": [["UNDER", 2.55], ["OVER", 1.45]],
      "TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:3.5": [["UNDER", 1.68], ["OVER", 2.05]],
      "TEAM_TOTAL_SHOTS:HOME:16.5": [["UNDER", 1.85], ["OVER", 1.85]],
      "TEAM_TOTAL_SHOTS:AWAY:11.5": [["UNDER", 1.95], ["OVER", 1.75]],
    });
  });

  it("betfan whole-match totals and CORNERS_TEAM keys are unchanged", () => {
    const outs = normalizeCapture(ctxEC);
    expect(Object.keys(keyedBy(outs, ["TOTAL_SHOTS", "TOTAL_SHOTS_ON_TARGET", "FOULS_TOTAL"])).sort()).toEqual([
      "FOULS_TOTAL:22.5",
      "TOTAL_SHOTS:28.5",
      "TOTAL_SHOTS_ON_TARGET:7.5",
      "TOTAL_SHOTS_ON_TARGET:8.5",
      "TOTAL_SHOTS_ON_TARGET:9.5",
    ]);
    expect(Object.keys(keyedBy(outs, ["CORNERS_TEAM"]))).toEqual([
      "CORNERS_TEAM:HOME:3.5",
      "CORNERS_TEAM:HOME:4.5",
      "CORNERS_TEAM:HOME:5.5",
      "CORNERS_TEAM:HOME:6.5",
      "CORNERS_TEAM:HOME:7.5",
      "CORNERS_TEAM:AWAY:2.5",
      "CORNERS_TEAM:AWAY:3.5",
      "CORNERS_TEAM:AWAY:4.5",
      "CORNERS_TEAM:AWAY:5.5",
      "CORNERS_TEAM:AWAY:6.5",
    ]);
  });

  it("betfan same shots-on-target line for both teams (4.5) stays on two keys", () => {
    const raw = (team: string, u: number, o: number) => ({
      bookmakerMarketId: team === "Francja" ? "168" : "169",
      name: `${team} - liczba celnych strzałów na bramkę (OPTA)`,
      selections: [
        { name: "Poniżej 4.5", odds: u },
        { name: "Powyżej 4.5", odds: o },
      ],
    });
    const fr = betfanNormalizer.normalizeMarket(raw("Francja", 3, 1.33), ctxFM)!;
    const ma = betfanNormalizer.normalizeMarket(raw("Maroko", 1.25, 3.5), ctxFM)!;
    expect([fr.marketKey, ma.marketKey]).toEqual([
      "TEAM_TOTAL_SHOTS_ON_TARGET:HOME:4.5",
      "TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:4.5",
    ]);
  });

  it("betfan CARDS_TEAM keeps side-prefixed selections", () => {
    const o = betfanNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "-200067",
        name: "Maroko - liczba kartek",
        selections: [
          { name: "Poniżej 1.5", odds: 2 },
          { name: "Powyżej 1.5", odds: 1.7 },
        ],
      },
      ctxFM
    )!;
    expect([o.marketKey, o.selections.map((s) => [s.code, s.odds])]).toEqual([
      "CARDS_TEAM:AWAY:1.5",
      [
        ["AWAY_UNDER", 2],
        ["AWAY_OVER", 1.7],
      ],
    ]);
  });
});
