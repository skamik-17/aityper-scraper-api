// Regression tests for the 2026-11 betfan scraper recovery
// (docs/superpowers/plans/2026-11-06-scraper-recovery/betfan.md).
// The capture tests run the real parser + normalizer over a trimmed betfan
// event payload (Everton v Coventry City, captured 2026-11-06); the raw
// shapes of the single-market tests mirror betfan golden entries
// #60/#67 and #294 (France v Morocco).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
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

/** A two-way O/U raw market at one line, shaped like the golden/capture rows. */
const ouRaw = (bookmakerMarketId: string, name: string, line: string): RawBookmakerMarket => ({
  bookmakerMarketId,
  name,
  selections: [
    { name: `Poniżej ${line}`, odds: 2 },
    { name: `Powyżej ${line}`, odds: 1.7 },
  ],
});

/** Projection that pins the code, the key and the selection codes of one output. */
const projection = (o: NormalizedMarketOutput | null) =>
  o && { marketCode: o.marketCode, marketKey: o.marketKey, selections: o.selections.map((s) => s.code) };

const DROPPED_TO_OTHER = { marketCode: "OTHER", marketKey: "OTHER", selections: ["UNKNOWN", "UNKNOWN"] };

describe("betfan recovery 2026-11", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("betfan team shot lines carry the team side (Everton v Coventry capture)", () => {
    const shotCodes = ["TEAM_TOTAL_SHOTS", "TEAM_TOTAL_SHOTS_ON_TARGET"];
    const outs = normalizeCapture(ctxEC);
    // The row count catches a key collision that the keyed map would hide.
    expect(outs.filter((o) => shotCodes.includes(o.marketCode))).toHaveLength(6);
    expect(keyedBy(outs, shotCodes)).toEqual({
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

  it("betfan team fouls use side-specific codes, away line no longer OTHER (Everton v Coventry capture)", () => {
    const foulCodes = ["HOME_TEAM_TOTAL_FOULS", "AWAY_TEAM_TOTAL_FOULS", "TEAM_TOTAL_FOULS"];
    const outs = normalizeCapture(ctxEC);
    // The row count catches a key collision that the keyed map would hide.
    expect(outs.filter((o) => foulCodes.includes(o.marketCode))).toHaveLength(2);
    expect(keyedBy(outs, foulCodes)).toEqual({
      "HOME_TEAM_TOTAL_FOULS:10.5": [["UNDER", 2], ["OVER", 1.7]],
      "AWAY_TEAM_TOTAL_FOULS:12.5": [["UNDER", 1.83], ["OVER", 1.83]],
    });
    expect(outs.filter((o) => o.marketCode === "OTHER" && /liczba fauli/.test(o.debug?.rawName ?? ""))).toHaveLength(0);
  });

  // Final review F1: a betfan OPTA team-stat id always carries one team's
  // line (home: 162/168/-200054, away: 163/169/-200055). When the team in the
  // title does not resolve, or names the other side, the row must not be
  // published side-less (TEAM_TOTAL_*:<line>) or on the whole-match code
  // (id 168 -> TOTAL_SHOTS_ON_TARGET:<line>, a fake +EV against the peers'
  // match-total line).
  it.each([
    ["162", "Arsenal - liczba fauli (OPTA)", "10.5"],
    ["168", "Arsenal - liczba celnych strzałów na bramkę (OPTA)", "4.5"],
    ["-200054", "Arsenal - liczba strzałów (OPTA)", "16.5"],
    ["169", "Everton - liczba celnych strzałów na bramkę (OPTA)", "4.5"],
  ])("betfan team-stat id %s with an unresolved or mismatched team (%s) drops to OTHER", (id, name, line) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(projection(betfanNormalizer.normalizeMarket(ouRaw(id, name, line), ctxEC))).toEqual(DROPPED_TO_OTHER);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(name);
  });

  it("betfan team-stat ids with the id's own team keep the side-specific keys", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const keys = [
      ouRaw("162", "Everton - liczba fauli (OPTA)", "10.5"),
      ouRaw("163", "Coventry City - liczba fauli (OPTA)", "12.5"),
      ouRaw("168", "Everton - liczba celnych strzałów na bramkę (OPTA)", "4.5"),
      ouRaw("169", "Coventry City - liczba celnych strzałów na bramkę (OPTA)", "2.5"),
      ouRaw("-200054", "Everton - liczba strzałów (OPTA)", "16.5"),
      ouRaw("-200055", "Coventry City - liczba strzałów (OPTA)", "11.5"),
    ].map((raw) => betfanNormalizer.normalizeMarket(raw, ctxEC)?.marketKey);
    expect(keys).toEqual([
      "HOME_TEAM_TOTAL_FOULS:10.5",
      "AWAY_TEAM_TOTAL_FOULS:12.5",
      "TEAM_TOTAL_SHOTS_ON_TARGET:HOME:4.5",
      "TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:2.5",
      "TEAM_TOTAL_SHOTS:HOME:16.5",
      "TEAM_TOTAL_SHOTS:AWAY:11.5",
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  // Final review F2: half-scoped shots/fouls lines (prefix "1. połowa - X -"
  // or suffix "... w 1. połowie") must not pool with the full-match peers.
  it.each([
    ["162", "1. połowa - Everton - liczba fauli (OPTA)", "5.5"],
    ["162", "Everton - liczba fauli w 1. połowie (OPTA)", "5.5"],
    ["163", "1. połowa: Coventry City - liczba fauli (OPTA)", "5.5"],
    ["-200054", "1. połowa - Everton - liczba strzałów (OPTA)", "7.5"],
    ["168", "1. połowa - Everton - liczba celnych strzałów na bramkę (OPTA)", "2.5"],
    ["-30243", "1. połowa - liczba fauli (OPTA)", "10.5"],
    ["-200194", "2. połowa - liczba strzałów (OPTA)", "12.5"],
  ])("betfan half-scoped shots/fouls line id %s (%s) drops to OTHER", (id, name, line) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(projection(betfanNormalizer.normalizeMarket(ouRaw(id, name, line), ctxEC))).toEqual(DROPPED_TO_OTHER);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(name);
  });

  // Controller ruling 22 (betfan): a team-prefixed stat title whose team does
  // not resolve, under a whole-match id, used to stay on the whole-match code,
  // so one team's line pooled with the match totals. It drops to OTHER.
  it.each([
    ["-200194", "Szwajcaria - liczba strzałów (OPTA)", "12.5"],
    ["-30242", "Szwajcaria - liczba celnych strzałów na bramkę (OPTA)", "4.5"],
    ["-30243", "Szwajcaria - liczba fauli (OPTA)", "11.5"],
    ["23", "Szwajcaria - liczba rzutów rożnych", "4.5"],
    ["13", "Szwajcaria - liczba kartek", "2.5"],
  ])("betfan whole-match id %s with an unresolved team title (%s) drops to OTHER", (id, name, line) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(projection(betfanNormalizer.normalizeMarket(ouRaw(id, name, line), ctxEC))).toEqual(DROPPED_TO_OTHER);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(name);
  });

  it("betfan whole-match and resolved team stat titles keep their codes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const keys = [
      ouRaw("-200194", "Liczba strzałów (OPTA)", "24.5"),
      ouRaw("23", "Liczba rzutów rożnych", "9.5"),
      ouRaw("13", "Liczba kartek", "3.5"),
      ouRaw("23", "Everton - liczba rzutów rożnych", "4.5"),
      ouRaw("13", "Coventry City - liczba kartek", "1.5"),
    ].map((raw) => betfanNormalizer.normalizeMarket(raw, ctxEC)?.marketKey);
    expect(keys).toEqual([
      "TOTAL_SHOTS:24.5",
      "CORNERS_TOTAL:9.5",
      "CARDS_TOTAL:3.5",
      "CORNERS_TEAM:HOME:4.5",
      "CARDS_TEAM:AWAY:1.5",
    ]);
    expect(warn).not.toHaveBeenCalled();
  });
});
