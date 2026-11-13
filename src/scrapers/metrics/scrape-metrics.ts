/**
 * One [ScrapeMetrics] JSON line per bookmaker job: phase times, transport counters,
 * event-loop delay and the RSS peaks seen while the job ran.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { PolishBookmaker } from "../../config/index.js";
import type { BookmakerRunStatus } from "../../services/run-outcome.js";
import type { ScrapeMetrics } from "../../types/full-offer.js";
import { createProcSummary, readProcessTree, type ProcessSamplerSummary, type ProcTree } from "../../utils/proc-sampler.js";
import type { JobTransport } from "../job-budgets.js";
import type { HttpStats } from "../shared/http/http-client.js";
import { hasTransportStats, type FullOfferScraper, type TransportStats } from "../shared/scraper-contract.js";

export interface JobMetricsLine {
  bookmaker: PolishBookmaker;
  transport: JobTransport;
  queueMs: number;
  durationMs: number;
  interrupted: boolean;
  leagues: Record<string, ScrapeMetrics & { runId: string; status: BookmakerRunStatus }>;
  eventLoopDelayMs: { p50: number; p99: number; max: number };
  /** Process-wide peak while the job ran. */
  nodeRssPeakMb: number;
  /** Browser jobs: process-wide Chromium tree peak while the job ran (shared by concurrent browser jobs); else null. */
  chromiumPeakRssMb: number | null;
}

export function formatScrapeMetricsLine(m: JobMetricsLine): string {
  // Fixed key order, whatever order the caller built the object in
  const ordered: JobMetricsLine = {
    bookmaker: m.bookmaker,
    transport: m.transport,
    queueMs: m.queueMs,
    durationMs: m.durationMs,
    interrupted: m.interrupted,
    leagues: m.leagues,
    eventLoopDelayMs: m.eventLoopDelayMs,
    nodeRssPeakMb: m.nodeRssPeakMb,
    chromiumPeakRssMb: m.chromiumPeakRssMb,
  };
  return `[ScrapeMetrics] ${JSON.stringify(ordered)}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function startEventLoopWindow(resolutionMs = 10): { stop(): JobMetricsLine["eventLoopDelayMs"] } {
  const h = monitorEventLoopDelay({ resolution: resolutionMs });
  h.enable();
  // The histogram counts the sampling timer's own resolution as delay
  const ms = (ns: number) => round1(Math.max(0, ns / 1e6 - resolutionMs));
  return {
    stop() {
      h.disable();
      if (h.count === 0) return { p50: 0, p99: 0, max: 0 };
      return { p50: ms(h.percentile(50)), p99: ms(h.percentile(99)), max: ms(h.max) };
    },
  };
}

export interface CycleSampler {
  track(): { stop(): ProcessSamplerSummary };
  stop(): Promise<void>;
}

/** One /proc read per tick for the whole cycle, fed to every job tracked at that moment. */
export function startCycleSampler(o: { intervalMs?: number; read?: () => Promise<ProcTree> } = {}): CycleSampler {
  const intervalMs = o.intervalMs ?? 1_000;
  const read = o.read ?? (() => readProcessTree(process.pid));
  const tracked = new Set<ReturnType<typeof createProcSummary>>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const schedule = () => {
    if (stopped) return;
    // Chained, never setInterval: reads never overlap
    timer = setTimeout(tick, intervalMs);
    timer.unref?.();
  };
  const tick = () => {
    inFlight = read()
      .then((t) => {
        for (const acc of tracked) acc.add(t);
      })
      .catch(() => {
        // A failed read is skipped
      })
      .finally(schedule);
  };
  schedule();

  return {
    track() {
      const acc = createProcSummary();
      tracked.add(acc);
      return {
        stop() {
          tracked.delete(acc);
          return acc.summary();
        },
      };
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
      tracked.clear();
    },
  };
}

export function readTransportStats(scraper: FullOfferScraper): TransportStats | undefined {
  return hasTransportStats(scraper) ? scraper.transportStats() : undefined;
}

export function diffHttpStats(before: HttpStats | undefined, after: HttpStats | undefined): HttpStats | undefined {
  if (!after) return undefined;
  const b = before ?? { requests: 0, retries: 0, failures: 0, bytes: 0, byStatus: {} };
  const byStatus: Record<string, number> = {};
  for (const [status, n] of Object.entries(after.byStatus)) {
    const d = n - (b.byStatus[status] ?? 0);
    if (d !== 0) byStatus[status] = d;
  }
  return {
    requests: after.requests - b.requests,
    retries: after.retries - b.retries,
    failures: after.failures - b.failures,
    bytes: after.bytes - b.bytes,
    byStatus,
  };
}

export function diffTransportStats(before: TransportStats | undefined, after: TransportStats | undefined): TransportStats | undefined {
  if (!after) return undefined;
  const out: TransportStats = {};
  const http = diffHttpStats(before?.http, after.http);
  if (http) out.http = http;
  if (after.ws) {
    const b = before?.ws ?? { framesReceived: 0, bytesReceived: 0 };
    out.ws = { framesReceived: after.ws.framesReceived - b.framesReceived, bytesReceived: after.ws.bytesReceived - b.bytesReceived };
  }
  return out.http || out.ws ? out : undefined;
}
