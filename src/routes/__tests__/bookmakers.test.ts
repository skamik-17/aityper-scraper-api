import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RUN2_FAILED, snapshotFromRun2 } from "../../__tests__/helpers/run-fixtures.js";

const m = vi.hoisted(() => ({
  getBookmakerStatusSnapshot: vi.fn(),
  getAverageScrapeDurations: vi.fn(),
}));

// Partial mocks: snapshotFromRun2() needs the real summary functions and row mapping.
vi.mock("../../services/bookmaker-status.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/bookmaker-status.js")>()),
  getBookmakerStatusSnapshot: m.getBookmakerStatusSnapshot,
}));
vi.mock("../../repositories/scraper-run-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../repositories/scraper-run-repository.js")>()),
  getAverageScrapeDurations: m.getAverageScrapeDurations,
}));

import bookmakersRouter from "../bookmakers.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { CONFIG } from "../../config/index.js";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express().use("/api/bookmakers", bookmakersRouter).use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

beforeEach(() => {
  m.getBookmakerStatusSnapshot.mockReset().mockResolvedValue(snapshotFromRun2());
  m.getAverageScrapeDurations.mockReset().mockResolvedValue(new Map([["fortuna", 9800]]));
});

type Info = { id: string; status: string; lastSuccessfulScrape: string | null; lastError?: string; matchesFound: number; avgScrapeDurationMs: number | null };
const find = (list: Info[], id: string) => list.find((b) => b.id === id)!;

describe("GET /api/bookmakers", () => {
  it("serves the run-2 snapshot of the scraped league by default", async () => {
    const body = await (await fetch(`${base}/api/bookmakers`)).json();
    expect(m.getBookmakerStatusSnapshot).toHaveBeenCalledWith(CONFIG.ENABLED_LEAGUES[0]);
    expect(body.meta).toEqual({ totalBookmakers: 14, availableCount: 9, errorCount: 5 });

    const bookmakers: Info[] = body.data.bookmakers;
    expect(find(bookmakers, "betters")).toMatchObject({
      status: "error",
      lastSuccessfulScrape: null,
      lastError: RUN2_FAILED.betters,
      matchesFound: 0,
    });
    expect(find(bookmakers, "fortuna")).toMatchObject({
      status: "available",
      lastSuccessfulScrape: "2026-11-06T16:02:49.798Z",
      matchesFound: 20,
      avgScrapeDurationMs: 9800,
    });
    expect(find(bookmakers, "fortuna")).not.toHaveProperty("lastError");
  });

  it("takes the league from the query", async () => {
    await fetch(`${base}/api/bookmakers?league=la-liga`);
    expect(m.getBookmakerStatusSnapshot).toHaveBeenCalledWith("la-liga");
  });

  it("falls back to the newest odds time for a bookmaker without run rows", async () => {
    const snap = snapshotFromRun2();
    snap.summaries.delete("lebull");
    snap.lastOddsAt.set("lebull", new Date("2026-08-22T08:00:07.846Z"));
    snap.status.lebull = "stale";
    m.getBookmakerStatusSnapshot.mockResolvedValue(snap);

    const bookmakers: Info[] = (await (await fetch(`${base}/api/bookmakers`)).json()).data.bookmakers;
    expect(find(bookmakers, "lebull")).toMatchObject({
      status: "stale",
      lastSuccessfulScrape: "2026-08-22T08:00:07.846Z",
      matchesFound: 0,
    });
    expect(find(bookmakers, "lebull")).not.toHaveProperty("lastError");
  });
});
