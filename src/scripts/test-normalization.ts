/**
 * Test script to verify market normalization is working
 * Checks that marketKey, normalizedType, and normalizedName fields are populated
 */

import { superbetScraper } from "../scrapers/bookmakers/index.js";
import { normalizeMarkets } from "../services/market-normalizer.js";
import { NormalizedMarketType, NormalizedSelection } from "../types/normalization.js";

async function testNormalization() {
    console.log("=".repeat(60));
    console.log("MARKET NORMALIZATION TEST");
    console.log("=".repeat(60));

    try {
        const result = await superbetScraper.scrapeFullOffer("ekstraklasa");

        if (!result.success || result.matches.length === 0) {
            console.log("❌ Failed to scrape matches");
            process.exit(1);
        }

        const match = result.matches[0];
        console.log(`\nMatch: ${match.homeTeam} vs ${match.awayTeam}`);
        console.log(`Total markets: ${match.markets.length}`);

        // Apply normalization
        const normalizedMarkets = normalizeMarkets(match.markets);

        // Statistics
        let withMarketKey = 0;
        let withNormalizedType = 0;
        let withNormalizedSelections = 0;
        const typeDistribution: Record<string, number> = {};

        for (const market of normalizedMarkets) {
            if (market.marketKey) withMarketKey++;
            if (market.normalizedType) {
                withNormalizedType++;
                typeDistribution[market.normalizedType] = (typeDistribution[market.normalizedType] || 0) + 1;
            }

            const normalizedSelCount = market.selections.filter(
                (s) => s.normalizedName && s.normalizedName !== NormalizedSelection.UNKNOWN
            ).length;
            if (normalizedSelCount > 0) withNormalizedSelections++;
        }

        console.log("\n--- NORMALIZATION STATISTICS ---");
        console.log(`Markets with marketKey: ${withMarketKey}/${normalizedMarkets.length} (${((withMarketKey / normalizedMarkets.length) * 100).toFixed(1)}%)`);
        console.log(`Markets with normalizedType: ${withNormalizedType}/${normalizedMarkets.length} (${((withNormalizedType / normalizedMarkets.length) * 100).toFixed(1)}%)`);
        console.log(`Markets with normalized selections: ${withNormalizedSelections}/${normalizedMarkets.length} (${((withNormalizedSelections / normalizedMarkets.length) * 100).toFixed(1)}%)`);

        console.log("\n--- TYPE DISTRIBUTION ---");
        const sortedTypes = Object.entries(typeDistribution).sort((a, b) => b[1] - a[1]);
        for (const [type, count] of sortedTypes) {
            console.log(`  ${type}: ${count} markets`);
        }

        // Sample normalized markets
        console.log("\n--- SAMPLE NORMALIZED MARKETS ---");
        const samples = [
            normalizedMarkets.find((m) => m.normalizedType === NormalizedMarketType.MATCH_WINNER),
            normalizedMarkets.find((m) => m.normalizedType === NormalizedMarketType.TOTAL_GOALS),
            normalizedMarkets.find((m) => m.normalizedType === NormalizedMarketType.BTTS),
            normalizedMarkets.find((m) => m.normalizedType === NormalizedMarketType.DOUBLE_CHANCE),
        ].filter(Boolean);

        for (const sample of samples) {
            if (!sample) continue;
            console.log(`\n  📊 ${sample.name}`);
            console.log(`     marketKey: ${sample.marketKey}`);
            console.log(`     normalizedType: ${sample.normalizedType}`);
            console.log(`     selections:`);
            for (const sel of sample.selections.slice(0, 4)) {
                console.log(`       - "${sel.name}" → ${sel.normalizedName} (odds: ${sel.odds})`);
            }
        }

        // Check OTHER type percentage
        const otherCount = typeDistribution[NormalizedMarketType.OTHER] || 0;
        const otherPercentage = (otherCount / normalizedMarkets.length) * 100;

        console.log("\n--- VERDICT ---");
        if (withMarketKey === normalizedMarkets.length && otherPercentage < 50) {
            console.log("✅ Normalization is working correctly!");
            console.log(`   ${(100 - otherPercentage).toFixed(1)}% of markets are properly categorized`);
        } else if (withMarketKey > 0) {
            console.log("⚠️ Partial normalization success");
            console.log(`   ${otherPercentage.toFixed(1)}% of markets are still uncategorized (OTHER)`);
        } else {
            console.log("❌ Normalization is NOT working");
        }

    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    } finally {
        await superbetScraper.cleanup();
    }

    process.exit(0);
}

testNormalization();
