#!/usr/bin/env npx tsx
/**
 * Betters audit data prep.
 *
 * Thin wrapper around the generic scraper-audit core. Scrapes one Betters match
 * full offer, runs the raw markets through the Betters normalizer, computes
 * mechanical flags, expands catalog families, and writes the intermediate JSON
 * consumed by /audit-betters:
 *   docs/betters-audit/.tmp/<matchId>.json  — PrepAuditOutput (gitignored)
 *
 * The stdout summary echoes the eventUrl so the orchestrator can pass it to the
 * fixer for online (re-scrape) verification.
 *
 * Usage:
 *   npx tsx scripts/betters-prep-audit.ts --url "<betters event url>" --league <slug> [--home "<team>"] [--away "<team>"] [--out <path>]
 */
import { bettersScraper } from "../src/scrapers/bookmakers/betters/index.js";
import { bettersNormalizer } from "../src/services/normalization/bookmakers/betters-normalizer.js";
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
      "Usage: --url <betters event url> --league <slug> [--home <team>] [--away <team>] [--out <path>]",
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
    scraper: bettersScraper,
    normalizer: bettersNormalizer,
    eventUrl: args.url,
    league: args.league,
    home: args.home,
    away: args.away,
  });

  if (!result) {
    console.error("[betters-prep] Could not scrape/locate match for the given URL");
    process.exit(1);
  }

  const out =
    args.out ?? resolve(process.cwd(), `../docs/betters-audit/.tmp/${result.matchId}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result.output, null, 2), "utf8");

  console.error(`[betters-prep] Wrote ${out}`);
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
  console.error("[betters-prep] FAILED:", err);
  process.exit(1);
});
