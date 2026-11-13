import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { RUN_ID, snapshotFromRun2 } from "../../__tests__/helpers/run-fixtures.js";

const m = vi.hoisted(() => ({
  getBookmakerStatusSnapshot: vi.fn(),
  getSchedulerStatus: vi.fn(),
  testConnection: vi.fn(),
}));

// Partial mock: snapshotFromRun2() needs the real summary and status functions.
vi.mock("../../services/bookmaker-status.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/bookmaker-status.js")>()),
  getBookmakerStatusSnapshot: m.getBookmakerStatusSnapshot,
}));
vi.mock("../../services/scheduler-service.js", async () => ({ getSchedulerStatus: m.getSchedulerStatus }));
vi.mock("../../config/database.js", async () => ({
  testConnection: m.testConnection,
  probeDatabase: vi.fn(),
  waitForDatabase: vi.fn(),
  getSupabase: vi.fn(),
}));
// toScrapeStats is real; keep the scraper tree (Playwright) out of this file.
vi.mock("../../scrapers/aggregator.js", async () => ({ runAllFullOfferScrapers: vi.fn(), closeAllBrowsers: vi.fn() }));

import healthRouter from "../health.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { scraperHealth } from "../../services/scraper-health.js";
import type { ScrapeResult } from "../../services/scraper-service.js";

let server: Server;
let base: string;

beforeAll(async () => {
  // No auth middleware in front of the router: the endpoint must not need one.
  const app = express().use("/api/health", healthRouter).use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

const DB_DOWN = "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)";

function run2Result(): ScrapeResult {
  return {
    runId: RUN_ID,
    league: "premier-league",
    startedAt: new Date("2026-11-06T16:00:00.350Z"),
    completedAt: new Date("2026-11-06T16:02:52.000Z"),
    duration: 171650,
    successCount: 9,
    errorCount: 5,
    uniqueMatches: 20,
    marketsScraped: 70000,
    errors: [],
    aborted: null,
    marketsSaved: 68201,
    outcomes: [],
  };
}

beforeEach(() => {
  scraperHealth.reset();
  m.getBookmakerStatusSnapshot.mockReset().mockResolvedValue(snapshotFromRun2());
  m.getSchedulerStatus.mockReset().mockReturnValue({
    isScheduled: false,
    isRunning: false,
    lastResults: {},
    nextRun: null,
    enabledLeagues: ["premier-league"],
  });
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/health/scrapers", () => {
  it("is reachable without an Authorization header", async () => {
    const res = await fetch(`${base}/api/health/scrapers?league=premier-league`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.bookmakers).toHaveLength(14);
    expect(body.data.league).toBe("premier-league");
  });

  it("rejects a malformed league slug", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await fetch(`${base}/api/health/scrapers?league=../etc`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_PARAMS");
    expect(m.getBookmakerStatusSnapshot).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("defaults to the first enabled league and reports its last run and abort", async () => {
    m.getSchedulerStatus.mockReturnValue({
      isScheduled: true,
      isRunning: false,
      lastResults: { "premier-league": run2Result() },
      nextRun: null,
      enabledLeagues: ["premier-league"],
    });
    scraperHealth.recordAbort("premier-league", DB_DOWN, new Date("2026-11-06T15:00:00.000Z"));

    const body = await (await fetch(`${base}/api/health/scrapers`)).json();
    expect(m.getBookmakerStatusSnapshot).toHaveBeenCalledWith("premier-league");
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      league: "premier-league",
      source: "scraper_runs",
      counts: { available: 9, stale: 0, error: 5 },
      lastRun: { startedAt: "2026-11-06T16:00:00.350Z", duration: 172, marketsSaved: 68201, aborted: null, failed: [] },
      lastAbort: { league: "premier-league", reason: DB_DOWN, at: "2026-11-06T15:00:00.000Z" },
    });
  });

  it("does not report the run or the abort of another league", async () => {
    m.getSchedulerStatus.mockReturnValue({
      isScheduled: true,
      isRunning: false,
      lastResults: { "la-liga": { ...run2Result(), league: "la-liga" } },
      nextRun: null,
      enabledLeagues: ["premier-league"],
    });
    scraperHealth.recordAbort("la-liga", DB_DOWN, new Date("2026-11-06T15:00:00.000Z"));

    const body = await (await fetch(`${base}/api/health/scrapers?league=premier-league`)).json();
    expect(body.data.lastRun).toBeNull();
    expect(body.data.lastAbort).toBeNull();
  });
});
