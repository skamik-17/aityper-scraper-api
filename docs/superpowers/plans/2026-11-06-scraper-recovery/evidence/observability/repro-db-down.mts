// Reproduces findings (a)+(b) on CURRENT code with zero DB writes:
// SUPABASE_URL points at a closed port, so every insert fails with ECONNREFUSED.
// Usage: SUPABASE_URL=http://127.0.0.1:59999 SUPABASE_SERVICE_KEY=dummy tsx repro-db-down.mts forbet
const REPO = "/home/skamik/Documents/repositories/personal/aityper-scraper-api";
const { runScrapeAndPersist } = await import(`${REPO}/src/services/scraper-service.ts`);
const { scraperHealth } = await import(`${REPO}/src/services/scraper-health.ts`);
const bookmaker = process.argv[2] ?? "forbet";
const result = await runScrapeAndPersist("premier-league", [bookmaker], true);
console.log("SCRAPE_RESULT " + JSON.stringify(result));
console.log("HEALTH " + JSON.stringify(scraperHealth.getAllHealth()));
process.exit(0);
