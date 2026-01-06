/**
 * Find BTTS and Double Chance markets in Fuksiarz
 */

import { fuksiarzScraper } from "../scrapers/bookmakers/index.js";

async function main() {
  try {
    const result = await fuksiarzScraper.scrapeFullOffer("premier-league");
    if (!result.success) {
      console.log("Scrape failed:", result.error);
      return;
    }

    const allMarkets = result.matches.flatMap(m => m.markets);

    console.log("\n=== Markets containing 'obie' or 'podwoj' ===\n");

    const bttsMarkets = allMarkets.filter(m =>
      m.name.toLowerCase().includes("obie") ||
      m.name.toLowerCase().includes("podwoj") ||
      m.name.toLowerCase().includes("podwój")
    );

    const uniqueNames = new Map<string, number>();
    for (const m of bttsMarkets) {
      uniqueNames.set(m.name, (uniqueNames.get(m.name) || 0) + 1);
    }

    for (const [name, count] of Array.from(uniqueNames.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`"${name}" (${count}x)`);
    }

    console.log(`\nTotal unique names: ${uniqueNames.size}`);

  } finally {
    await fuksiarzScraper.cleanup();
  }
}
main();
