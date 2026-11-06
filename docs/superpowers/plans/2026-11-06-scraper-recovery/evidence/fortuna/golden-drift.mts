// Read-only twin of `scripts/rebless-golden.ts --bookmaker fortuna --include-unblessed --dry`:
// same projection and comparison (KEEP IN SYNC with projectNormalized/stable there), but it prints
// the full index lists instead of the first 20 names, and never writes.
// Usage (from the repo root):
//   node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/fortuna/golden-drift.mts [--since <file>]
// --since <file>: a previous GOLDEN_DRIFT line (saved to a file); prints only indices that are new since then.
import fs from "fs";
const REPO = new URL("../../../../../../", import.meta.url).pathname;
const { fortunaNormalizer: n } = await import(`${REPO}src/services/normalization/bookmakers/fortuna-normalizer.ts`);
const base = `${REPO}src/services/normalization/__fixtures__/fortuna/world-cup-2026_france_morocco`;
const fx = JSON.parse(fs.readFileSync(`${base}.json`, "utf8"));
const ex = JSON.parse(fs.readFileSync(`${base}.expected.json`, "utf8"));
const stable = (v: any): any =>
  Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
const proj = (o: any) =>
  !o ? null : {
    marketCode: o.marketCode, marketKey: o.marketKey, paramValue: o.paramValue ?? null, parameters: o.parameters ?? null,
    customLabel: o.customLabel ?? null, matchedBy: o.debug?.matchedBy ?? null,
    selections: o.selections.map((s: any) => ({ code: String(s.code), label: s.label, odds: s.odds })),
  };
const raw = new Map(fx.entries.map((e: any) => [e.index, e.raw]));
const w = console.warn; console.warn = () => {};
const blessed: number[] = [], unblessed: number[] = [];
for (const e of ex.entries) {
  const r: any = raw.get(e.index);
  if (!r) continue;
  const out = n.normalizeMarket({
    bookmakerMarketId: r.bookmakerMarketId ? String(r.bookmakerMarketId) : undefined, name: r.name,
    groupName: r.groupName || undefined, paramValue: r.paramValue || undefined,
    selections: r.selections.map((s: any) => ({ name: s.name, odds: s.odds })),
  }, fx.ctx);
  if (JSON.stringify(stable(proj(out))) !== JSON.stringify(stable(e.expected))) (e.blessed ? blessed : unblessed).push(e.index);
}
console.warn = w;
const sinceIdx = process.argv.indexOf("--since");
if (sinceIdx > 0) {
  const prev = JSON.parse(fs.readFileSync(process.argv[sinceIdx + 1], "utf8").replace(/^GOLDEN_DRIFT /, ""));
  const had = new Set<number>([...prev.blessed, ...prev.unblessed]);
  console.log("GOLDEN_DRIFT_NEW " + JSON.stringify({ blessed: blessed.filter((i) => !had.has(i)), unblessed: unblessed.filter((i) => !had.has(i)), gone: [...had].filter((i) => !blessed.includes(i) && !unblessed.includes(i)) }));
} else {
  console.log("GOLDEN_DRIFT " + JSON.stringify({ blessedCount: blessed.length, unblessedCount: unblessed.length, blessed, unblessed }));
}
