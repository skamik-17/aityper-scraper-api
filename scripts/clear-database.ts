#!/usr/bin/env npx tsx
/**
 * Script to clear all data from local Supabase database
 * Usage: npx tsx scripts/clear-database.ts [--all | --odds | --runs | --markets | --extended]
 *
 * Options:
 *   --all      Clear all tables (default)
 *   --odds     Clear only scraped_odds table
 *   --runs     Clear only scraper_runs table
 *   --markets  Clear only scraped_markets table (full offer)
 *   --extended Clear only extended market tables (double_chance, over_under, btts)
 *   --dry-run  Show what would be deleted without actually deleting
 */

import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../src/config/index.js";

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

interface TableStats {
  name: string;
  count: number;
}

async function getTableCount(tableName: string): Promise<number> {
  const { count, error } = await supabase
    .from(tableName)
    .select("*", { count: "exact", head: true });

  if (error) {
    console.error(`Error counting ${tableName}:`, error.message);
    return 0;
  }

  return count ?? 0;
}

async function clearTable(tableName: string, dryRun: boolean): Promise<number> {
  const count = await getTableCount(tableName);

  if (count === 0) {
    console.log(`  [${tableName}] Already empty`);
    return 0;
  }

  if (dryRun) {
    console.log(`  [${tableName}] Would delete ${count} rows`);
    return count;
  }

  // Delete all rows (using a condition that matches everything)
  const { error } = await supabase
    .from(tableName)
    .delete()
    .gte("created_at", "1970-01-01");

  if (error) {
    console.error(`  [${tableName}] Error: ${error.message}`);
    return 0;
  }

  console.log(`  [${tableName}] Deleted ${count} rows`);
  return count;
}

async function clearScrapedOdds(dryRun: boolean): Promise<number> {
  return clearTable("scraped_odds", dryRun);
}

async function clearScraperRuns(dryRun: boolean): Promise<number> {
  const count = await getTableCount("scraper_runs");

  if (count === 0) {
    console.log("  [scraper_runs] Already empty");
    return 0;
  }

  if (dryRun) {
    console.log(`  [scraper_runs] Would delete ${count} rows`);
    return count;
  }

  // scraper_runs uses started_at instead of created_at
  const { error } = await supabase
    .from("scraper_runs")
    .delete()
    .gte("started_at", "1970-01-01");

  if (error) {
    console.error(`  [scraper_runs] Error: ${error.message}`);
    return 0;
  }

  console.log(`  [scraper_runs] Deleted ${count} rows`);
  return count;
}

async function clearExtendedMarkets(dryRun: boolean): Promise<number> {
  let total = 0;
  total += await clearTable("odds_double_chance", dryRun);
  total += await clearTable("odds_over_under", dryRun);
  total += await clearTable("odds_btts", dryRun);
  return total;
}

async function clearScrapedMarkets(dryRun: boolean): Promise<number> {
  return clearTable("scraped_markets", dryRun);
}

async function showStats(): Promise<void> {
  console.log("\nCurrent database statistics:");
  console.log("─".repeat(40));

  const tables = [
    "scraped_odds",
    "scraped_markets",
    "scraper_runs",
    "odds_double_chance",
    "odds_over_under",
    "odds_btts",
  ];

  for (const table of tables) {
    const count = await getTableCount(table);
    console.log(`  ${table.padEnd(20)} ${count.toString().padStart(8)} rows`);
  }

  console.log("─".repeat(40));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const clearOdds = args.includes("--odds");
  const clearRuns = args.includes("--runs");
  const clearMarkets = args.includes("--markets");
  const clearExtended = args.includes("--extended");
  const clearAll = args.includes("--all") || (!clearOdds && !clearRuns && !clearMarkets && !clearExtended);

  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Supabase Database Cleanup Script       ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log();

  if (dryRun) {
    console.log("🔍 DRY RUN MODE - No data will be deleted\n");
  }

  // Show current stats
  await showStats();

  console.log();

  if (clearAll) {
    console.log("Clearing ALL tables...\n");
  } else {
    const targets = [];
    if (clearOdds) targets.push("scraped_odds");
    if (clearRuns) targets.push("scraper_runs");
    if (clearMarkets) targets.push("scraped_markets");
    if (clearExtended) targets.push("extended markets");
    console.log(`Clearing: ${targets.join(", ")}\n`);
  }

  let totalDeleted = 0;

  if (clearAll || clearOdds) {
    totalDeleted += await clearScrapedOdds(dryRun);
  }

  if (clearAll || clearMarkets) {
    totalDeleted += await clearScrapedMarkets(dryRun);
  }

  if (clearAll || clearRuns) {
    totalDeleted += await clearScraperRuns(dryRun);
  }

  if (clearAll || clearExtended) {
    totalDeleted += await clearExtendedMarkets(dryRun);
  }

  console.log();

  if (dryRun) {
    console.log(`📊 Would delete ${totalDeleted} total rows`);
    console.log("\nRun without --dry-run to actually delete data.");
  } else {
    console.log(`✅ Deleted ${totalDeleted} total rows`);

    // Show final stats
    await showStats();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
