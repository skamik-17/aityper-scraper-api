import { MARKET_CATALOG } from "../src/data/market-catalog.js";

const byId = new Map<number, string[]>();
const byCode = new Map<string, number[]>();

for (const entry of MARKET_CATALOG) {
  if (!byId.has(entry.numericId)) byId.set(entry.numericId, []);
  byId.get(entry.numericId)!.push(entry.code);

  if (!byCode.has(entry.code)) byCode.set(entry.code, []);
  byCode.get(entry.code)!.push(entry.numericId);
}

console.log("=== Duplicate numericIds ===");
for (const [id, codes] of byId) {
  if (codes.length > 1) console.log(`  id=${id}: ${codes.join(", ")}`);
}

console.log("\n=== Duplicate codes ===");
for (const [code, ids] of byCode) {
  if (ids.length > 1) console.log(`  code=${code}: ids=${ids.join(", ")}`);
}

console.log(`\nTotal entries: ${MARKET_CATALOG.length}`);
console.log(`Unique numericIds: ${byId.size}`);
console.log(`Unique codes: ${byCode.size}`);
