/**
 * Analyze Polish market name patterns to find more normalizable markets
 */

import { superbetScraper } from "../scrapers/bookmakers/index.js";
import { normalizeMarkets } from "../services/market-normalizer.js";
import { NormalizedMarketType } from "../types/normalization.js";

async function analyzePatterns() {
  console.log("=== Analyzing Polish Market Name Patterns ===\n");

  const result = await superbetScraper.scrapeFullOffer("premier-league");
  if (!result.success) {
    console.error("Failed to scrape:", result.error);
    process.exit(1);
  }

  // Group markets by type
  const byType = new Map<NormalizedMarketType, number>();
  const nonRynekPatterns = new Map<string, {count: number, samples: string[]}>();

  for (const match of result.matches) {
    for (const market of match.markets) {
      // Count by normalized type
      const normalized = normalizeMarkets([market])[0];
      const current = byType.get(normalized.normalizedType) || 0;
      byType.set(normalized.normalizedType, current + 1);

      // Collect non-Rynek market names
      if (!market.name.match(/^Rynek /)) {
        const key = market.name.toLowerCase();
        if (!nonRynekPatterns.has(key)) {
          nonRynekPatterns.set(key, {count: 0, samples: []});
        }
        const data = nonRynekPatterns.get(key)!;
        data.count++;
        if (data.samples.length < 1) {
          data.samples.push(market.name);
        }
      }
    }
  }

  console.log("=== Current Coverage ===");
  const total = result.matches.reduce((sum, m) => sum + m.markets.length, 0);
  const otherCount = byType.get(NormalizedMarketType.OTHER) || 0;
  const coverage = ((total - otherCount) / total * 100).toFixed(1);
  console.log(`Total markets: ${total}`);
  console.log(`OTHER: ${otherCount} (${(otherCount/total*100).toFixed(1)}%)`);
  console.log(`Coverage: ${coverage}%`);

  console.log("\n=== Non-Rynek Market Names (Polish) ===");
  const sorted = Array.from(nonRynekPatterns.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 30);

  for (const [name, data] of sorted) {
    console.log(`\n${name} (${data.count}x)`);
    for (const sample of data.samples) {
      console.log(`  - "${sample}"`);
    }
  }

  await superbetScraper.cleanup();
  process.exit(0);
}

analyzePatterns().catch(console.error);
