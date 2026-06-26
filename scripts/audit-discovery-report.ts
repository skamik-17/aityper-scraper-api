#!/usr/bin/env npx tsx
/**
 * Generic per-bookmaker discovery-quality report.
 *
 * Prep-scrapes one match for a scraper-based bookmaker and prints the
 * discovery analysis (recognition %, placeholder count, empty-id ratio,
 * top unrecognized names). Use it to find where a scraper discards data
 * (real market names / market-type ids) before running the audit agents.
 *
 * Usage:
 *   npx tsx scripts/audit-discovery-report.ts --bookmaker fortuna --url "<event url>" --league world-cup-2026
 */
import { getBookmakerAuditTargets } from "../src/services/audit/bookmaker-registry.js";
import { runScraperPrepAudit } from "../src/services/audit/scraper-audit-core.js";
import { analyzeDiscovery } from "../src/services/audit/discovery-analysis.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i < process.argv.length - 1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const bookmaker = arg("--bookmaker");
  const url = arg("--url");
  const league = arg("--league");
  if (!bookmaker || !url || !league) {
    console.error("Usage: --bookmaker <bm> --url <event url> --league <slug>");
    process.exit(1);
  }
  const target = getBookmakerAuditTargets(bookmaker);
  if (!target) {
    console.error(`Unknown/unsupported bookmaker: ${bookmaker}`);
    process.exit(1);
  }
  const result = await runScraperPrepAudit({
    scraper: target.scraper,
    normalizer: target.normalizer,
    eventUrl: url,
    league,
  });
  if (!result) {
    console.error("Could not scrape/locate match");
    process.exit(1);
  }
  const a = analyzeDiscovery(result.output.markets);
  console.log(JSON.stringify({ bookmaker, league, matchId: result.matchId, ...a }, null, 2));
}

main().catch((e) => {
  console.error("[discovery-report] FAILED:", e);
  process.exit(1);
});
