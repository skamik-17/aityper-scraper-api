#!/usr/bin/env npx tsx
/**
 * Per-bookmaker scrape status of one league: the same snapshot
 * (scraper_runs plus odds freshness) as GET /api/health/scrapers. Read-only.
 *
 * Usage:
 *   npx tsx scripts/scraper-status.ts [--league premier-league] [--json] [--threshold N]
 *
 * Prints a table (header plus one row per bookmaker) or, with --json, the
 * ScraperHealthReport. Exit codes:
 *   0  no bookmaker at or above the failure threshold
 *   1  a bookmaker failed >= threshold runs in a row (default ALERT_CONSECUTIVE_FAILURES)
 *   2  database unreachable, or a usage error
 */
import { CONFIG } from "../src/config/index.js";
import { probeDatabase } from "../src/config/database.js";
import { getBookmakerStatusSnapshot } from "../src/services/bookmaker-status.js";
import { buildScraperHealthReport, formatStatusTable } from "../src/services/scraper-status-report.js";

const USAGE = "Usage: scraper-status.ts [--league <slug>] [--json] [--threshold N]";
const LEAGUE_SLUG = /^[a-z0-9-]+$/;

interface Args {
  league: string;
  json: boolean;
  threshold: number;
}

function parseArgs(argv: string[]): Args | null {
  const args: Args = { league: CONFIG.ENABLED_LEAGUES[0], json: false, threshold: CONFIG.ALERT_CONSECUTIVE_FAILURES };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--json") {
      args.json = true;
    } else if (flag === "--league" && value !== undefined) {
      args.league = value;
      i++;
    } else if (flag === "--threshold" && value !== undefined) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) return null;
      args.threshold = n;
      i++;
    } else {
      return null;
    }
  }
  return LEAGUE_SLUG.test(args.league) ? args : null;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(USAGE);
    return 2;
  }

  const probe = await probeDatabase();
  if (!probe.ok) {
    console.error(`Database unreachable at ${CONFIG.SUPABASE_URL}: ${probe.error}`);
    return 2;
  }

  const snap = await getBookmakerStatusSnapshot(args.league);
  // The last run and the last abort live in the server process's memory; this process has neither.
  const report = buildScraperHealthReport(args.league, snap, null, null, new Date());
  console.log(args.json ? JSON.stringify(report, null, 2) : formatStatusTable(report));

  const failing = report.bookmakers.filter((b) => b.consecutiveFailures >= args.threshold);
  if (failing.length > 0) {
    const list = failing.map((b) => `${b.bookmaker} (${b.consecutiveFailures})`).join(", ");
    console.error(`${failing.length} bookmaker(s) failed ${args.threshold}+ runs in a row: ${list}`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    // Status unknown: neither 0 nor 1 would be true.
    console.error("scraper-status failed:", error);
    process.exit(2);
  },
);
