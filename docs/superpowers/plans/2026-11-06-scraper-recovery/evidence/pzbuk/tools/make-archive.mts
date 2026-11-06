// Build a PrepAuditOutput raw-archive file from the FULL capture using the
// proposed (union-of-markets) accumulation + the CURRENT parseAllMarkets, so
// scripts/harvest-fixtures.ts can turn it into a golden fixture pair.
import fs from "node:fs";
const REPO = "/home/skamik/Documents/repositories/personal/aityper-scraper-api";
const { parseAllMarkets, parseTeamNames } = await import(`${REPO}/src/scrapers/bookmakers/pzbuk/parser.ts`);
const { pzbukNormalizer } = await import(`${REPO}/src/services/normalization/bookmakers/pzbuk-normalizer.ts`);
const { buildPrepAuditOutput, dedupeRawMarkets, scrapedMarketsToRaw } = await import(`${REPO}/src/services/audit/scraper-audit-core.ts`);
const { getCanonicalTeamName } = await import(`${REPO}/src/utils/team-matcher.ts`);
const [capPath, outPath] = process.argv.slice(2);
const cap = JSON.parse(fs.readFileSync(capPath, "utf8"));
let eventData: any = null;
const acc = new Map(), union = new Map();
for (const f of cap.frames.event) {
  if (f.dir !== "recv") continue;
  let env: any; try { env = JSON.parse(Buffer.from(f.b64, "base64").toString("utf8")); } catch { continue; }
  if (env?.type !== "DATA") continue;
  for (const m of env.payload) {
    const st = m.payload;
    if (m.type !== "INITIAL_STATE" || st.events.length !== 1) continue;
    if (!eventData) eventData = st.events;
    for (const mk of st.markets) union.set(mk.id, mk);
    for (const s of st.selections) if (s.status === "Active") acc.set(s.id, s);
  }
}
const event = eventData[0];
const teams = parseTeamNames(event);
const markets = parseAllMarkets({ events: eventData, markets: [...union.values()], selections: [...acc.values()] }, event.id, teams);
const home = getCanonicalTeamName(teams.homeTeam, "premier-league");
const away = getCanonicalTeamName(teams.awayTeam, "premier-league");
const rawMarkets = dedupeRawMarkets(scrapedMarketsToRaw(markets));
const output = buildPrepAuditOutput({
  normalizer: pzbukNormalizer,
  ctx: { homeTeam: home, awayTeam: away, leagueName: "premier-league", league: "premier-league" } as any,
  rawMarkets,
  meta: { matchId: String(event.id), homeTeam: home, awayTeam: away, league: "premier-league" },
});
(output as any).meta.fetchedAt = cap.capturedAt;
// Keep the vendor line in the raw block (production forwards ScrapedMarket.paramValue;
// buildPrepAuditOutput drops it). harvest-fixtures.ts reads raw.paramValue.
for (const m of (output as any).markets) m.raw.paramValue = rawMarkets[m.index]?.paramValue ?? "";
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ outPath, bytes: fs.statSync(outPath).size, scraped: markets.length, rawDeduped: rawMarkets.length, meta: output.meta }));
