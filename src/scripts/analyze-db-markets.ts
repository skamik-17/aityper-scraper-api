/**
 * Analyze Market Normalization from Database
 *
 * Analyzes already scraped data in full_offer_markets table to understand:
 * 1. Current normalization coverage per bookmaker
 * 2. What markets are labeled as OTHER (unknown)
 * 3. Selection normalization patterns
 *
 * Usage:
 *   npx tsx src/scripts/analyze-db-markets.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface MarketRow {
  id: string;
  match_id: string;
  bookmaker: string;
  market_key: string | null;
  normalized_type: string;
  normalized_group: string | null;
  name: string;  // market name
  param_value: string | null;
  selections: Array<{
    name: string;
    odds: number;
    normalizedName?: string;
  }>;
}

interface BookmakerStats {
  bookmaker: string;
  totalMarkets: number;
  normalizedCount: number;
  otherCount: number;
  coveragePercent: number;
  typeDistribution: Record<string, number>;
  // Unique market names that couldn't be normalized
  otherMarketNames: Array<{ name: string; count: number }>;
  // Selection names that are UNKNOWN
  unknownSelections: Array<{ name: string; marketName: string; count: number }>;
}

async function analyzeBookmaker(bookmaker: string, markets: MarketRow[]): Promise<BookmakerStats> {
  const stats: BookmakerStats = {
    bookmaker,
    totalMarkets: markets.length,
    normalizedCount: 0,
    otherCount: 0,
    coveragePercent: 0,
    typeDistribution: {},
    otherMarketNames: [],
    unknownSelections: [],
  };

  const otherNameCounts = new Map<string, number>();
  const unknownSelCounts = new Map<string, { marketName: string; count: number }>();

  for (const market of markets) {
    // Count type distribution
    const type = market.normalized_type || "UNKNOWN";
    stats.typeDistribution[type] = (stats.typeDistribution[type] || 0) + 1;

    if (type === "OTHER" || type === "UNKNOWN") {
      stats.otherCount++;
      // Track the market name
      const existing = otherNameCounts.get(market.name) || 0;
      otherNameCounts.set(market.name, existing + 1);
    } else {
      stats.normalizedCount++;
    }

    // Check for UNKNOWN selections
    for (const sel of market.selections) {
      if (sel.normalizedName === "UNKNOWN" || !sel.normalizedName) {
        const key = sel.name.toLowerCase();
        const existing = unknownSelCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          unknownSelCounts.set(key, { marketName: market.name, count: 1 });
        }
      }
    }
  }

  stats.coveragePercent = stats.totalMarkets > 0
    ? (stats.normalizedCount / stats.totalMarkets) * 100
    : 0;

  // Convert maps to sorted arrays
  stats.otherMarketNames = Array.from(otherNameCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  stats.unknownSelections = Array.from(unknownSelCounts.entries())
    .map(([name, data]) => ({ name, marketName: data.marketName, count: data.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  return stats;
}

async function main(): Promise<void> {
  console.log("\n" + "=".repeat(80));
  console.log("MARKET NORMALIZATION ANALYSIS FROM DATABASE");
  console.log("=".repeat(80) + "\n");

  // Fetch all markets from database (using latest_markets view)
  const { data: markets, error } = await supabase
    .from("latest_markets")
    .select("*")
    .order("bookmaker");

  if (error) {
    console.error("Database error:", error);
    process.exit(1);
  }

  if (!markets || markets.length === 0) {
    console.log("No markets found in database. Run scrapers first.");
    process.exit(0);
  }

  console.log(`Total markets in database: ${markets.length}\n`);

  // Group by bookmaker
  const byBookmaker = new Map<string, MarketRow[]>();
  for (const market of markets as MarketRow[]) {
    const list = byBookmaker.get(market.bookmaker) || [];
    list.push(market);
    byBookmaker.set(market.bookmaker, list);
  }

  // Analyze each bookmaker
  const allStats: BookmakerStats[] = [];
  for (const [bookmaker, bookmakerMarkets] of byBookmaker) {
    const stats = await analyzeBookmaker(bookmaker, bookmakerMarkets);
    allStats.push(stats);
  }

  // Sort by coverage (ascending - worst first)
  allStats.sort((a, b) => a.coveragePercent - b.coveragePercent);

  // Print summary table
  console.log("COVERAGE SUMMARY");
  console.log("-".repeat(80));
  console.log(
    `${"Bookmaker".padEnd(12)} | ${"Total".padEnd(7)} | ${"OK".padEnd(6)} | ${"OTHER".padEnd(6)} | ${"Coverage".padEnd(10)} | Top Type`
  );
  console.log("-".repeat(80));

  for (const stats of allStats) {
    const topType = Object.entries(stats.typeDistribution)
      .filter(([t]) => t !== "OTHER")
      .sort((a, b) => b[1] - a[1])[0];
    const topTypeStr = topType ? `${topType[0]} (${topType[1]})` : "-";

    const coverageColor = stats.coveragePercent >= 80 ? "✅" :
      stats.coveragePercent >= 50 ? "⚠️" : "❌";

    console.log(
      `${stats.bookmaker.padEnd(12)} | ${String(stats.totalMarkets).padEnd(7)} | ${String(stats.normalizedCount).padEnd(6)} | ${String(stats.otherCount).padEnd(6)} | ${coverageColor} ${stats.coveragePercent.toFixed(1).padStart(5)}% | ${topTypeStr}`
    );
  }
  console.log("-".repeat(80));

  // Detailed analysis per bookmaker
  console.log("\n" + "=".repeat(80));
  console.log("DETAILED ANALYSIS PER BOOKMAKER");
  console.log("=".repeat(80));

  for (const stats of allStats) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`📊 ${stats.bookmaker.toUpperCase()}`);
    console.log(`   Coverage: ${stats.coveragePercent.toFixed(1)}% (${stats.normalizedCount}/${stats.totalMarkets})`);

    // Type distribution
    console.log(`\n   Type Distribution:`);
    const sortedTypes = Object.entries(stats.typeDistribution)
      .sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sortedTypes.slice(0, 8)) {
      const pct = ((count / stats.totalMarkets) * 100).toFixed(1);
      const marker = type === "OTHER" ? "⚠️" : "  ";
      console.log(`   ${marker} ${type.padEnd(25)} ${String(count).padStart(4)} (${pct}%)`);
    }

    // OTHER markets
    if (stats.otherMarketNames.length > 0) {
      console.log(`\n   ❌ Uncategorized market names (need patterns):`);
      for (const { name, count } of stats.otherMarketNames.slice(0, 10)) {
        console.log(`      "${name}" (${count}x)`);
      }
    }

    // Unknown selections
    if (stats.unknownSelections.length > 0) {
      console.log(`\n   ❓ Unknown selection names:`);
      for (const { name, count } of stats.unknownSelections.slice(0, 8)) {
        console.log(`      "${name}" (${count}x)`);
      }
    }
  }

  // Global stats
  const totalMarkets = allStats.reduce((sum, s) => sum + s.totalMarkets, 0);
  const totalNormalized = allStats.reduce((sum, s) => sum + s.normalizedCount, 0);
  const globalCoverage = totalMarkets > 0 ? (totalNormalized / totalMarkets) * 100 : 0;

  console.log("\n" + "=".repeat(80));
  console.log("GLOBAL STATISTICS");
  console.log("=".repeat(80));
  console.log(`Total markets: ${totalMarkets}`);
  console.log(`Normalized: ${totalNormalized}`);
  console.log(`Global coverage: ${globalCoverage.toFixed(1)}%`);
  console.log(`Bookmakers analyzed: ${allStats.length}`);

  // Collect all unique OTHER market names across all bookmakers
  const globalOtherNames = new Map<string, { bookmakers: Set<string>; count: number }>();
  for (const stats of allStats) {
    for (const { name, count } of stats.otherMarketNames) {
      const existing = globalOtherNames.get(name);
      if (existing) {
        existing.bookmakers.add(stats.bookmaker);
        existing.count += count;
      } else {
        globalOtherNames.set(name, { bookmakers: new Set([stats.bookmaker]), count });
      }
    }
  }

  // Print common patterns across bookmakers
  console.log("\n" + "=".repeat(80));
  console.log("COMMON UNCATEGORIZED PATTERNS (across multiple bookmakers)");
  console.log("=".repeat(80));

  const sortedGlobal = Array.from(globalOtherNames.entries())
    .filter(([, data]) => data.bookmakers.size > 1)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20);

  if (sortedGlobal.length > 0) {
    for (const [name, data] of sortedGlobal) {
      console.log(`\n"${name}"`);
      console.log(`   Total: ${data.count}x across ${data.bookmakers.size} bookmakers`);
      console.log(`   Bookmakers: ${Array.from(data.bookmakers).join(", ")}`);
    }
  } else {
    console.log("No common patterns found across multiple bookmakers.");
  }

  console.log("\n");
}

main().catch((error) => {
  console.error("Analysis failed:", error);
  process.exit(1);
});
