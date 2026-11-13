import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcTree } from "../../../utils/proc-sampler.js";
import {
  diffHttpStats,
  diffTransportStats,
  formatScrapeMetricsLine,
  readTransportStats,
  startCycleSampler,
  startEventLoopWindow,
  type JobMetricsLine,
} from "../scrape-metrics.js";

const MB = 2 ** 20;
const tree = (nodeMb: number, chromiumMb: number): ProcTree => ({
  rootRssBytes: nodeMb * MB,
  chromium: [{ pid: 200, rssBytes: chromiumMb * MB, cpuTicks: 0 }],
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("scrape metrics", () => {
  it("one /proc read per tick feeds every tracked job; a job sees only the ticks while it was tracked", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce(tree(200, 100)).mockResolvedValueOnce(tree(300, 400)).mockResolvedValue(tree(250, 150));
    const s = startCycleSampler({ intervalMs: 1_000, read });
    const a = s.track();
    await vi.advanceTimersByTimeAsync(1_000);
    const b = s.track();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(a.stop()).toMatchObject({ samples: 3, nodePeakRssMb: 300, chromiumPeakRssMb: 400 });
    expect(b.stop()).toMatchObject({ samples: 2, nodePeakRssMb: 300 });
    await s.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("a failed /proc read is skipped and the sampler keeps ticking", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValueOnce(new Error("ENOENT")).mockResolvedValue(tree(100, 0));
    const s = startCycleSampler({ intervalMs: 1_000, read });
    const a = s.track();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(a.stop()).toMatchObject({ samples: 1, nodePeakRssMb: 100 });
    await s.stop();
  });

  it("diffs HttpClient stats including byStatus; reads transport stats only from a TransportStatsSource", () => {
    expect(diffHttpStats({ requests: 3, retries: 0, failures: 0, bytes: 100, byStatus: { "200": 3 } },
      { requests: 23, retries: 1, failures: 1, bytes: 5_100, byStatus: { "200": 22, "503": 1 } }))
      .toEqual({ requests: 20, retries: 1, failures: 1, bytes: 5_000, byStatus: { "200": 19, "503": 1 } });
    expect(diffTransportStats({ ws: { framesReceived: 2, bytesReceived: 10 } }, { ws: { framesReceived: 9, bytesReceived: 710 } }))
      .toEqual({ ws: { framesReceived: 7, bytesReceived: 700 } });
    expect(diffTransportStats(undefined, undefined)).toBeUndefined();
    const base = { bookmaker: "forbet" as const, scrapeFullOffer: vi.fn(), cleanup: vi.fn() };
    const http = { requests: 1, retries: 0, failures: 0, bytes: 9, byStatus: { "200": 1 } };
    expect(readTransportStats({ ...base, transportStats: () => ({ http }) })).toEqual({ http });
    expect(readTransportStats(base)).toBeUndefined();
  });

  it("event-loop window reports a 120 ms block above resolution", async () => {
    const w = startEventLoopWindow();
    await new Promise((r) => setTimeout(r, 30));
    const t = Date.now();
    while (Date.now() - t < 120) {
      // block the event loop
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(w.stop().max).toBeGreaterThanOrEqual(100);
  });

  it("formats one prefixed JSON line", () => {
    const line: JobMetricsLine = {
      bookmaker: "forbet",
      transport: "http",
      queueMs: 0,
      durationMs: 812,
      interrupted: false,
      leagues: {
        "premier-league": {
          runId: "11111111-1111-4111-8111-111111111111",
          status: "success",
          phasesMs: { scrape: 600, normalizeSave: 212 },
          matches: 20,
          marketsFound: 6000,
          marketsSaved: 5869,
          http: { requests: 20, retries: 0, failures: 0, bytes: 5_000, byStatus: { "200": 20 } },
        },
      },
      eventLoopDelayMs: { p50: 0.1, p99: 3.2, max: 9.8 },
      nodeRssPeakMb: 310,
      chromiumPeakRssMb: null,
    };
    expect(formatScrapeMetricsLine(line)).toBe(`[ScrapeMetrics] ${JSON.stringify(line)}`);
  });
});
