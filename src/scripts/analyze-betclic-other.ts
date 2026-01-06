/**
 * Analyze Betclic OTHER markets in detail
 */

import { betclicScraper } from "../scrapers/bookmakers/index.js";
import { normalizeMarketsForBookmaker } from "../services/market-normalizer.js";
import { NormalizedMarketType, NormalizedMarketGroup } from "../types/normalization.js";

async function test() {
  const result = await betclicScraper.scrapeFullOffer("premier-league");
  if (result.success && result.matches.length > 0) {
    const allMarkets = result.matches.flatMap((m) => m.markets);
    const normalized = normalizeMarketsForBookmaker(allMarkets, "betclic");

    // Count by type
    const typeCounts = new Map<NormalizedMarketType, number>();
    const groupCounts = new Map<NormalizedMarketGroup, number>();

    for (const m of normalized) {
      typeCounts.set(m.normalizedType, (typeCounts.get(m.normalizedType) || 0) + 1);
      groupCounts.set(m.normalizedGroup, (groupCounts.get(m.normalizedGroup) || 0) + 1);
    }

    console.log("Total markets:", normalized.length);
    console.log("\nMarket type distribution:");
    for (const [type, count] of typeCounts.entries()) {
      const pct = (count / normalized.length * 100).toFixed(1);
      console.log(`  ${type}: ${count} (${pct}%)`);
    }

    console.log("\nMarket group distribution:");
    for (const [group, count] of groupCounts.entries()) {
      const pct = (count / normalized.length * 100).toFixed(1);
      console.log(`  ${group}: ${count} (${pct}%)`);
    }

    // Count non-OTHER
    const nonOther = normalized.length - (typeCounts.get(NormalizedMarketType.OTHER) || 0);
    console.log("\nCoverage (non-OTHER):", (nonOther / normalized.length * 100).toFixed(1) + "%");

    // Get OTHER market details
    const otherMarkets = new Map<string, number>();
    for (const m of normalized) {
      if (m.normalizedType === NormalizedMarketType.OTHER) {
        otherMarkets.set(m.name, (otherMarkets.get(m.name) || 0) + 1);
      }
    }

    console.log("\nTotal OTHER unique markets:", otherMarkets.size);
    console.log("\nFirst 20 OTHER markets:");
    const sorted = Array.from(otherMarkets.entries()).sort(
      (a, b) => b[1] - a[1]
    );
    sorted.slice(0, 20).forEach(([name, count], i) => {
      console.log(`${i + 1}. "${name}" (${count}x)`);
    });
  }
  await betclicScraper.cleanup();
}

test();
