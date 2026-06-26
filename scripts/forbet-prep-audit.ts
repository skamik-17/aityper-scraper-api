#!/usr/bin/env npx tsx
/**
 * Forbet audit data prep.
 *
 * Thin wrapper around the generic scraper-audit core. Scrapes one Forbet match
 * full offer, runs the raw markets through the Forbet normalizer, computes
 * mechanical flags, expands catalog families, and writes the intermediate JSON
 * consumed by /audit-forbet:
 *   docs/forbet-audit/.tmp/<matchId>.json  — PrepAuditOutput (gitignored)
 *
 * The stdout summary echoes the eventUrl so the orchestrator can pass it to the
 * fixer for online (re-scrape) verification.
 *
 * Usage:
 *   npx tsx scripts/forbet-prep-audit.ts --url "<forbet event url>" --league <slug> [--home "<team>"] [--away "<team>"] [--out <path>]
 */
import { forbetScraper } from "../src/scrapers/bookmakers/forbet/index.js";
import { forbetNormalizer } from "../src/services/normalization/bookmakers/forbet-normalizer.js";
import { runScraperPrepAudit } from "../src/services/audit/scraper-audit-core.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

interface Args {
  url: string;
  league: string;
  home?: string;
  away?: string;
  out?: string;
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
      "Usage: --url <forbet event url> --league <slug> [--home <team>] [--away <team>] [--out <path>]",
    );
    process.exit(1);
  }
  return {
    url,
    league: get("--league") ?? "unknown",
    home: get("--home"),
    away: get("--away"),
    out: get("--out"),
  };
}

async function main() {
  const args = parseArgs();

  const result = await runScraperPrepAudit({
    scraper: forbetScraper,
    normalizer: forbetNormalizer,
    eventUrl: args.url,
    league: args.league,
    home: args.home,
    away: args.away,
  });

  if (!result) {
    console.error("[forbet-prep] Could not scrape/locate match for the given URL");
    process.exit(1);
  }

  const out =
    args.out ?? resolve(process.cwd(), `../docs/forbet-audit/.tmp/${result.matchId}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result.output, null, 2), "utf8");

  console.error(`[forbet-prep] Wrote ${out}`);
  console.log(
    JSON.stringify(
      {
        matchId: result.matchId,
        outputPath: out,
        eventUrl: args.url,
        league: args.league,
        homeTeam: result.output.meta.homeTeam,
        awayTeam: result.output.meta.awayTeam,
        rawDeduped: result.rawDeduped,
        recognized: result.recognized,
        unrecognized: result.unrecognized,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[forbet-prep] FAILED:", err);
  process.exit(1);
});
