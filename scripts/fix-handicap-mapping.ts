#!/usr/bin/env npx tsx
/**
 * Fix incorrectly mapped handicap data
 * Records in DRAW_NO_BET (ID 3) with handicap format "1 (+X)" should be ASIAN_HANDICAP (ID 15)
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log("=".repeat(80));
  console.log("FIXING INCORRECTLY MAPPED HANDICAP DATA");
  console.log("=".repeat(80));

  // Find all DRAW_NO_BET records with handicap format
  const { data: allDnb } = await supabase
    .from("odds")
    .select("*")
    .eq("market_type_id", 3);

  if (!allDnb || allDnb.length === 0) {
    console.log("No DRAW_NO_BET records found");
    return;
  }

  console.log(`\nFound ${allDnb.length} DRAW_NO_BET records`);

  // Find records with handicap format (containing "(+" or "(-")
  const handicapRecords = allDnb.filter((r) => {
    const selections = r.selections || [];
    return selections.some(
      (s: any) =>
        s.name?.includes("(+") || s.name?.includes("(-")
    );
  });

  if (handicapRecords.length === 0) {
    console.log("No handicap records found in DRAW_NO_BET");
    return;
  }

  console.log(
    `Found ${handicapRecords.length} handicap records incorrectly mapped to DRAW_NO_BET`
  );

  // Count per match
  const perMatch = new Map<string, number>();
  handicapRecords.forEach((r) => {
    perMatch.set(r.match_id, (perMatch.get(r.match_id) || 0) + 1);
  });

  console.log("\nAffected matches:");
  for (const [matchId, count] of perMatch.entries()) {
    console.log(`  ${matchId}: ${count} records`);
  }

  // Delete all incorrectly mapped records
  let deleted = 0;
  for (const rec of handicapRecords) {
    const { error } = await supabase.from("odds").delete().eq("id", rec.id);

    if (error) {
      console.error(`  ❌ Failed to delete ${rec.id}: ${error.message}`);
    } else {
      deleted++;
    }
  }

  console.log(`\n✅ Deleted ${deleted} incorrectly mapped records`);

  // Verify fix for Getafe vs Real Sociedad
  const matchId = "laliga:getafe:real sociedad";
  const { data: remaining } = await supabase
    .from("odds")
    .select("market_type_id, market_key, selections")
    .eq("match_id", matchId)
    .eq("market_type_id", 3)
    .limit(1);

  console.log("\n" + "=".repeat(80));
  console.log(`Remaining DRAW_NO_BET for ${matchId}:`);
  console.log("=".repeat(80));

  if (remaining && remaining.length > 0) {
    console.log("Still has DRAW_NO_BET records:");
    remaining[0].selections?.forEach((s: any) => {
      console.log(`  ${s.name} => ${s.normalizedName}: ${s.odds}`);
    });
  } else {
    console.log("  No DRAW_NO_BET records remaining (handicap records deleted)");
  }
}

main().catch(console.error);
