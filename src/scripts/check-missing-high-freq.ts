import { superbetScraper } from "../scrapers/bookmakers/index.js";

const HIGH_FREQ_IDS = [
  "236240", "236242", "236244", "201787", "236224", "236246", "200248"
];

async function check() {
  console.log("=== Checking High-Frequency Rynek IDs ===\n");

  const result = await superbetScraper.scrapeFullOffer("premier-league");
  if (!result.success) {
    console.error("Failed to scrape:", result.error);
    process.exit(1);
  }

  const seen = new Set<string>();

  for (const match of result.matches) {
    for (const market of match.markets) {
      const idMatch = market.name.match(/^Rynek\s+(\d+)$/i);
      if (idMatch && HIGH_FREQ_IDS.includes(idMatch[1]) && !seen.has(idMatch[1])) {
        seen.add(idMatch[1]);

        console.log(`\n=== ${market.name} (${idMatch[1]}) ===`);
        console.log(`Selections (${market.selections.length} total):`);

        const uniqueSelections = new Set<string>();
        for (const sel of market.selections) {
          uniqueSelections.add(sel.name);
        }

        for (const selName of Array.from(uniqueSelections).slice(0, 10)) {
          console.log(`  - "${selName}"`);
        }
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Found ${seen.size}/${HIGH_FREQ_IDS.length} IDs`);

  await superbetScraper.cleanup();
  process.exit(0);
}

check().catch(console.error);
