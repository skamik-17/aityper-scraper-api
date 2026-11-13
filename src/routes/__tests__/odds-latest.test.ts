import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotFromRun2 } from "../../__tests__/helpers/run-fixtures.js";

const m = vi.hoisted(() => ({
  getAggregatedOdds: vi.fn(),
  getBookmakerStatusSnapshot: vi.fn(),
  getLastSuccessfulScrapeTime: vi.fn(),
}));

// The real odds service and route; only the DB reads are stubbed.
vi.mock("../../repositories/odds-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../repositories/odds-repository.js")>()),
  getAggregatedOdds: m.getAggregatedOdds,
}));
vi.mock("../../services/bookmaker-status.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/bookmaker-status.js")>()),
  getBookmakerStatusSnapshot: m.getBookmakerStatusSnapshot,
}));
// The global (all-league) last success: a later run of another league must not set this league's lastUpdated.
vi.mock("../../repositories/scraper-run-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../repositories/scraper-run-repository.js")>()),
  getLastSuccessfulScrapeTime: m.getLastSuccessfulScrapeTime,
}));

import oddsRouter from "../odds.js";
import { errorHandler } from "../../middleware/error-handler.js";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express().use("/api/odds", oddsRouter).use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

beforeEach(() => {
  m.getAggregatedOdds.mockReset().mockResolvedValue([]);
  m.getBookmakerStatusSnapshot.mockReset().mockResolvedValue(snapshotFromRun2());
  m.getLastSuccessfulScrapeTime.mockReset().mockResolvedValue(new Date("2026-11-06T17:30:00.000Z"));
});

describe("GET /api/odds meta", () => {
  it("serves the league snapshot: status, bookmakerHealth and the league's last OK run", async () => {
    const { meta } = await (await fetch(`${base}/api/odds?league=premier-league`)).json();
    expect(m.getBookmakerStatusSnapshot).toHaveBeenCalledWith("premier-league");
    expect(Object.keys(meta.bookmakerHealth)).toHaveLength(14);
    expect(meta.bookmakerHealth.betters).toEqual({
      status: "error",
      lastSuccessAt: null,
      failingSince: "2026-11-06T16:00:00.350Z",
      consecutiveFailures: 1,
    });
    expect(Object.values(meta.bookmakerStatus).filter((s) => s === "available")).toHaveLength(9);
    expect(meta.bookmakerStatus.betters).toBe("error");
    expect(meta.lastUpdated).toBe("2026-11-06T16:02:49.798Z");
  });
});
