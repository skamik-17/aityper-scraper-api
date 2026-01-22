#!/usr/bin/env npx tsx
/**
 * Betclic Filter Discovery Script
 *
 * Systematically tests different Protobuf field numbers (2-10) with values (0-20)
 * to discover which field controls market group filtering.
 *
 * The script:
 * 1. Fetches baseline response (no filter)
 * 2. Tests each field/value combination
 * 3. Compares response size and market count to baseline
 * 4. Outputs combinations where response differs from baseline
 *
 * Usage:
 *   npx tsx scripts/betclic-filter-discovery.ts                           # Use default test match
 *   npx tsx scripts/betclic-filter-discovery.ts --match 905675290968064   # Specific match ID
 *   npx tsx scripts/betclic-filter-discovery.ts --quick                   # Quick mode (fewer values)
 *   npx tsx scripts/betclic-filter-discovery.ts --field 2                 # Test only field 2
 */

import { fetchMatchDetails, fetchGrpcStream } from "../src/scrapers/bookmakers/betclic/navigation.js";
import { parseAllMarketsFromProto, encodeBigVarint, encodeVarint } from "../src/scrapers/bookmakers/betclic/parser.js";
import { ENDPOINTS } from "../src/scrapers/bookmakers/betclic/constants.js";

// ============ Configuration ============

/** Delay between requests to avoid rate limiting (ms) */
const REQUEST_DELAY_MS = 100;

/** Fields to test (2-10 as per task description) */
const FIELDS_TO_TEST = [2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Values to test for each field (0-20 as per task description) */
const VALUES_TO_TEST = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Quick mode values (subset for faster testing) */
const QUICK_VALUES = [0, 1, 2, 3, 4, 5, 10, 15, 20];

// ============ CLI Arguments ============
const args = process.argv.slice(2);
const MATCH_ID_ARG = args.find((_, i) => args[i - 1] === "--match" || args[i - 1] === "-m");
const FIELD_ARG = args.find((_, i) => args[i - 1] === "--field" || args[i - 1] === "-f");
const QUICK_MODE = args.includes("--quick") || args.includes("-q");

// Default test match from the task description
const DEFAULT_MATCH_ID = "905675290968064";

// ============ Types ============

interface BaselineResult {
  responseSize: number;
  marketCount: number;
  marketGroups: string[];
}

interface FilterTestResult {
  fieldNum: number;
  value: number;
  responseSize: number;
  marketCount: number;
  marketGroups: string[];
  sizeDiff: number;
  marketDiff: number;
  error?: string;
}

interface DiscoverySummary {
  fieldNum: number;
  differentValues: number[];
  totalDifferent: number;
  avgSizeDiff: number;
  avgMarketDiff: number;
}

// ============ Request Building ============

/**
 * Build a protobuf request with a specific field number and value
 * Field 1 is always the match ID (tag 0x08)
 * Additional field uses tag = (fieldNum << 3) | wireType
 * Wire type 0 = varint
 */
function buildRequestWithField(matchId: string, fieldNum: number, value: number): Buffer {
  // Field 1 (match ID): tag 0x08 = field 1, wire type 0 (varint)
  const matchIdBytes = [0x08, ...encodeBigVarint(BigInt(matchId))];

  // Additional field: tag = (fieldNum << 3) | 0 (wire type 0 = varint)
  const fieldTag = (fieldNum << 3) | 0;
  const fieldBytes = [fieldTag, ...encodeVarint(value)];

  return Buffer.from([...matchIdBytes, ...fieldBytes]);
}

/**
 * Fetch match details with a specific field/value filter
 */
async function fetchWithFilter(
  matchId: string,
  fieldNum: number,
  value: number
): Promise<Buffer | null> {
  try {
    const requestBody = buildRequestWithField(matchId, fieldNum, value);
    const response = await fetchGrpcStream(ENDPOINTS.match, requestBody);
    return response;
  } catch (error) {
    return null;
  }
}

// ============ Analysis Functions ============

/**
 * Parse response and extract metrics
 */
function analyzeResponse(rawData: Buffer): { marketCount: number; marketGroups: string[] } {
  try {
    const markets = parseAllMarketsFromProto(rawData);
    const groupSet = new Set<string>();

    for (const market of markets) {
      if (market.groupName) {
        groupSet.add(market.groupName);
      }
    }

    return {
      marketCount: markets.length,
      marketGroups: Array.from(groupSet).sort(),
    };
  } catch {
    return { marketCount: 0, marketGroups: [] };
  }
}

/**
 * Fetch and analyze baseline (no filter)
 */
async function fetchBaseline(matchId: string): Promise<BaselineResult | null> {
  console.log("\n📊 Fetching baseline (no filter)...");

  const rawData = await fetchMatchDetails(matchId);
  if (!rawData) {
    console.error("❌ Failed to fetch baseline");
    return null;
  }

  const analysis = analyzeResponse(rawData);

  console.log(`   Response size: ${rawData.length} bytes`);
  console.log(`   Markets: ${analysis.marketCount}`);
  console.log(`   Groups: ${analysis.marketGroups.join(", ")}`);

  return {
    responseSize: rawData.length,
    marketCount: analysis.marketCount,
    marketGroups: analysis.marketGroups,
  };
}

/**
 * Test a single field/value combination
 */
async function testFieldValue(
  matchId: string,
  fieldNum: number,
  value: number,
  baseline: BaselineResult
): Promise<FilterTestResult> {
  const result: FilterTestResult = {
    fieldNum,
    value,
    responseSize: 0,
    marketCount: 0,
    marketGroups: [],
    sizeDiff: 0,
    marketDiff: 0,
  };

  try {
    const rawData = await fetchWithFilter(matchId, fieldNum, value);

    if (!rawData) {
      result.error = "No response";
      return result;
    }

    result.responseSize = rawData.length;

    if (rawData.length < 50) {
      result.error = "Response too small";
      return result;
    }

    const analysis = analyzeResponse(rawData);
    result.marketCount = analysis.marketCount;
    result.marketGroups = analysis.marketGroups;
    result.sizeDiff = rawData.length - baseline.responseSize;
    result.marketDiff = analysis.marketCount - baseline.marketCount;

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ Output Functions ============

/**
 * Print a single test result
 */
function printResult(result: FilterTestResult, showAll: boolean = false): void {
  if (result.error) {
    if (showAll) {
      console.log(`   Field ${result.fieldNum}, Value ${result.value}: ❌ ${result.error}`);
    }
    return;
  }

  const isDifferent = result.sizeDiff !== 0 || result.marketDiff !== 0;

  if (isDifferent || showAll) {
    const sizeDiffStr = result.sizeDiff >= 0 ? `+${result.sizeDiff}` : `${result.sizeDiff}`;
    const marketDiffStr = result.marketDiff >= 0 ? `+${result.marketDiff}` : `${result.marketDiff}`;
    const marker = isDifferent ? "🔍" : "  ";

    console.log(
      `   ${marker} Field ${result.fieldNum}, Value ${String(result.value).padStart(2)}: ` +
        `${result.responseSize} bytes (${sizeDiffStr}), ` +
        `${result.marketCount} markets (${marketDiffStr})`
    );

    if (isDifferent && result.marketGroups.length > 0) {
      console.log(`      Groups: ${result.marketGroups.join(", ")}`);
    }
  }
}

/**
 * Print summary of discoveries for a field
 */
function printFieldSummary(summary: DiscoverySummary): void {
  if (summary.totalDifferent === 0) {
    console.log(`   Field ${summary.fieldNum}: No differences found`);
    return;
  }

  console.log(
    `   Field ${summary.fieldNum}: ${summary.totalDifferent} different values ` +
      `(avg size: ${summary.avgSizeDiff >= 0 ? "+" : ""}${summary.avgSizeDiff.toFixed(0)}, ` +
      `avg markets: ${summary.avgMarketDiff >= 0 ? "+" : ""}${summary.avgMarketDiff.toFixed(1)})`
  );
  console.log(`      Values: ${summary.differentValues.join(", ")}`);
}

// ============ Main Discovery Logic ============

async function runDiscovery(matchId: string): Promise<void> {
  console.log("\n" + "=".repeat(100));
  console.log("BETCLIC FILTER DISCOVERY - BRUTE FORCE");
  console.log("=".repeat(100));
  console.log(`\nMatch ID: ${matchId}`);

  // Determine which fields and values to test
  const fieldsToTest = FIELD_ARG ? [parseInt(FIELD_ARG, 10)] : FIELDS_TO_TEST;
  const valuesToTest = QUICK_MODE ? QUICK_VALUES : VALUES_TO_TEST;

  console.log(`Fields to test: ${fieldsToTest.join(", ")}`);
  console.log(`Values to test: ${valuesToTest.join(", ")}`);
  console.log(`Total combinations: ${fieldsToTest.length * valuesToTest.length}`);
  console.log(`Estimated time: ~${Math.ceil((fieldsToTest.length * valuesToTest.length * REQUEST_DELAY_MS) / 1000)}s`);

  // Fetch baseline
  const baseline = await fetchBaseline(matchId);
  if (!baseline) {
    console.error("\n❌ Cannot proceed without baseline");
    process.exit(1);
  }

  // Store all results
  const allResults: FilterTestResult[] = [];
  const differentResults: FilterTestResult[] = [];

  // Test each field
  for (const fieldNum of fieldsToTest) {
    console.log(`\n${"─".repeat(80)}`);
    console.log(`Testing Field ${fieldNum}...`);
    console.log(`${"─".repeat(80)}`);

    const fieldResults: FilterTestResult[] = [];

    for (const value of valuesToTest) {
      // Rate limiting delay
      await sleep(REQUEST_DELAY_MS);

      const result = await testFieldValue(matchId, fieldNum, value, baseline);
      fieldResults.push(result);
      allResults.push(result);

      // Print progress
      printResult(result, false);

      // Track different results
      if (!result.error && (result.sizeDiff !== 0 || result.marketDiff !== 0)) {
        differentResults.push(result);
      }
    }

    // Print field summary
    const differentForField = fieldResults.filter(
      (r) => !r.error && (r.sizeDiff !== 0 || r.marketDiff !== 0)
    );

    if (differentForField.length > 0) {
      const avgSizeDiff =
        differentForField.reduce((sum, r) => sum + r.sizeDiff, 0) / differentForField.length;
      const avgMarketDiff =
        differentForField.reduce((sum, r) => sum + r.marketDiff, 0) / differentForField.length;

      console.log(`\n   📊 Field ${fieldNum} Summary:`);
      console.log(`      Different values: ${differentForField.length}/${valuesToTest.length}`);
      console.log(`      Avg size diff: ${avgSizeDiff >= 0 ? "+" : ""}${avgSizeDiff.toFixed(0)} bytes`);
      console.log(`      Avg market diff: ${avgMarketDiff >= 0 ? "+" : ""}${avgMarketDiff.toFixed(1)} markets`);
    } else {
      console.log(`\n   ⚪ Field ${fieldNum}: All values identical to baseline`);
    }
  }

  // Print final summary
  console.log("\n" + "=".repeat(100));
  console.log("DISCOVERY SUMMARY");
  console.log("=".repeat(100));

  console.log(`\n📊 Baseline:`);
  console.log(`   Response size: ${baseline.responseSize} bytes`);
  console.log(`   Markets: ${baseline.marketCount}`);
  console.log(`   Groups: ${baseline.marketGroups.join(", ")}`);

  console.log(`\n📊 Test Results:`);
  console.log(`   Total combinations tested: ${allResults.length}`);
  console.log(`   Combinations with errors: ${allResults.filter((r) => r.error).length}`);
  console.log(`   Combinations different from baseline: ${differentResults.length}`);

  if (differentResults.length > 0) {
    console.log("\n" + "=".repeat(100));
    console.log("DISCOVERED FILTER PATTERNS");
    console.log("=".repeat(100));

    // Group by field
    const byField = new Map<number, FilterTestResult[]>();
    for (const result of differentResults) {
      if (!byField.has(result.fieldNum)) {
        byField.set(result.fieldNum, []);
      }
      byField.get(result.fieldNum)!.push(result);
    }

    for (const [fieldNum, results] of byField.entries()) {
      console.log(`\n🔍 Field ${fieldNum}:`);

      // Sort by value
      results.sort((a, b) => a.value - b.value);

      for (const result of results) {
        const sizeDiffStr = result.sizeDiff >= 0 ? `+${result.sizeDiff}` : `${result.sizeDiff}`;
        const marketDiffStr = result.marketDiff >= 0 ? `+${result.marketDiff}` : `${result.marketDiff}`;

        console.log(
          `   Value ${String(result.value).padStart(2)}: ` +
            `${result.responseSize} bytes (${sizeDiffStr}), ` +
            `${result.marketCount} markets (${marketDiffStr})`
        );

        if (result.marketGroups.length > 0) {
          console.log(`            Groups: ${result.marketGroups.join(", ")}`);
        }
      }

      // Suggest which field might be the filter
      const avgMarketDiff =
        results.reduce((sum, r) => sum + Math.abs(r.marketDiff), 0) / results.length;

      if (avgMarketDiff > 10) {
        console.log(`\n   ⭐ Field ${fieldNum} shows significant market count variation!`);
        console.log(`      This is likely the market group filter field.`);
      }
    }
  } else {
    console.log("\n⚠️  No filter patterns discovered.");
    console.log("   Possible reasons:");
    console.log("   - The filter field is outside the tested range (2-10)");
    console.log("   - The filter values are outside the tested range (0-20)");
    console.log("   - The API doesn't support filtering via additional fields");
    console.log("   - The match doesn't have multiple market groups");
  }

  // Print recommendations
  console.log("\n" + "=".repeat(100));
  console.log("RECOMMENDATIONS");
  console.log("=".repeat(100));

  if (differentResults.length > 0) {
    // Find the field with most variation
    const byField = new Map<number, FilterTestResult[]>();
    for (const result of differentResults) {
      if (!byField.has(result.fieldNum)) {
        byField.set(result.fieldNum, []);
      }
      byField.get(result.fieldNum)!.push(result);
    }

    let bestField = 0;
    let bestVariation = 0;

    for (const [fieldNum, results] of byField.entries()) {
      const variation = results.reduce((sum, r) => sum + Math.abs(r.marketDiff), 0);
      if (variation > bestVariation) {
        bestVariation = variation;
        bestField = fieldNum;
      }
    }

    if (bestField > 0) {
      console.log(`\n✅ Recommended filter field: Field ${bestField}`);
      console.log(`   Add to constants.ts:`);
      console.log(`   export const MARKET_GROUP_FILTER_FIELD = ${bestField};`);

      const fieldResults = byField.get(bestField) || [];
      const values = fieldResults.map((r) => r.value).sort((a, b) => a - b);
      console.log(`\n   Discovered filter values: ${values.join(", ")}`);
    }
  } else {
    console.log("\n⚠️  No clear filter field discovered.");
    console.log("   Try:");
    console.log("   - Testing with a different match that has more market groups");
    console.log("   - Expanding the field range (try fields 11-20)");
    console.log("   - Using the tab sniffer to capture actual browser requests");
  }

  console.log("\n" + "=".repeat(100));
  console.log("USAGE TIPS");
  console.log("=".repeat(100));
  console.log(`
  Test specific field:
    npx tsx scripts/betclic-filter-discovery.ts --field 2

  Quick mode (fewer values):
    npx tsx scripts/betclic-filter-discovery.ts --quick

  Different match:
    npx tsx scripts/betclic-filter-discovery.ts --match <matchId>

  Combine options:
    npx tsx scripts/betclic-filter-discovery.ts --field 3 --quick --match 123456
  `);
}

// ============ Main Entry Point ============

async function main(): Promise<void> {
  const matchId = MATCH_ID_ARG || DEFAULT_MATCH_ID;

  // Validate field argument if provided
  if (FIELD_ARG) {
    const fieldNum = parseInt(FIELD_ARG, 10);
    if (isNaN(fieldNum) || fieldNum < 1 || fieldNum > 20) {
      console.error(`\n❌ Invalid field number: ${FIELD_ARG}`);
      console.error("   Field number must be between 1 and 20");
      process.exit(1);
    }
  }

  try {
    await runDiscovery(matchId);
    console.log("\n✅ Discovery complete!");
  } catch (error) {
    console.error("\n❌ Discovery failed:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Script failed:", error);
  process.exit(1);
});
