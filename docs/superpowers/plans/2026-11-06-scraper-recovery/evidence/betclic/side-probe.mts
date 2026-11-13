// Read-only side/price probe for Task 4 (no DB writes): scrape the Betclic full offer once,
// normalize it, and dump every match result / OPTA / penalty / tackles / offsides / fouls market
// with its raw selection names, normalized selection codes and odds, so sides and prices can be
// checked by hand.
// Usage (repo root, between scheduled runs, one live probe at a time):
//   node_modules/.bin/tsx <this file> > side-probe.out; python3 -I side-check.py side-probe.out
// Prints one "SIDE_ROW {json}" line per market and a final "SIDE_SUMMARY {json}" line.
// Row fields:
//   sels  what is stored: raw name and raw odds joined by index with the normalized code
//   raw   the scraped selections as [name, odds]
//   own   the normalizer's own output as [label, code, odds], so side-check can confirm that
//         each code carries the price of the leg it was resolved from
const REPO = new URL("../../../../../../", import.meta.url).pathname;
const { getScraper, closeAllBrowsers } = await import(`${REPO}src/scrapers/aggregator.ts`);
const { normalizeMarketsForBookmaker, normalizer } = await import(`${REPO}src/services/normalization/index.ts`);
const league = "premier-league";
const pick = /^Wynik meczu|OPTA|karn|odbi|spalon|faul/i;
const scraper = getScraper("betclic");
let r: any;
try { r = await scraper.scrapeFullOffer(league); } finally { await closeAllBrowsers(); }
const rows: unknown[] = [];
// Selections keep their raw name/odds through the index join unless the normalizer changed the count.
let collapsed = 0;
for (const m of r.matches ?? []) {
  const n = normalizeMarketsForBookmaker(m.markets, "betclic", m.homeTeam, m.awayTeam, league);
  n.forEach((mk: any, i: number) => {
    if (!pick.test(String(mk.name))) return;
    const raw = m.markets[i];
    const changedCount = mk.selections.length !== raw?.selections?.length;
    if (changedCount) collapsed++;
    const sels = mk.selections.map((s: any) => [s.name, s.normalizedName, s.odds]);
    const own = normalizer
      .normalize(raw, "betclic", m.homeTeam, m.awayTeam, league)
      .selections.map((s: any) => [s.name, s.normalizedName, s.odds]);
    const rawSels = (raw?.selections ?? []).map((s: any) => [s.name, s.odds]);
    rows.push({ changedCount, match: `${m.homeTeam} vs ${m.awayTeam}`, name: mk.name, type: mk.normalizedType, key: mk.marketKey, param: mk.paramValue ?? "", sels, raw: rawSels, own });
  });
}
for (const row of rows) console.log("SIDE_ROW " + JSON.stringify(row));
console.log("SIDE_SUMMARY " + JSON.stringify({ success: !!r.success, matches: (r.matches ?? []).length, rows: rows.length, collapsed }));
process.exit(r.success ? 0 : 1);
