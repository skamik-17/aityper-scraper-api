#!/usr/bin/env npx tsx
/**
 * Per-bookmaker scrape status of one league: the same snapshot
 * (scraper_runs plus odds freshness) as GET /api/health/scrapers. Read-only.
 *
 * Usage:
 *   npx tsx scripts/scraper-status.ts [--league premier-league] [--json] [--threshold N]
 *
 * Prints a table (header plus one row per bookmaker, then `source=<source>`
 * on stderr) or, with --json, the ScraperHealthReport. Exit codes
 * (statusExitCode):
 *   0  run history read, no bookmaker at or above the failure threshold
 *   1  a bookmaker failed >= threshold runs in a row (default ALERT_CONSECUTIVE_FAILURES)
 *   2  database unreachable, run history unavailable (source=odds_only), or a usage error
 */
import { CONFIG } from "../src/config/index.js";
import { probeDatabase } from "../src/config/database.js";
import { getBookmakerStatusSnapshot } from "../src/services/bookmaker-status.js";
import { buildScraperHealthReport, formatStatusTable, statusExitCode } from "../src/services/scraper-status-report.js";

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
    // A flag is never a value: "--league --json" is a usage error, not the league "--json".
    const hasValue = value !== undefined && !value.startsWith("--");
    if (flag === "--json") {
      args.json = true;
    } else if (flag === "--league" && hasValue) {
      args.league = value;
      i++;
    } else if (flag === "--threshold" && hasValue) {
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
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatStatusTable(report));
    // The table has no source column; on stderr, so stdout stays one header plus one row per bookmaker.
    console.error(`source=${report.source}`);
  }

  const exit = statusExitCode(report, args.threshold);
  if (exit.message) console.error(exit.message);
  return exit.code;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    // Status unknown: neither 0 nor 1 would be true.
    console.error("scraper-status failed:", error);
    process.exit(2);
  },
);
