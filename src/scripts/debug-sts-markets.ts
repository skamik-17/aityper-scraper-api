/**
 * Debug script to analyze STS market IDs and their selections
 */

import { stsScraper } from "../scrapers/bookmakers/index.js";

async function main() {
  console.log("Fetching STS markets...");

  try {
    const result = await stsScraper.scrapeFullOffer("premier-league");

    if (!result.success || result.matches.length === 0) {
      console.error("Failed:", result.error);
      process.exit(1);
    }

    console.log(`\nFound ${result.matches.length} matches\n`);

    // Find match with most markets
    let bestMatch = result.matches[0];
    for (const match of result.matches) {
      if (match.markets.length > bestMatch.markets.length) {
        bestMatch = match;
      }
    }
    const match = bestMatch;
    console.log(`Analyzing: ${match.home} vs ${match.away}`);
    console.log(`Markets: ${match.markets.length}\n`);

    // Aggregate Rynek markets across ALL matches to get better selection data
    const rynekMarkets = new Map<string, {
      name: string;
      groupName?: string;
      selections: Array<{ name: string; odds: number }>;
      matchCount: number;
    }>();

    for (const m of result.matches) {
      for (const market of m.markets) {
        if (market.name.startsWith("Rynek ")) {
          const existing = rynekMarkets.get(market.name);
          if (!existing) {
            rynekMarkets.set(market.name, {
              name: market.name,
              groupName: market.groupName,
              selections: market.selections.map(s => ({
                name: s.name,
                odds: s.odds
              })),
              matchCount: 1
            });
          } else {
            existing.matchCount++;
            // Keep selections with more entries or more descriptive names
            if (market.selections.length > existing.selections.length ||
                (market.selections[0]?.name && !/^\d+$/.test(market.selections[0].name) && /^\d+$/.test(existing.selections[0]?.name))) {
              existing.selections = market.selections.map(s => ({
                name: s.name,
                odds: s.odds
              }));
              existing.groupName = market.groupName;
            }
          }
        }
      }
    }

    // Sort by Rynek number
    const sortedMarkets = Array.from(rynekMarkets.values()).sort((a, b) => {
      const numA = parseInt(a.name.replace("Rynek ", ""));
      const numB = parseInt(b.name.replace("Rynek ", ""));
      return numA - numB;
    });

    console.log("Unknown Rynek markets and their selections:\n");
    console.log("=".repeat(70));

    for (const market of sortedMarkets) {
      console.log(`\n${market.name} (in ${market.matchCount} matches, group: ${market.groupName || "?"}):`);
      console.log(`  Selections (${market.selections.length}):`);
      for (const sel of market.selections.slice(0, 15)) {
        console.log(`    - "${sel.name}" @ ${sel.odds}`);
      }
      if (market.selections.length > 15) {
        console.log(`    ... and ${market.selections.length - 15} more`);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("\nDone!");

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await stsScraper.cleanup();
    process.exit(0);
  }
}

main();
