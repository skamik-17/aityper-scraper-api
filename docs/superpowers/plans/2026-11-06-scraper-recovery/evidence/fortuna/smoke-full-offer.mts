// Single-bookmaker live smoke test: scrape full offer + normalize, NO DB writes.
// Usage (from the repo root):
//   node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/<bm>/smoke-full-offer.mts <bookmaker> [league] [CODE1,CODE2,...] [options]
// Options (fortuna copy, added 2026-11-06 for the before/after comparison):
//   --dump <file>          write the scraped matches (raw markets) to <file> before normalizing
//   --from <file>          skip the scrape and normalize the matches saved by --dump (no network)
//   --count-ids <ids>      per match, count raw markets whose bookmakerMarketId is in <ids>
//                          (comma list; the "ufo:mtyp:" prefix may be omitted) -> perMatch[].idRaw
//   --warn-pattern <re>    count console.warn lines matching <re> -> warnPatternCount
// Prints one SMOKE_RESULT JSON line; exit 0 when the scrape succeeded with >= 1 match.
import fs from "fs";
const REPO = new URL("../../../../../../", import.meta.url).pathname;
const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const dumpFile = opt("--dump");
const fromFile = opt("--from");
const countIds = new Set((opt("--count-ids") ?? "").split(",").filter(Boolean).map((i) => (i.startsWith("ufo:") ? i : `ufo:mtyp:${i}`)));
const warnPatternArg = opt("--warn-pattern");
const warnPattern = warnPatternArg ? new RegExp(warnPatternArg) : null;
const [bookmaker = "sts", league = "premier-league", codesArg = ""] = argv;
const { normalizeMarketsForBookmaker } = await import(`${REPO}src/services/normalization/index.ts`);
const requiredCodes = codesArg ? codesArg.split(",") : [];
const t0 = Date.now();
let r: any;
const realWarn = console.warn;
let warnCount = 0;
let warnPatternCount = 0;
if (fromFile) {
  r = JSON.parse(fs.readFileSync(fromFile, "utf8"));
} else {
  const { getScraper, closeAllBrowsers } = await import(`${REPO}src/scrapers/aggregator.ts`);
  const scraper = getScraper(bookmaker);
  console.warn = () => { warnCount++; };
  try { r = await scraper.scrapeFullOffer(league); } finally { await closeAllBrowsers(); }
  console.warn = realWarn;
  if (dumpFile) fs.writeFileSync(dumpFile, JSON.stringify({ success: r.success, error: r.error ?? null, capturedAt: new Date().toISOString(), matches: r.matches }));
}
console.warn = (...a: any[]) => { warnCount++; if (warnPattern && warnPattern.test(a.join(" "))) warnPatternCount++; };
const perMatch: Array<{ match: string; raw: number; normalized: number; other: number; idRaw?: number }> = [];
const codeHits: Record<string, number> = Object.fromEntries(requiredCodes.map((c) => [c, 0]));
let sels = 0, unknown = 0, other = 0, total = 0;
for (const m of r.matches ?? []) {
  const n = normalizeMarketsForBookmaker(JSON.parse(JSON.stringify(m.markets)), bookmaker, m.homeTeam, m.awayTeam, league);
  const codes = new Set(n.map((x: any) => x.normalizedType));
  for (const c of requiredCodes) if (codes.has(c)) codeHits[c]++;
  const o = n.filter((x: any) => x.normalizedType === "OTHER").length;
  other += o; total += n.length;
  for (const mk of n) for (const s of mk.selections) { sels++; if (s.normalizedName === "UNKNOWN") unknown++; }
  const row: any = { match: `${m.homeTeam} vs ${m.awayTeam}`, raw: m.markets.length, normalized: n.length - o, other: o };
  if (countIds.size) row.idRaw = m.markets.filter((x: any) => countIds.has(String(x.bookmakerMarketId))).length;
  perMatch.push(row);
}
console.warn = realWarn;
const counts = perMatch.map((p) => p.normalized).sort((a, b) => a - b);
const out: any = {
  bookmaker, league, success: !!r.success, matches: perMatch.length, source: fromFile ? `file:${fromFile}` : "live",
  minNormalizedPerMatch: counts[0] ?? 0, medianNormalizedPerMatch: counts[Math.floor(counts.length / 2)] ?? 0,
  otherMarketShare: total ? +(other / total).toFixed(4) : null, unknownSelectionShare: sels ? +(unknown / sels).toFixed(4) : null,
  requiredCodeMatchCounts: codeHits, warnings: warnCount, perMatch, error: r.error ?? null, durationMs: Date.now() - t0,
};
if (warnPattern) out.warnPatternCount = warnPatternCount;
console.log("SMOKE_RESULT " + JSON.stringify(out));
process.exit(r.success && perMatch.length > 0 ? 0 : 1);
