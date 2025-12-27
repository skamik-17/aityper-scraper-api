/**
 * Premier League Scraper Test Script
 * Run with: npx tsx backend/src/scripts/test-premier-league.ts
 *
 * Tests all 6 bookmaker scrapers for Premier League matches.
 */

import { runAllScrapers, runSingleScraper } from "../scrapers/aggregator.js";
import type { PolishBookmaker } from "../config/index.js";
import type { ScraperResult } from "../types/scraper.js";

const LEAGUE = "premier-league";

async function testSingleScraper(bookmaker: PolishBookmaker): Promise<ScraperResult> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing ${bookmaker.toUpperCase()} scraper for ${LEAGUE}`);
  console.log("=".repeat(60));

  const startTime = Date.now();
  const result = await runSingleScraper(bookmaker, LEAGUE);
  const duration = Date.now() - startTime;

  console.log(`\nResult:`);
  console.log(`  Status: ${result.status}`);
  console.log(`  Duration: ${duration}ms`);

  if (result.status === "success" && result.data) {
    console.log(`  Matches found: ${result.data.length}`);
    console.log(`\n  Sample matches:`);
    result.data.slice(0, 5).forEach((match, idx) => {
      console.log(
        `    ${idx + 1}. ${match.homeTeam} vs ${match.awayTeam}`
      );
      console.log(
        `       Odds: ${match.homeOdds.toFixed(2)} | ${match.drawOdds.toFixed(2)} | ${match.awayOdds.toFixed(2)}`
      );
    });
    if (result.data.length > 5) {
      console.log(`    ... and ${result.data.length - 5} more matches`);
    }
  } else {
    console.log(`  Error: ${result.error || "Unknown error"}`);
  }

  return result;
}

async function testAllScrapers() {
  console.log("\n" + "=".repeat(70));
  console.log("   PREMIER LEAGUE SCRAPER TEST - Testing all 6 bookmakers");
  console.log("=".repeat(70));

  const bookmakers: PolishBookmaker[] = [
    "sts",
    "fortuna",
    "betclic",
    "superbet",
    "lvbet",
    "fuksiarz",
  ];

  const results: Map<PolishBookmaker, ScraperResult> = new Map();

  // Test each scraper sequentially to avoid resource conflicts
  for (const bookmaker of bookmakers) {
    const result = await testSingleScraper(bookmaker);
    results.set(bookmaker, result);
  }

  // Print summary
  console.log("\n" + "=".repeat(70));
  console.log("   SUMMARY");
  console.log("=".repeat(70));

  let successCount = 0;
  let totalMatches = 0;

  for (const bookmaker of bookmakers) {
    const result = results.get(bookmaker)!;
    const status = result.status === "success" ? "OK" : "FAILED";
    const matches = result.data?.length || 0;

    if (result.status === "success") {
      successCount++;
      totalMatches += matches;
    }

    console.log(
      `  ${bookmaker.padEnd(12)} : ${status.padEnd(8)} | ${matches} matches | ${result.duration}ms`
    );
  }

  console.log("\n" + "-".repeat(50));
  console.log(`  Success: ${successCount}/${bookmakers.length} scrapers`);
  console.log(`  Total matches found: ${totalMatches}`);
  console.log("=".repeat(70) + "\n");

  // Exit with error code if any scraper failed
  const failed = bookmakers.length - successCount;
  process.exit(failed > 0 ? 1 : 0);
}

// Allow testing a single scraper via command line argument
const args = process.argv.slice(2);
if (args.length > 0) {
  const bookmaker = args[0] as PolishBookmaker;
  const validBookmakers: PolishBookmaker[] = [
    "sts", "fortuna", "betclic", "superbet", "lvbet", "fuksiarz"
  ];

  if (validBookmakers.includes(bookmaker)) {
    testSingleScraper(bookmaker)
      .then((result) => {
        process.exit(result.status === "success" ? 0 : 1);
      })
      .catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
      });
  } else {
    console.error(`Invalid bookmaker: ${bookmaker}`);
    console.error(`Valid options: ${validBookmakers.join(", ")}`);
    process.exit(1);
  }
} else {
  testAllScrapers().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
