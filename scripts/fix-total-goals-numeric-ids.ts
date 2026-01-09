#!/usr/bin/env npx tsx
/**
 * Fix TOTAL_GOALS records with numeric IDs (4/5) that don't have goal line parameter
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log("=".repeat(80));
  console.log("FIXING TOTAL_GOALS WITH NUMERIC IDs (4/5) - NO GOAL LINE");
  console.log("=".repeat(80));

  // Find all TOTAL_GOALS records with numeric IDs 4 or 5
  const { data: allRecords, error } = await supabase
    .from("odds")
    .select("*")
    .eq("market_type_id", 4);

  if (error) {
    console.error("Error fetching records:", error);
    return;
  }

  console.log(`\nFound ${allRecords?.length} TOTAL_GOALS records`);

  // Find records with numeric IDs 4 or 5 and no parameter in market_key
  const problematic = allRecords?.filter((r) => {
    const hasId4Or5 = r.selections?.some(
      (s: any) => s.name === "4" || s.name === "5"
    );
    const hasNoParam = r.market_key === "TOTAL_GOALS"; // no :X.X suffix
    return hasId4Or5 && hasNoParam;
  });

  if (!problematic || problematic.length === 0) {
    console.log("No problematic records found");
    return;
  }

  console.log(`Found ${problematic.length} problematic records (numeric IDs without goal line)`);

  // Count per match
  const perMatch = new Map<string, number>();
  problematic.forEach((r) => {
    perMatch.set(r.match_id, (perMatch.get(r.match_id) || 0) + 1);
  });

  console.log("\nAffected matches (showing first 10):");
  let count = 0;
  for (const [matchId, num] of perMatch.entries()) {
    if (count++ >= 10) break;
    console.log(`  ${matchId}: ${num} records`);
  }
  if (perMatch.size > 10) {
    console.log(`  ... and ${perMatch.size - 10} more matches`);
  }

  // Delete all problematic records
  let deleted = 0;
  for (const rec of problematic) {
    const { error: deleteError } = await supabase
      .from("odds")
      .delete()
      .eq("id", rec.id);

    if (deleteError) {
      console.error(`  ❌ Failed to delete record ${rec.id}: ${deleteError.message}`);
    } else {
      deleted++;
    }
  }

  console.log(`\n✅ Deleted ${deleted} problematic records`);

  // Verify Getafe vs Real Sociedad
  const matchId = "laliga:getafe:real sociedad";
  const { data: remaining } = await supabase
    .from("odds")
    .select("market_key, selections")
    .eq("match_id", matchId)
    .eq("market_type_id", 4);

  console.log("\n" + "=".repeat(80));
  console.log(`Remaining TOTAL_GOALS for ${matchId}:`);
  console.log("=".repeat(80));

  const keys = new Set(remaining?.map((r) => r.market_key) || []);
  for (const key of Array.from(keys).sort()) {
    console.log(`  ${key}`);
  }
}

main().catch(console.error);
