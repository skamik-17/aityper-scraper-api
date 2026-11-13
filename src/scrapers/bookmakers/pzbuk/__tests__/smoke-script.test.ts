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
  withinPeerBand,
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

/** Hand-built normalized markets, with no fail-closed drops. */
const quiet = (markets: ScrapedMarket[]) => ({ markets, dropped: [] as string[] });

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
      vocabularyMisses: [],
      invalidOdds: [],
      ordinalMarkets: 0,
      templateMarkets: 0,
      gated: [],
      droppedMarkets: [],
      peerMatched: false,
      compared: false,
      x12ProbabilityGap: null,
      x12Outliers: [],
      x12Quotes: [],
    });
  });

  it("collects the fail-closed '[pzbuk] Dropping' warnings per match and restores console.warn", () => {
    const warn = console.warn;
    const m = fixtureMatch();
    // Synthetic: a 1x2 with HOME twice is dropped by the repeated-code guard.
    m.markets = [...m.markets, { name: "1x2", bookmakerMarketId: "1", selections: [{ name: "Everton FC", odds: 1.66 }, { name: "Everton FC", odds: 1.7 }, { name: "Coventry City", odds: 4.91 }] }];
    const normalized = normalizeQuietly(m, "premier-league");
    expect(console.warn).toBe(warn);
    expect(normalized.dropped).toEqual([expect.stringMatching(/^\[pzbuk\] Dropping MATCH_WINNER "1x2" \(id: 1\)/)]);
    expect(evaluateMatch(m, normalized, null).droppedMarkets).toEqual(normalized.dropped);
  });

  it("lists codes outside the catalog vocabulary of non-OTHER, non-player markets (vocabularyMisses)", () => {
    const counts = countMarkets([
      // the Task 7 mislabel class: a unique wrong code that no collision rule sees
      market("Podwójna szansa & oba zespoły strzelą", "DOUBLE_CHANCE_BTTS", "DOUBLE_CHANCE_BTTS", [["Brighton & Hove Albion/remis & tak", "DRAW_YES", 2.0], ["remis/Coventry City & tak", "X2_YES", 6.1]]),
      market("1x2", "MATCH_WINNER", "MATCH_WINNER", [["Everton FC", "HOME", 1.66], ["?", "UNKNOWN", 3.92], ["Coventry City", "AWAY", 4.91]]),
      market("1. strzelec gola", "GOALSCORER_FIRST", "GOALSCORER_FIRST", [["Barry, Thierno", "Thierno Barry", 4.18]]),
      market("1. Połowa - Dokładny wynik", "HALF_TIME_CORRECT_SCORE", "HALF_TIME_CORRECT_SCORE", [["0:0", "0-0", 2.85], ["inny", "OTHER", 12.3]]),
      market("Rynek 81", "OTHER", "OTHER", [["Everton FC (+0.5)", "Everton FC (+0.5)", 1.17]]),
    ]);
    expect(counts.vocabularyMisses).toEqual(["DOUBLE_CHANCE_BTTS:DRAW_YES <- Podwójna szansa & oba zespoły strzelą"]);
  });

  it("lists every selection without a finite price above 1 (invalidOdds)", () => {
    const counts = countMarkets([
      market("1x2", "MATCH_WINNER", "MATCH_WINNER", [["Everton FC", "HOME", Number.NaN], ["Remis", "DRAW", 3.92], ["Coventry City", "AWAY", "4.91" as unknown as number]]),
      market("Rynek 81", "OTHER", "OTHER", [["x", "x", Number.POSITIVE_INFINITY]]),
    ]);
    expect(counts.invalidOdds).toEqual(["MATCH_WINNER:HOME <- 1x2 (NaN)", "MATCH_WINNER:AWAY <- 1x2 (\"4.91\")", "OTHER:x <- Rynek 81 (Infinity)"]);
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
  it("takes the median and range of every other bookmaker and never pzbuk itself", () => {
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
    // pzbuk 1.66/3.92/4.91 vs medians 1.65/3.90/5.00
    expect(report).toMatchObject({ peerMatched: true, compared: true, x12Outliers: [] });
    expect(report.x12Quotes).toEqual([
      { code: "HOME", odds: 1.66, median: 1.65, min: 1.6, max: 1.7 },
      { code: "DRAW", odds: 3.92, median: 3.9, min: 3.8, max: 4.0 },
      { code: "AWAY", odds: 4.91, median: 5.0, min: 4.8, max: 5.2 },
    ]);
    expect(report.x12ProbabilityGap).toBeCloseTo(1 / 4.91 - 1 / 5.0, 12);
  });

  it("catches a HOME/AWAY swap", () => {
    const swapped = [market("1x2", "MATCH_WINNER", "MATCH_WINNER", [["Everton FC", "HOME", 4.91], ["Remis", "DRAW", 3.92], ["Coventry City", "AWAY", 1.66]])];
    const peers = new Map([[peerKey("Everton", "Coventry City"), peerRow("Everton", "Coventry City", { sts: x12(1.66, 3.92, 4.91), etoto: x12(1.6, 4.0, 4.8) })]]);
    const report = evaluateMatch({ ...fixtureMatch(), markets: [] }, quiet(swapped), peers);
    expect(report.x12Outliers.map((q) => q.code)).toEqual(["HOME", "AWAY"]);
    // HOME 4.91 vs median 1.63 (sts 1.66, etoto 1.6) is the largest gap: 41 pp
    expect(report.x12ProbabilityGap).toBeCloseTo(1 / 1.63 - 1 / 4.91, 12);
  });

  it("catches a 10x leak", () => {
    const leaked = [market("1x2", "MATCH_WINNER", "MATCH_WINNER", [["Everton FC", "HOME", 16.6], ["Remis", "DRAW", 3.92], ["Coventry City", "AWAY", 4.91]])];
    const peers = new Map([[peerKey("Everton", "Coventry City"), peerRow("Everton", "Coventry City", { sts: x12(1.66, 3.92, 4.91) })]]);
    const report = evaluateMatch({ ...fixtureMatch(), markets: [] }, quiet(leaked), peers);
    expect(report.x12Outliers).toEqual([{ code: "HOME", odds: 16.6, median: 1.66, min: 1.66, max: 1.66 }]);
  });

  it("catches a leak of id 126 (Kartki 1x2) into MATCH_WINNER", () => {
    const leaked = [market("Kartki 1x2", "MATCH_WINNER", "MATCH_WINNER", [["Everton FC", "HOME", 2.75], ["remis", "DRAW", 3.83], ["Coventry City", "AWAY", 1.95]])];
    const peers = new Map([[peerKey("Everton", "Coventry City"), peerRow("Everton", "Coventry City", { sts: x12(1.66, 3.92, 4.91) })]]);
    const report = evaluateMatch({ ...fixtureMatch(), markets: [] }, quiet(leaked), peers);
    // HOME 2.75 vs 1.66 is 23.9 pp off in implied probability
    expect(report.x12Outliers.map((q) => q.code)).toEqual(["HOME", "AWAY"]);
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
    return evaluateMatch({ ...fixtureMatch(), homeTeam: "Arsenal", awayTeam: "Hull City", markets: [] }, quiet(normalized), peers);
  };

  it("accepts the Arsenal v Hull City long shot (16.68 vs median 15.375, peers 14-18)", () => {
    const report = arsenalHull(16.68);
    expect(report.x12Quotes).toEqual([
      { code: "HOME", odds: 1.15, median: 1.17, min: 1.15, max: 1.18 },
      { code: "DRAW", odds: 7.36, median: 7.25, min: 7, max: 8 },
      { code: "AWAY", odds: 16.68, median: 15.375, min: 14, max: 18 },
    ]);
    // AWAY is 8.49% off in odds but only 0.51 pp off in implied probability (limit 2.5 pp);
    // the largest gap is HOME, 1.49 pp.
    expect(report.x12Outliers).toEqual([]);
    expect(1 / 15.375 - 1 / 16.68).toBeLessThan(0.0052);
    expect(report.x12ProbabilityGap).toBeCloseTo(1 / 1.15 - 1 / 1.17, 12);
  });

  it("flags a long shot outside the peer range and more than 2.5 pp from the median", () => {
    // 9 vs 15.375: 4.6 pp off, below the peer minimum of 14
    expect(arsenalHull(9).x12Outliers.map((q) => q.code)).toEqual(["AWAY"]);
  });

  it("A6 rule: within 2.5 pp of the median's implied probability, or inside the peer [min, max]", () => {
    const q = (odds: number, median: number, min: number, max: number) => ({ code: "DRAW", odds, median, min, max });
    expect(withinPeerBand(q(3.9, 3.6, 3.55, 3.65))).toBe(true); // 2.1 pp, outside the range
    expect(withinPeerBand(q(4.15, 3.6, 3.4, 4.2))).toBe(true); // 3.7 pp, inside the range
    expect(withinPeerBand(q(4.25, 3.6, 3.4, 4.2))).toBe(false); // 4.2 pp, above the range
    expect(withinPeerBand(q(Number.NaN, 3.6, 3.4, 4.2))).toBe(false);
    expect(withinPeerBand(q("3.6" as unknown as number, 3.6, 3.4, 4.2))).toBe(false);
  });

  it("treats a non-finite PZBuk price as an outlier, not as a missing comparison", () => {
    const normalized = [market("1x2", "MATCH_WINNER", "MATCH_WINNER", [["Everton FC", "HOME", Number.NaN], ["Remis", "DRAW", 3.92], ["Coventry City", "AWAY", 4.91]])];
    const peers = new Map([[peerKey("Everton", "Coventry City"), peerRow("Everton", "Coventry City", { sts: x12(1.66, 3.92, 4.91) })]]);
    const report = evaluateMatch({ ...fixtureMatch(), markets: [] }, quiet(normalized), peers);
    expect(report.x12Outliers.map((q) => q.code)).toEqual(["HOME"]);
    expect(report.invalidOdds).toEqual(["MATCH_WINNER:HOME <- 1x2 (NaN)"]);
    expect(report.x12ProbabilityGap).toBeCloseTo(0, 12); // over the finite quotes only
  });

  it("reports a joined match whose MATCH_WINNER could not be compared (compared: false)", () => {
    const peers = new Map([[peerKey("Everton", "Coventry City"), peerRow("Everton", "Coventry City", { sts: x12(1.66, 3.92, 4.91) })]]);
    const noWinner = evaluateMatch({ ...fixtureMatch(), markets: [] }, quiet([]), peers);
    expect(noWinner).toMatchObject({ peerMatched: true, compared: false, x12ProbabilityGap: null, x12Outliers: [], x12Quotes: [] });
  });

  it("joins on exact canonical names and yields null without a row or without peers", () => {
    const m = fixtureMatch();
    const normalized = normalizeQuietly(m, "premier-league");
    const renamed = new Map([[peerKey("Everton FC", "Coventry City"), peerRow("Everton FC", "Coventry City", { sts: x12(1.66, 3.92, 4.91) })]]);
    expect(evaluateMatch(m, normalized, renamed)).toMatchObject({ peerMatched: false, compared: false, x12ProbabilityGap: null });
    const onlyPzbuk = new Map([[peerKey("Everton", "Coventry City"), peerRow("Everton", "Coventry City", { pzbuk: x12(1.66, 3.92, 4.91) })]]);
    expect(evaluateMatch(m, normalized, onlyPzbuk)).toMatchObject({ peerMatched: true, compared: false, x12ProbabilityGap: null });
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
    vocabularyMisses: [],
    invalidOdds: [],
    ordinalMarkets: 0,
    templateMarkets: 0,
    gated: [],
    droppedMarkets: [],
    peerMatched: true,
    compared: true,
    x12ProbabilityGap: 0.025,
    x12Outliers: [],
    x12Quotes: [],
  });
  const reports = (n = 18) => Array.from({ length: n }, (_, i) => ok(i));
  const OUTLIER = { code: "HOME", odds: 4.91, median: 1.66, min: 1.6, max: 1.7 };

  it("passes exactly at the A1-A6 thresholds and keeps the SMOKE key order", () => {
    const smoke = summarize({ success: true, reports: reports(), transport, durationMs: 312000, peers: "loaded" });
    expect(Object.keys(smoke)).toEqual([
      "success", "matches", "minParsedMarkets", "minNonOther", "maxUnknownShareNonOther", "collisions",
      "vocabularyMisses", "invalidOdds", "droppedMarkets", "peers", "peerMatched", "compared", "x12Outliers",
      "max1x2ProbabilityGap", "invalidFrames", "chunkedFrames", "maxFrameBytes",
      "ordinalMarkets", "templateMarkets", "gatedNonOther", "durationMs", "pass",
    ]);
    expect(smoke).toMatchObject({
      success: true, matches: 18, minParsedMarkets: 90, minNonOther: 40, maxUnknownShareNonOther: 0.02,
      collisions: 0, vocabularyMisses: 0, invalidOdds: 0, droppedMarkets: 0, peers: "loaded", peerMatched: 18,
      compared: 18, x12Outliers: 0, max1x2ProbabilityGap: 0.025, maxFrameBytes: 82207, gatedNonOther: 0,
      durationMs: 312000, pass: true,
    });
  });

  it.each<[string, (r: MatchReport[]) => MatchReport[], boolean?]>([
    ["17 matches (A1)", (r) => r.slice(1)],
    ["a match with 89 parsed markets (A2)", (r) => [{ ...r[0], parsed: 89 }, ...r.slice(1)]],
    ["a match with 39 non-OTHER markets (A3)", (r) => [{ ...r[0], nonOther: 39 }, ...r.slice(1)]],
    ["an UNKNOWN share of 2.01% (A4)", (r) => [{ ...r[0], unknownShareNonOther: 0.0201 }, ...r.slice(1)]],
    ["one collision (A5)", (r) => [{ ...r[0], collisions: ["MATCH_WINNER:HOME <- Kartki 1x2"] }, ...r.slice(1)]],
    ["one vocabulary miss (A5)", (r) => [{ ...r[0], vocabularyMisses: ["DOUBLE_CHANCE_BTTS:DRAW_YES <- x"] }, ...r.slice(1)]],
    ["one invalid PZBuk price", (r) => [{ ...r[0], invalidOdds: ["MATCH_WINNER:HOME <- 1x2 (NaN)"] }, ...r.slice(1)]],
    ["one 1X2 outlier (A6)", (r) => [{ ...r[0], x12Outliers: [OUTLIER] }, ...r.slice(1)]],
    ["a gated ordinal market (A12)", (r) => [{ ...r[0], ordinalMarkets: 1, gated: ["2. gol"] }, ...r.slice(1)]],
    ["success:false", (r) => r, false],
  ])("fails on %s", (_label, mutate, success = true) => {
    expect(summarize({ success, reports: mutate(reports()), transport, durationMs: 1, peers: "loaded" }).pass).toBe(false);
  });

  it("fails when peers were requested but unavailable (A6 not checked)", () => {
    const r = reports().map((x) => ({ ...x, peerMatched: false, compared: false, x12ProbabilityGap: null }));
    expect(summarize({ success: true, reports: r, transport, durationMs: 1, peers: "unavailable" })).toMatchObject({ peers: "unavailable", compared: 0, pass: false });
    expect(summarize({ success: true, reports: r, transport, durationMs: 1, peers: "off" })).toMatchObject({ peers: "off", pass: true });
  });

  it("never fails on transport counters, reported ordinals, fail-closed drops or a null gap (A11, A12)", () => {
    const r = reports().map((x) => ({
      ...x, peerMatched: false, compared: false, x12ProbabilityGap: null, ordinalMarkets: 2, templateMarkets: 1,
      droppedMarkets: ['[pzbuk] Dropping MATCH_WINNER "1x2" (id: 1): misread or repeated selections'],
    }));
    const smoke = summarize({ success: true, reports: r, transport: { invalidFrames: 3, chunkedFrames: 2, maxFrameBytes: 2_000_000 }, durationMs: 1, peers: "off" });
    expect(smoke).toMatchObject({
      peerMatched: 0, compared: 0, max1x2ProbabilityGap: null, droppedMarkets: 18, invalidFrames: 3, chunkedFrames: 2,
      maxFrameBytes: 2_000_000, ordinalMarkets: 36, templateMarkets: 18, gatedNonOther: 0, pass: true,
    });
  });

  it("reports zeros when nothing was scraped", () => {
    const smoke = summarize({ success: false, reports: [], transport: { invalidFrames: 0, chunkedFrames: 0, maxFrameBytes: 0 }, durationMs: 5, peers: "off" });
    expect(smoke).toMatchObject({ matches: 0, minParsedMarkets: 0, minNonOther: 0, maxUnknownShareNonOther: 0, max1x2ProbabilityGap: null, pass: false });
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
