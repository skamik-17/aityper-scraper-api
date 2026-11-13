import { describe, expect, it } from "vitest";
import { buildIncrementalReport, formatIncrementalReport } from "../incremental-report.js";

const T = Date.parse("2026-11-08T00:00:00.000Z");
const MIN = 60_000;
const W = { from: T, to: T + 24 * 60 * MIN };

/** One [IncrementalPass] line; defaults: a warm forbet plan-only pass. */
function pass(p: Record<string, unknown> = {}, atMs = T + 5 * MIN): string {
  return `[IncrementalPass] ${JSON.stringify({
    runId: "r",
    bookmaker: "forbet",
    league: "premier-league",
    mode: "plan-only",
    ledger: "warm",
    listed: 19,
    due: 1,
    listingRequests: 1,
    listingBytes: 142_000,
    requests: 1,
    bytes: 142_000,
    preAgeMinByTier: {},
    at: new Date(atMs).toISOString(),
    ...p,
  })}`;
}
function full(p: Record<string, unknown> = {}, atMs = T + 5 * MIN): string {
  return `[FullPassCost] ${JSON.stringify({
    runId: "r",
    bookmaker: "forbet",
    league: "premier-league",
    matches: 19,
    requests: 20,
    bytes: 6_500_000,
    durationMs: 3000,
    at: new Date(atMs).toISOString(),
    ...p,
  })}`;
}

/** 144 warm passes 10 min apart with Σ due 152, and 24 hourly full passes. */
function quietDay(): string[] {
  const lines: string[] = [];
  for (let i = 0; i < 144; i++) lines.push(pass({ due: i < 8 ? 2 : 1 }, T + i * 10 * MIN));
  for (let i = 0; i < 24; i++) lines.push(full({}, T + i * 60 * MIN + MIN));
  return lines;
}

describe("buildIncrementalReport", () => {
  it("quiet window passes at under half the bytes", () => {
    const r = buildIncrementalReport(quietDay(), { ...W, window: "quiet" });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      bookmaker: "forbet",
      league: "premier-league",
      warmPasses: 144,
      coldPasses: 0,
      fullPasses: 24,
      fullBytes: 156_000_000,
      estBytes: 71_312_000,
      fullRequests: 480,
      estRequests: 296,
      failures: [],
    });
    expect(r.totalsOk).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("staleness above tier + 12 min fails the window", () => {
    const lines = quietDay();
    lines[10] = pass({ preAgeMinByTier: { lt1h: 23, gt72h: 300 } }, T + 100 * MIN);
    const r = buildIncrementalReport(lines, { ...W, window: "quiet" });
    expect(r.rows[0].maxPreAgeMin).toEqual({ lt1h: 23, gt72h: 300 });
    expect(r.failures).toContain("forbet/premier-league: lt1h max age 23 min > 22");
    expect(r.ok).toBe(false);
  });

  it("cold passes are excluded and more than two fail", () => {
    const lines = quietDay();
    for (let i = 0; i < 3; i++) lines.push(pass({ ledger: "cold", due: 19, listingBytes: 999_999_999 }, T + (i + 1) * MIN));
    const r = buildIncrementalReport(lines, { ...W, window: "quiet" });
    expect(r.rows[0]).toMatchObject({ coldPasses: 3, warmPasses: 144, estBytes: 71_312_000 });
    expect(r.failures).toContain("forbet/premier-league: 3 cold passes > 2");
    expect(r.ok).toBe(false);
  });

  it("matchday needs lt1h and 1to3h observations", () => {
    const lines = quietDay();
    const r = buildIncrementalReport(lines, { ...W, window: "matchday" });
    expect(r.failures).toEqual(["forbet/premier-league: no lt1h observation", "forbet/premier-league: no 1to3h observation"]);
    lines[3] = pass({ preAgeMinByTier: { lt1h: 9, "1to3h": 15 } }, T + 30 * MIN);
    expect(buildIncrementalReport(lines, { ...W, window: "matchday" }).ok).toBe(true);
  });

  it("ignores lines outside the window and non-JSON lines", () => {
    const lines = [
      ...quietDay(),
      pass({ listingBytes: 999_999_999 }, T - MIN),
      full({ bytes: 1 }, W.to),
      "[IncrementalPass] {not json",
      "[Aggregator/FullOffer] forbet success: 19 matches",
    ];
    const r = buildIncrementalReport(lines, { ...W, window: "quiet" });
    expect(r.rows[0]).toMatchObject({ warmPasses: 144, fullPasses: 24, estBytes: 71_312_000 });
  });

  it("a window with no passes fails", () => {
    const r = buildIncrementalReport([], { ...W, window: "quiet" });
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual(["no [IncrementalPass] lines in the window"]);
  });

  it("live mode counts db passes as warm and checks only pass counts and staleness", () => {
    const lines: string[] = [];
    for (let i = 0; i < 140; i++) lines.push(pass({ mode: i % 6 === 0 ? "forced" : "incremental", ledger: "db", bytes: 500_000, requests: 3 }, T + i * 10 * MIN));
    lines.push(pass({ mode: "plan-only" }));
    const r = buildIncrementalReport(lines, { ...W, window: "matchday", live: true });
    expect(r.rows[0]).toMatchObject({ warmPasses: 140, coldPasses: 0, fullPasses: 0, estBytes: 70_000_000, estRequests: 420 });
    expect(r.failures).toEqual(["forbet/premier-league: no lt1h observation", "forbet/premier-league: no 1to3h observation"]);
    expect(buildIncrementalReport(lines, { ...W, window: "quiet", live: true }).ok).toBe(true);
  });
});

describe("formatIncrementalReport", () => {
  it("prints one row per bookmaker-league and PASS/FAIL", () => {
    const lines = [...quietDay(), ...quietDay().map((l) => l.replace('"forbet"', '"etoto"'))];
    lines.push(pass({ bookmaker: "etoto", preAgeMinByTier: { lt1h: 30 } }, T + 7 * MIN));
    const out = formatIncrementalReport(buildIncrementalReport(lines, { ...W, window: "quiet" }));
    const rows = out.split("\n").filter((l) => /^(forbet|etoto)\/premier-league /.test(l));
    expect(rows).toHaveLength(2);
    expect(rows.find((l) => l.startsWith("forbet"))).toMatch(/ PASS$/);
    expect(rows.find((l) => l.startsWith("etoto"))).toMatch(/ FAIL$/);
    expect(out).toContain("etoto/premier-league: lt1h max age 30 min > 22");
    expect(out.trimEnd().split("\n").pop()).toBe("RESULT: FAIL");
  });
});
