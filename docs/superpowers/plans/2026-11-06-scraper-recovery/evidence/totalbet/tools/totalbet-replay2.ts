// Run from the repo root: heavy [--live] npx tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/tools/<file>. Reads/writes .scratch/totalbet-probe2/.
// Offline replay of the 2026-11-13 probe #2 recording: scraper + normalizer, no network.
import { readFileSync, existsSync } from "node:fs";
import { TotalbetPlaywrightScraper } from "../../../../../../../src/scrapers/bookmakers/totalbet/index.js";
import type { FetchJson } from "../../../../../../../src/scrapers/bookmakers/totalbet/api-client.js";
import { totalbetNormalizer } from "../../../../../../../src/services/normalization/bookmakers/totalbet-normalizer.js";

const DIR = new URL(`file://${process.cwd()}/.scratch/totalbet-probe2/`);
const replay: FetchJson = async (url) => {
  const file = url.includes("/events?") ? "list-1.json" : `detail-${url.split("/").pop()}.json`;
  const path = new URL(file, DIR);
  if (!existsSync(path)) return { status: 404, contentType: "application/json", body: { code: 404 } };
  return { status: 200, contentType: "application/json", body: JSON.parse(readFileSync(path, "utf8")) };
};
const warns: string[] = [];
console.warn = (...a: unknown[]) => { warns.push(a.join(" ")); };
console.log = () => {};
const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: replay }).scrapeFullOffer("premier-league");
const codes = new Map<string, number>();
let other = 0, unknownSel = 0, total = 0;
const otherNames = new Map<string, number>();
for (const m of r.matches) {
  for (const raw of m.markets) {
    const o = totalbetNormalizer.normalizeMarket({ bookmakerMarketId: raw.bookmakerMarketId, name: raw.name, paramValue: raw.paramValue, selections: raw.selections }, { homeTeam: m.homeTeam, awayTeam: m.awayTeam, league: "premier-league" });
    total++;
    if (!o) continue;
    if (o.marketCode === "OTHER") { other++; const k = raw.name.replace(m.homeTeam, "<H>").replace(m.awayTeam, "<A>"); otherNames.set(k, (otherNames.get(k) ?? 0) + 1); continue; }
    codes.set(o.marketCode, (codes.get(o.marketCode) ?? 0) + 1);
    unknownSel += o.selections.filter((s) => s.code === "UNKNOWN").length;
  }
}
process.stdout.write(JSON.stringify({ success: r.success, matches: r.matches.length, error: r.error ?? null, driftWarnings: warns.filter((w) => w.includes("phase-1")).length, otherWarnings: warns.length }) + "\n");
for (const c of ["TOTAL_GOALS","HALF_TIME_TOTAL_GOALS","HOME_TEAM_TOTAL_GOALS","AWAY_TEAM_TOTAL_GOALS","HALF_TIME_HOME_TEAM_TOTAL_GOALS","HALF_TIME_AWAY_TEAM_TOTAL_GOALS","ODD_EVEN_GOALS","HALF_TIME_ODD_EVEN_GOALS","SECOND_HALF_ODD_EVEN_GOALS","SECOND_HALF_TOTAL_GOALS"]) process.stdout.write(`${c} ${codes.get(c) ?? 0}\n`);
process.stdout.write(`raw ${total} mapped ${[...codes.values()].reduce((a, b) => a + b, 0)} other ${other} unknownSelections ${unknownSel} codes ${codes.size}\n`);
for (const [k, v] of [...otherNames].filter(([k]) => /suma|parzyst|total/i.test(k))) process.stdout.write(`OTHER ${v} ${k}\n`);
