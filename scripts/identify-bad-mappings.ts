/**
 * Identify bad market mappings in database
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface OddsRecord {
  id: number;
  match_id: string;
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
}

// Expected selection patterns for each market type
const EXPECTED_PATTERNS: Record<number, {
  expectedSelections: string[];
  namePattern?: RegExp;
  description: string;
}> = {
  1: { // MATCH_WINNER
    expectedSelections: ["HOME", "DRAW", "AWAY"],
    description: "1X2 result",
  },
  22: { // CORRECT_SCORE
    expectedSelections: ["SCORE"],
    namePattern: /^\d+:\d+$/,
    description: "Exact scores like 1:0, 2:1",
  },
  35: { // RESULT_AND_BTTS
    expectedSelections: ["HOME_YES", "HOME_NO", "DRAW_YES", "DRAW_NO", "AWAY_YES", "AWAY_NO"],
    description: "Result + BTTS combinations",
  },
  37: { // HALFTIME_FULLTIME
    expectedSelections: ["1/1", "1/X", "1/2", "X/1", "X/X", "X/2", "2/1", "2/X", "2/2"],
    description: "HT/FT combinations",
  },
};

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
      console.error("Error:", error);
      break;
    }
    if (!data || data.length === 0) break;
    allRecords.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  return allRecords;
}

async function main() {
  console.log("=".repeat(80));
  console.log("IDENTIFYING BAD MARKET MAPPINGS");
  console.log("=".repeat(80));
  console.log();

  const { data: marketTypes } = await supabase
    .from("market_types")
    .select("id, code, name_pl");

  const typeMap = new Map<number, { code: string; name_pl: string }>();
  marketTypes?.forEach((t) => typeMap.set(t.id, t));

  const odds = await getAllOdds();
  console.log(`Total records: ${odds.length}\n`);

  // Group by market type
  const byType = new Map<number, OddsRecord[]>();
  odds.forEach((r) => {
    if (!byType.has(r.market_type_id)) byType.set(r.market_type_id, []);
    byType.get(r.market_type_id)!.push(r);
  });

  // Analyze each market type for issues
  const badMappings: Array<{
    marketTypeId: number;
    code: string;
    issue: string;
    samples: string[];
    count: number;
  }> = [];

  for (const [typeId, records] of byType) {
    const marketType = typeMap.get(typeId);
    if (!marketType) continue;

    // Collect unique selection names
    const selectionNames = new Set<string>();
    const normalizedNames = new Set<string>();

    for (const r of records) {
      r.selections?.forEach((s) => {
        selectionNames.add(s.name);
        normalizedNames.add(s.normalizedName);
      });
    }

    // Check for issues
    const issues: string[] = [];
    const unknownCount = records.reduce((sum, r) =>
      sum + (r.selections?.filter(s => s.normalizedName === "UNKNOWN").length || 0), 0);

    if (unknownCount > records.length * 0.1) {
      issues.push(`High UNKNOWN rate: ${unknownCount} selections`);
    }

    // Check specific market types for wrong data
    if (typeId === 22) { // CORRECT_SCORE
      const hasScoreFormat = Array.from(selectionNames).some(n => /^\d+:\d+$/.test(n));
      const hasNumericIds = Array.from(selectionNames).some(n => /^\d{2,3}$/.test(n));
      if (!hasScoreFormat && hasNumericIds) {
        issues.push("Contains numeric IDs instead of score formats (e.g., '187' instead of '1:0')");
      }
    }

    if (typeId === 35) { // RESULT_AND_BTTS
      const hasOverUnder = Array.from(normalizedNames).some(n => n === "OVER" || n === "UNDER");
      if (hasOverUnder) {
        issues.push("Contains OVER/UNDER selections - this is O/U+BTTS, not Result+BTTS");
      }
    }

    if (typeId === 37) { // HALFTIME_FULLTIME
      const hasLineValues = Array.from(selectionNames).some(n => /i [+-]\d/.test(n));
      if (hasLineValues) {
        issues.push("Contains O/U line values - this is HT/FT+O/U combo, not simple HT/FT");
      }
    }

    if (issues.length > 0) {
      badMappings.push({
        marketTypeId: typeId,
        code: marketType.code,
        issue: issues.join("; "),
        samples: Array.from(selectionNames).slice(0, 10),
        count: records.length,
      });
    }
  }

  // Report
  console.log("=".repeat(80));
  console.log("BAD MAPPINGS FOUND");
  console.log("=".repeat(80));

  if (badMappings.length === 0) {
    console.log("✅ No bad mappings found!");
  } else {
    for (const bad of badMappings) {
      console.log(`\n❌ [${bad.marketTypeId}] ${bad.code}`);
      console.log(`   Issue: ${bad.issue}`);
      console.log(`   Records: ${bad.count}`);
      console.log(`   Sample selections: ${bad.samples.join(", ")}`);
    }
  }

  // Show all market types with sample data
  console.log("\n" + "=".repeat(80));
  console.log("ALL MARKET TYPES - SAMPLE DATA");
  console.log("=".repeat(80));

  for (const [typeId, records] of Array.from(byType).sort((a, b) => a[0] - b[0])) {
    const marketType = typeMap.get(typeId);
    const sample = records[0];

    console.log(`\n[${typeId}] ${marketType?.code || "UNKNOWN"} (${records.length} records)`);
    console.log(`   Sample match: ${sample.home_team} vs ${sample.away_team}`);
    console.log(`   Market key: ${sample.market_key}`);
    console.log(`   Selections (first 5):`);
    sample.selections?.slice(0, 5).forEach((s) => {
      console.log(`      "${s.name}" → ${s.normalizedName} @ ${s.odds}`);
    });
  }
}

main().catch(console.error);
