// Single-bookmaker live smoke test: scrape full offer + normalize, NO DB writes.
// Usage (from the repo root):
//   node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/<bm>/smoke-full-offer.mts <bookmaker> [league] [CODE1,CODE2,...]
// Prints one SMOKE_RESULT JSON line; exit 0 when the scrape succeeded with >= 1 match.
const REPO = new URL("../../../../../../", import.meta.url).pathname;
const { getScraper, closeAllBrowsers } = await import(`${REPO}src/scrapers/aggregator.ts`);
const { normalizeMarketsForBookmaker } = await import(`${REPO}src/services/normalization/index.ts`);
const [bookmaker = "sts", league = "premier-league", codesArg = ""] = process.argv.slice(2);
const requiredCodes = codesArg ? codesArg.split(",") : [];
const t0 = Date.now();
const scraper = getScraper(bookmaker);
let r: any;
const realWarn = console.warn;
let warnCount = 0;
console.warn = () => { warnCount++; };
try { r = await scraper.scrapeFullOffer(league); } finally { await closeAllBrowsers(); }
const perMatch: Array<{ match: string; raw: number; normalized: number; other: number }> = [];
const codeHits: Record<string, number> = Object.fromEntries(requiredCodes.map((c) => [c, 0]));
let sels = 0, unknown = 0, other = 0, total = 0;
for (const m of r.matches ?? []) {
  const n = normalizeMarketsForBookmaker(m.markets, bookmaker, m.homeTeam, m.awayTeam, league);
  const codes = new Set(n.map((x: any) => x.normalizedType));
  for (const c of requiredCodes) if (codes.has(c)) codeHits[c]++;
  const o = n.filter((x: any) => x.normalizedType === "OTHER").length;
  other += o; total += n.length;
  for (const mk of n) for (const s of mk.selections) { sels++; if (s.normalizedName === "UNKNOWN") unknown++; }
  perMatch.push({ match: `${m.homeTeam} vs ${m.awayTeam}`, raw: m.markets.length, normalized: n.length - o, other: o });
}
console.warn = realWarn;
const counts = perMatch.map((p) => p.normalized).sort((a, b) => a - b);
const out = {
  bookmaker, league, success: !!r.success, matches: perMatch.length,
  minNormalizedPerMatch: counts[0] ?? 0, medianNormalizedPerMatch: counts[Math.floor(counts.length / 2)] ?? 0,
  otherMarketShare: total ? +(other / total).toFixed(4) : null, unknownSelectionShare: sels ? +(unknown / sels).toFixed(4) : null,
  requiredCodeMatchCounts: codeHits, warnings: warnCount, perMatch, error: r.error ?? null, durationMs: Date.now() - t0,
};
console.log("SMOKE_RESULT " + JSON.stringify(out));
process.exit(r.success && perMatch.length > 0 ? 0 : 1);
