import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG } from "../../config/index.js";
import { snapshotFromRun2 } from "../../__tests__/helpers/run-fixtures.js";
import type { ScrapeStats } from "../../types/api.js";
import { getBookmakerStatusSnapshot } from "../bookmaker-status.js";
import { buildScraperHealthReport, formatStatusTable, statusExitCode } from "../scraper-status-report.js";

// Only the snapshot's three DB reads are stubbed; the run fixtures keep the real toScraperRunInsert.
const repo = vi.hoisted(() => ({
  getRecentRunRows: vi.fn(),
  getLastSuccessfulScrapeTime: vi.fn(),
  getOddsFreshnessByBookmaker: vi.fn(),
}));
vi.mock("../../repositories/scraper-run-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../repositories/scraper-run-repository.js")>()),
  getRecentRunRows: repo.getRecentRunRows,
  getLastSuccessfulScrapeTime: repo.getLastSuccessfulScrapeTime,
}));
vi.mock("../../repositories/odds-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../repositories/odds-repository.js")>()),
  getOddsFreshnessByBookmaker: repo.getOddsFreshnessByBookmaker,
}));

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

  it("counts every status bucket, stale included", () => {
    // Run 2 has no stale bookmaker, so the first test cannot tell a counted stale from a dropped one.
    const snap = snapshotFromRun2();
    for (const bm of ["lebull", "sts"] as const) {
      snap.status[bm] = "stale";
      snap.health[bm].status = "stale";
    }
    const r = buildScraperHealthReport("premier-league", snap, null, null, NOW);
    expect(r.counts).toEqual({ available: 8, stale: 2, error: 4 });
    expect(r.bookmakers.find((b) => b.bookmaker === "sts")?.status).toBe("stale");
    expect(r.bookmakers.find((b) => b.bookmaker === "lebull")?.status).toBe("stale");
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

describe("statusExitCode", () => {
  const report = () => buildScraperHealthReport("premier-league", snapshotFromRun2(), null, null, NOW);

  it("is 0 when the run history was read and no bookmaker reaches the threshold", () => {
    // Run 2: five bookmakers failed once each.
    expect(statusExitCode(report(), 3)).toEqual({ code: 0, message: null });
  });

  it("is 1 and lists, in CONFIG.BOOKMAKERS order, every bookmaker at or above the threshold", () => {
    expect(statusExitCode(report(), 1)).toEqual({
      code: 1,
      message: "5 bookmaker(s) failed 1+ runs in a row: betters (1), lebull (1), betcris (1), pzbuk (1), totalbet (1)",
    });
  });

  it("the threshold is inclusive", () => {
    const r = report();
    r.bookmakers.find((b) => b.bookmaker === "pzbuk")!.consecutiveFailures = 3;
    expect(statusExitCode(r, 3)).toEqual({ code: 1, message: "1 bookmaker(s) failed 3+ runs in a row: pzbuk (3)" });
    r.bookmakers.find((b) => b.bookmaker === "pzbuk")!.consecutiveFailures = 2;
    expect(statusExitCode(r, 3).code).toBe(0);
  });

  it("is 2, never 0 or 1, for a report without run history (source odds_only)", () => {
    const snap = snapshotFromRun2();
    snap.source = "odds_only";
    snap.summaries.clear();
    const r = buildScraperHealthReport("premier-league", snap, null, null, NOW);
    for (const threshold of [1, 3]) {
      expect(statusExitCode(r, threshold)).toEqual({ code: 2, message: "run history unavailable (source=odds_only)" });
    }
  });

  describe("on the snapshot's odds_only fallback", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.clearAllMocks();
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      repo.getOddsFreshnessByBookmaker.mockResolvedValue(new Map([["fortuna", new Date("2026-11-06T16:00:45.385Z")]]));
      repo.getLastSuccessfulScrapeTime.mockResolvedValue(new Date("2026-11-06T16:02:49.798Z"));
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    async function reportFor(): Promise<ReturnType<typeof buildScraperHealthReport>> {
      return buildScraperHealthReport("premier-league", await getBookmakerStatusSnapshot("premier-league", NOW), null, null, NOW);
    }

    it("a rejected scraper_runs read exits 2, although its table shows 0 fails everywhere", async () => {
      repo.getRecentRunRows.mockRejectedValue(new Error("scraper_runs read failed: canceling statement due to statement timeout"));
      const r = await reportFor();
      expect(r.source).toBe("odds_only");
      // The false green this guards against: every row reads FAILS 0.
      expect(r.bookmakers.every((b) => b.consecutiveFailures === 0)).toBe(true);
      expect(statusExitCode(r, 3)).toEqual({ code: 2, message: "run history unavailable (source=odds_only)" });
    });

    it("a scraper_runs row the summary cannot read exits 2", async () => {
      repo.getRecentRunRows.mockResolvedValue([
        { bookmaker: "betters", status: "scrape_failed", started_at: "not a timestamp", finished_at: null, run_id: null,
          error_message: "No events found from API", matches_found: 0, markets_saved: 0 },
      ]);
      const r = await reportFor();
      expect(r.source).toBe("odds_only");
      expect(statusExitCode(r, 3)).toEqual({ code: 2, message: "run history unavailable (source=odds_only)" });
    });

    it("a readable run history is judged on its failures", async () => {
      repo.getRecentRunRows.mockResolvedValue([
        { bookmaker: "betters", status: "scrape_failed", started_at: "2026-11-06T16:00:00.35+00:00", finished_at: null, run_id: null,
          error_message: "No events found from API", matches_found: 0, markets_saved: 0 },
      ]);
      const r = await reportFor();
      expect(r.source).toBe("scraper_runs");
      expect(statusExitCode(r, 3)).toEqual({ code: 0, message: null });
      expect(statusExitCode(r, 1)).toEqual({ code: 1, message: "1 bookmaker(s) failed 1+ runs in a row: betters (1)" });
    });
  });
});
