#!/usr/bin/env npx tsx
/**
 * Script to clear badly mapped STS data from database
 *
 * This clears records where STS market IDs were incorrectly mapped to wrong market types:
 * - CORRECT_SCORE (22): Had market 9 (Last Goal) mapped incorrectly
 * - RESULT_AND_BTTS (35): Had markets 49/50 (BTTS+O/U) mapped incorrectly
 * - HALFTIME_FULLTIME (37): Had market 1012 (HT/FT+O/U) mapped incorrectly
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/clear-bad-mappings.ts [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Market types that had bad mappings - need to clear STS data
const BAD_MARKET_TYPE_IDS = [
  22, // CORRECT_SCORE - had market 9 (Last Goal) wrongly mapped
  35, // RESULT_AND_BTTS - had markets 49/50 (BTTS+O/U) wrongly mapped
  37, // HALFTIME_FULLTIME - had market 1012 (HT/FT+O/U combo) wrongly mapped
];

async function getMarketTypeNames(): Promise<Map<number, string>> {
  const { data } = await supabase
    .from("market_types")
    .select("id, code");

  const map = new Map<number, string>();
  data?.forEach(t => map.set(t.id, t.code));
  return map;
}

async function countRecords(marketTypeId: number, bookmaker?: string): Promise<number> {
  let query = supabase
    .from("odds")
    .select("*", { count: "exact", head: true })
    .eq("market_type_id", marketTypeId);

  if (bookmaker) {
    query = query.eq("bookmaker", bookmaker);
  }

  const { count, error } = await query;

  if (error) {
    console.error(`Error counting: ${error.message}`);
    return 0;
  }

  return count ?? 0;
}

async function clearRecords(marketTypeId: number, bookmaker: string, dryRun: boolean): Promise<number> {
  const count = await countRecords(marketTypeId, bookmaker);

  if (count === 0) {
    return 0;
  }

  if (dryRun) {
    return count;
  }

  const { error } = await supabase
    .from("odds")
    .delete()
    .eq("market_type_id", marketTypeId)
    .eq("bookmaker", bookmaker);

  if (error) {
    console.error(`Error deleting: ${error.message}`);
    return 0;
  }

  return count;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("=".repeat(80));
  console.log("CLEARING BADLY MAPPED STS DATA");
  console.log("=".repeat(80));

  if (dryRun) {
    console.log("\n🔍 DRY RUN MODE - No data will be deleted\n");
  }

  const typeNames = await getMarketTypeNames();

  console.log("\nMarket types to clear (STS only):");
  for (const typeId of BAD_MARKET_TYPE_IDS) {
    const name = typeNames.get(typeId) || "UNKNOWN";
    const count = await countRecords(typeId, "sts");
    console.log(`  [${typeId}] ${name}: ${count} STS records`);
  }

  console.log("\n" + "-".repeat(80));
  console.log("Clearing records...\n");

  let totalDeleted = 0;

  for (const typeId of BAD_MARKET_TYPE_IDS) {
    const name = typeNames.get(typeId) || "UNKNOWN";
    const deleted = await clearRecords(typeId, "sts", dryRun);

    if (deleted > 0) {
      if (dryRun) {
        console.log(`  ⚠️  [${typeId}] ${name}: Would delete ${deleted} records`);
      } else {
        console.log(`  ✅ [${typeId}] ${name}: Deleted ${deleted} records`);
      }
      totalDeleted += deleted;
    } else {
      console.log(`  ℹ️  [${typeId}] ${name}: No records to delete`);
    }
  }

  console.log("\n" + "=".repeat(80));

  if (dryRun) {
    console.log(`📊 Would delete ${totalDeleted} total records`);
    console.log("\nRun without --dry-run to actually delete data.");
  } else {
    console.log(`✅ Deleted ${totalDeleted} total records`);
    console.log("\n🔄 Re-run scraper to get correctly mapped data.");
  }
}

main().catch(console.error);
