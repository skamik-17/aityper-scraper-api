#!/usr/bin/env npx tsx
/**
 * Etoto audit data prep.
 *
 * Thin wrapper around the generic scraper-audit core. Scrapes one Etoto match
 * full offer, runs the raw markets through the Etoto normalizer, computes
 * mechanical flags, expands catalog families, and writes the intermediate JSON
 * consumed by /audit-etoto:
 *   docs/etoto-audit/.tmp/<matchId>.json  — PrepAuditOutput (gitignored)
 *
 * The stdout summary echoes the eventUrl so the orchestrator can pass it to the
 * fixer for online (re-scrape) verification.
 *
 * Usage:
 *   npx tsx scripts/etoto-prep-audit.ts --url "<etoto event url>" --league <slug> [--home "<team>"] [--away "<team>"] [--out <path>]
 */
import { etotoScraper } from "../src/scrapers/bookmakers/etoto/index.js";
import { etotoNormalizer } from "../src/services/normalization/bookmakers/etoto-normalizer.js";
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
      "Usage: --url <etoto event url> --league <slug> [--home <team>] [--away <team>] [--out <path>]",
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
    scraper: etotoScraper,
    normalizer: etotoNormalizer,
    eventUrl: args.url,
    league: args.league,
    home: args.home,
    away: args.away,
  });

  if (!result) {
    console.error("[etoto-prep] Could not scrape/locate match for the given URL");
    process.exit(1);
  }

  const out =
    args.out ?? resolve(process.cwd(), `../docs/etoto-audit/.tmp/${result.matchId}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result.output, null, 2), "utf8");

  console.error(`[etoto-prep] Wrote ${out}`);
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
  console.error("[etoto-prep] FAILED:", err);
  process.exit(1);
});
