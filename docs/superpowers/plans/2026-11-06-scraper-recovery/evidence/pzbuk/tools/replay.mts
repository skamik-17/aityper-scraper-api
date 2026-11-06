// Offline replay: decode captured frames, accumulate like navigation.ts (current)
// and like the proposed fix (union of markets), then run the CURRENT
// parseAllMarkets + pzbuk normalizer from src and report coverage stats.
import fs from "node:fs";
const REPO = "/home/skamik/Documents/repositories/personal/aityper-scraper-api";
const { parseAllMarkets, parseTeamNames, parse1X2Odds } = await import(`${REPO}/src/scrapers/bookmakers/pzbuk/parser.ts`);
const { normalizeMarketsForBookmaker } = await import(`${REPO}/src/services/normalization/index.ts`);
const { pzbukNormalizer } = await import(`${REPO}/src/services/normalization/bookmakers/pzbuk-normalizer.ts`);
const { getCanonicalTeamName } = await import(`${REPO}/src/utils/team-matcher.ts`);

const capPath = process.argv[2];
const outDir = process.argv[3];
const cap = JSON.parse(fs.readFileSync(capPath, "utf8"));

// Map keys of PZBUK_MARKET_ID_TO_CODE (not exported) parsed from the source text
const normSrc = fs.readFileSync(`${REPO}/src/services/normalization/bookmakers/pzbuk-normalizer.ts`, "utf8");
const mapBlock = normSrc.slice(normSrc.indexOf("const PZBUK_MARKET_ID_TO_CODE"), normSrc.indexOf("};", normSrc.indexOf("const PZBUK_MARKET_ID_TO_CODE")));
const idMap: Record<string, string> = {};
for (const m of mapBlock.matchAll(/^\s*"(\d+)":\s*"([A-Z0-9_]+)"/gm)) idMap[m[1]] = m[2];

function messages(b64: string): any[] {
  const s = Buffer.from(b64, "base64").toString("utf8");
  try {
    const env = JSON.parse(s);
    if (Array.isArray(env)) return env;
    if (env?.type === "DATA" && Array.isArray(env.payload)) return env.payload;
  } catch { /* ignore */ }
  return [];
}

const evFrames = cap.frames.event.filter((f: any) => f.dir === "recv");
// --- Current navigation.ts single-event accumulation (lines 258-287) ---
let eventData: any = null, marketDataLargest: any[] | null = null;
const acc = new Map<any, any>();
const unionMarkets = new Map<any, any>();
for (const f of evFrames) for (const m of messages(f.b64)) {
  if (m?.type !== "INITIAL_STATE") continue;
  const st = m.payload;
  if (!(st?.events?.length > 0) || st.events.length !== 1) continue;
  if (!eventData) eventData = st.events;
  if (st.markets?.length > 0 && (!marketDataLargest || st.markets.length > marketDataLargest.length)) marketDataLargest = st.markets;
  for (const mk of st.markets || []) unionMarkets.set(mk.id, mk);
  for (const sel of st.selections || []) if (sel.status === "Active") acc.set(sel.id, sel);
}
const event = eventData[0];
const teams = parseTeamNames(event);
const home = getCanonicalTeamName(teams.homeTeam, "premier-league");
const away = getCanonicalTeamName(teams.awayTeam, "premier-league");
const expectedMarkets = Object.values(event.marketGroups || {}).reduce((a: number, g: any) => a + (g.marketsCount || 0), 0);
console.log(`event ${event.id} ${teams.homeTeam} - ${teams.awayTeam} -> canonical ${home} - ${away}`);
console.log(`marketGroups: ${JSON.stringify(Object.values(event.marketGroups).map((g: any) => [g.id, g.name.trim(), g.marketsCount]))} sum marketsCount=${expectedMarkets}`);
console.log(`accumulated active selections=${acc.size}, largest markets array=${marketDataLargest?.length}, union markets=${unionMarkets.size}`);
const selMarketIds = new Set([...acc.values()].map((s) => s.marketId));
console.log(`distinct selection.marketId=${selMarketIds.size}; covered by largest=${[...selMarketIds].filter((id) => marketDataLargest!.some((m) => m.id === id)).length}; covered by union=${[...selMarketIds].filter((id) => unionMarkets.has(id)).length}`);

function run(label: string, markets: any[]) {
  const state = { events: eventData, markets, selections: [...acc.values()] };
  const scraped = parseAllMarkets(state, event.id, teams);
  const placeholder = scraped.filter((m: any) => /^Rynek \d+/.test(m.name)).length;
  const normalized = normalizeMarketsForBookmaker(JSON.parse(JSON.stringify(scraped)), "pzbuk", home, away, "premier-league");
  let sel = 0, unk = 0, other = 0, otherSel = 0;
  const byCode: Record<string, number> = {};
  for (const n of normalized) {
    byCode[n.normalizedType] = (byCode[n.normalizedType] || 0) + 1;
    if (n.normalizedType === "OTHER") { other++; otherSel += n.selections.length; }
    for (const s of n.selections) { sel++; if (s.normalizedName === "UNKNOWN") unk++; }
  }
  // matchedBy + direct normalizer nulls
  const matchedBy: Record<string, number> = {};
  let nulls = 0;
  for (const m of scraped) {
    const out = pzbukNormalizer.normalizeMarket({ name: m.name, bookmakerMarketId: Number(m.bookmakerMarketId), paramValue: m.paramValue, selections: m.selections.map((s: any) => ({ name: s.name, odds: s.odds })) }, { homeTeam: home, awayTeam: away, league: "premier-league" });
    if (!out) nulls++; else matchedBy[out.debug?.matchedBy ?? "?"] = (matchedBy[out.debug?.matchedBy ?? "?"] || 0) + 1;
  }
  const ids = [...new Set(scraped.map((m: any) => m.bookmakerMarketId))];
  const unmappedIds = ids.filter((id) => !(id in idMap));
  console.log(`\n--- ${label}: scraped markets=${scraped.length} (placeholder names=${placeholder}), distinct marketTypeIds=${ids.length}, ids NOT in PZBUK_MARKET_ID_TO_CODE=${unmappedIds.length}`);
  console.log(`normalized: selections=${sel}, UNKNOWN=${unk} (${((100 * unk) / sel).toFixed(1)}%), OTHER markets=${other} (${otherSel} selections), normalizer nulls=${nulls}, matchedBy=${JSON.stringify(matchedBy)}`);
  console.log(`codes (non-OTHER)=${Object.keys(byCode).filter((c) => c !== "OTHER").length}: ${JSON.stringify(byCode)}`);
  return { scraped, normalized, unmappedIds, ids };
}
const cur = run("CURRENT accumulation (largest markets array)", marketDataLargest!);
const fix = run("FIXED accumulation (union of markets)", [...unionMarkets.values()]);

// Name diff between the two runs, for markets whose name changed
const nameChanges: any[] = [];
const curBy = new Map(cur.scraped.map((m: any) => [`${m.bookmakerMarketId}:${m.paramValue}`, m]));
for (const m of fix.scraped) {
  const c: any = curBy.get(`${m.bookmakerMarketId}:${m.paramValue}`);
  if (c && c.name !== m.name) nameChanges.push([m.bookmakerMarketId, m.paramValue, c.name, m.name]);
}
console.log(`\nname changes current->fixed: ${nameChanges.length}`);
console.log(JSON.stringify(nameChanges.slice(0, 60)));
// Code changes current -> fixed
const codeChanges: any[] = [];
for (let i = 0; i < fix.normalized.length; i++) {
  const f = fix.normalized[i];
  const c: any = cur.normalized.find((x: any) => x.bookmakerMarketId === f.bookmakerMarketId && x.paramValue === f.paramValue);
  if (c && c.normalizedType !== f.normalizedType) codeChanges.push([f.bookmakerMarketId, f.paramValue, f.name, `${c.normalizedType} -> ${f.normalizedType}`]);
}
console.log(`code changes current->fixed: ${codeChanges.length}`);
console.log(JSON.stringify(codeChanges));

// Unmapped ids with names (union run)
const unm = fix.unmappedIds.map((id: string) => {
  const m = fix.scraped.find((x: any) => x.bookmakerMarketId === id);
  const n = fix.normalized.find((x: any) => x.bookmakerMarketId === id);
  const mt = [...unionMarkets.values()].find((x: any) => String(x.marketType?.id) === id);
  return [id, m?.name, mt?.marketType?.originalName, n?.normalizedType, m?.selections.length];
});
console.log(`\nunmapped ids (fixed run): ${JSON.stringify(unm)}`);

// 1X2 sanity
const one = fix.normalized.find((n: any) => n.normalizedType === "MATCH_WINNER" && n.bookmakerMarketId === "1");
console.log(`\n1X2 id1: ${JSON.stringify(one?.selections.map((s: any) => [s.name, s.normalizedName, s.odds]))}`);
console.log(`parse1X2Odds (legacy path, numeric ids): ${JSON.stringify(parse1X2Odds([...acc.values()]))}`);
console.log(`parse1X2Odds with String-coerced ids: ${JSON.stringify(parse1X2Odds([...acc.values()].map((s) => ({ ...s, marketTypeId: String(s.marketTypeId) }))))}`);

fs.writeFileSync(`${outDir}/replay.fixed.normalized.json`, JSON.stringify(fix.normalized, null, 1));
fs.writeFileSync(`${outDir}/replay.current.normalized.json`, JSON.stringify(cur.normalized, null, 1));
fs.writeFileSync(`${outDir}/replay.fixed.scraped.json`, JSON.stringify(fix.scraped, null, 1));
fs.writeFileSync(`${outDir}/replay.current.scraped.json`, JSON.stringify(cur.scraped, null, 1));
