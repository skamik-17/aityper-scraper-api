#!/usr/bin/env npx tsx
/**
 * Etoto Market Discovery Script.
 *
 * Thin wrapper around the generic scraper-audit core. Re-scrapes one Etoto
 * match full offer, normalizes the markets, and prints RAW vs FRONTEND JSON so
 * the @etoto-audit-fixer can verify a fix (view_type / param-count check).
 *
 * Usage:
 *   npx tsx scripts/etoto-market-discovery.ts --url "<event url>" --league <slug>            # summary
 *   npx tsx scripts/etoto-market-discovery.ts --url "<event url>" --league <slug> --market "Liczba goli"  # one market detail
 *   npx tsx scripts/etoto-market-discovery.ts --url "<event url>" --league <slug> --all      # full detail for all markets
 */
import { etotoScraper } from "../src/scrapers/bookmakers/etoto/index.js";
import { etotoNormalizer } from "../src/services/normalization/bookmakers/etoto-normalizer.js";
import { runScraperDiscovery } from "../src/services/audit/scraper-audit-core.js";

interface Args {
  url: string;
  league: string;
  market?: string;
  home?: string;
  away?: string;
  all: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
  };
  const url = get("--url");
  if (!url) {
    console.error(
      'Usage: --url <event url> --league <slug> [--market "<name>"] [--home <team>] [--away <team>] [--all]',
    );
    process.exit(1);
  }
  return {
    url,
    league: get("--league") ?? "unknown",
    market: get("--market"),
    home: get("--home"),
    away: get("--away"),
    all: argv.includes("--all"),
  };
}

async function main() {
  const args = parseArgs();
  await runScraperDiscovery({
    scraper: etotoScraper,
    normalizer: etotoNormalizer,
    eventUrl: args.url,
    league: args.league,
    home: args.home,
    away: args.away,
    marketFilter: args.market,
    showAll: args.all,
  });
}

main().catch((err) => {
  console.error("[etoto-discovery] FAILED:", err);
  process.exit(1);
});
