import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_ID } from "../../__tests__/helpers/run-fixtures.js";

const { getRunsSummary } = vi.hoisted(() => ({ getRunsSummary: vi.fn() }));
vi.mock("../../repositories/scraper-run-repository.js", async () => ({ getRunsSummary }));
// The scrape trigger is not under test; keep the scraper tree (Playwright) out of this file.
vi.mock("../../services/scraper-service.js", async () => ({ runScrapeAndPersist: vi.fn() }));
// admin imports the coordinator; scheduler-service pulls in the aggregator, i.e. the whole scraper tree.
vi.mock("../../services/scheduler-service.js", async () => ({ runCoordinator: { start: vi.fn() } }));

import adminRouter from "../admin.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { CONFIG } from "../../config/index.js";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express().use(express.json()).use("/api/admin", adminRouter).use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

beforeEach(() => {
  getRunsSummary.mockResolvedValue({
    runs: [
      {
        batchId: RUN_ID,
        league: "premier-league",
        startedAt: new Date("2026-11-06T16:00:00.350Z"),
        finishedAt: new Date("2026-11-06T16:02:49.798Z"),
        totalDurationMs: 169448,
        results: [
          { bookmaker: "betclic", status: "success", matchesFound: 20, marketsSaved: 3150, durationMs: 9100 },
          {
            bookmaker: "fortuna", status: "partial", matchesFound: 20, marketsSaved: 2801, durationMs: 9800,
            error: "Batch insert failed (1 of 7 batches): Could not query the database for the schema cache. Retrying. [PGRST002]",
          },
          {
            bookmaker: "betters", status: "scrape_failed", matchesFound: 0, marketsSaved: 0, durationMs: 8100,
            error: "No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485",
          },
        ],
      },
    ],
    total: 1,
  });
});

describe("GET /api/admin/runs", () => {
  it("counts partial as OK in /api/admin/runs", async () => {
    const res = await fetch(`${base}/api/admin/runs`, { headers: { Authorization: `Bearer ${CONFIG.ADMIN_API_KEY}` } });
    expect(res.status).toBe(200);
    const run = (await res.json()).data.runs[0];
    expect(run.runId).toBe(RUN_ID);
    expect(run.summary).toMatchObject({ successCount: 2, errorCount: 1, totalMatchesFound: 40 });
    expect(run.results.map((r: { status: string }) => r.status)).toEqual(["success", "success", "error"]);
  });
});
