/**
 * Debug Betclic market structure
 */

import { betclicScraper } from "../scrapers/bookmakers/index.js";

async function test() {
  try {
    const result = await betclicScraper.scrapeFullOffer("premier-league");
    if (result.success && result.matches.length > 0) {
      const match = result.matches[0];
      console.log("Teams:", match.homeTeam, "vs", match.awayTeam);
      console.log("Total markets:", match.markets.length);

      const uniqueNames = new Map<
        string,
        {
          type: string | undefined;
          group: string | undefined;
          count: number;
          selSample: string[];
        }
      >();
      for (const m of match.markets) {
        const existing = uniqueNames.get(m.name);
        if (existing === undefined) {
          uniqueNames.set(m.name, {
            type: m.type,
            group: m.groupName,
            count: 1,
            selSample: m.selections.slice(0, 3).map((s) => s.name),
          });
        } else {
          existing.count++;
        }
      }

      console.log("\nUnique market names:", uniqueNames.size);
      for (const [name, info] of uniqueNames) {
        console.log("---");
        console.log("Name:", name);
        console.log("Type:", info.type, "| Group:", info.group);
        console.log("Selections:", info.selSample.join(", "));
      }
    }
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await betclicScraper.cleanup();
  }
}

test();
