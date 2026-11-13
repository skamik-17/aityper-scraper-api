import { beforeEach, describe, expect, it, vi } from "vitest";
import { outcome } from "../../__tests__/helpers/run-fixtures.js";
import { scraperHealth } from "../scraper-health.js";

const FORBET_ERR =
  "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)";

beforeEach(() => {
  scraperHealth.reset();
  vi.clearAllMocks();
});

describe("scraperHealth.recordOutcome", () => {
  it("persist_failed is a failure (today it would read healthy 100%)", () => {
    scraperHealth.recordOutcome(outcome({ bookmaker: "forbet", status: "persist_failed", error: FORBET_ERR }));
    expect(scraperHealth.getHealth("forbet")).toMatchObject({ status: "failing", successRate: 0, consecutiveFailures: 1 });
    expect(scraperHealth.getHealth("forbet").lastError).toContain("ECONNREFUSED");
  });

  it("consecutiveFailures resets on success", () => {
    scraperHealth.recordOutcome(outcome({ bookmaker: "betcris", status: "scrape_failed", error: "No WebSocket data captured" }));
    scraperHealth.recordOutcome(outcome({ bookmaker: "betcris", status: "scrape_failed", error: "No WebSocket data captured" }));
    expect(scraperHealth.getHealth("betcris").consecutiveFailures).toBe(2);
    scraperHealth.recordOutcome(outcome({ bookmaker: "betcris", status: "success", marketsSaved: 9753 }));
    const h = scraperHealth.getHealth("betcris");
    expect(h.consecutiveFailures).toBe(0);
    expect(h).toMatchObject({ lastStatus: "success", successRate: 33, status: "failing" });
  });

  it("empty counts as a failure and partial as OK (owner decision A6)", () => {
    scraperHealth.recordOutcome(outcome({ bookmaker: "etoto", status: "empty", matchesFound: 0, error: "Scraper reported success with 0 matches" }));
    scraperHealth.recordOutcome(outcome({ bookmaker: "fortuna", status: "partial", marketsSaved: 2801, error: "Batch insert failed (1 of 7 batches): x" }));
    expect(scraperHealth.getHealth("etoto")).toMatchObject({ status: "failing", consecutiveFailures: 1, lastStatus: "empty" });
    expect(scraperHealth.getHealth("fortuna")).toMatchObject({ status: "healthy", successRate: 100, consecutiveFailures: 0, lastStatus: "partial" });
  });

  it("lastSuccessAt is the finish time of the newest OK outcome", () => {
    scraperHealth.recordOutcome(outcome({ bookmaker: "sts", status: "success", finishedAt: new Date("2026-11-06T15:02:49.048Z") }));
    scraperHealth.recordOutcome(outcome({ bookmaker: "sts", status: "persist_failed", error: FORBET_ERR, finishedAt: new Date("2026-11-06T16:02:49.048Z") }));
    expect(scraperHealth.getHealth("sts")).toMatchObject({
      lastStatus: "persist_failed",
      lastSuccessAt: "2026-11-06T15:02:49.048Z",
      lastError: FORBET_ERR,
    });
  });

  it("a bookmaker without outcomes reads as no data", () =>
    expect(scraperHealth.getHealth("pzbuk")).toEqual({
      scraper: "pzbuk",
      successRate: 0,
      avgDuration: 0,
      status: "healthy",
      lastError: null,
      lastStatus: null,
      consecutiveFailures: 0,
      lastSuccessAt: null,
    }));

  it("getFailingScrapers flags a bookmaker that fails most outcome-classified runs", () => {
    for (const status of ["empty", "persist_failed", "scrape_failed", "success", "success"] as const) {
      scraperHealth.recordOutcome(outcome({ bookmaker: "lebull", status }));
    }
    for (const status of ["success", "success", "success", "success", "persist_failed"] as const) {
      scraperHealth.recordOutcome(outcome({ bookmaker: "sts", status }));
    }
    expect(scraperHealth.getFailingScrapers()).toEqual(["lebull"]);
    expect(scraperHealth.getAllHealth().map((h) => h.scraper)).toEqual(["lebull", "sts"]);
  });
});

describe("scraperHealth.getRecentOutcomes", () => {
  it("returns one league's outcomes newest first, at most 50 per bookmaker", () => {
    const base = Date.parse("2026-11-04T00:00:00.000Z");
    for (let i = 0; i < 52; i++) {
      scraperHealth.recordOutcome(
        outcome({ runId: `run-${i}`, bookmaker: "betters", status: "scrape_failed", startedAt: new Date(base + i * 3_600_000) }),
      );
    }
    scraperHealth.recordOutcome(outcome({ runId: "run-sts", bookmaker: "sts", startedAt: new Date(base + 10.5 * 3_600_000) }));
    scraperHealth.recordOutcome(outcome({ runId: "run-laliga", bookmaker: "sts", league: "la-liga" }));

    const recent = scraperHealth.getRecentOutcomes("premier-league");
    expect(recent.filter((o) => o.bookmaker === "betters")).toHaveLength(50);
    expect(recent).toHaveLength(51);
    expect(recent[0].runId).toBe("run-51");
    expect(recent.map((o) => o.runId)).not.toContain("run-0");
    expect(recent.map((o) => o.runId)).not.toContain("run-1");
    expect(recent.map((o) => o.runId)).not.toContain("run-laliga");
    const times = recent.map((o) => o.startedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(scraperHealth.getRecentOutcomes("la-liga").map((o) => o.runId)).toEqual(["run-laliga"]);
    expect(scraperHealth.getRecentOutcomes("serie-a")).toEqual([]);
  });
});

describe("scraperHealth aborts", () => {
  it("remembers the last aborted run until reset", () => {
    expect(scraperHealth.getLastAbort()).toBeNull();
    scraperHealth.recordAbort("premier-league", "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)", new Date("2026-11-06T15:44:05.000Z"));
    expect(scraperHealth.getLastAbort()).toEqual({
      league: "premier-league",
      reason: "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)",
      at: "2026-11-06T15:44:05.000Z",
    });
    scraperHealth.recordOutcome(outcome({ bookmaker: "sts" }));
    scraperHealth.reset();
    expect(scraperHealth.getLastAbort()).toBeNull();
    expect(scraperHealth.getRecentOutcomes("premier-league")).toEqual([]);
    expect(scraperHealth.getAllHealth()).toEqual([]);
  });
});
