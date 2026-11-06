// Dry-run smoke (scrape + normalize, NO DB) against CURRENT code - shape of scripts/smoke-bookmaker.ts.
// Usage: tsx smoke-normalize.mts <bookmaker> <league>
const REPO = "/home/skamik/Documents/repositories/personal/aityper-scraper-api";
const { getScraper, closeAllBrowsers } = await import(`${REPO}/src/scrapers/aggregator.ts`);
const { normalizeMarketsForBookmaker } = await import(`${REPO}/src/services/normalization/index.ts`);
const [bookmaker = "forbet", league = "premier-league"] = process.argv.slice(2);
const t0 = Date.now();
const scraper = getScraper(bookmaker);
let r: any;
try { r = await scraper.scrapeFullOffer(league); } finally { await closeAllBrowsers(); }
let found = 0, normalized = 0, other = 0, sels = 0, unknown = 0;
const perMatch: number[] = [];
for (const m of r.matches ?? []) {
  found += m.markets.length;
  const n = normalizeMarketsForBookmaker(m.markets, bookmaker, m.homeTeam, m.awayTeam, league);
  normalized += n.length; perMatch.push(n.length);
  for (const mk of n) { if (mk.normalizedType === "OTHER") other++; for (const s of mk.selections) { sels++; if (s.normalizedName === "UNKNOWN") unknown++; } }
}
const status = !r.success ? "scrape_failed" : (r.matches?.length ?? 0) === 0 ? "empty" : "scraped";
const out = { bookmaker, league, status, matches: r.matches?.length ?? 0, marketsFound: found, marketsNormalized: normalized,
  minMarketsPerMatch: perMatch.length ? Math.min(...perMatch) : 0, otherMarketShare: normalized ? +(other / normalized).toFixed(4) : null,
  unknownSelectionShare: sels ? +(unknown / sels).toFixed(4) : null, error: r.error ?? null, durationMs: Date.now() - t0 };
console.log("SMOKE_RESULT " + JSON.stringify(out));
process.exit(status === "scraped" ? 0 : 1);
