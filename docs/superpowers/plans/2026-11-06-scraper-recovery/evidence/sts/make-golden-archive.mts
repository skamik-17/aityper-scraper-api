// Builds a scripts/harvest-fixtures.ts raw archive from the durable Arsenal vs Hull City
// snapshot, parsed by the parser of the checkout this file sits in (REPO = 6 levels up).
// Usage (from that checkout's root):
//   node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/make-golden-archive.mts <out-dir>
// Writes <out-dir>/premier-league_arsenal_hull_city__2026-11-06.json and prints its market count.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const REPO = new URL("../../../../../../", import.meta.url).pathname;
const EV = new URL("./", import.meta.url).pathname;
const P = await import(`${REPO}src/scrapers/bookmakers/sts/parser.ts`);
const outDir = process.argv[2];
if (!outDir) throw new Error("usage: make-golden-archive.mts <out-dir>");
const ipl = P.parseWebSocketJson(readFileSync(join(EV, "i_pl.trimmed.txt"), "utf8"));
const fixture = P.parseFixtures(ipl, "premier-league").find((f: { id: string }) => f.id === "f2921898");
const snap = P.parseWebSocketJson(readFileSync(join(EV, "f_f2921898_pl.arsenal-hull.snapshot.txt"), "utf8"));
const raw = P.parseAllMarkets(fixture, snap, ipl);
const markets = raw.map((m: any, index: number) => ({
  index,
  raw: {
    bookmakerMarketId: m.bookmakerMarketId ?? "",
    groupId: "",
    groupName: m.groupName ?? "",
    name: m.name,
    selections: m.selections.map((s: { name: string; odds: number }) => ({ name: s.name, odds: s.odds })),
  },
}));
mkdirSync(outDir, { recursive: true });
const file = join(outDir, "premier-league_arsenal_hull_city__2026-11-06.json");
writeFileSync(file, `${JSON.stringify({ meta: { matchId: "f2921898", homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" }, markets }, null, 2)}\n`);
console.log(JSON.stringify({ archive: file, markets: markets.length }));
