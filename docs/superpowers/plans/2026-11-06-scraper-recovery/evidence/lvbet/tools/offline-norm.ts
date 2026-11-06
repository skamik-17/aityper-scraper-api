// Offline normalization stats: run the CURRENT normalizer over a raw market list.
// usage: [REPO_ROOT=<checkout>] tsx offline-norm.ts <markets.json> <bookmaker> <home> <away> <league> <out.json>
import * as fs from "node:fs";
// REPO_ROOT selects the checkout whose normalizer runs (default: the main checkout).
const REPO = process.env.REPO_ROOT ?? "/home/skamik/Documents/repositories/personal/aityper-scraper-api";
const { normalizeMarketsForBookmaker } = await import(`${REPO}/src/services/normalization/index.ts`);
const [file, bm, home, away, league, out] = process.argv.slice(2);
let raw = JSON.parse(fs.readFileSync(file, "utf8"));
if (!Array.isArray(raw)) raw = raw.bookmakers?.[bm]?.markets ?? raw.markets;
const origWarn = console.warn; let warns = 0; console.warn = () => { warns++; };
const norm = normalizeMarketsForBookmaker(raw, bm, home, away, league);
console.warn = origWarn;
let sel = 0, unk = 0, otherMk = 0, otherSel = 0;
const otherNames = new Map<string, number>();
const codes = new Map<string, number>();
for (const m of norm) {
  const t = (m as any).normalizedType ?? "OTHER";
  codes.set(t, (codes.get(t) ?? 0) + 1);
  for (const s of m.selections) { sel++; if ((s as any).normalizedName === "UNKNOWN") unk++; }
  if (t === "OTHER") {
    otherMk++; otherSel += m.selections.length;
    const base = m.name.replace(/\s+-?\d+(\.\d+)?$/, "");
    otherNames.set(base, (otherNames.get(base) ?? 0) + 1);
  }
}
const top = [...otherNames.entries()].sort((a, b) => b[1] - a[1]);
const res = { markets: norm.length, codes: [...codes.keys()].filter((c) => c !== "OTHER").length, selections: sel, unknownSel: unk, unknownPct: +(100 * unk / Math.max(sel, 1)).toFixed(1), otherMarkets: otherMk, otherMarketPct: +(100 * otherMk / Math.max(norm.length, 1)).toFixed(1), otherSelPct: +(100 * otherSel / Math.max(sel, 1)).toFixed(1), distinctOtherNames: top.length, warns };
console.log(JSON.stringify(res));
fs.writeFileSync(out, JSON.stringify({ res, codes: Object.fromEntries(codes), otherNames: top, rows: norm.map((m: any) => ({ name: m.name, groupName: m.groupName, bmid: m.bookmakerMarketId, param: m.paramValue, code: m.normalizedType ?? "OTHER", key: m.marketKey, sels: m.selections.map((s: any) => [s.name, s.normalizedName, s.odds]) })) }, null, 1));
