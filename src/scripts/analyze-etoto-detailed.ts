/**
 * Detailed analysis of Etoto uncategorized markets
 */

import { etotoScraper } from "../scrapers/bookmakers/index.js";
import { normalizeMarketsForBookmaker } from "../services/market-normalizer.js";
import { NormalizedMarketType } from "../types/normalization.js";

async function main() {
  try {
    const result = await etotoScraper.scrapeFullOffer("premier-league");
    if (!result.success) {
      console.log("Scrape failed:", result.error);
      return;
    }

    const allMarkets = result.matches.flatMap(m => m.markets);
    const normalized = normalizeMarketsForBookmaker(allMarkets, "etoto");

    // Get all OTHER markets
    const otherMarkets = normalized.filter(m => m.normalizedType === NormalizedMarketType.OTHER);

    // Get unique market names
    const uniqueNames = new Map<string, { count: number; selections: string[] }>();
    for (const m of otherMarkets) {
      if (!uniqueNames.has(m.name)) {
        uniqueNames.set(m.name, { count: 1, selections: m.selections.slice(0, 3).map(s => s.name) });
      } else {
        uniqueNames.get(m.name)!.count++;
      }
    }

    // Sort by count and print all
    const sorted = Array.from(uniqueNames.entries()).sort((a, b) => b[1].count - a[1].count);

    console.log("\n=== ALL Etoto Uncategorized Markets ===\n");
    for (const [name, data] of sorted) {
      console.log(`"${name}" (${data.count}x)`);
      console.log(`  Selections: ${data.selections.join(", ")}`);
    }
    console.log(`\nTotal unique uncategorized: ${sorted.length}`);

  } finally {
    await etotoScraper.cleanup();
  }
}
main();
