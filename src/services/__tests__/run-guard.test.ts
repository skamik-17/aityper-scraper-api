import { describe, expect, it, vi } from "vitest";
import { probeCurrentRun } from "../run-guard.js";

const URL = "http://localhost:3001/api/health";
const NOW = Date.parse("2026-11-07T10:00:00.000Z");
const health = (data: Record<string, unknown>) =>
  vi.fn(async () => new Response(JSON.stringify({ success: true, data: { status: "ok", ...data } }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

describe("probeCurrentRun", () => {
  it("running when /api/health reports currentRun", async () => {
    expect(await probeCurrentRun(URL, { fetchImpl: health({ currentRun: { runId: "440d2fc6-658b-46fe-b288-05261faa0caf", trigger: "interval", startedAt: "2026-11-07T09:59:00.000Z" }, nextScrapeAt: null }), now: () => NOW }))
      .toEqual({ state: "running", run: { runId: "440d2fc6-658b-46fe-b288-05261faa0caf", trigger: "interval", startedAt: "2026-11-07T09:59:00.000Z" } });
  });

  it("due within 5 min, idle otherwise", async () => {
    expect((await probeCurrentRun(URL, { fetchImpl: health({ currentRun: null, nextScrapeAt: "2026-11-07T10:04:59.000Z" }), now: () => NOW })).state).toBe("due");
    expect(await probeCurrentRun(URL, { fetchImpl: health({ currentRun: null, nextScrapeAt: "2026-11-07T10:05:01.000Z" }), now: () => NOW }))
      .toEqual({ state: "idle", nextScrapeAt: "2026-11-07T10:05:01.000Z" });
    expect(await probeCurrentRun(URL, { fetchImpl: health({ currentRun: null, nextScrapeAt: null }), now: () => NOW })).toEqual({ state: "idle", nextScrapeAt: null });
  });

  it("unreachable on a network error or a non-200, never throws", async () => {
    expect(await probeCurrentRun(URL, { fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch }))
      .toEqual({ state: "unreachable", error: "fetch failed" });
    expect((await probeCurrentRun(URL, { fetchImpl: vi.fn().mockResolvedValue(new Response("x", { status: 503 })) as unknown as typeof fetch })).state).toBe("unreachable");
  });
});
