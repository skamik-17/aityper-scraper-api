#!/usr/bin/env npx tsx
/**
 * Fix 1X2 records with team names instead of numeric IDs (wrong odds)
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log("=".repeat(80));
  console.log("FINDING 1X2 RECORDS WITH TEAM NAMES (WRONG ODDS)");
  console.log("=".repeat(80));

  // Find all 1X2 records
  const { data: allRecords } = await supabase
    .from("odds")
    .select("*")
    .eq("market_type_id", 1)
    .eq("bookmaker", "sts");

  if (!allRecords || allRecords.length === 0) {
    console.log("No 1X2 records found");
    return;
  }

  console.log(`\nTotal STS 1X2 records: ${allRecords.length}`);

  // Find records with team names (wrong format)
  const problematic: any[] = [];
  allRecords.forEach((r) => {
    const selections = r.selections || [];
    const hasTeamNames = selections.some(
      (s: any) =>
        s.name === "Getafe" ||
        s.name === "Real Sociedad" ||
        s.name === "Remis" ||
        s.name === "Wolverhampton" ||
        s.name === "Newcastle" ||
        s.name === "Liverpool" ||
        (s.name && s.name.length > 3 && s.name !== "1" && s.name !== "2" && s.name !== "3")
    );

    if (hasTeamNames) {
      problematic.push(r);
    }
  });

  console.log(`Found ${problematic.length} records with team names (wrong odds)`);

  if (problematic.length === 0) {
    return;
  }

  // Group by match
  const perMatch = new Map<string, any[]>();
  problematic.forEach((r) => {
    if (!perMatch.has(r.match_id)) {
      perMatch.set(r.match_id, []);
    }
    perMatch.get(r.match_id)!.push(r);
  });

  console.log("\nAffected matches:");
  for (const [matchId, recs] of perMatch.entries()) {
    console.log(`  ${matchId}: ${recs.length} records`);
    // Show sample odds
    console.log(`    Sample: ${JSON.stringify(recs[0].selections)}`);
  }

  // Delete all problematic records
  console.log("\n" + "=".repeat(80));
  console.log("Deleting problematic records...");
  console.log("=".repeat(80));

  let deleted = 0;
  for (const rec of problematic) {
    const { error } = await supabase.from("odds").delete().eq("id", rec.id);

    if (error) {
      console.error(`  ❌ Failed to delete ${rec.id}: ${error.message}`);
    } else {
      deleted++;
    }
  }

  console.log(`\n✅ Deleted ${deleted} problematic 1X2 records`);

  // Verify fix for Getafe vs Real Sociedad
  const matchId = "laliga:getafe:real sociedad";
  const { data: remaining } = await supabase
    .from("odds")
    .select("scraped_at, selections")
    .eq("match_id", matchId)
    .eq("market_type_id", 1)
    .order("scraped_at", { ascending: false })
    .limit(1);

  console.log("\n" + "=".repeat(80));
  console.log(`Latest 1X2 for ${matchId}:`);
  console.log("=".repeat(80));
  if (remaining && remaining.length > 0) {
    console.log(`  scraped_at: ${remaining[0].scraped_at}`);
    remaining[0].selections?.forEach((s: any) => {
      console.log(`    ${s.name} => ${s.normalizedName}: ${s.odds}`);
    });
  }
}

main().catch(console.error);
