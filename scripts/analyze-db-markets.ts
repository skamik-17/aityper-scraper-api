/**
 * Analyze database market data for quality issues
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Helper to get all records (bypassing 1000 limit)
async function getAllOdds(): Promise<OddsRecord[]> {
  const allRecords: OddsRecord[] = [];
  let from = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("odds")
      .select("*")
      .range(from, from + batchSize - 1)
      .order("id");

    if (error) {
      console.error("Error fetching odds:", error);
      break;
    }

    if (!data || data.length === 0) break;
    allRecords.push(...data);

    if (data.length < batchSize) break;
    from += batchSize;
  }

  return allRecords;
}

interface OddsRecord {
  id: number;
  match_id: string;
  league_slug: string;
  home_team: string;
  away_team: string;
  bookmaker: string;
  market_type_id: number;
  market_key: string;
  param_value: string | null;
  selections: Array<{
    name: string;
    normalizedName: string;
    odds: number;
  }>;
  scraped_at: string;
}

interface MarketType {
  id: number;
  code: string;
  name_pl: string;
  selections: string[];
}

async function main() {
  console.log("=".repeat(80));
  console.log("DATABASE MARKET DATA ANALYSIS");
  console.log("=".repeat(80));
  console.log();

  // Get all market types
  const { data: marketTypes, error: mtError } = await supabase
    .from("market_types")
    .select("id, code, name_pl, selections")
    .order("id");

  if (mtError) {
    console.error("Error fetching market types:", mtError);
    return;
  }

  const typeMap = new Map<number, MarketType>();
  marketTypes?.forEach((t) => typeMap.set(t.id, t));

  // Get all odds records (bypassing 1000 limit)
  const odds = await getAllOdds();

  console.log(`Total odds records: ${odds?.length || 0}\n`);

  // Group by market type
  const byMarket = new Map<number, OddsRecord[]>();
  odds?.forEach((record) => {
    const id = record.market_type_id;
    if (!byMarket.has(id)) byMarket.set(id, []);
    byMarket.get(id)!.push(record);
  });

  // Analyze each market type
  const issues: string[] = [];

  for (const [marketId, records] of Array.from(byMarket.entries()).sort(
    (a, b) => a[0] - b[0]
  )) {
    const marketType = typeMap.get(marketId);
    if (!marketType) {
      issues.push(`Market ID ${marketId}: Unknown market type!`);
      continue;
    }

    console.log("-".repeat(80));
    console.log(`[${marketId}] ${marketType.code} (${marketType.name_pl})`);
    console.log("-".repeat(80));
    console.log(`Records: ${records.length}`);

    // Get unique market keys
    const uniqueKeys = new Set(records.map((r) => r.market_key));
    console.log(`Unique market keys: ${uniqueKeys.size}`);
    console.log(`Keys: ${Array.from(uniqueKeys).slice(0, 10).join(", ")}${uniqueKeys.size > 10 ? "..." : ""}`);

    // Analyze selections
    const allSelections = new Map<string, number>();
    const oddsRanges: number[] = [];
    let badOddsCount = 0;
    let missingSelectionsCount = 0;
    let unknownSelectionsCount = 0;

    for (const record of records) {
      if (!record.selections || !Array.isArray(record.selections)) {
        missingSelectionsCount++;
        continue;
      }

      for (const sel of record.selections) {
        const normalized = sel.normalizedName || "MISSING";
        allSelections.set(normalized, (allSelections.get(normalized) || 0) + 1);

        if (typeof sel.odds === "number") {
          oddsRanges.push(sel.odds);
          if (sel.odds < 1.0 || sel.odds > 1000) {
            badOddsCount++;
          }
        }

        // Check if selection is expected
        if (
          normalized !== "UNKNOWN" &&
          normalized !== "MISSING" &&
          !marketType.selections.includes(normalized)
        ) {
          unknownSelectionsCount++;
        }
      }
    }

    // Print selection distribution
    console.log(`\nSelection distribution:`);
    Array.from(allSelections.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, count]) => {
        const expected = marketType.selections.includes(name) ? "✓" : "⚠️";
        console.log(`  ${expected} ${name}: ${count}`);
      });

    // Print odds range
    if (oddsRanges.length > 0) {
      const minOdds = Math.min(...oddsRanges);
      const maxOdds = Math.max(...oddsRanges);
      const avgOdds = oddsRanges.reduce((a, b) => a + b, 0) / oddsRanges.length;
      console.log(`\nOdds range: ${minOdds.toFixed(2)} - ${maxOdds.toFixed(2)} (avg: ${avgOdds.toFixed(2)})`);
    }

    // Report issues
    const marketIssues: string[] = [];
    if (badOddsCount > 0) {
      marketIssues.push(`${badOddsCount} records with suspicious odds (<1 or >1000)`);
    }
    if (missingSelectionsCount > 0) {
      marketIssues.push(`${missingSelectionsCount} records with missing selections`);
    }
    if (unknownSelectionsCount > 0) {
      marketIssues.push(`${unknownSelectionsCount} unexpected selection types`);
    }
    if (allSelections.has("UNKNOWN")) {
      marketIssues.push(`${allSelections.get("UNKNOWN")} UNKNOWN selections`);
    }

    if (marketIssues.length > 0) {
      console.log(`\n⚠️ ISSUES:`);
      marketIssues.forEach((issue) => console.log(`  - ${issue}`));
      issues.push(`[${marketId}] ${marketType.code}: ${marketIssues.join("; ")}`);
    } else {
      console.log(`\n✅ No issues found`);
    }

    // Show sample records
    console.log(`\nSample records:`);
    records.slice(0, 2).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.home_team} vs ${r.away_team} (${r.bookmaker})`);
      console.log(`     Key: ${r.market_key}, Param: ${r.param_value || "none"}`);
      console.log(`     Selections: ${JSON.stringify(r.selections?.slice(0, 3))}`);
    });

    console.log();
  }

  // Summary
  console.log("=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total market types with data: ${byMarket.size}`);
  console.log(`Total records: ${odds?.length || 0}`);

  if (issues.length > 0) {
    console.log(`\n⚠️ MARKETS WITH ISSUES (${issues.length}):`);
    issues.forEach((issue) => console.log(`  - ${issue}`));
  } else {
    console.log(`\n✅ All markets look good!`);
  }
}

main().catch(console.error);
