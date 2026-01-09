/**
 * Full analysis of Fuksiarz markets - both categorized and uncategorized
 */

import { fuksiarzScraper } from "../scrapers/bookmakers/index.js";
import { normalizeMarketsForBookmaker } from "../services/normalization/index.js";
import { NormalizedMarketType } from "../types/normalization.js";

async function main() {
  try {
    const result = await fuksiarzScraper.scrapeFullOffer("premier-league");
    if (!result.success) {
      console.log("Scrape failed:", result.error);
      return;
    }

    const allMarkets = result.matches.flatMap(m => m.markets);
    const normalized = normalizeMarketsForBookmaker(allMarkets, "fuksiarz");

    // Group by normalized type
    const byType = new Map<string, Map<string, { count: number; selections: string[] }>>();

    for (const m of normalized) {
      const type = m.normalizedType || "OTHER";
      if (!byType.has(type)) {
        byType.set(type, new Map());
      }
      const typeMarkets = byType.get(type)!;

      if (!typeMarkets.has(m.name)) {
        typeMarkets.set(m.name, { count: 1, selections: m.selections.slice(0, 3).map(s => s.name) });
      } else {
        typeMarkets.get(m.name)!.count++;
      }
    }

    // Sort types by count
    const sortedTypes = Array.from(byType.entries())
      .map(([type, markets]) => ({
        type,
        totalCount: Array.from(markets.values()).reduce((sum, m) => sum + m.count, 0),
        markets: Array.from(markets.entries()).sort((a, b) => b[1].count - a[1].count)
      }))
      .sort((a, b) => b.totalCount - a.totalCount);

    console.log("\n=== Fuksiarz Markets by Normalized Type ===\n");

    for (const { type, totalCount, markets } of sortedTypes) {
      console.log(`\n--- ${type} (${totalCount} markets) ---`);
      for (const [name, data] of markets.slice(0, 10)) {
        console.log(`  "${name}" (${data.count}x)`);
        console.log(`    Selections: ${data.selections.join(", ")}`);
      }
      if (markets.length > 10) {
        console.log(`  ... and ${markets.length - 10} more unique market names`);
      }
    }

  } finally {
    await fuksiarzScraper.cleanup();
  }
}
main();
