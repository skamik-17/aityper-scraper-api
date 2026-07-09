import { runScrapeAndPersist } from "./src/services/scraper-service.js";

async function main() {
  console.log("[rescrape] starting world-cup-2026 full re-scrape...");
  await runScrapeAndPersist("world-cup-2026", undefined, true);
  console.log("[rescrape] DONE");
}
main().then(() => process.exit(0)).catch((e) => { console.error("[rescrape] FATAL:", e); process.exit(1); });
