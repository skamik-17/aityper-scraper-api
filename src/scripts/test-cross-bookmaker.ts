/**
 * Compare normalization across different bookmakers
 * Verifies that same markets get same marketKey
 */

import { superbetScraper, stsScraper } from "../scrapers/bookmakers/index.js";
import { normalizeMarketsForBookmaker } from "../services/normalization/index.js";
import { NormalizedMarketType } from "../types/normalization.js";

async function compareBookmakers() {
    console.log("=".repeat(60));
    console.log("CROSS-BOOKMAKER NORMALIZATION TEST");
    console.log("=".repeat(60));

    const bookmakers = [
        { name: "Superbet", scraper: superbetScraper },
        { name: "STS", scraper: stsScraper },
    ];

    const marketsByKey: Record<string, Array<{ bookmaker: string; name: string; selections: string[] }>> = {};

    for (const { name, scraper } of bookmakers) {
        console.log(`\n[${name}] Scraping...`);
        try {
            const result = await scraper.scrapeFullOffer("ekstraklasa");
            if (!result.success || result.matches.length === 0) {
                console.log(`[${name}] No matches found`);
                continue;
            }

            // Take first match
            const match = result.matches[0];
            console.log(`[${name}] Match: ${match.homeTeam} vs ${match.awayTeam}`);

            const bookmaker = name.toLowerCase() as "superbet" | "sts";
            const normalized = normalizeMarketsForBookmaker(match.markets, bookmaker, match.homeTeam, match.awayTeam);

            // Only look at non-OTHER markets
            const coreMarkets = normalized.filter(m => m.normalizedType !== NormalizedMarketType.OTHER);
            console.log(`[${name}] Core markets: ${coreMarkets.length}`);

            for (const market of coreMarkets) {
                const key = market.marketKey || "UNKNOWN";
                if (!marketsByKey[key]) marketsByKey[key] = [];
                marketsByKey[key].push({
                    bookmaker: name,
                    name: market.name,
                    selections: market.selections.map(s => `${s.name}=${s.odds}`).slice(0, 3),
                });
            }
        } catch (error) {
            console.error(`[${name}] Error:`, error);
        } finally {
            await scraper.cleanup();
        }
    }

    console.log("\n" + "=".repeat(60));
    console.log("COMPARISON RESULTS");
    console.log("=".repeat(60));

    // Show markets that appear in both bookmakers
    const sharedKeys = Object.entries(marketsByKey)
        .filter(([_, entries]) => {
            const bookmakerNames = new Set(entries.map(e => e.bookmaker));
            return bookmakerNames.size > 1;
        })
        .sort((a, b) => a[0].localeCompare(b[0]));

    if (sharedKeys.length === 0) {
        console.log("\n⚠️ No shared marketKeys found between bookmakers");
        console.log("(Matches might be different or markets not overlapping)");
    } else {
        console.log(`\n✅ Found ${sharedKeys.length} shared marketKeys!\n`);

        for (const [key, entries] of sharedKeys.slice(0, 15)) {
            console.log(`\n📊 ${key}`);
            for (const entry of entries) {
                console.log(`   [${entry.bookmaker}] "${entry.name}"`);
                console.log(`      ${entry.selections.join(", ")}`);
            }
        }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total unique marketKeys: ${Object.keys(marketsByKey).length}`);
    console.log(`Shared between bookmakers: ${sharedKeys.length}`);

    process.exit(0);
}

compareBookmakers();
