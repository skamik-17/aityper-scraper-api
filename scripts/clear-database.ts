#!/usr/bin/env npx tsx
/**
 * Script to clear all data from local Supabase database
 * Usage: npx tsx scripts/clear-database.ts [--all | --odds | --runs | --history] [--dry-run] [--stats]
 *
 * Current database structure:
 *   - market_types: 41 seed rows (NEVER cleared)
 *   - odds: 216,021 rows of scraped odds
 *   - scraper_runs: 0 rows (currently unused)
 *
 * Options:
 *   --all      Clear all data tables (default)
 *   --odds     Clear only the odds tables: odds_current, odds_snapshot, matches and,
 *              while it exists, the legacy odds table
 *   --runs     Clear only scraper_runs table
 *   --history  Clear odds_history (the change log); the only way to clear it
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

/** PostgREST answers PGRST205 for a table that does not exist (odds after migration 15). */
async function tableExists(tableName: string): Promise<boolean> {
  const { error } = await (supabase as any).from(tableName).select("*", { count: "exact", head: true });
  return (error as { code?: unknown } | null)?.code !== "PGRST205";
}

/** Deletes every row; safeupdate needs a filter, so the delete carries `match_id IS NOT NULL`. */
async function clearByMatchId(tableName: string, dryRun: boolean): Promise<number> {
  if (!(await tableExists(tableName))) {
    console.log(`  [${tableName}] Table not found - skipped`);
    return 0;
  }
  const count = await getTableCount(tableName);

  if (count === 0) {
    console.log(`  [${tableName}] Already empty`);
    return 0;
  }

  if (dryRun) {
    console.log(`  [${tableName}] Would delete ${count} rows`);
    return count;
  }

  const { error } = await (supabase as any).from(tableName).delete().not("match_id", "is", null);

  if (error) {
    console.error(`  [${tableName}] Error: ${error.message}`);
    return 0;
  }

  console.log(`  [${tableName}] Deleted ${count} rows`);
  return count;
}

/** The odds tables: the snapshot model (children first) and the legacy table while it exists. */
async function clearOdds(dryRun: boolean): Promise<number> {
  let total = 0;
  for (const table of ["odds_current", "odds_snapshot", "matches", "odds"]) {
    total += await clearByMatchId(table, dryRun);
  }
  return total;
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
      description: "Legacy scraped odds (all scrapes; dropped in migration 15)",
    },
    {
      name: "matches",
      description: "One row per fixture (snapshot model)",
    },
    {
      name: "odds_snapshot",
      description: "One row per match and bookmaker (snapshot model)",
    },
    {
      name: "odds_current",
      description: "Current quote per match, bookmaker and market (snapshot model)",
    },
    {
      name: "odds_history",
      description: "Append-only change log (cleared only with --history)",
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
  const clearHistoryFlag = args.includes("--history");
  const clearAll = args.includes("--all") || (!clearOddsFlag && !clearRunsFlag && !clearHistoryFlag && !showOnly);

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
    if (clearHistoryFlag) targets.push("odds_history");
    console.log(`Clearing: ${targets.join(", ")}\n`);
  }

  let totalDeleted = 0;

  if (clearAll || clearOddsFlag) {
    totalDeleted += await clearOdds(dryRun);
  }

  if (clearAll || clearRunsFlag) {
    totalDeleted += await clearScraperRuns(dryRun);
  }

  // Never part of --all: the change log feeds the value model
  if (clearHistoryFlag) {
    totalDeleted += await clearByMatchId("odds_history", dryRun);
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
