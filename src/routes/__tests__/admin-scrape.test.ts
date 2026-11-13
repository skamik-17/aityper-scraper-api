import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ start: vi.fn(), runScrapeAndPersist: vi.fn(), closeAllBrowsers: vi.fn() }));
vi.mock("../../services/scheduler-service.js", async () => ({ runCoordinator: { start: h.start } }));
vi.mock("../../services/scraper-service.js", async () => ({ runScrapeAndPersist: h.runScrapeAndPersist }));
vi.mock("../../scrapers/aggregator.js", async () => ({ closeAllBrowsers: h.closeAllBrowsers }));
vi.mock("../../repositories/scraper-run-repository.js", async () => ({ getRunsSummary: vi.fn() }));

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
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const post = (body: unknown) =>
  fetch(`${base}/api/admin/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CONFIG.ADMIN_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/admin/scrape", () => {
  it("returns 202 with the coordinator's run id", async () => {
    h.start.mockReturnValueOnce({ accepted: true, run: { runId: "6f1c2b9e-0d4a-4c43-9a57-2a1f3c0e9b11", startedAt: new Date("2026-11-07T10:00:00.000Z") } });
    const res = await post({ league: "premier-league", bookmakers: ["pzbuk"] });
    expect(res.status).toBe(202);
    expect((await res.json()).data).toEqual({ runId: "6f1c2b9e-0d4a-4c43-9a57-2a1f3c0e9b11", status: "started",
      league: "premier-league", bookmakers: ["pzbuk"], startedAt: "2026-11-07T10:00:00.000Z" });
    expect(h.start).toHaveBeenCalledWith({ trigger: "admin", leagues: ["premier-league"], bookmakers: ["pzbuk"] });
  });

  it("defaults to the first enabled league and all bookmakers", async () => {
    h.start.mockReturnValueOnce({ accepted: true, run: { runId: "x", startedAt: new Date("2026-11-07T10:00:00.000Z") } });
    await post({});
    expect(h.start).toHaveBeenCalledWith({ trigger: "admin", leagues: [CONFIG.ENABLED_LEAGUES[0]], bookmakers: [...CONFIG.BOOKMAKERS] });
  });

  it("returns 409 with the running run (Review Focus 2)", async () => {
    h.start.mockReturnValueOnce({ accepted: false, running: { runId: "440d2fc6-658b-46fe-b288-05261faa0caf", trigger: "interval",
      startedAt: new Date("2026-11-07T10:00:00.350Z"), leagues: ["premier-league"], bookmakers: [...CONFIG.BOOKMAKERS] } });
    const res = await post({});
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: "SCRAPE_IN_PROGRESS",
      message: "Scrape run 440d2fc6-658b-46fe-b288-05261faa0caf (interval) in progress since 2026-11-07T10:00:00.350Z",
      details: { runId: "440d2fc6-658b-46fe-b288-05261faa0caf", trigger: "interval" } });
    expect(h.runScrapeAndPersist).not.toHaveBeenCalled();
    expect(h.closeAllBrowsers).not.toHaveBeenCalled();
  });

  it("rejects a league that is not enabled (today's default)", async () => {
    const res = await post({ league: "ekstraklasa" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({ code: "INVALID_PARAMS",
      message: `League not enabled: ekstraklasa (enabled: ${CONFIG.ENABLED_LEAGUES.join(", ")})` });
    expect(h.start).not.toHaveBeenCalled();
  });
});
