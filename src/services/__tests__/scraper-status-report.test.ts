import { describe, expect, it } from "vitest";
import { CONFIG } from "../../config/index.js";
import { snapshotFromRun2 } from "../../__tests__/helpers/run-fixtures.js";
import type { ScrapeStats } from "../../types/api.js";
import { buildScraperHealthReport, formatStatusTable } from "../scraper-status-report.js";

// 13 min after run 2 finished (evidence/observability/api-status-snapshot-2026-11-06.json).
const NOW = new Date("2026-11-06T16:16:18.614Z");

describe("buildScraperHealthReport", () => {
  it("orders 14 entries by CONFIG.BOOKMAKERS and counts statuses", () => {
    const r = buildScraperHealthReport("premier-league", snapshotFromRun2(), null, null, new Date("2026-11-06T16:16:18.614Z"));
    expect(r.bookmakers.map((b) => b.bookmaker)).toEqual([...CONFIG.BOOKMAKERS]);
    expect(r.counts).toEqual({ available: 9, stale: 0, error: 5 });
    expect(r.bookmakers.find((b) => b.bookmaker === "totalbet")).toMatchObject({
      status: "error",
      lastError: "No events found from API | fetch HTTP 404 https://totalbet.pl/rest/market/categories/multi/7124/events",
    });
  });

  it("fills every entry field from the run summary", () => {
    const r = buildScraperHealthReport("premier-league", snapshotFromRun2(), null, null, NOW);
    expect(r).toMatchObject({ league: "premier-league", generatedAt: NOW.toISOString(), source: "scraper_runs", lastRun: null, lastAbort: null });
    expect(r.bookmakers.find((b) => b.bookmaker === "betters")).toEqual({
      bookmaker: "betters",
      status: "error",
      lastStatus: "scrape_failed",
      lastRunAt: "2026-11-06T16:00:00.350Z",
      lastSuccessAt: null,
      lastOddsAt: null,
      consecutiveFailures: 1,
      failingSince: "2026-11-06T16:00:00.350Z",
      lastError: "No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485",
      lastMatchesFound: 0,
      lastMarketsSaved: 0,
    });
    expect(r.bookmakers.find((b) => b.bookmaker === "fortuna")).toEqual({
      bookmaker: "fortuna",
      status: "available",
      lastStatus: "success",
      lastRunAt: "2026-11-06T16:00:00.350Z",
      lastSuccessAt: "2026-11-06T16:02:49.798Z",
      lastOddsAt: null,
      consecutiveFailures: 0,
      failingSince: null,
      lastError: null,
      lastMatchesFound: 20,
      lastMarketsSaved: 12897,
    });
  });

  it("a bookmaker without run rows keeps its odds time and reports no run", () => {
    const snap = snapshotFromRun2();
    snap.summaries.delete("lebull");
    snap.lastOddsAt.set("lebull", new Date("2026-08-22T08:00:07.846Z"));
    snap.status.lebull = "stale";
    const entry = buildScraperHealthReport("premier-league", snap, null, null, NOW).bookmakers.find((b) => b.bookmaker === "lebull");
    expect(entry).toEqual({
      bookmaker: "lebull",
      status: "stale",
      lastStatus: null,
      lastRunAt: null,
      lastSuccessAt: null,
      lastOddsAt: "2026-08-22T08:00:07.846Z",
      consecutiveFailures: 0,
      failingSince: null,
      lastError: null,
      lastMatchesFound: 0,
      lastMarketsSaved: 0,
    });
  });

  it("passes the last run and the last abort through", () => {
    const lastRun: ScrapeStats = {
      startedAt: "2026-11-06T16:00:00.350Z",
      completedAt: "2026-11-06T16:02:49.798Z",
      duration: 169,
      successCount: 9,
      errorCount: 5,
      uniqueMatches: 20,
      marketsScraped: 68201,
      marketsSaved: 68201,
      aborted: null,
      failed: [],
    };
    const lastAbort = {
      league: "premier-league",
      reason: "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)",
      at: "2026-11-06T15:00:00.000Z",
    };
    const r = buildScraperHealthReport("premier-league", snapshotFromRun2(), lastRun, lastAbort, NOW);
    expect(r.lastRun).toEqual(lastRun);
    expect(r.lastAbort).toEqual(lastAbort);
  });
});

describe("formatStatusTable", () => {
  const report = () => buildScraperHealthReport("premier-league", snapshotFromRun2(), null, null, NOW);

  it("formats header plus 14 rows with truncated errors", () => {
    const lines = formatStatusTable(buildScraperHealthReport("premier-league", snapshotFromRun2(), null, null, NOW)).split("\n");
    expect(lines[0]).toMatch(/^BOOKMAKER\s+STATUS\s+LAST RUN\s+LAST SUCCESS\s+FAILS\s+ERROR$/);
    expect(lines).toHaveLength(15);
    expect(lines.find((l) => l.startsWith("betters"))).toMatch(/^betters\s+error\s+2026-11-06T16:00:00Z\s+-\s+1\s+No events found from API \| document HTTP 404/);
  });

  it("a successful row: second-precision Z timestamps, 0 fails, - for no error", () => {
    const fortuna = formatStatusTable(report()).split("\n").find((l) => l.startsWith("fortuna"));
    expect(fortuna).toMatch(/^fortuna\s+available\s+2026-11-06T16:00:00Z\s+2026-11-06T16:02:49Z\s+0\s+-$/);
  });

  it("cuts an error to 120 chars ending in an ellipsis", () => {
    const r = report();
    const long = "Batch insert failed (12 of 12 batches): " + "x".repeat(200);
    r.bookmakers.find((b) => b.bookmaker === "sts")!.lastError = long;
    const sts = formatStatusTable(r).split("\n").find((l) => l.startsWith("sts"))!;
    const cell = sts.slice(sts.indexOf("Batch insert failed"));
    expect(cell).toHaveLength(120);
    expect(cell).toBe(long.slice(0, 119) + "…");
  });

  it("an error of exactly 120 chars is kept whole", () => {
    const r = report();
    const exact = "y".repeat(120);
    r.bookmakers.find((b) => b.bookmaker === "sts")!.lastError = exact;
    expect(formatStatusTable(r).split("\n").find((l) => l.startsWith("sts"))!.endsWith(" " + exact)).toBe(true);
  });

  it("keeps one line per bookmaker when an error spans lines", () => {
    const r = report();
    r.bookmakers.find((b) => b.bookmaker === "pzbuk")!.lastError = "No WebSocket data captured\n  at page.goto\r\n\tws closed";
    const lines = formatStatusTable(r).split("\n");
    expect(lines).toHaveLength(15);
    expect(lines.find((l) => l.startsWith("pzbuk"))).toMatch(/No WebSocket data captured at page\.goto ws closed$/);
  });

  it("a blank error prints as -", () => {
    const r = report();
    r.bookmakers.find((b) => b.bookmaker === "sts")!.lastError = " \n ";
    expect(formatStatusTable(r).split("\n").find((l) => l.startsWith("sts"))).toMatch(/\s0\s+-$/);
  });

  it("aligns every column under its header", () => {
    const lines = formatStatusTable(report()).split("\n");
    const header = lines[0];
    const starts = ["STATUS", "LAST RUN", "LAST SUCCESS", "FAILS", "ERROR"].map((h) => header.indexOf(h));
    for (const line of lines.slice(1)) {
      for (const start of starts) {
        // Each column starts after a two-space gutter.
        expect(line.slice(start - 2, start)).toBe("  ");
        expect(line[start]).not.toBe(" ");
      }
    }
  });
});
