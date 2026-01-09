#!/usr/bin/env npx tsx
/**
 * Analyze TOTAL_GOALS market for Getafe vs Real Sociedad
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const matchId = "laliga:getafe:real sociedad";
  const mtId = 4;

  const { data: all } = await supabase
    .from("odds")
    .select("*")
    .eq("match_id", matchId)
    .eq("market_type_id", mtId)
    .order("scraped_at", { ascending: false });

  // Group by market_key and get latest
  const latest = new Map<string, any>();
  all?.forEach((d) => {
    if (!latest.has(d.market_key)) {
      latest.set(d.market_key, d);
    }
  });

  console.log("Latest TOTAL_GOALS by market_key:");
  console.log("=".repeat(80));

  for (const [key, record] of latest.entries()) {
    const over = record.selections?.find((s: any) => s.normalizedName === "OVER");
    const under = record.selections?.find((s: any) => s.normalizedName === "UNDER");

    console.log(`\n${key}:`);
    console.log(`  OVER:  ${over?.odds || "N/A"}`);
    console.log(`  UNDER: ${under?.odds || "N/A"}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("\nANALYSIS:");
  console.log("The 'TOTAL_GOALS' (without parameter) has odds:");
  console.log("  OVER: ~2.15, UNDER: ~1.65");
  console.log("\nComparing to parameterized lines:");
  console.log("  0.5:  OVER=1.15 UNDER=5.25  (OVER favorite)");
  console.log("  1.5:  OVER=1.67 UNDER=2.20  (OVER slight favorite)");
  console.log("  2.5:  OVER=3.10 UNDER=1.38  (UNDER favorite)");
  console.log("  3.5:  OVER=6.40 UNDER=1.12  (UNDER heavy favorite)");
  console.log("\nThe ID 4/5 odds (2.15/1.65) fall between 1.5 and 2.5 lines.");
  console.log("This suggests it might be 2.0 goals or a special base market.");
}

main().catch(console.error);
