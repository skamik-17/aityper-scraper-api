// Offline gate for the grouper tasks: run a market-type-grouper.ts over a frozen
// grouper input (evidence/fuksiarz/grouper-input-*.json) and count "I. Surname"
// labels. Usage: npx tsx measure-grouper.mts <abs path to market-type-grouper.ts> <input.json>
//   withPeers    = abbreviated label carrying another bookmaker (label regression)
//   fuksiarzOnly = abbreviated label quoted by fuksiarz alone
//   stranded     = fuksiarz-only abbreviated row next to a same-initial, same-surname full-name row
import * as fs from "node:fs";
const [grouperPath, inputPath] = process.argv.slice(2);
const { groupMarketsByTypeWithParameters } = await import(grouperPath);
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const out = groupMarketsByTypeWithParameters(input.marketsWithBookmakers);
const abbr = /^\p{Lu}\.\s/u;
let params = 0, withPeers = 0, fuksiarzOnly = 0, stranded = 0;
const strandedSample: string[] = []; const rowsNoFuksiarz: string[] = [];
for (const m of out) {
  const vals = m.parameters.map((p: any) => [p.value ?? "", [...new Set(p.bookmakers.filter((b: any) => b.selections.length).map((b: any) => b.bookmaker))].sort() as string[]] as const);
  for (const [v, bms] of vals) {
    params++;
    if (!bms.includes("fuksiarz")) rowsNoFuksiarz.push(`${m.type}|${v}|${bms.join()}`);
    if (!abbr.test(v)) continue;
    if (bms.length > 1) { withPeers++; continue; }
    if (bms[0] !== "fuksiarz") continue;
    fuksiarzOnly++;
    const ini = v[0].toLowerCase(), sur = v.split(" ").pop()!.toLowerCase();
    if (vals.some(([x]) => x !== v && !abbr.test(x) && x.toLowerCase().split(" ").pop() === sur && x.toLowerCase().startsWith(ini))) { stranded++; strandedSample.push(`${m.type}:${v}`); }
  }
}
console.log(JSON.stringify({ params, withPeers, fuksiarzOnly, stranded, strandedSample: strandedSample.slice(0, 20) }));
process.exit(0);
