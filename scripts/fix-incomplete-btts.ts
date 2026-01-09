#!/usr/bin/env npx tsx
/**
 * Fix incomplete BTTS records (where only YES exists without NO)
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const matchId = "laliga:getafe:real sociedad";

  console.log("=".repeat(80));
  console.log("FIXING INCOMPLETE BTTS RECORD");
  console.log("=".repeat(80));

  // Get all BTTS records for this match
  const { data: allRecords, error } = await supabase
    .from("odds")
    .select("*")
    .eq("match_id", matchId)
    .eq("market_type_id", 5)
    .order("scraped_at", { ascending: false });

  if (error) {
    console.error("Error fetching records:", error);
    return;
  }

  console.log(`\nFound ${allRecords?.length} BTTS records\n`);

  // Find incomplete records (where selections.length < 2)
  const incomplete = allRecords?.filter((r) => (r.selections?.length || 0) < 2) || [];

  if (incomplete.length === 0) {
    console.log("No incomplete records found");
    return;
  }

  console.log(`Found ${incomplete.length} incomplete records:`);
  incomplete.forEach((r) => {
    console.log(`  ID: ${r.id}, scraped_at: ${r.scraped_at}, selections: ${JSON.stringify(r.selections)}`);
  });

  // Delete incomplete records
  for (const rec of incomplete) {
    const { error: deleteError } = await supabase
      .from("odds")
      .delete()
      .eq("id", rec.id);

    if (deleteError) {
      console.error(`  ❌ Failed to delete record ${rec.id}: ${deleteError.message}`);
    } else {
      console.log(`  ✅ Deleted record ${rec.id}`);
    }
  }

  // Verify the latest record is now complete
  const { data: latest } = await supabase
    .from("odds")
    .select("*")
    .eq("match_id", matchId)
    .eq("market_type_id", 5)
    .order("scraped_at", { ascending: false })
    .limit(1);

  console.log("\n" + "-".repeat(80));
  console.log("Latest BTTS record after fix:");
  console.log("-".repeat(80));
  console.log(`  ID: ${latest?.[0]?.id}`);
  console.log(`  scraped_at: ${latest?.[0]?.scraped_at}`);
  console.log(`  selections: ${JSON.stringify(latest?.[0]?.selections)}`);
  console.log(`  selections count: ${latest?.[0]?.selections?.length || 0}`);
}

main().catch(console.error);
