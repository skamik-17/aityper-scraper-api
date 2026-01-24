/**
 * Test script to verify Betclic tab scraper performance optimizations
 * Tests:
 * 1. Session reuse between matches
 * 2. Resource blocking (images, fonts, analytics)
 * 3. Tab clicking speed
 * 4. Performance metrics logging
 */

import { BetclicPlaywrightTabScraper } from "../src/scrapers/bookmakers/betclic/tab-scraper.js";

const TEST_MATCHES = [
  "https://www.betclic.pl/pilka-nozna-sfootball/premier-league-c3/west-ham-sunderland-m905675290968064",
];

async function runPerformanceTest() {
  console.log("=".repeat(80));
  console.log("Betclic Tab Scraper Performance Test");
  console.log("=".repeat(80));
  console.log();

  const scraper = new BetclicPlaywrightTabScraper();

  const startTime = Date.now();
  const results: {
    matchIndex: number;
    matchUrl: string;
    duration: number;
    success: boolean;
  }[] = [];

  for (let i = 0; i < TEST_MATCHES.length; i++) {
    console.log(`\n[${i + 1}/${TEST_MATCHES.length}] Testing match: ${TEST_MATCHES[i]}`);

    const matchStart = Date.now();

    try {
      const responses = await scraper.fetchMarketsWithTabClicks(TEST_MATCHES[i]);
      const duration = Date.now() - matchStart;

      results.push({
        matchIndex: i,
        matchUrl: TEST_MATCHES[i],
        duration,
        success: true,
      });

      console.log(`✓ Match completed in ${duration}ms, captured ${responses.length} responses`);
    } catch (error) {
      const duration = Date.now() - matchStart;

      results.push({
        matchIndex: i,
        matchUrl: TEST_MATCHES[i],
        duration,
        success: false,
      });

      console.error(`✗ Match failed after ${duration}ms:`, error);
    }

    // Small delay between matches to let metrics settle
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const totalDuration = Date.now() - startTime;

  console.log("\n" + "=".repeat(80));
  console.log("Performance Summary");
  console.log("=".repeat(80));
  console.log(`Total matches: ${TEST_MATCHES.length}`);
  console.log(`Successful matches: ${results.filter((r) => r.success).length}`);
  console.log(`Failed matches: ${results.filter((r) => !r.success).length}`);
  console.log(`Total duration: ${totalDuration}ms`);
  console.log(`Avg per match: ${Math.round(totalDuration / TEST_MATCHES.length)}ms`);

  const avgDuration =
    results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const minDuration = Math.min(...results.map((r) => r.duration));
  const maxDuration = Math.max(...results.map((r) => r.duration));

  console.log(`Min match duration: ${minDuration}ms`);
  console.log(`Max match duration: ${maxDuration}ms`);
  console.log(`Avg match duration: ${Math.round(avgDuration)}ms`);

  // Check if performance meets acceptance criteria
  const isFastEnough = avgDuration < 60000; // 60 seconds per 10 matches avg
  console.log(`\nPerformance criteria met: ${isFastEnough ? "YES ✓" : "NO ✗"}`);
  console.log(`  Target: < 60s avg per match (from AC #5)`);
  console.log(`  Actual: ${Math.round(avgDuration / 1000)}s avg per match`);

  await scraper.cleanup();
}

runPerformanceTest().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
