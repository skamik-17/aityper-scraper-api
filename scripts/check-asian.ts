import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function check() {
  // Find regular TOTAL_GOALS markets for comparison
  const { data, error } = await supabase
    .from("latest_odds")
    .select("*")
    .eq("market_code", "TOTAL_GOALS")
    .eq("home_team", "Real Madrid")
    .limit(10);

  if (error) {
    console.error("Error:", error);
    return;
  }

  console.log("=== TOTAL_GOALS (standard) for Real Madrid ===\n");

  for (const row of data) {
    console.log("Match:", row.home_team, "vs", row.away_team);
    console.log("  market_key:", row.market_key);
    console.log("  param_value:", row.param_value);
    console.log("  selections:", JSON.stringify(row.selections));
    console.log("");
  }

  // Now ASIAN for same match
  const { data: asianData, error: asianError } = await supabase
    .from("latest_odds")
    .select("*")
    .eq("market_code", "TOTAL_GOALS_ASIAN")
    .eq("home_team", "Real Madrid")
    .limit(10);

  if (asianError) {
    console.error("Error:", asianError);
    return;
  }

  console.log("\n=== TOTAL_GOALS_ASIAN for Real Madrid ===\n");

  for (const row of asianData) {
    console.log("Match:", row.home_team, "vs", row.away_team);
    console.log("  market_key:", row.market_key);
    console.log("  param_value:", row.param_value);
    console.log("  selections:", JSON.stringify(row.selections));
    console.log("");
  }
}

check();
