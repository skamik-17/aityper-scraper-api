#!/usr/bin/env npx tsx
/**
 * Check specific match data in database
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const matchId = "laliga:getafe:real sociedad";

  console.log("=".repeat(80));
  console.log("GETAFE VS REAL SOCIEDAD - ALL MARKETS");
  console.log("=".repeat(80));

  const { data } = await supabase
    .from("odds")
    .select("*")
    .eq("match_id", matchId)
    .order("market_type_id");

  if (!data || data.length === 0) {
    console.log("No data found");
    return;
  }

  // Group by market_type_id
  const grouped = new Map<number, any[]>();
  data.forEach((d) => {
    if (!grouped.has(d.market_type_id)) {
      grouped.set(d.market_type_id, []);
    }
    grouped.get(d.market_type_id)!.push(d);
  });

  // Get market type names
  const { data: mts } = await supabase
    .from("market_types")
    .select("id, code, name_pl, selections")
    .in("id", Array.from(grouped.keys()));

  const mtMap = new Map(mts?.map((m) => [m.id, m]) || []);

  for (const [mtId, records] of grouped.entries()) {
    const mt = mtMap.get(mtId);
    console.log("\n" + "-".repeat(80));
    console.log(
      `Market Type ID: ${mtId} | Code: ${mt?.code} | Name: ${mt?.name_pl}`
    );
    console.log(`Expected selections: ${mt?.selections?.join(", ")}`);
    console.log("-".repeat(80));

    records.forEach((r) => {
      console.log(`  Market key: ${r.market_key}`);
      console.log("  Selections:");
      r.selections?.forEach((s: any) => {
        console.log(
          `    - name: ${s.name} => normalized: ${s.normalizedName} odds: ${s.odds}`
        );
      });
      console.log("  ---");
    });
  }
}

main().catch(console.error);
