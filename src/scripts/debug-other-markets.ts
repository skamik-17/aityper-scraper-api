/**
 * Debug script to see what OTHER markets look like
 * Helps identify patterns we're missing
 */

import { superbetScraper } from "../scrapers/bookmakers/index.js";
import { normalizeMarkets } from "../services/market-normalizer.js";
import { NormalizedMarketType } from "../types/normalization.js";

async function analyzeOtherMarkets() {
    console.log("Analyzing OTHER markets...\n");

    try {
        const result = await superbetScraper.scrapeFullOffer("ekstraklasa");
        if (!result.success) process.exit(1);

        const match = result.matches[0];
        const normalized = normalizeMarkets(match.markets);

        const otherMarkets = normalized.filter(m => m.normalizedType === NormalizedMarketType.OTHER);

        // Group by name patterns
        const patterns: Record<string, string[]> = {};

        for (const market of otherMarkets) {
            // Get first word or key pattern
            const key = market.name.split(/[\s\-:]/)[0].toLowerCase();
            if (!patterns[key]) patterns[key] = [];
            if (patterns[key].length < 3) {
                patterns[key].push(market.name);
            }
        }

        console.log(`Total OTHER markets: ${otherMarkets.length}\n`);
        console.log("=== Sample market names by pattern ===\n");

        // Sort by frequency
        const sorted = Object.entries(patterns).sort((a, b) => b[1].length - a[1].length);

        for (const [pattern, samples] of sorted.slice(0, 30)) {
            console.log(`[${pattern}] (${patterns[pattern].length} markets)`);
            for (const sample of samples) {
                console.log(`  - "${sample}"`);
            }
        }

    } finally {
        await superbetScraper.cleanup();
    }

    process.exit(0);
}

analyzeOtherMarkets();
