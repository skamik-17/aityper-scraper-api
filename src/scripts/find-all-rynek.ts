import { superbetScraper } from "../scrapers/bookmakers/index.js";

async function find() {
  const result = await superbetScraper.scrapeFullOffer("premier-league");
  if (!result.success) {
    console.error("Failed to scrape:", result.error);
    process.exit(1);
  }

  // Collect all Rynek IDs
  const rynekIds = new Map<string, number>();

  for (const match of result.matches) {
    for (const market of match.markets) {
      const idMatch = market.name.match(/^Rynek\s+(\d+)$/i);
      if (idMatch) {
        const id = idMatch[1];
        rynekIds.set(id, (rynekIds.get(id) || 0) + 1);
      }
    }
  }

  console.log(`Total unique Rynek IDs: ${rynekIds.size}`);
  console.log("\n=== All Rynek IDs (sorted by count) ===");
  
  const sorted = Array.from(rynekIds.entries()).sort((a, b) => b[1] - a[1]);
  for (const [id, count] of sorted) {
    console.log(`Rynek ${id}: ${count}x`);
  }

  await superbetScraper.cleanup();
  process.exit(0);
}

find().catch(console.error);
