import { superbetScraper } from "../scrapers/bookmakers/index.js";

const FREQUENT_IDS = [
  "231194", "236218", "236216", "236222", "236220", "201787", "236226",
  "236230", "236232", "236228", "200248", "236224", "236246"
];

async function check() {
  console.log("=== Checking Frequent Rynek IDs ===\n");

  const result = await superbetScraper.scrapeFullOffer("premier-league");
  if (!result.success) {
    console.error("Failed to scrape:", result.error);
    process.exit(1);
  }

  const seen = new Set<string>();

  for (const match of result.matches) {
    for (const market of match.markets) {
      const idMatch = market.name.match(/^Rynek\s+(\d+)$/i);
      if (idMatch && FREQUENT_IDS.includes(idMatch[1]) && !seen.has(idMatch[1])) {
        seen.add(idMatch[1]);

        console.log(`\n=== ${market.name} ===`);
        console.log(`Selections (${market.selections.length} total):`);

        const uniqueSelections = new Set<string>();
        for (const sel of market.selections) {
          uniqueSelections.add(sel.name);
        }

        for (const selName of Array.from(uniqueSelections).slice(0, 12)) {
          console.log(`  - "${selName}"`);
        }

        if (seen.size === FREQUENT_IDS.length) break;
      }
    }

    if (seen.size === FREQUENT_IDS.length) break;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Found ${seen.size}/${FREQUENT_IDS.length} IDs`);

  await superbetScraper.cleanup();
  process.exit(0);
}

check().catch(console.error);
