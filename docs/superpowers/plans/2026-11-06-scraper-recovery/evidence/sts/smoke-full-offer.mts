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
// STS only: the r=17 team-stats group (the only source of CARDS_TEAM,
// CORNERS_TEAM and the EACH_TEAM_* codes) is listed about one day before
// kickoff, later than the rest of the full offer. One extra read-only listing
// capture, before the scrape and independent of the parser, records which
// fixtures list it (an `a` key starting with "17m"), so a parser that stops
// reading the group cannot shrink F17 and pass.
let teamStatsIds: Set<string> | null = null;
let teamStatsError: string | null = null;
if (bookmaker === "sts") {
  // A failure here only nulls F17; the smoke itself still runs
  try {
    const { navigateAndCaptureLeagueData } = await import(`${REPO}src/scrapers/bookmakers/sts/navigation.ts`);
    const { parseWebSocketJson } = await import(`${REPO}src/scrapers/bookmakers/sts/parser.ts`);
    const listing = await (scraper as any).executeWithBrowser(
      (page: unknown) => navigateAndCaptureLeagueData(page, league),
      (error: unknown) => { teamStatsError = String(error); return null; },
    );
    const json: any = listing ? parseWebSocketJson(listing.initialData) : null;
    if (json?.B?.S) {
      const ids = new Set<string>();
      for (const sport of Object.values<any>(json.B.S)) for (const cat of Object.values<any>(sport.C ?? {}))
        for (const t of Object.values<any>(cat.T ?? {})) for (const [id, fx] of Object.entries<any>(t.FX ?? {}))
          if (Object.keys(fx?.a ?? {}).some((k) => k.startsWith("17m"))) ids.add(id);
      teamStatsIds = ids;
    } else {
      teamStatsError ??= "no listing i_pl captured";
    }
  } catch (error) {
    teamStatsError = String(error);
  }
}
const realWarn = console.warn;
let warnCount = 0;
console.warn = () => { warnCount++; };
try { r = await scraper.scrapeFullOffer(league); } finally { await closeAllBrowsers(); }
const perMatch: Array<{ match: string; id: string; raw: number; normalized: number; other: number; teamStats: boolean | null; codes: string[] }> = [];
const codeHits: Record<string, number> = Object.fromEntries(requiredCodes.map((c) => [c, 0]));
let sels = 0, unknown = 0, other = 0, total = 0;
for (const m of r.matches ?? []) {
  const n = normalizeMarketsForBookmaker(m.markets, bookmaker, m.homeTeam, m.awayTeam, league);
  const codes = new Set(n.map((x: any) => x.normalizedType));
  for (const c of requiredCodes) if (codes.has(c)) codeHits[c]++;
  const o = n.filter((x: any) => x.normalizedType === "OTHER").length;
  other += o; total += n.length;
  for (const mk of n) for (const s of mk.selections) { sels++; if (s.normalizedName === "UNKNOWN") unknown++; }
  perMatch.push({
    match: `${m.homeTeam} vs ${m.awayTeam}`, id: m.matchId, raw: m.markets.length, normalized: n.length - o, other: o,
    teamStats: teamStatsIds ? teamStatsIds.has(m.matchId) : null, codes: requiredCodes.filter((c) => codes.has(c)),
  });
}
console.warn = realWarn;
const counts = perMatch.map((p) => p.normalized).sort((a, b) => a - b);
// F = full-offer matches (raw >= 400); F17 = those whose fixture lists the r=17 group
const fullOffer = perMatch.filter((p) => p.raw >= 400);
const fullOfferTeamStats = fullOffer.filter((p) => p.teamStats);
const out = {
  bookmaker, league, success: !!r.success, matches: perMatch.length,
  minNormalizedPerMatch: counts[0] ?? 0, medianNormalizedPerMatch: counts[Math.floor(counts.length / 2)] ?? 0,
  otherMarketShare: total ? +(other / total).toFixed(4) : null, unknownSelectionShare: sels ? +(unknown / sels).toFixed(4) : null,
  requiredCodeMatchCounts: codeHits,
  fullOfferMatches: fullOffer.length,
  teamStatsFullOfferMatches: teamStatsIds ? fullOfferTeamStats.length : null,
  teamStatsCodeMatchCounts: teamStatsIds
    ? Object.fromEntries(requiredCodes.map((c) => [c, fullOfferTeamStats.filter((p) => p.codes.includes(c)).length]))
    : null,
  teamStatsError,
  warnings: warnCount, perMatch, error: r.error ?? null, durationMs: Date.now() - t0,
};
console.log("SMOKE_RESULT " + JSON.stringify(out));
process.exit(r.success && perMatch.length > 0 ? 0 : 1);
