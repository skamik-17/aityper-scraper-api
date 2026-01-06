/**
 * Test script for Full Offer Scrapers
 *
 * Tests all 14 scrapers' scrapeFullOffer() method to verify:
 * 1. Scraper executes without errors
 * 2. Returns matches with markets
 * 3. Each match has ≥50 markets (plan requirement)
 *
 * Usage:
 *   npx tsx src/scripts/test-full-offer.ts [bookmaker] [league]
 *   npx tsx src/scripts/test-full-offer.ts [bookmaker] [league] --match "west ham,nottingham"
 *
 * Examples:
 *   npx tsx src/scripts/test-full-offer.ts all premier-league
 *   npx tsx src/scripts/test-full-offer.ts betclic premier-league --match "west ham,nottingham"
 */

import type { PolishBookmaker } from "../config/index.js";
import type { FullOfferScraperResult } from "../types/full-offer.js";
import {
  superbetScraper,
  etotoScraper,
  forbetScraper,
  lebullScraper,
  fuksiarzScraper,
  betfanScraper,
  totalbetScraper,
  betclicScraper,
  lvbetScraper,
  fortunaScraper,
  bettersScraper,
  pzbukScraper,
  stsScraper,
  betcrisScraper,
} from "../scrapers/bookmakers/index.js";
import { PlaywrightScraper } from "../scrapers/base/playwright-base.js";

// Map of all scrapers
const SCRAPERS: Record<PolishBookmaker, PlaywrightScraper> = {
  superbet: superbetScraper,
  etoto: etotoScraper,
  forbet: forbetScraper,
  lebull: lebullScraper,
  fuksiarz: fuksiarzScraper,
  betfan: betfanScraper,
  totalbet: totalbetScraper,
  betclic: betclicScraper,
  lvbet: lvbetScraper,
  fortuna: fortunaScraper,
  betters: bettersScraper,
  pzbuk: pzbukScraper,
  sts: stsScraper,
  betcris: betcrisScraper,
};

interface TestResult {
  bookmaker: PolishBookmaker;
  success: boolean;
  matchCount: number;
  totalMarkets: number;
  avgMarketsPerMatch: number;
  minMarkets: number;
  maxMarkets: number;
  meetsRequirement: boolean; // ≥50 markets per match
  duration: number;
  error?: string;
  matchFilter?: string;
  filteredMatch?: {
    homeTeam: string;
    awayTeam: string;
    marketCount: number;
  };
}

/**
 * Filter matches by team names (case-insensitive partial match)
 */
function findMatchByTeams(
  matches: { homeTeam: string; awayTeam: string; markets: unknown[] }[],
  teamFilter: string
): { homeTeam: string; awayTeam: string; markets: unknown[] } | null {
  const filterParts = teamFilter.toLowerCase().split(",").map((s) => s.trim());

  return matches.find((m) => {
    const home = m.homeTeam.toLowerCase();
    const away = m.awayTeam.toLowerCase();

    // Check if all filter parts match either home or away team
    return filterParts.every(
      (part) => home.includes(part) || away.includes(part)
    );
  }) || null;
}

async function testScraper(
  bookmaker: PolishBookmaker,
  league: string,
  matchFilter?: string
): Promise<TestResult> {
  const scraper = SCRAPERS[bookmaker];
  const startTime = Date.now();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${bookmaker.toUpperCase()}`);
  console.log(`League: ${league}`);
  if (matchFilter) {
    console.log(`Match filter: ${matchFilter}`);
  }
  console.log(`${"=".repeat(60)}`);

  try {
    const result: FullOfferScraperResult = await scraper.scrapeFullOffer(league);
    const duration = Date.now() - startTime;

    if (!result.success) {
      console.log(`❌ FAILED: ${result.error}`);
      return {
        bookmaker,
        success: false,
        matchCount: 0,
        totalMarkets: 0,
        avgMarketsPerMatch: 0,
        minMarkets: 0,
        maxMarkets: 0,
        meetsRequirement: false,
        duration,
        error: result.error,
      };
    }

    const matches = result.matches;
    const matchCount = matches.length;
    const marketCounts = matches.map((m) => m.markets.length);
    const totalMarkets = marketCounts.reduce((a, b) => a + b, 0);
    const avgMarketsPerMatch = matchCount > 0 ? totalMarkets / matchCount : 0;
    const minMarkets = matchCount > 0 ? Math.min(...marketCounts) : 0;
    const maxMarkets = matchCount > 0 ? Math.max(...marketCounts) : 0;
    const meetsRequirement = minMarkets >= 50; // Updated to 50 markets requirement

    console.log(`✅ SUCCESS`);
    console.log(`   Matches found: ${matchCount}`);
    console.log(`   Total markets: ${totalMarkets}`);
    console.log(`   Avg markets/match: ${avgMarketsPerMatch.toFixed(1)}`);
    console.log(`   Min markets: ${minMarkets}`);
    console.log(`   Max markets: ${maxMarkets}`);
    console.log(`   Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`   Meets ≥50 requirement: ${meetsRequirement ? "✅ YES" : "⚠️ NO"}`);

    // Find filtered match if filter is specified
    let filteredMatch: TestResult["filteredMatch"] = undefined;
    if (matchFilter) {
      const found = findMatchByTeams(matches, matchFilter);
      if (found) {
        filteredMatch = {
          homeTeam: found.homeTeam,
          awayTeam: found.awayTeam,
          marketCount: found.markets.length,
        };
        const meets50 = found.markets.length >= 50;
        console.log(`\n   🎯 FILTERED MATCH: ${found.homeTeam} vs ${found.awayTeam}`);
        console.log(`   Markets: ${found.markets.length} ${meets50 ? "✅" : "❌"} (requirement: ≥50)`);

        // Group markets by groupName
        const groups = new Map<string, number>();
        for (const market of found.markets as { groupName?: string }[]) {
          const group = market.groupName || "Other";
          groups.set(group, (groups.get(group) || 0) + 1);
        }
        for (const [group, count] of groups) {
          console.log(`     - ${group}: ${count} markets`);
        }
      } else {
        console.log(`\n   ⚠️ Match "${matchFilter}" NOT FOUND in results`);
      }
    } else {
      // Show sample match details (first match)
      if (matches.length > 0) {
        const sample = matches[0];
        console.log(`\n   Sample match: ${sample.homeTeam} vs ${sample.awayTeam}`);
        console.log(`   Markets (${sample.markets.length}):`);

        // Group markets by groupName
        const groups = new Map<string, number>();
        for (const market of sample.markets) {
          const group = market.groupName || "Other";
          groups.set(group, (groups.get(group) || 0) + 1);
        }

        for (const [group, count] of groups) {
          console.log(`     - ${group}: ${count} markets`);
        }
      }
    }

    return {
      bookmaker,
      success: true,
      matchCount,
      totalMarkets,
      avgMarketsPerMatch,
      minMarkets,
      maxMarkets,
      meetsRequirement,
      duration,
      matchFilter,
      filteredMatch,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(`❌ ERROR: ${errorMsg}`);
    return {
      bookmaker,
      success: false,
      matchCount: 0,
      totalMarkets: 0,
      avgMarketsPerMatch: 0,
      minMarkets: 0,
      maxMarkets: 0,
      meetsRequirement: false,
      duration,
      error: errorMsg,
    };
  } finally {
    await scraper.cleanup();
  }
}

async function testAllScrapers(league: string, matchFilter?: string): Promise<void> {
  const bookmakers = Object.keys(SCRAPERS) as PolishBookmaker[];
  const results: TestResult[] = [];

  console.log(`\n${"#".repeat(60)}`);
  console.log(`# FULL OFFER SCRAPER TEST SUITE`);
  console.log(`# League: ${league}`);
  if (matchFilter) {
    console.log(`# Match filter: ${matchFilter}`);
  }
  console.log(`# Scrapers: ${bookmakers.length}`);
  console.log(`${"#".repeat(60)}`);

  for (const bookmaker of bookmakers) {
    const result = await testScraper(bookmaker, league, matchFilter);
    results.push(result);
  }

  // Summary
  console.log(`\n${"#".repeat(60)}`);
  console.log(`# SUMMARY`);
  console.log(`${"#".repeat(60)}\n`);

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const meetsReq = results.filter((r) => r.meetsRequirement);

  console.log(`Total scrapers: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Meets ≥50 markets requirement: ${meetsReq.length}`);

  // Check if we have a match filter
  const hasMatchFilter = results.some((r) => r.matchFilter);

  if (hasMatchFilter) {
    // Show filtered match summary
    console.log(`\n${"─".repeat(70)}`);
    console.log(
      `${"Bookmaker".padEnd(12)} | ${"Status".padEnd(8)} | ${"Match".padEnd(35)} | ${"Markets".padEnd(8)} | ≥50`
    );
    console.log(`${"─".repeat(70)}`);

    for (const r of results) {
      const status = r.success ? "✅ OK" : "❌ FAIL";
      const matchName = r.filteredMatch
        ? `${r.filteredMatch.homeTeam} vs ${r.filteredMatch.awayTeam}`.slice(0, 35)
        : "NOT FOUND";
      const markets = r.filteredMatch ? String(r.filteredMatch.marketCount) : "-";
      const meets = r.filteredMatch && r.filteredMatch.marketCount >= 50 ? "✅" : "❌";
      console.log(
        `${r.bookmaker.padEnd(12)} | ${status.padEnd(8)} | ${matchName.padEnd(35)} | ${markets.padEnd(8)} | ${meets}`
      );
    }
    console.log(`${"─".repeat(70)}`);

    // Count how many meet the ≥50 requirement for filtered match
    const filteredMeets50 = results.filter(
      (r) => r.filteredMatch && r.filteredMatch.marketCount >= 50
    ).length;
    console.log(`\nFiltered match meets ≥50: ${filteredMeets50}/${results.length}`);
  } else {
    // Original summary table
    console.log(`\n${"─".repeat(90)}`);
    console.log(
      `${"Bookmaker".padEnd(12)} | ${"Status".padEnd(8)} | ${"Matches".padEnd(8)} | ${"Markets".padEnd(8)} | ${"Avg".padEnd(6)} | ${"Min".padEnd(5)} | ${"Max".padEnd(5)} | ${"Req".padEnd(4)} | Duration`
    );
    console.log(`${"─".repeat(90)}`);

    for (const r of results) {
      const status = r.success ? "✅ OK" : "❌ FAIL";
      const req = r.meetsRequirement ? "✅" : "⚠️";
      console.log(
        `${r.bookmaker.padEnd(12)} | ${status.padEnd(8)} | ${String(r.matchCount).padEnd(8)} | ${String(r.totalMarkets).padEnd(8)} | ${r.avgMarketsPerMatch.toFixed(1).padEnd(6)} | ${String(r.minMarkets).padEnd(5)} | ${String(r.maxMarkets).padEnd(5)} | ${req.padEnd(4)} | ${(r.duration / 1000).toFixed(1)}s`
      );
    }
    console.log(`${"─".repeat(90)}`);
  }

  // Failed details
  if (failed.length > 0) {
    console.log(`\n⚠️ FAILED SCRAPERS:`);
    for (const r of failed) {
      console.log(`  - ${r.bookmaker}: ${r.error}`);
    }
  }

  // Below requirement
  const belowReq = results.filter((r) => r.success && !r.meetsRequirement);
  if (belowReq.length > 0) {
    console.log(`\n⚠️ BELOW ≥50 MARKETS REQUIREMENT:`);
    for (const r of belowReq) {
      console.log(`  - ${r.bookmaker}: min=${r.minMarkets}, avg=${r.avgMarketsPerMatch.toFixed(1)}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse --match argument
  let matchFilter: string | undefined;
  const matchArgIndex = args.findIndex((a) => a === "--match");
  if (matchArgIndex !== -1 && args[matchArgIndex + 1]) {
    matchFilter = args[matchArgIndex + 1];
    args.splice(matchArgIndex, 2); // Remove --match and its value from args
  }

  const bookmakerArg = args[0];
  const league = args[1] || "ekstraklasa";

  if (bookmakerArg && bookmakerArg !== "all" && SCRAPERS[bookmakerArg as PolishBookmaker]) {
    // Test single scraper
    await testScraper(bookmakerArg as PolishBookmaker, league, matchFilter);
  } else if (bookmakerArg === "all" || !bookmakerArg) {
    // Test all scrapers
    await testAllScrapers(league, matchFilter);
  } else {
    console.log(`Unknown bookmaker: ${bookmakerArg}`);
    console.log(`Available: ${Object.keys(SCRAPERS).join(", ")}, all`);
    console.log(`\nUsage: npx tsx src/scripts/test-full-offer.ts [bookmaker] [league] [--match "team1,team2"]`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
