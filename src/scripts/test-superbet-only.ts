/**
 * Test script for Superbet only
 */
import { superbetScraper } from "../scrapers/bookmakers/superbet.js";

async function testSuperbet() {
  console.log("--- Testing Superbet Premier League Listing ---");
  try {
    const res = await superbetScraper.scrapeLeague("premier-league");
    if (res.status === "success" && res.data) {
      console.log(`✅ Found ${res.data.length} matches.`);
      
      const matchWithUrl = res.data.find(m => m.eventUrl);
      if (matchWithUrl) {
        console.log("\n--- Testing Superbet Match Details ---");
        console.log(`URL: ${matchWithUrl.eventUrl}`);
        const details = await superbetScraper.scrapeMatchDetails(matchWithUrl.eventUrl);
        if (details.status === "success" && details.data) {
          console.log("✅ Details success!");
          console.log("   Markets found:", Object.keys(details.data).filter(k => k.startsWith('market')));
          console.log("   1X2:", JSON.stringify(details.data.market1X2));
          console.log("   DC:", JSON.stringify(details.data.marketDoubleChance));
          console.log("   BTTS:", JSON.stringify(details.data.marketBTTS));
          console.log("   O/U (first 2):", JSON.stringify(Object.entries(details.data.marketOverUnder || {}).slice(0, 2)));
        } else {
          console.log("❌ Details failed:", details.error);
        }
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await superbetScraper.cleanup();
  }
}

testSuperbet();
