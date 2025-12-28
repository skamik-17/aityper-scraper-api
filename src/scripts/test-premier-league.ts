/**
 * Backend test script for Premier League scrapers with filtering
 * Prefer pre-match events like Chelsea vs Bournemouth
 */

import { stsScraper } from "../scrapers/bookmakers/sts.js";
import { fortunaScraper } from "../scrapers/bookmakers/fortuna.js";
import { superbetScraper } from "../scrapers/bookmakers/superbet.js";
import { lvbetScraper } from "../scrapers/bookmakers/lvbet.js";
import { fuksiarzScraper } from "../scrapers/bookmakers/fuksiarz.js";
import { betfanScraper } from "../scrapers/bookmakers/betfan.js";
import { totalbetScraper } from "../scrapers/bookmakers/totalbet.js";
import { forbetScraper } from "../scrapers/bookmakers/forbet.js";
import { etotoScraper } from "../scrapers/bookmakers/etoto.js";
import { bettersScraper } from "../scrapers/bookmakers/betters.js";
import { lebullScraper } from "../scrapers/bookmakers/lebull.js";
import { betcrisScraper } from "../scrapers/bookmakers/betcris.js";
import { pzbukScraper } from "../scrapers/bookmakers/pzbuk.js";

const allScrapers: Record<string, any> = {
  sts: stsScraper,
  fortuna: fortunaScraper,
  superbet: superbetScraper,
  lvbet: lvbetScraper,
  fuksiarz: fuksiarzScraper,
  betfan: betfanScraper,
  totalbet: totalbetScraper,
  forbet: forbetScraper,
  etoto: etotoScraper,
  betters: bettersScraper,
  lebull: lebullScraper,
  betcris: betcrisScraper,
  pzbuk: pzbukScraper,
};

async function test() {
  const league = "premier-league";
  const args = process.argv.slice(2);
  const bookmakerArg = args.find(a => a.startsWith('--bookmaker='))?.split('=')[1];

  let scrapersToTest: Record<string, any> = {};
  if (bookmakerArg) {
    if (allScrapers[bookmakerArg]) scrapersToTest[bookmakerArg] = allScrapers[bookmakerArg];
    else { console.error(`Unknown bookmaker: ${bookmakerArg}`); process.exit(1); }
  } else {
    scrapersToTest = allScrapers;
  }

  const results = [];

  for (const [name, scraper] of Object.entries(scrapersToTest)) {
    console.log(`\n--- Testing ${name.toUpperCase()} ---`);
    try {
      const res = await scraper.scrapeLeague(league);
      if (res.status === "success" && res.data && res.data.length > 0) {
        console.log(`✅ Listing Success! Found ${res.data.length} matches.`);
        
        // Prefer Chelsea match for testing details
        let match = res.data.find((m: any) => 
          (m.homeTeam.toLowerCase().includes("chelsea") || m.awayTeam.toLowerCase().includes("chelsea")) && m.eventUrl
        );
        
        // Fallback to any match with URL that isn't currently Live if possible (crude check)
        if (!match) {
          match = res.data.find((m: any) => m.eventUrl && !m.eventName?.toLowerCase().includes("live"));
        }
        
        // Final fallback
        if (!match) match = res.data[0];

        console.log(`   Selected for details: ${match.homeTeam} vs ${match.awayTeam}`);
        
        if (match.eventUrl) {
          console.log(`   URL: ${match.eventUrl}`);
          const details = await scraper.scrapeMatchDetails(match.eventUrl);
          if (details.status === "success") {
            console.log(`   ✅ Details success!`);
            console.log(`      1X2: ${JSON.stringify(details.data.market1X2)}`);
            console.log(`      DC:  ${JSON.stringify(details.data.marketDoubleChance)}`);
            console.log(`      BTTS: ${JSON.stringify(details.data.marketBTTS)}`);
            const ouEntries = Object.entries(details.data.marketOverUnder || {});
            console.log(`      O/U: ${ouEntries.length} lines found.`);
            if (ouEntries.length > 0) console.log(`      Sample O/U: ${JSON.stringify(ouEntries[0])}`);
          } else {
            console.log(`   ❌ Details failed: ${details.error}`);
          }
        } else {
          console.log(`   ⚠️ No eventUrl found for details test`);
        }
        results.push({ name, status: "PASS", count: res.data.length });
      } else {
        console.log(`❌ Failed: ${res.error || 'No data'}`);
        results.push({ name, status: "FAIL", error: res.error });
      }
    } catch (err: any) {
      console.log(`❌ Error: ${err.message}`);
      results.push({ name, status: "ERROR", error: err.message });
    } finally {
      await scraper.cleanup();
    }
  }

  console.log("\n\n=== TEST SUMMARY ===");
  console.table(results);
}

test();