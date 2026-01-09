#!/usr/bin/env npx tsx
/**
 * Script to clear all data from local Supabase database
 * Usage: npx tsx scripts/clear-database.ts [--all | --odds | --runs] [--dry-run] [--stats]
 *
 * Current database structure:
 *   - market_types: 41 seed rows (NEVER cleared)
 *   - odds: 216,021 rows of scraped odds
 *   - scraper_runs: 0 rows (currently unused)
 *
 * Options:
 *   --all      Clear all data tables (default)
 *   --odds     Clear only odds table
 *   --runs     Clear only scraper_runs table
 *   --dry-run  Show what would be deleted without actually deleting
 *   --stats     Show current statistics only
 */

import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../src/config/index.js";

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

interface TableInfo {
  name: string;
  description: string;
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

async function clearOdds(dryRun: boolean): Promise<number> {
  const count = await getTableCount("odds");

  if (count === 0) {
    console.log("  [odds] Already empty");
    return 0;
  }

  if (dryRun) {
    console.log(`  [odds] Would delete ${count} rows`);
    return count;
  }

  const { error } = await supabase
    .from("odds")
    .delete()
    .gte("scraped_at", "1970-01-01");

  if (error) {
    console.error(`  [odds] Error: ${error.message}`);
    return 0;
  }

  console.log(`  [odds] Deleted ${count} rows`);
  return count;
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

async function showStats(): Promise<void> {
  console.log("\nCurrent database statistics:");
  console.log("─".repeat(60));

  const tables: TableInfo[] = [
    {
      name: "market_types",
      description: "Canonical market types (seed data - never cleared)",
    },
    {
      name: "odds",
      description: "Scraped odds data (all scrapes)",
    },
    {
      name: "scraper_runs",
      description: "Scraper run logs (currently unused)",
    },
  ];

  for (const table of tables) {
    const count = await getTableCount(table.name);
    const countStr = count.toString().padStart(10);
    const nameStr = table.name.padEnd(20);
    console.log(`  ${nameStr} ${countStr} rows  - ${table.description}`);
  }

  console.log("\nViews (auto-refreshed when tables are cleared):");
  console.log("─".repeat(60));

  const views = [
    {
      name: "latest_odds",
      description: "Deduped latest odds per match/bookmaker/market",
    },
    {
      name: "market_comparison",
      description: "Sorted odds for cross-bookmaker comparison",
    },
    {
      name: "matches_with_odds",
      description: "Match summaries (likely legacy - unused)",
    },
  ];

  for (const view of views) {
    const nameStr = view.name.padEnd(25);
    console.log(`  ${nameStr} - ${view.description}`);
  }

  console.log("─".repeat(60));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const showOnly = args.includes("--stats");
  const clearOddsFlag = args.includes("--odds");
  const clearRunsFlag = args.includes("--runs");
  const clearAll = args.includes("--all") || (!clearOddsFlag && !clearRunsFlag && !showOnly);

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   Supabase Database Cleanup Script            ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();

  if (dryRun) {
    console.log("🔍 DRY RUN MODE - No data will be deleted\n");
  }

  // Show current stats
  await showStats();

  if (showOnly) {
    console.log("\n✅ Stats only mode - exiting without changes");
    return;
  }

  console.log();

  if (clearAll) {
    console.log("Clearing ALL data tables (preserving seed data)...\n");
  } else {
    const targets: string[] = [];
    if (clearOddsFlag) targets.push("odds");
    if (clearRunsFlag) targets.push("scraper_runs");
    console.log(`Clearing: ${targets.join(", ")}\n`);
  }

  let totalDeleted = 0;

  if (clearAll || clearOddsFlag) {
    totalDeleted += await clearOdds(dryRun);
  }

  if (clearAll || clearRunsFlag) {
    totalDeleted += await clearScraperRuns(dryRun);
  }

  console.log();

  if (dryRun) {
    console.log(`📊 Would delete ${totalDeleted} total rows`);
    console.log("\nRun without --dry-run to actually delete data.");
  } else {
    console.log(`✅ Deleted ${totalDeleted} total rows`);
    console.log("🔄 Views (latest_odds, market_comparison) will auto-refresh");

    // Show final stats
    await showStats();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
