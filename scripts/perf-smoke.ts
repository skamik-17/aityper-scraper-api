/**
 * perf-smoke: one bookmaker's scrapeFullOffer, measured (wall time, node and
 * Chromium memory/CPU, transport counters) and optionally compared with an
 * earlier run (README §6 parity gate 2). It never touches the database: the
 * Supabase URL is forced to a dead port before any src/ module is imported.
 *
 * Usage:
 *   npx tsx scripts/perf-smoke.ts --bookmaker <bm> [--league premier-league] [--out <file>] [--dump <file>] [--baseline <file>] [--force]
 *
 * Prints `PERF_SMOKE {json}` (and `PARITY {json}` with --baseline). Exit codes:
 *   0  scraped (success with > 0 matches) and, with --baseline, parity passed
 *   1  scrape_failed, empty, timed out, or parity failed
 *   2  usage error, unknown bookmaker, or the HH:55-HH:10 window without --force
 */
import { readFileSync, writeFileSync } from "node:fs";
import { startProcessSampler } from "../src/utils/proc-sampler.js";
import { comparePerfParity, countOffer, diffTransportStats, type PerfCounts, type PerfParity } from "../src/utils/perf-summary.js";
import { getTransportOverride } from "../src/config/transport.js";
import type { PolishBookmaker } from "../src/config/index.js";
import type { FullOfferScraperResult } from "../src/types/full-offer.js";
import type { TransportStats } from "../src/scrapers/shared/scraper-contract.js";

const USAGE =
  "Usage: perf-smoke.ts --bookmaker <bm> [--league <slug>] [--out <file>] [--dump <file>] [--baseline <file>] [--force]";
const GUARD_MS = 600_000;

interface Args {
  bookmaker: string;
  league: string;
  out?: string;
  dump?: string;
  baseline?: string;
  force: boolean;
}

function parseArgs(argv: string[]): Args | null {
  const args: Partial<Args> = { league: "premier-league", force: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    const hasValue = value !== undefined && !value.startsWith("--");
    if (flag === "--force") {
      args.force = true;
      continue;
    }
    if (!hasValue) return null;
    if (flag === "--bookmaker") args.bookmaker = value;
    else if (flag === "--league") args.league = value;
    else if (flag === "--out") args.out = value;
    else if (flag === "--dump") args.dump = value;
    else if (flag === "--baseline") args.baseline = value;
    else return null;
    i++;
  }
  return args.bookmaker ? (args as Args) : null;
}

function inScheduledWindow(now = new Date()): boolean {
  const m = now.getMinutes();
  return m >= 55 || m <= 9;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(USAGE);
    return 2;
  }
  if (!args.force && inScheduledWindow()) {
    console.error("Refusing to run between HH:55 and HH:10 (scheduled scrape window); pass --force to override");
    return 2;
  }

  // Never reach the shared DB, whatever checkout this runs from.
  process.env.SUPABASE_URL = "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_KEY = "perf-smoke-no-db";
  const smoke = await import("./smoke-bookmaker.js");
  const agg = await import("../src/scrapers/aggregator.js");
  const { hasTransportStats } = await import("../src/scrapers/shared/scraper-contract.js");

  if (!smoke.isBookmaker(args.bookmaker) || !agg.getScraper(args.bookmaker)) {
    console.error(`Unknown bookmaker: ${args.bookmaker}`);
    return 2;
  }
  const bm: PolishBookmaker = args.bookmaker;
  const scraper = agg.getScraper(bm)!;

  const sampler = startProcessSampler({ rootPid: process.pid, intervalMs: 500 });
  const cpu0 = process.cpuUsage();
  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  const before: TransportStats | null = hasTransportStats(scraper) ? scraper.transportStats() : null;

  let timedOut = false;
  let result: FullOfferScraperResult;
  let wallMs = 0;
  let sampled: Awaited<ReturnType<typeof sampler.stop>>;
  try {
    let guard: ReturnType<typeof setTimeout> | undefined;
    const guardPromise = new Promise<FullOfferScraperResult>((resolve) => {
      guard = setTimeout(() => {
        timedOut = true;
        resolve({ success: false, bookmaker: bm, league: args.league, matches: [], error: `perf-smoke guard: no result after ${GUARD_MS}ms` });
      }, GUARD_MS);
    });
    result = await Promise.race([smoke.scrapeOnce(bm, args.league), guardPromise]);
    clearTimeout(guard);
    wallMs = Date.now() - t0;
  } finally {
    await scraper.cleanup();
    // A failed close never changes the exit code (smoke-bookmaker's rule).
    await agg.closeAllBrowsers().catch((e: unknown) => console.error("perf-smoke: closing browsers failed:", e));
    await new Promise((r) => setTimeout(r, 1000)); // sample the Chromium exit
    sampled = await sampler.stop();
  }

  const after: TransportStats | null = hasTransportStats(scraper) ? scraper.transportStats() : null;
  const cpu = process.cpuUsage(cpu0);
  const counts: PerfCounts = countOffer(result);
  const dry = smoke.summarizeDryRun(bm, args.league, result, t0);

  let parity: PerfParity | undefined;
  if (args.baseline) {
    const base = JSON.parse(readFileSync(args.baseline, "utf8")) as PerfCounts;
    parity = comparePerfParity({ matches: base.matches, markets: base.markets, selections: base.selections }, counts);
  }

  const summary = {
    bookmaker: bm,
    league: args.league,
    startedAt,
    scraperClass: (scraper as object).constructor.name,
    transportOverride: getTransportOverride(bm) ?? null,
    wallMs,
    success: result.success,
    error: result.error ?? null,
    timedOut,
    matches: counts.matches,
    markets: counts.markets,
    selections: counts.selections,
    smoke: dry.result,
    transport: before && after ? diffTransportStats(before, after) : null,
    memory: {
      nodePeakRssMb: Math.max(sampled.nodePeakRssMb, Math.round(process.resourceUsage().maxRSS / 1024)),
      chromiumPeakRssMb: sampled.chromiumPeakRssMb,
      chromiumPeakProcesses: sampled.chromiumPeakProcesses,
      chromiumProcessesEver: sampled.chromiumProcessesEver,
    },
    cpu: { nodeS: Math.round(((cpu.user + cpu.system) / 1e6) * 100) / 100, chromiumS: sampled.chromiumCpuS },
    samples: sampled.samples,
    ...(parity ? { parity } : {}),
  };

  console.log("PERF_SMOKE " + JSON.stringify(summary));
  if (parity) console.log("PARITY " + JSON.stringify(parity));
  if (args.out) writeFileSync(args.out, JSON.stringify(summary, null, 1));
  if (args.dump) writeFileSync(args.dump, JSON.stringify(result));

  if (timedOut || dry.code !== 0) return 1;
  if (parity && !parity.pass) return 1;
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("perf-smoke failed:", error);
    process.exit(1);
  },
);
