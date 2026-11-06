// Standalone single-bookmaker full-offer smoke test against CURRENT code.
// No DB writes: calls scrapeFullOffer only (normalizeAndSaveMatches is not invoked).
// Usage: tsx smoke-current.mts <bookmaker> <league>
const REPO = "/home/skamik/Documents/repositories/personal/aityper-scraper-api";
const { getScraper, closeAllBrowsers } = await import(`${REPO}/src/scrapers/aggregator.ts`);

const [bookmaker = "betters", league = "premier-league"] = process.argv.slice(2);
const started = Date.now();
const scraper = getScraper(bookmaker);
if (!scraper) { console.error(`unknown bookmaker ${bookmaker}`); process.exit(2); }
let result: any;
try {
  result = await scraper.scrapeFullOffer(league);
} finally {
  await closeAllBrowsers();
}
const markets = (result.matches ?? []).reduce((s: number, m: any) => s + m.markets.length, 0);
const summary = {
  bookmaker, league,
  success: result.success,
  matches: result.matches?.length ?? 0,
  markets,
  error: result.error ?? null,
  durationMs: Date.now() - started,
};
console.log("SMOKE_RESULT " + JSON.stringify(summary));
process.exit(summary.success && summary.matches > 0 ? 0 : 1);
