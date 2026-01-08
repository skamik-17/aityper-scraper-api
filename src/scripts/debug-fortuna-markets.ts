import { fortunaScraper } from "../scrapers/bookmakers/index.js";
import { normalizer } from "../services/normalization/index.js";
import { NormalizedMarketType } from "../types/normalization.js";

async function debugFortunaMarkets() {
    console.log("Analyzing uncategorized Fortuna markets...\n");

    try {
        const result = await fortunaScraper.scrapeFullOffer("premier-league");
        if (!result.success) {
            console.error("Failed to scrape");
            process.exit(1);
        }

        // Collect all unknown market IDs with their structure
        const unknownIds = new Map<string, {
            count: number;
            groupName: string;
            selectionSamples: string[];
        }>();

        for (const match of result.matches) {
            for (const market of match.markets) {
                // Normalize to check if it's OTHER
                const normalized = normalizer.normalize(
                    market,
                    "fortuna",
                    match.homeTeam,
                    match.awayTeam
                );

                if (normalized.normalizedType === NormalizedMarketType.OTHER) {
                    // Extract ID if it's a "Rynek ufo:mtyp:" format
                    const idMatch = market.name.match(/ufo:mtyp:(\d+[-]\w+)/i);
                    const key = idMatch ? idMatch[1] : market.name;

                    if (!unknownIds.has(key)) {
                        unknownIds.set(key, {
                            count: 1,
                            groupName: market.groupName || "Unknown",
                            selectionSamples: market.selections.slice(0, 5).map((s: any) => s.name)
                        });
                    } else {
                        const entry = unknownIds.get(key)!;
                        entry.count++;
                    }
                }
            }
        }

        console.log(`Found ${unknownIds.size} unique uncategorized markets\n`);
        console.log("=== Uncategorized markets by frequency ===\n");

        const sorted = Array.from(unknownIds.entries())
            .sort((a, b) => b[1].count - a[1].count);

        for (const [id, data] of sorted) {
            console.log(`ufo:mtyp:${id} (${data.count}x)`);
            console.log(`  Group: ${data.groupName}`);
            console.log(`  Sample selections: ${data.selectionSamples.join(", ")}`);

            // Try to guess the type based on selections
            const selections = data.selectionSamples.join(" ").toLowerCase();
            let guess = "UNKNOWN";

            if (selections.includes("+") || selections.includes("-")) {
                if (selections.includes("2.5") || selections.includes("1.5") || selections.includes("3.5")) {
                    guess = "TOTAL_GOALS (Over/Under with line)";
                } else if (selections.includes("0.5") || selections.includes("1") || selections.includes("1.5") || selections.includes("2")) {
                    guess = "HANDICAP or TOTAL_GOALS";
                }
            }

            if (selections.includes("tak") && selections.includes("nie")) {
                guess = "BTTS or YES/NO market";
            }

            if (selections.includes("1") && selections.includes("0") && selections.includes("2")) {
                guess = "MATCH_WINNER (1X2 variant)";
            }

            if (selections.includes("1x") || selections.includes("x2") || selections.includes("12")) {
                guess = "DOUBLE_CHANCE variant";
            }

            console.log(`  Guess: ${guess}`);
            console.log();
        }

        console.log("\n=== Summary ===");
        const totalCount = Array.from(unknownIds.values()).reduce((sum, data) => sum + data.count, 0);
        console.log(`Total uncategorized market instances: ${totalCount}`);

    } finally {
        await fortunaScraper.cleanup();
    }

    process.exit(0);
}

debugFortunaMarkets();
