/**
 * Test full pipeline integration with bookmaker-specific normalizers
 */

import { runSingleFullOfferScraper } from "../scrapers/aggregator.js";

async function testIntegration() {
  console.log("===================================================================");
  console.log("INTEGRATION TEST - Bookmaker-Specific Normalizers");
  console.log("===================================================================");
  console.log("");

  // Test with a single bookmaker that has good coverage
  console.log("Testing Fortuna (79.4% coverage expected)...");
  const result = await runSingleFullOfferScraper("fortuna", "premier-league");

  if (result.success && result.matches.length > 0) {
    console.log(`Fortuna scraped: ${result.matches.length} matches`);

    const firstMatch = result.matches[0];
    console.log(`\nFirst match: ${firstMatch.homeTeam} vs ${firstMatch.awayTeam}`);
    console.log(`Total markets: ${firstMatch.markets.length}`);

    // Check normalization results
    let normalizedCount = 0;
    let otherCount = 0;
    const types: Record<string, number> = {};

    for (const market of firstMatch.markets) {
      if (market.normalizedType) {
        normalizedCount++;
        types[market.normalizedType] = (types[market.normalizedType] || 0) + 1;
      } else {
        otherCount++;
      }
    }

    console.log(`\nNormalization results:`);
    console.log(`  Normalized: ${normalizedCount} (${(normalizedCount/firstMatch.markets.length*100).toFixed(1)}%)`);
    console.log(`  OTHER: ${otherCount} (${(otherCount/firstMatch.markets.length*100).toFixed(1)}%)`);

    console.log(`\nType distribution:`);
    for (const [type, count] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }

    // Show sample normalized market
    const sampleNormalized = firstMatch.markets.find(m => m.normalizedType && m.normalizedType !== "OTHER");
    if (sampleNormalized) {
      console.log(`\nSample normalized market:`);
      console.log(`  Name: ${sampleNormalized.name}`);
      console.log(`  Normalized Type: ${sampleNormalized.normalizedType}`);
      console.log(`  Market Key: ${sampleNormalized.marketKey}`);
      console.log(`  Selections: ${sampleNormalized.selections.length}`);
    }

    console.log("\nINTEGRATION TEST PASSED");
  } else {
    console.log("Fortuna scrape failed");
  }

  console.log("===================================================================");
}

testIntegration().catch(console.error);
