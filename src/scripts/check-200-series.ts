import { superbetScraper } from "../scrapers/bookmakers/index.js";

const SERIES_200 = [
  "200247", "200248", "200735", "200736", "200737", "200738", "200739",
  "200753", "200754", "200755", "200756", "200765", "200766", "200770",
  "200771", "200772", "200773"
];

const SERIES_231 = [
  "231000", "231001", "231002", "231003", "231004", "231005", "231045"
];

async function check() {
  console.log("=== Checking 200xxx and 231xxx Series ===\n");

  const result = await superbetScraper.scrapeFullOffer("premier-league");
  if (!result.success) {
    console.error("Failed to scrape:", result.error);
    process.exit(1);
  }

  const seen = new Set<string>();

  for (const match of result.matches) {
    for (const market of match.markets) {
      const idMatch = market.name.match(/^Rynek\s+(\d+)$/i);
      if (idMatch && !seen.has(idMatch[1])) {
        const id = idMatch[1];
        if (SERIES_200.includes(id) || SERIES_231.includes(id)) {
          seen.add(id);

          console.log(`\n=== ${market.name} ===`);
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
  }

  console.log(`\n=== Summary ===`);
  console.log(`Found ${seen.size}/${SERIES_200.length + SERIES_231.length} IDs`);

  await superbetScraper.cleanup();
  process.exit(0);
}

check().catch(console.error);
