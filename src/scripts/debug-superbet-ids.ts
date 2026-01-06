/**
 * Debug script to show selections for specific Superbet market IDs
 * This helps identify what the unknown "Rynek XXX" markets actually are
 */

import { superbetScraper } from "../scrapers/bookmakers/index.js";
import { normalizeMarkets } from "../services/market-normalizer.js";
import { NormalizedMarketType } from "../types/normalization.js";

// The IDs we want to investigate
const UNKNOWN_IDS = [
  "236424", "236430", "236428", "236426", "236436",
  "233483", "233482", "704", "233484", "233485",
  "542", "201511", "713", "733", "544",
  "200755", "200756", "200773", "200571"
];

async function debugMarketIds() {
  console.log("=== Superbet Market ID Debug ===\n");

  try {
    const result = await superbetScraper.scrapeFullOffer("premier-league");
    if (!result.success) {
      console.error("Failed to scrape:", result.error);
      process.exit(1);
    }

    const seen = new Set<string>();

    // Find and display markets with unknown IDs
    for (const match of result.matches) {
      for (const market of match.markets) {
        const idMatch = market.name.match(/^Rynek\s+(\d+)$/i);
        if (idMatch && UNKNOWN_IDS.includes(idMatch[1]) && !seen.has(idMatch[1])) {
          seen.add(idMatch[1]);

          console.log(`\n=== ${market.name} (appears in analysis) ===`);
          console.log(`Selections (${market.selections.length} total):`);

          // Show all unique selections to identify market type
          const uniqueSelections = new Set<string>();
          for (const sel of market.selections) {
            uniqueSelections.add(sel.name);
          }

          for (const selName of Array.from(uniqueSelections).slice(0, 10)) {
            console.log(`  - "${selName}"`);
          }

          // Try to identify market type from selections
          const allNames = Array.from(uniqueSelections).join(" ").toLowerCase();

          let suggestedType = "UNKNOWN";
          if (/1|x|2/.test(allNames) && !/poniżej|powyżej|over|under|gole|bramki/.test(allNames)) {
            suggestedType = "MATCH_WINNER or HALF_TIME_RESULT";
          } else if (/poniżej|powyżej|over|under/.test(allNames)) {
            suggestedType = "TOTAL_GOALS or similar";
          } else if (/gg|ng|tak|nie|obie|strzel/.test(allNames)) {
            suggestedType = "BTTS or HALF_TIME_BTTS";
          } else if (/ handicap |handicap/i.test(allNames)) {
            suggestedType = "HANDICAP type";
          } else if (/bramka|gola?|goal/.test(allNames) && /strzelec|scorer/.test(allNames)) {
            suggestedType = "GOALSCORER (player market)";
          } else if (/rożny|corn/.test(allNames)) {
            suggestedType = "CORNERS";
          } else if (/żółt|yell|kartk|card/.test(allNames)) {
            suggestedType = "CARDS";
          }

          console.log(`  Suggested type: ${suggestedType}`);

          if (seen.size === UNKNOWN_IDS.length) break;
        }
      }

      if (seen.size === UNKNOWN_IDS.length) break;
    }

    console.log("\n=== Summary ===");
    console.log(`Found ${seen.size}/${UNKNOWN_IDS.length} IDs`);
    const notFound = UNKNOWN_IDS.filter(id => !seen.has(id));
    if (notFound.length > 0) {
      console.log(`Not found: ${notFound.join(", ")}`);
    }

  } finally {
    await superbetScraper.cleanup();
  }

  process.exit(0);
}

debugMarketIds();
