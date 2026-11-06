// Offline reproduction of RC1: emulate the CURRENT processResponse (navigation.ts:154-178) on truncated
// captured gRPC-web-text group payloads and count parsed markets.
// Usage (repo root): node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/truncation-repro.mts <dir-with-1261715874385920_<GROUP>.b64>
// The 7 full-group captures (Arsenal vs Hull, 2026-11-06 16:30Z) were taken by stream-probe; STRZELCY alone is 1.7 MB,
// so they are not kept here. The two small groups (TOP, HANDICAP) are kept as arsenal-hull_*.grpc-web-text.b64.
import { readFileSync } from "node:fs";
const REPO = new URL("../../../../../../", import.meta.url).pathname;
const { parseAllMarketsFromMultipleResponses } = await import(`${REPO}src/scrapers/bookmakers/betclic/parser.ts`);
const dir = process.argv[2];
const G = ["TOP", "WYNIK", "STRZELCY", "GOLE", "METODA_GOLA", "HANDICAP", "STATYSTYKI"];
const raw = Object.fromEntries(G.map((g) => [g, readFileSync(`${dir}/1261715874385920_${g}.b64`, "utf8")]));
const cur = (s: string) => { const d = Buffer.from(s.replace(/[\r\n]/g, ""), "base64"); return d.length > 5 ? d.subarray(5, 5 + d.readUInt32BE(1)) : d.subarray(5); };
const log = console.log; console.log = () => {};
const count = (cut: Record<string, number>) =>
  parseAllMarketsFromMultipleResponses(G.map((g) => cur(cut[g] ? raw[g].slice(0, cut[g]) : raw[g])).filter((b) => b.length >= 100)).length;
const res = {
  sizesB64: Object.fromEntries(G.map((g) => [g, raw[g].length])),
  full: count({}),
  strzelcy_cut_103808_chars: count({ STRZELCY: 103808 }),
  strzelcy_cut_at_run1_size_388976B: count({ STRZELCY: Math.floor((388976 + 5) / 3) * 4 }),
  strzelcy_cut_90pct: count({ STRZELCY: Math.floor(raw.STRZELCY.length * 0.9) }),
  statystyki_cut_half: count({ STATYSTYKI: Math.floor(raw.STATYSTYKI.length / 2) }),
};
console.log = log;
console.log(JSON.stringify(res));
