#!/usr/bin/env npx tsx
/**
 * Betfan audit data prep.
 *
 * Thin wrapper around the generic scraper-audit core. Scrapes one Betfan match
 * full offer, runs the raw markets through the Betfan normalizer, computes
 * mechanical flags, expands catalog families, and writes the intermediate JSON
 * consumed by /audit-betfan:
 *   docs/betfan-audit/.tmp/<matchId>.json  — PrepAuditOutput (gitignored)
 *
 * The stdout summary echoes the eventUrl so the orchestrator can pass it to the
 * fixer for online (re-scrape) verification.
 *
 * Usage:
 *   npx tsx scripts/betfan-prep-audit.ts --url "<betfan event url>" --league <slug> [--home "<team>"] [--away "<team>"] [--out <path>]
 */
import { betfanScraper } from "../src/scrapers/bookmakers/betfan/index.js";
import { betfanNormalizer } from "../src/services/normalization/bookmakers/betfan-normalizer.js";
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
      "Usage: --url <betfan event url> --league <slug> [--home <team>] [--away <team>] [--out <path>]",
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
    scraper: betfanScraper,
    normalizer: betfanNormalizer,
    eventUrl: args.url,
    league: args.league,
    home: args.home,
    away: args.away,
  });

  if (!result) {
    console.error("[betfan-prep] Could not scrape/locate match for the given URL");
    process.exit(1);
  }

  const out =
    args.out ?? resolve(process.cwd(), `../docs/betfan-audit/.tmp/${result.matchId}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result.output, null, 2), "utf8");

  console.error(`[betfan-prep] Wrote ${out}`);
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
  console.error("[betfan-prep] FAILED:", err);
  process.exit(1);
});
