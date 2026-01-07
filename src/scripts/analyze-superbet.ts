/**
 * Extract and analyze Superbet market patterns from saved analysis
 */

import * as fs from "fs";
import * as path from "path";

// Find the most recent analysis file
const dataDir = path.join(process.cwd(), "data");
const files = fs.readdirSync(dataDir)
  .filter(f => f.startsWith("bookmaker-analysis-premier-league-"))
  .sort()
  .reverse();

if (files.length === 0) {
  console.error("No analysis files found");
  process.exit(1);
}

const latestFile = path.join(dataDir, files[0]);
console.log(`Loading: ${latestFile}\n`);

const data = JSON.parse(fs.readFileSync(latestFile, "utf-8"));

// Find Superbet data (index 5 based on the run output)
const superbetData = data.find((d: any) => d.bookmaker === "superbet");

if (!superbetData) {
  console.error("Superbet data not found in analysis");
  process.exit(1);
}

console.log("=".repeat(80));
console.log("SUPERBET MARKET ANALYSIS");
console.log("=".repeat(80));
console.log(`Total Markets: ${superbetData.totalMarkets}`);
console.log(`Coverage: ${superbetData.coveragePercent.toFixed(1)}%`);
console.log(`OTHER (uncategorized): ${superbetData.otherTypeCount} (${((superbetData.otherTypeCount / superbetData.totalMarkets) * 100).toFixed(1)}%)`);
console.log(`Unique Market Names: ${superbetData.uniqueMarketNames.length}`);
console.log(`Unique Selection Names: ${superbetData.uniqueSelectionNames.length}\n`);

// Get top OTHER markets that need mapping
console.log("=".repeat(80));
console.log("TOP UNCATEGORIZED MARKETS (Need ID Mapping)");
console.log("=".repeat(80));

const otherMarkets = superbetData.otherMarkets
  .sort((a: any, b: any) => b.count - a.count)
  .slice(0, 20);

let totalOther = 0;
for (const market of otherMarkets) {
  totalOther += market.count;
  const pct = ((market.count / superbetData.totalMarkets) * 100).toFixed(1);
  console.log(`  ${market.name.padEnd(25)} ${String(market.count).padStart(6)}x (${pct}%)`);
  // Show sample selections if available
  if (market.selections && market.selections.length > 0) {
    const samples = market.selections.slice(0, 5).join(", ");
    console.log(`    Selections: ${samples}${market.selections.length > 5 ? "..." : ""}`);
  }
}

console.log(`\n  ${"TOTAL".padEnd(25)} ${String(totalOther).padStart(6)}x (${((totalOther / superbetData.totalMarkets) * 100).toFixed(1)}%)`);

// Analyze "Rynek" pattern
console.log("\n" + "=".repeat(80));
console.log("RYNEK ID PATTERN ANALYSIS");
console.log("=".repeat(80));

const rynekMarkets = superbetData.uniqueMarketNames.filter((n: string) => /^Rynek \d+$/.test(n));
console.log(`Total "Rynek XXX" markets: ${rynekMarkets.length}`);

// Extract unique IDs
const idMap = new Map<number, { name: string; count: number }>();
for (const market of superbetData.topPatterns) {
  const match = market.name.match(/^Rynek (\d+)$/);
  if (match) {
    const id = parseInt(match[1], 10);
    const existing = idMap.get(id);
    if (existing) {
      existing.count += market.count;
    } else {
      idMap.set(id, { name: market.name, count: market.count });
    }
  }
}

// Sort by count
const sortedIds = Array.from(idMap.entries()).sort((a, b) => b[1].count - a[1].count);
console.log(`\nTop "Rynek" IDs by frequency:`);
for (const [id, info] of sortedIds.slice(0, 15)) {
  const pct = ((info.count / superbetData.totalMarkets) * 100).toFixed(1);
  console.log(`  Rynek ${String(id).padEnd(8)} ${String(info.count).padStart(6)}x (${pct}%)`);
}

// Analyze Polish text markets
console.log("\n" + "=".repeat(80));
console.log("POLISH TEXT MARKETS (Pattern-based matching)");
console.log("=".repeat(80));

const textMarkets = superbetData.uniqueMarketNames.filter((n: string) =>
  !/^Rynek \d+$/.test(n) &&
  !/^[A-Z\s\/]+$/.test(n) // Not all caps English
);

if (textMarkets.length > 0) {
  console.log(`\nFound ${textMarkets.length} Polish text markets:`);
  for (const name of textMarkets.slice(0, 20)) {
    const pattern = superbetData.topPatterns.find((p: any) => p.name === name);
    const count = pattern?.count || 0;
    const pct = count > 0 ? ((count / superbetData.totalMarkets) * 100).toFixed(1) : "0.0";
    console.log(`  ${name} (${count}x, ${pct}%)`);
  }
} else {
  console.log("\nNo Polish text markets found - all are 'Rynek XXX' format");
}

// Recommendations
console.log("\n" + "=".repeat(80));
console.log("RECOMMENDATIONS");
console.log("=".repeat(80));

console.log(`
1. Add top "Rynek" IDs to SUPERBET_ID_MAPPINGS in superbet-normalizer.ts:
   - Focus on IDs with >= 1% frequency first
   - These likely represent core markets (handicaps, totals, BTTS)

2. Check if high-frequency IDs follow patterns:
   - IDs in 236xxx range: Check if they're all same market type
   - IDs in 201xxx, 233xxx ranges: Check for player/special markets

3. For lower-frequency IDs (<0.5%):
   - Can likely be left as OTHER (player props, exotic markets)
   - Focus coverage on core betting markets

4. Target coverage goal: >=70%
   - Current: ${superbetData.coveragePercent.toFixed(1)}%
   - Need to map: ~${((superbetData.totalMarkets * 0.70) - (superbetData.totalMarkets * (superbetData.coveragePercent / 100))).toFixed(0)} markets
   - Top 10 Rynek IDs would add: ${sortedIds.slice(0, 10).reduce((sum, [_, info]) => sum + info.count, 0)} markets
`);
