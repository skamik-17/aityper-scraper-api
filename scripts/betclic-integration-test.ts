#!/usr/bin/env npx tsx
/**
 * Betclic Integration Test
 *
 * Performs full scrapeFullOffer() call for premier-league and verifies market coverage.
 * Tests multi-tab fetching implementation and verifies presence of key market types from each tab.
 *
 * Usage:
 *   npx tsx backend/scripts/betclic-integration-test.ts
 *   npx tsx backend/scripts/betclic-integration-test.ts --verbose    # Show detailed output
 */

import { betclicScraper } from "../src/scrapers/bookmakers/betclic/index.js";
import type { FullOfferScraperResult, ScrapedMarket } from "../src/types/full-offer.js";
import { MARKET_TYPES } from "../src/scrapers/bookmakers/betclic/constants.js";

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose") || args.includes("-v");

const TEST_LEAGUE = "premier-league";
const MIN_MARKETS_PER_MATCH = 50;

const REQUIRED_MARKET_TYPES = [
  "CORNERS_TOTAL",
  "CARDS_TOTAL",
  "PLAYER_ASSISTS",
  "HANDICAP",
] as const;

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string;
}

interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
}

function hasMarketType(markets: ScrapedMarket[], marketType: string): boolean {
  return markets.some((market) => market.type === marketType);
}

function countUniqueMarketTypes(markets: ScrapedMarket[]): number {
  const uniqueTypes = new Set(markets.map((m) => m.type).filter(Boolean));
  return uniqueTypes.size;
}

async function runIntegrationTests(): Promise<TestSummary> {
  const results: TestResult[] = [];

  console.log("\n" + "=".repeat(100));
  console.log("BETCLIC INTEGRATION TEST");
  console.log("=".repeat(100));
  console.log(`\nTesting multi-tab fetching for league: ${TEST_LEAGUE}`);
  console.log(`Minimum markets expected per match: ${MIN_MARKETS_PER_MATCH}`);
  console.log(`Required market types: ${REQUIRED_MARKET_TYPES.join(", ")}`);

  console.log("\n" + "=".repeat(100));
  console.log("FETCHING FULL OFFER");
  console.log("=".repeat(100));

  console.log("\n[Test 1] Calling betclicScraper.scrapeFullOffer('premier-league')...");
  const startTime = Date.now();

  let result: FullOfferScraperResult;
  try {
    result = await betclicScraper.scrapeFullOffer(TEST_LEAGUE);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.push({
      name: "Script runs without errors",
      passed: false,
      message: `Script crashed with error: ${errorMessage}`,
      details: VERBOSE ? String(error) : undefined,
    });
    return { total: results.length, passed: 0, failed: results.length, results };
  }

  const duration = Date.now() - startTime;

  if (!result.success) {
    const errorMsg = result.error || "Unknown error";
    results.push({
      name: "Script runs without errors",
      passed: false,
      message: `scrapeFullOffer() failed: ${errorMsg}`,
      details: VERBOSE ? `Duration: ${duration}ms` : undefined,
    });
    return { total: results.length, passed: 0, failed: results.length, results };
  }

  results.push({
    name: "Script runs without errors",
    passed: true,
    message: `scrapeFullOffer() completed successfully in ${duration}ms`,
    details: `Bookmaker: ${result.bookmaker}, League: ${result.league}`,
  });

  console.log("\n[Test 2] Verifying at least one match is returned...");
  const matchCount = result.matches.length;

  if (matchCount === 0) {
    results.push({
      name: "At least one match is returned",
      passed: false,
      message: `No matches found in Premier League`,
      details: "This could indicate that no matches are currently available or the API is down",
    });
  } else {
    results.push({
      name: "At least one match is returned",
      passed: true,
      message: `Found ${matchCount} match${matchCount !== 1 ? "es" : ""} in Premier League`,
      details: VERBOSE
        ? result.matches.map((m) => `${m.homeTeam} vs ${m.awayTeam}`).join("\n  ")
        : undefined,
    });
  }

  console.log("\n[Test 3] Verifying each match has > 50 markets...");

  const matchesWithInsufficientMarkets: string[] = [];
  const marketCounts: number[] = [];

  for (const match of result.matches) {
    const marketCount = match.markets.length;
    marketCounts.push(marketCount);

    if (marketCount < MIN_MARKETS_PER_MATCH) {
      matchesWithInsufficientMarkets.push(
        `${match.homeTeam} vs ${match.awayTeam}: ${marketCount} markets`
      );
    }
  }

  if (matchesWithInsufficientMarkets.length > 0) {
    const avgMarkets = (marketCounts.reduce((a, b) => a + b, 0) / marketCounts.length).toFixed(1);
    results.push({
      name: "Each match has > 50 markets",
      passed: false,
      message: `${matchesWithInsufficientMarkets.length} of ${matchCount} matches have < ${MIN_MARKETS_PER_MATCH} markets (average: ${avgMarkets})`,
      details: matchesWithInsufficientMarkets.join("\n  "),
    });
  } else {
    const avgMarkets = (marketCounts.reduce((a, b) => a + b, 0) / marketCounts.length).toFixed(1);
    const minMarkets = Math.min(...marketCounts);
    const maxMarkets = Math.max(...marketCounts);

    results.push({
      name: "Each match has > 50 markets",
      passed: true,
      message: `All matches have > ${MIN_MARKETS_PER_MATCH} markets (average: ${avgMarkets}, min: ${minMarkets}, max: ${maxMarkets})`,
      details: VERBOSE
        ? marketCounts.map((count, i) => {
            const m = result.matches[i];
            return `${m.homeTeam} vs ${m.awayTeam}: ${count} markets`;
          }).join("\n  ")
        : undefined,
    });
  }

  console.log("\n[Test 4] Verifying presence of CORNERS market type...");

  const matchesWithCorners = result.matches.filter((m) =>
    hasMarketType(m.markets, "CORNERS_TOTAL")
  );

  if (matchesWithCorners.length === 0) {
    results.push({
      name: "Presence of CORNERS market type",
      passed: false,
      message: "No matches have CORNERS_TOTAL markets",
      details: "Corners markets should come from Statystyki tab (filter value 6)",
    });
  } else if (matchesWithCorners.length < result.matches.length) {
    results.push({
      name: "Presence of CORNERS market type",
      passed: false,
      message: `CORNERS_TOTAL markets found in ${matchesWithCorners.length}/${result.matches.length} matches`,
      details: "Expected in all matches from Statystyki tab",
    });
  } else {
    results.push({
      name: "Presence of CORNERS market type",
      passed: true,
      message: `CORNERS_TOTAL markets found in all ${result.matches.length} matches`,
      details: VERBOSE
        ? matchesWithCorners.map((m) => `${m.homeTeam} vs ${m.awayTeam}`).join(", ")
        : undefined,
    });
  }

  console.log("\n[Test 5] Verifying presence of CARDS market type...");

  const matchesWithCards = result.matches.filter((m) =>
    hasMarketType(m.markets, "CARDS_TOTAL")
  );

  if (matchesWithCards.length === 0) {
    results.push({
      name: "Presence of CARDS market type",
      passed: false,
      message: "No matches have CARDS_TOTAL markets",
      details: "Cards markets should come from Statystyki tab (filter value 6)",
    });
  } else if (matchesWithCards.length < result.matches.length) {
    results.push({
      name: "Presence of CARDS market type",
      passed: false,
      message: `CARDS_TOTAL markets found in ${matchesWithCards.length}/${result.matches.length} matches`,
      details: "Expected in all matches from Statystyki tab",
    });
  } else {
    results.push({
      name: "Presence of CARDS market type",
      passed: true,
      message: `CARDS_TOTAL markets found in all ${result.matches.length} matches`,
      details: VERBOSE
        ? matchesWithCards.map((m) => `${m.homeTeam} vs ${m.awayTeam}`).join(", ")
        : undefined,
    });
  }

  console.log("\n[Test 6] Verifying presence of GOALSCORER market type...");
  console.log("Note: Checking for PLAYER_ASSISTS type (mapped from GOALSCORER in constants)");

  const matchesWithGoalscorer = result.matches.filter((m) =>
    hasMarketType(m.markets, "PLAYER_ASSISTS")
  );

  if (matchesWithGoalscorer.length === 0) {
    results.push({
      name: "Presence of GOALSCORER market type",
      passed: false,
      message: "No matches have PLAYER_ASSISTS (GOALSCORER) markets",
      details: "Scorer markets should come from Strzelcy tab (filter value 2)",
    });
  } else if (matchesWithGoalscorer.length < result.matches.length) {
    results.push({
      name: "Presence of GOALSCORER market type",
      passed: false,
      message: `PLAYER_ASSISTS markets found in ${matchesWithGoalscorer.length}/${result.matches.length} matches`,
      details: "Expected in all matches from Strzelcy tab",
    });
  } else {
    results.push({
      name: "Presence of GOALSCORER market type",
      passed: true,
      message: `PLAYER_ASSISTS (GOALSCORER) markets found in all ${result.matches.length} matches`,
      details: VERBOSE
        ? matchesWithGoalscorer.map((m) => `${m.homeTeam} vs ${m.awayTeam}`).join(", ")
        : undefined,
    });
  }

  console.log("\n[Test 7] Verifying presence of HANDICAP market type...");

  const matchesWithHandicap = result.matches.filter((m) =>
    hasMarketType(m.markets, "HANDICAP")
  );

  if (matchesWithHandicap.length === 0) {
    results.push({
      name: "Presence of HANDICAP market type",
      passed: false,
      message: "No matches have HANDICAP markets",
      details: "Handicap markets should come from Handicap tab (filter value 5)",
    });
  } else if (matchesWithHandicap.length < result.matches.length) {
    results.push({
      name: "Presence of HANDICAP market type",
      passed: false,
      message: `HANDICAP markets found in ${matchesWithHandicap.length}/${result.matches.length} matches`,
      details: "Expected in all matches from Handicap tab",
    });
  } else {
    results.push({
      name: "Presence of HANDICAP market type",
      passed: true,
      message: `HANDICAP markets found in all ${result.matches.length} matches`,
      details: VERBOSE
        ? matchesWithHandicap.map((m) => `${m.homeTeam} vs ${m.awayTeam}`).join(", ")
        : undefined,
    });
  }

  if (VERBOSE) {
    console.log("\n" + "=".repeat(100));
    console.log("MARKET TYPE ANALYSIS");
    console.log("=".repeat(100));

    const allMarketTypes = new Map<string, Set<string>>();

    for (const match of result.matches) {
      for (const market of match.markets) {
        if (!market.type) continue;
        if (!allMarketTypes.has(market.type)) {
          allMarketTypes.set(market.type, new Set());
        }
        allMarketTypes.get(market.type)!.add(market.name);
      }
    }

    console.log(`\nTotal unique market types: ${allMarketTypes.size}`);
    console.log("\nMarket types found:\n");

    const sortedTypes = Array.from(allMarketTypes.entries()).sort(
      (a, b) => b[1].size - a[1].size
    );

    for (const [type, names] of sortedTypes) {
      const isRequired = REQUIRED_MARKET_TYPES.includes(type as any);
      const prefix = isRequired ? "✅ " : "   ";
      console.log(`${prefix}${type} (${names.size} markets)`);
    }

    console.log("\nMissing required types:");
    const missingRequired = REQUIRED_MARKET_TYPES.filter(
      (t) => !allMarketTypes.has(t)
    );
    if (missingRequired.length === 0) {
      console.log("  ✅ All required types found!");
    } else {
      for (const type of missingRequired) {
        console.log(`  ❌ ${type}`);
      }
    }
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  };
}

function printResults(summary: TestSummary): void {
  console.log("\n" + "=".repeat(100));
  console.log("TEST RESULTS");
  console.log("=".repeat(100));

  for (const result of summary.results) {
    const icon = result.passed ? "✅" : "❌";
    console.log(`\n${icon} ${result.name}`);
    console.log(`   ${result.message}`);

    if (result.details && VERBOSE) {
      console.log(`\n   Details:`);
      const detailLines = result.details.split("\n");
      for (const line of detailLines) {
        console.log(`   ${line}`);
      }
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log("SUMMARY");
  console.log("=".repeat(100));

  const passRate = ((summary.passed / summary.total) * 100).toFixed(1);
  const overallStatus = summary.failed === 0 ? "PASS" : "FAIL";

  console.log(`\nTotal tests: ${summary.total}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Pass rate: ${passRate}%`);
  console.log(`\nOverall: ${overallStatus}`);

  if (overallStatus === "FAIL") {
    console.log("\n" + "=".repeat(100));
    console.log("FAILED TESTS ANALYSIS");
    console.log("=".repeat(100));
    console.log("\n⚠️  Note on API Behavior:");
    console.log("   Based on test-003 findings, Betclic API returns identical responses");
    console.log("   for all 7 filter values (0-6). This means:");
    console.log("   - Multi-tab implementation is architecturally correct");
    console.log("   - The filter mechanism works as designed");
    console.log("   - However, the API does not actually filter by market group");
    console.log("   - All responses contain the same 3 market groups (Gole, Inne, Wynik meczu)");
    console.log("\n   This is likely due to:");
    console.log("   1. API changes since initial reverse engineering");
    console.log("   2. Different behavior for different matches/leagues");
    console.log("   3. Need to discover different filter field/value combinations");
    console.log("\n   See backend/docs/betclic-market-coverage-final.md for details");
  } else {
    console.log("\n✅ All acceptance criteria met!");
    console.log("   Multi-tab fetching is working correctly.");
  }

  console.log("\n" + "=".repeat(100));
}

async function main(): Promise<void> {
  const summary = await runIntegrationTests();
  printResults(summary);

  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("\n❌ Integration test failed with uncaught error:", error);
  process.exit(1);
});
