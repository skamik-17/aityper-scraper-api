import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { FullMatchOffer, ScrapedMarket } from "../../../../types/full-offer.js";
import {
  countMarkets,
  evaluateMatch,
  indexPeerRows,
  median,
  normalizeQuietly,
  parseArgs,
  peerKey,
  summarize,
  type MatchReport,
  type PeerRow,
} from "../../../../../scripts/pzbuk-smoke.js";

const fx = JSON.parse(
  readFileSync(
    new URL("../../../../services/normalization/__fixtures__/pzbuk/premier-league_everton_coventry_city.json", import.meta.url),
    "utf8",
  ),
);

// The 2026-11-06 Everton-Coventry City archive as the scraper would hand it over
// (empty archive strings become undefined, as in golden.test.ts).
const fixtureMatch = (): FullMatchOffer => ({
  matchId: fx.matchId,
  bookmaker: "pzbuk",
  homeTeam: fx.ctx.homeTeam,
  awayTeam: fx.ctx.awayTeam,
  eventUrl: "",
  scrapedAt: new Date(0),
  markets: fx.entries.map(({ raw }: any) => ({
    name: raw.name,
    bookmakerMarketId: raw.bookmakerMarketId ? String(raw.bookmakerMarketId) : undefined,
    groupName: raw.groupName || undefined,
    paramValue: raw.paramValue || undefined,
    selections: raw.selections,
  })),
});

type Sel = [name: string, code: string, odds: number];
const market = (name: string, normalizedType: string, marketKey: string, sels: Sel[]): ScrapedMarket =>
  ({
    name,
    normalizedType,
    marketKey,
    selections: sels.map(([n, code, odds]) => ({ name: n, normalizedName: code, odds })),
  }) as ScrapedMarket;

const x12 = (home: number, draw: number, away: number) =>
  ({ selections: [{ normalizedName: "HOME", odds: home }, { normalizedName: "DRAW", odds: draw }, { normalizedName: "AWAY", odds: away }] });

const peerRow = (homeTeam: string, awayTeam: string, odds: Record<string, ReturnType<typeof x12>>): PeerRow => ({
  homeTeam,
  awayTeam,
  markets: { MATCH_WINNER: { bookmakerOdds: odds } },
});

describe("pzbuk smoke: per-match counts", () => {
  it("counts the real-names fixture like its golden output (A2-A5, A12)", () => {
    const m = fixtureMatch();
    const report = evaluateMatch(m, normalizeQuietly(m, "premier-league"), null);
    expect(report).toEqual({
      homeTeam: "Everton",
      awayTeam: "Coventry City",
      parsed: 167,
      nonOther: 76,
      unknownShareNonOther: 0,
      collisions: [],
      ordinalMarkets: 0,
      templateMarkets: 0,
      gated: [],
      peerMatched: false,
      x12Deviation: null,
      x12Quotes: [],
    });
  });

  it("counts overlapping codes per non-OTHER marketKey and ignores OTHER (same rule as pzbuk-real-names.test.ts)", () => {
    const counts = countMarkets([
      market("Suma", "TOTAL_GOALS", "TOTAL_GOALS:2.5", [["ponad 2.5", "OVER", 1.77], ["poniżej 2.5", "UNDER", 1.98]]),
      market("1. Połowa - Suma", "TOTAL_GOALS", "TOTAL_GOALS:2.5", [["ponad 2.5", "OVER", 3.1], ["poniżej 2.5", "UNDER", 1.3]]),
      market("Everton FC Dokładna liczba goli", "HOME_EXACT_GOALS", "HOME_EXACT_GOALS", [["0", "0", 5.4]]),
      market("Coventry City Dokładna liczba goli", "HOME_EXACT_GOALS", "HOME_EXACT_GOALS", [["1", "1", 3.05]]),
      market("Strzelec gola", "OTHER", "OTHER", [["Keane, Michael", "UNKNOWN", 3.3]]),
      market("Strzelec ostatniego gola", "OTHER", "OTHER", [["Keane, Michael", "UNKNOWN", 11.19]]),
    ]);
    expect(counts.nonOther).toBe(4);
    expect(counts.collisions).toEqual([
      "TOTAL_GOALS:2.5:OVER <- 1. Połowa - Suma",
      "TOTAL_GOALS:2.5:UNDER <- 1. Połowa - Suma",
    ]);
  });

  it("measures UNKNOWN only among selections of non-OTHER markets (A4)", () => {
    const counts = countMarkets([
      market("a", "CORRECT_SCORE", "CORRECT_SCORE", [["1:0", "1-0", 7], ["0:1", "0-1", 9], ["2:0", "2-0", 11], ["inny", "UNKNOWN", 15]]),
      market("b", "EXACT_GOALS", "EXACT_GOALS", [["0", "0", 9], ["1", "1", 4], ["2", "2", 3.4], ["3", "3", 4], ["4", "4", 6], ["5+", "5+", 9]]),
      market("c", "OTHER", "OTHER", [["x", "UNKNOWN", 2], ["y", "UNKNOWN", 2], ["z", "UNKNOWN", 2]]),
    ]);
    expect(counts.unknownShareNonOther).toBeCloseTo(0.1, 12);
  });

  it("counts ordinal and template names on the trimmed name and lists the gated ones (A12)", () => {
    const counts = countMarkets([
      market("2. gol", "OTHER", "OTHER", []),
      market(" 10. strzelec gola ", "OTHER", "OTHER", []),
      market("1. Połowa - 2. gol", "HALF_TIME_FIRST_GOAL", "HALF_TIME_FIRST_GOAL", []),
      market("1. Połowa - {SpecialIntValue1}. gol", "OTHER", "OTHER", []),
      market("{SpecialIntValue1}. kartka", "FIRST_CARD", "FIRST_CARD", []),
      // synthetic: matches both sets and must be gated once
      market("2. gol {SpecialIntValue2}", "FIRST_TEAM_TO_SCORE", "FIRST_TEAM_TO_SCORE", []),
      // regression guards: the captured pre-match "1." forms are not ordinals
      market("1. gol", "FIRST_TEAM_TO_SCORE", "FIRST_TEAM_TO_SCORE", []),
      market("2. Połowa - 1. gol", "SECOND_HALF_FIRST_GOAL", "SECOND_HALF_FIRST_GOAL", []),
    ]);
    expect(counts.ordinalMarkets).toBe(4);
    expect(counts.templateMarkets).toBe(3);
    expect(counts.gated).toEqual(["1. Połowa - 2. gol", "{SpecialIntValue1}. kartka", "2. gol {SpecialIntValue2}"]);
  });
});

describe("pzbuk smoke: MATCH_WINNER against peers (A6)", () => {
  it("takes the median of every other bookmaker and never pzbuk itself", () => {
    const m = fixtureMatch();
    const peers = new Map([
      [
        peerKey("Everton", "Coventry City"),
        peerRow("Everton", "Coventry City", {
          sts: x12(1.7, 3.9, 5.0),
          etoto: x12(1.6, 4.0, 4.8),
          lvbet: x12(1.65, 3.8, 5.2),
          pzbuk: x12(9.99, 9.99, 9.99),
        }),
      ],
    ]);
    const report = evaluateMatch(m, normalizeQuietly(m, "premier-league"), peers);
    // pzbuk 1.66/3.92/4.91 vs medians 1.65/3.90/5.00: the largest gap is AWAY, 1.8%
    expect(report.peerMatched).toBe(true);
    expect(report.x12Deviation).toBeCloseTo(0.018, 10);
  });

  it("catches a HOME/AWAY swap", () => {
    const swapped = [market("1x2", "MATCH_WINNER", "MATCH_WINNER", [["Everton FC", "HOME", 4.91], ["Remis", "DRAW", 3.92], ["Coventry City", "AWAY", 1.66]])];
    const peers = new Map([[peerKey("Everton", "Coventry City"), peerRow("Everton", "Coventry City", { sts: x12(1.66, 3.92, 4.91) })]]);
    const report = evaluateMatch({ ...fixtureMatch(), markets: [] }, swapped, peers);
    expect(report.x12Deviation).toBeCloseTo(4.91 / 1.66 - 1, 10);
  });

  it("catches a leak of id 126 (Kartki 1x2) into MATCH_WINNER", () => {
    const leaked = [market("Kartki 1x2", "MATCH_WINNER", "MATCH_WINNER", [["Everton FC", "HOME", 2.75], ["remis", "DRAW", 3.83], ["Coventry City", "AWAY", 1.95]])];
    const peers = new Map([[peerKey("Everton", "Coventry City"), peerRow("Everton", "Coventry City", { sts: x12(1.66, 3.92, 4.91) })]]);
    const report = evaluateMatch({ ...fixtureMatch(), markets: [] }, leaked, peers);
    // +66% on HOME, as the plan's A6 row predicts
    expect(report.x12Deviation).toBeCloseTo(2.75 / 1.66 - 1, 10);
  });

  // Live 2026-11-07 Arsenal v Hull City: pzbuk 1.15/7.36/16.68 against the 10 peers of
  // .scratch/t7/peers-after.json (medians 1.17/7.25/15.375; AWAY peers range 14-18).
  const ARSENAL_HULL_PEERS = {
    sts: x12(1.17, 7.9, 17), etoto: x12(1.17, 7, 15), lvbet: x12(1.18, 7.5, 15), betfan: x12(1.17, 7, 15.5),
    forbet: x12(1.17, 7.2, 15), betclic: x12(1.16, 7, 15.25), betcris: x12(1.15, 8, 17), fortuna: x12(1.17, 7.1, 15.5),
    fuksiarz: x12(1.17, 7.4, 18), superbet: x12(1.18, 7.3, 14),
  };
  const arsenalHull = (away: number) => {
    const normalized = [market("1x2", "MATCH_WINNER", "MATCH_WINNER", [["Arsenal FC", "HOME", 1.15], ["Remis", "DRAW", 7.36], ["Hull City", "AWAY", away]])];
    const peers = new Map([[peerKey("Arsenal", "Hull City"), peerRow("Arsenal", "Hull City", ARSENAL_HULL_PEERS)]]);
    return evaluateMatch({ ...fixtureMatch(), homeTeam: "Arsenal", awayTeam: "Hull City", markets: [] }, normalized, peers);
  };

  it("accepts a long shot within 1 pp of the peer median's implied probability", () => {
    const report = arsenalHull(16.68);
    expect(report.x12Quotes).toEqual([
      { code: "HOME", odds: 1.15, median: 1.17 },
      { code: "DRAW", odds: 7.36, median: 7.25 },
      { code: "AWAY", odds: 16.68, median: 15.375 },
    ]);
    // AWAY is 8.49% off in odds but only 0.51 pp off in implied probability; 1 pp counts as 8%.
    expect(report.x12Deviation).toBeCloseTo(8 * (1 / 15.375 - 1 / 16.68), 10);
    expect(report.x12Deviation!).toBeLessThan(0.08);
  });

  it("still flags a long shot more than 8% and more than 1 pp from the peer median", () => {
    // 12 vs 15.375: 22% off in odds and 1.8 pp off in implied probability
    expect(arsenalHull(12).x12Deviation).toBeCloseTo(8 * (1 / 12 - 1 / 15.375), 10);
    expect(arsenalHull(12).x12Deviation!).toBeGreaterThan(0.08);
  });

  it("joins on exact canonical names and yields null without a row or without peers", () => {
    const m = fixtureMatch();
    const normalized = normalizeQuietly(m, "premier-league");
    const renamed = new Map([[peerKey("Everton FC", "Coventry City"), peerRow("Everton FC", "Coventry City", { sts: x12(1.66, 3.92, 4.91) })]]);
    expect(evaluateMatch(m, normalized, renamed)).toMatchObject({ peerMatched: false, x12Deviation: null });
    const onlyPzbuk = new Map([[peerKey("Everton", "Coventry City"), peerRow("Everton", "Coventry City", { pzbuk: x12(1.66, 3.92, 4.91) })]]);
    expect(evaluateMatch(m, normalized, onlyPzbuk)).toMatchObject({ peerMatched: true, x12Deviation: null });
  });

  it("computes a plain median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1.7, 1.6])).toBeCloseTo(1.65, 12);
  });

  it("indexes peer rows from the /api/odds body and tolerates a malformed one", () => {
    const row = peerRow("Everton", "Coventry City", { sts: x12(1.66, 3.92, 4.91) });
    const index = indexPeerRows({ success: true, data: { matches: [row] } });
    expect([...index.keys()]).toEqual([peerKey("Everton", "Coventry City")]);
    expect(index.get(peerKey("Everton", "Coventry City"))).toBe(row);
    for (const body of [null, {}, { data: {} }, { data: { matches: [null, { homeTeam: 1 }] } }]) {
      expect(indexPeerRows(body).size).toBe(0);
    }
  });
});

describe("pzbuk smoke: SMOKE line and verdict", () => {
  const transport = { invalidFrames: 0, chunkedFrames: 0, maxFrameBytes: 82207 };
  const ok = (i: number): MatchReport => ({
    homeTeam: `H${i}`,
    awayTeam: `A${i}`,
    parsed: 90,
    nonOther: 40,
    unknownShareNonOther: 0.02,
    collisions: [],
    ordinalMarkets: 0,
    templateMarkets: 0,
    gated: [],
    peerMatched: true,
    x12Deviation: 0.08,
    x12Quotes: [],
  });
  const reports = (n = 18) => Array.from({ length: n }, (_, i) => ok(i));

  it("passes exactly at the A1-A6 thresholds and keeps the SMOKE key order", () => {
    const smoke = summarize({ success: true, reports: reports(), transport, durationMs: 312000 });
    expect(Object.keys(smoke)).toEqual([
      "success", "matches", "minParsedMarkets", "minNonOther", "maxUnknownShareNonOther", "collisions",
      "peerMatched", "max1x2Deviation", "invalidFrames", "chunkedFrames", "maxFrameBytes",
      "ordinalMarkets", "templateMarkets", "gatedNonOther", "durationMs", "pass",
    ]);
    expect(smoke).toMatchObject({
      success: true, matches: 18, minParsedMarkets: 90, minNonOther: 40, maxUnknownShareNonOther: 0.02,
      collisions: 0, peerMatched: 18, max1x2Deviation: 0.08, maxFrameBytes: 82207, gatedNonOther: 0,
      durationMs: 312000, pass: true,
    });
  });

  it.each<[string, (r: MatchReport[]) => MatchReport[], boolean?]>([
    ["17 matches (A1)", (r) => r.slice(1)],
    ["a match with 89 parsed markets (A2)", (r) => [{ ...r[0], parsed: 89 }, ...r.slice(1)]],
    ["a match with 39 non-OTHER markets (A3)", (r) => [{ ...r[0], nonOther: 39 }, ...r.slice(1)]],
    ["an UNKNOWN share of 2.01% (A4)", (r) => [{ ...r[0], unknownShareNonOther: 0.0201 }, ...r.slice(1)]],
    ["one collision (A5)", (r) => [{ ...r[0], collisions: ["MATCH_WINNER:HOME <- Kartki 1x2"] }, ...r.slice(1)]],
    ["a 1X2 deviation of 8.01% (A6)", (r) => [{ ...r[0], x12Deviation: 0.0801 }, ...r.slice(1)]],
    ["a gated ordinal market (A12)", (r) => [{ ...r[0], ordinalMarkets: 1, gated: ["2. gol"] }, ...r.slice(1)]],
    ["success:false", (r) => r, false],
  ])("fails on %s", (_label, mutate, success = true) => {
    expect(summarize({ success, reports: mutate(reports()), transport, durationMs: 1 }).pass).toBe(false);
  });

  it("never fails on transport counters, reported ordinals or a null deviation (A11, A12)", () => {
    const r = reports().map((x) => ({ ...x, peerMatched: false, x12Deviation: null, ordinalMarkets: 2, templateMarkets: 1 }));
    const smoke = summarize({ success: true, reports: r, transport: { invalidFrames: 3, chunkedFrames: 2, maxFrameBytes: 2_000_000 }, durationMs: 1 });
    expect(smoke).toMatchObject({
      peerMatched: 0, max1x2Deviation: null, invalidFrames: 3, chunkedFrames: 2, maxFrameBytes: 2_000_000,
      ordinalMarkets: 36, templateMarkets: 18, gatedNonOther: 0, pass: true,
    });
  });

  it("reports zeros when nothing was scraped", () => {
    const smoke = summarize({ success: false, reports: [], transport: { invalidFrames: 0, chunkedFrames: 0, maxFrameBytes: 0 }, durationMs: 5 });
    expect(smoke).toMatchObject({ matches: 0, minParsedMarkets: 0, minNonOther: 0, maxUnknownShareNonOther: 0, max1x2Deviation: null, pass: false });
  });
});

describe("pzbuk smoke: arguments", () => {
  it("reads --league, --peers and --help", () => {
    expect(parseArgs(["--league", "premier-league", "--peers", "http://localhost:3001"])).toEqual({
      league: "premier-league", peers: "http://localhost:3001", help: false,
    });
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs([]).league).toBeUndefined();
  });
});
