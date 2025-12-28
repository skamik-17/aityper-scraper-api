/**
 * Test script for STS only
 */
import { stsScraper } from "../scrapers/bookmakers/sts.js";

async function testSTS() {
  console.log("--- Testing STS Premier League Listing ---");
  try {
    const res = await stsScraper.scrapeLeague("premier-league");
    if (res.status === "success" && res.data) {
      console.log(`✅ Found ${res.data.length} matches.`);
      res.data.slice(0, 5).forEach((m, i) => {
        console.log(`${i+1}. ${m.homeTeam} vs ${m.awayTeam}`);
        console.log(`   URL: ${m.eventUrl}`);
        console.log(`   Odds: ${m.homeOdds} | ${m.drawOdds} | ${m.awayOdds}`);
      });

      if (res.data[0].eventUrl) {
        console.log("\n--- Testing STS Match Details ---");
        const details = await stsScraper.scrapeMatchDetails(res.data[0].eventUrl);
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
    } else {
      console.log("❌ Listing failed:", res.error);
    }
  } catch (err) {
    console.error("Fatal error:", err);
  } finally {
    await stsScraper.cleanup();
  }
}

testSTS();
