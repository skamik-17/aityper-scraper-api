#!/usr/bin/env npx tsx
/**
 * Betclic Market Discovery Script
 *
 * Fetches match data from Betclic gRPC API and analyzes all available markets.
 * Unlike STS which uses WebSocket, Betclic uses gRPC-web with Protocol Buffers.
 *
 * Usage:
 *   npx tsx scripts/betclic-market-discovery.ts                           # Use default test match
 *   npx tsx scripts/betclic-market-discovery.ts --match 905675290968064   # Specific match ID
 *   npx tsx scripts/betclic-market-discovery.ts --url "https://..."       # Extract match ID from URL
 *   npx tsx scripts/betclic-market-discovery.ts --verbose                 # Show all market details
 *   npx tsx scripts/betclic-market-discovery.ts --raw                     # Show basic protobuf structure
 *   npx tsx scripts/betclic-market-discovery.ts --proto                   # Show detailed protobuf analysis
 *   npx tsx scripts/betclic-market-discovery.ts --filter 5                # Test filter value (Field 2)
 */

import { fetchMatchDetails, extractMatchIdFromUrl, fetchGrpcStream } from "../src/scrapers/bookmakers/betclic/navigation.js";
import { parseAllMarketsFromProto, parseFields, getMessage, getString, encodeBigVarint, encodeVarint } from "../src/scrapers/bookmakers/betclic/parser.js";
import { MARKET_TYPES, MARKET_GROUPS, PROTO_FIELDS, TEAM_SEPARATOR, ENDPOINTS } from "../src/scrapers/bookmakers/betclic/constants.js";
import type { ScrapedMarket } from "../src/types/full-offer.js";

// ============ Expected Market Types ============
// These are the market types we expect to find in a typical football match
const EXPECTED_MARKET_TYPES = [
  "1X2",              // Match result
  "DOUBLE_CHANCE",    // Double chance
  "BTTS",             // Both teams to score
  "OVER_UNDER",       // Total goals over/under
  "CORRECT_SCORE",    // Correct score
  "HANDICAP",         // Handicap
  "HALF_TIME_1X2",    // Half time result
  "GOALSCORER",       // Goalscorer markets
] as const;

// ============ CLI Arguments ============
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose") || args.includes("-v");
const SHOW_RAW = args.includes("--raw") || args.includes("-r");
const SHOW_PROTO = args.includes("--proto") || args.includes("-p");
const MATCH_ID_ARG = args.find((_, i) => args[i - 1] === "--match" || args[i - 1] === "-m");
const URL_ARG = args.find((_, i) => args[i - 1] === "--url" || args[i - 1] === "-u");
const FILTER_ARG = args.find((_, i) => args[i - 1] === "--filter" || args[i - 1] === "-f");

// Default test match from the task description
const DEFAULT_MATCH_ID = "905675290968064";
const DEFAULT_MATCH_URL = "https://www.betclic.pl/pilka-nozna-sfootball/premier-league-c3/west-ham-sunderland-m905675290968064";

// ============ Analysis Types ============
interface MarketAnalysis {
  totalMarkets: number;
  byType: Map<string, ScrapedMarket[]>;
  byGroupName: Map<string, ScrapedMarket[]>;
  missingTypes: string[];
  suspiciousMarkets: ScrapedMarket[];
  allMarkets: ScrapedMarket[];
}

interface MatchInfo {
  matchId: string;
  matchName: string;
  homeTeam: string;
  awayTeam: string;
}

// ============ Main Functions ============

/**
 * Extract match info from raw protobuf data
 */
function extractMatchInfo(rawData: Buffer, matchId: string): MatchInfo {
  try {
    const root = parseFields(rawData);
    const wrapper = getMessage(root, PROTO_FIELDS.ROOT_WRAPPER);
    const matchInfo = wrapper ? getMessage(wrapper, PROTO_FIELDS.MATCH_ID) : null;
    const matchName = matchInfo ? getString(matchInfo, PROTO_FIELDS.MATCH_NAME) || "" : "";
    const parts = matchName.split(TEAM_SEPARATOR).map((t) => t.trim());

    return {
      matchId,
      matchName,
      homeTeam: parts[0] || "Unknown",
      awayTeam: parts[1] || "Unknown",
    };
  } catch {
    return {
      matchId,
      matchName: "Unknown",
      homeTeam: "Unknown",
      awayTeam: "Unknown",
    };
  }
}

/**
 * Analyze markets and group them by type and groupName
 */
function analyzeMarkets(markets: ScrapedMarket[]): MarketAnalysis {
  const byType = new Map<string, ScrapedMarket[]>();
  const byGroupName = new Map<string, ScrapedMarket[]>();
  const suspiciousMarkets: ScrapedMarket[] = [];

  for (const market of markets) {
    // Group by type
    const type = market.type || "UNKNOWN";
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type)!.push(market);

    // Group by groupName
    const groupName = market.groupName || "Other";
    if (!byGroupName.has(groupName)) {
      byGroupName.set(groupName, []);
    }
    byGroupName.get(groupName)!.push(market);

    // Check for suspicious markets
    if (type === "OTHER" || type === "UNKNOWN") {
      suspiciousMarkets.push(market);
    }
  }

  // Find missing expected types
  const foundTypes = new Set(byType.keys());
  const missingTypes = EXPECTED_MARKET_TYPES.filter((t) => !foundTypes.has(t));

  return {
    totalMarkets: markets.length,
    byType,
    byGroupName,
    missingTypes,
    suspiciousMarkets,
    allMarkets: markets,
  };
}

/**
 * Print raw protobuf structure for debugging
 */
function printRawStructure(rawData: Buffer): void {
  console.log("\n" + "=".repeat(100));
  console.log("RAW PROTOBUF STRUCTURE");
  console.log("=".repeat(100));

  try {
    const root = parseFields(rawData);
    console.log(`\nRoot fields: ${Array.from(root.keys()).join(", ")}`);

    const wrapper = getMessage(root, 1);
    if (wrapper) {
      console.log(`Wrapper (field 1) fields: ${Array.from(wrapper.keys()).join(", ")}`);

      // Field 2 contains market groups
      const marketGroupMsgs = wrapper.get(2) || [];
      console.log(`\nMarket groups (field 2): ${marketGroupMsgs.length} entries`);

      for (let i = 0; i < Math.min(marketGroupMsgs.length, 5); i++) {
        const msg = marketGroupMsgs[i];
        if (msg.type === "bytes" && Buffer.isBuffer(msg.data)) {
          const groupFields = parseFields(msg.data);
          const groupName = getString(groupFields, 2) || "(no name)";
          console.log(`  Group ${i + 1}: "${groupName}" - fields: ${Array.from(groupFields.keys()).join(", ")}`);
        }
      }

      if (marketGroupMsgs.length > 5) {
        console.log(`  ... and ${marketGroupMsgs.length - 5} more groups`);
      }
    }
  } catch (error) {
    console.error("Error parsing raw structure:", error);
  }
}

// ============ Proto Structure Analysis ============

/** Maximum values to show per field to avoid spam */
const MAX_VALUES_PER_FIELD = 3;

/** Minimum bytes length to attempt recursive parsing */
const MIN_BYTES_FOR_NESTED = 10;

/**
 * Get wire type name from wire type number
 */
function getWireTypeName(wireType: number): string {
  switch (wireType) {
    case 0: return "varint";
    case 1: return "double (64-bit)";
    case 2: return "bytes/string/message";
    case 5: return "float (32-bit)";
    default: return `unknown(${wireType})`;
  }
}

/**
 * Try to decode bytes as UTF-8 string
 * Returns the string if readable, null otherwise
 */
function tryDecodeAsString(buf: Buffer): string | null {
  try {
    const str = buf.toString("utf8");
    // Check if string contains mostly printable characters
    const printableCount = str.split("").filter(c => {
      const code = c.charCodeAt(0);
      return (code >= 0x20 && code <= 0x7E) || // ASCII printable
             (code >= 0xA0 && code <= 0xFF) || // Latin-1 supplement
             (code >= 0x100 && code <= 0xFFFF); // Extended Unicode
    }).length;
    
    // Consider it readable if >70% printable and length > 0
    if (str.length > 0 && printableCount / str.length > 0.7) {
      return str;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if bytes buffer looks like a nested protobuf message
 */
function looksLikeNestedMessage(buf: Buffer): boolean {
  if (buf.length < MIN_BYTES_FOR_NESTED) return false;
  
  // Try to parse as protobuf - if it has valid fields, it's likely a message
  try {
    const fields = parseFields(buf);
    // If we got at least one field and didn't consume all bytes as garbage, it's likely valid
    return fields.size > 0;
  } catch {
    return false;
  }
}

/**
 * Format a value for display based on its type
 */
function formatValue(type: string, data: unknown, maxLen: number = 50): string {
  if (type === "varint" && typeof data === "number") {
    return `${data}`;
  }
  if (type === "double" && typeof data === "number") {
    return `${data.toFixed(4)}`;
  }
  if (type === "float" && typeof data === "number") {
    return `${data.toFixed(4)}`;
  }
  if (type === "bytes" && Buffer.isBuffer(data)) {
    const str = tryDecodeAsString(data);
    if (str) {
      const truncated = str.length > maxLen ? str.substring(0, maxLen) + "..." : str;
      return `"${truncated}" (${data.length} bytes, string)`;
    }
    if (looksLikeNestedMessage(data)) {
      return `<nested message> (${data.length} bytes)`;
    }
    // Show hex preview for binary data
    const hexPreview = data.slice(0, 16).toString("hex");
    return `[${hexPreview}${data.length > 16 ? "..." : ""}] (${data.length} bytes, binary)`;
  }
  return String(data);
}

interface ProtoFieldInfo {
  fieldNum: number;
  wireType: number;
  values: Array<{ type: string; data: unknown }>;
}

/**
 * Parse buffer and extract field information with wire types
 */
function extractFieldInfo(buf: Buffer): ProtoFieldInfo[] {
  const fieldMap = new Map<number, ProtoFieldInfo>();
  let offset = 0;

  while (offset < buf.length) {
    // Read tag
    let tag = 0;
    let shift = 0;
    let bytesRead = 0;
    
    while (offset + bytesRead < buf.length) {
      const b = buf[offset + bytesRead++];
      tag |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    
    if (bytesRead === 0) break;
    offset += bytesRead;

    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;

    let value: { type: string; data: unknown } | null = null;

    if (wireType === 0) {
      // Varint
      let v = 0;
      shift = 0;
      bytesRead = 0;
      while (offset + bytesRead < buf.length) {
        const b = buf[offset + bytesRead++];
        v |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      offset += bytesRead;
      value = { type: "varint", data: v };
    } else if (wireType === 2) {
      // Length-delimited
      let len = 0;
      shift = 0;
      bytesRead = 0;
      while (offset + bytesRead < buf.length) {
        const b = buf[offset + bytesRead++];
        len |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      offset += bytesRead;
      if (offset + len > buf.length) break;
      const data = buf.slice(offset, offset + len);
      offset += len;
      value = { type: "bytes", data };
    } else if (wireType === 5) {
      // 32-bit float
      if (offset + 4 > buf.length) break;
      value = { type: "float", data: buf.readFloatLE(offset) };
      offset += 4;
    } else if (wireType === 1) {
      // 64-bit double
      if (offset + 8 > buf.length) break;
      value = { type: "double", data: buf.readDoubleLE(offset) };
      offset += 8;
    } else {
      // Unknown wire type
      break;
    }

    if (value) {
      if (!fieldMap.has(fieldNum)) {
        fieldMap.set(fieldNum, { fieldNum, wireType, values: [] });
      }
      fieldMap.get(fieldNum)!.values.push(value);
    }
  }

  return Array.from(fieldMap.values()).sort((a, b) => a.fieldNum - b.fieldNum);
}

/**
 * Recursively print protobuf structure with indentation
 */
function printProtoStructureRecursive(buf: Buffer, indent: number = 0, maxDepth: number = 5): void {
  if (indent > maxDepth) {
    console.log(`${"  ".repeat(indent)}... (max depth reached)`);
    return;
  }

  const fields = extractFieldInfo(buf);
  const prefix = "  ".repeat(indent);

  for (const field of fields) {
    const wireTypeName = getWireTypeName(field.wireType);
    const valueCount = field.values.length;
    const showCount = Math.min(valueCount, MAX_VALUES_PER_FIELD);

    console.log(`${prefix}Field ${field.fieldNum} [${wireTypeName}] (${valueCount} value${valueCount !== 1 ? "s" : ""}):`);

    for (let i = 0; i < showCount; i++) {
      const val = field.values[i];
      const formatted = formatValue(val.type, val.data);
      console.log(`${prefix}  [${i}] ${formatted}`);

      // Recursively parse nested messages
      if (val.type === "bytes" && Buffer.isBuffer(val.data) && looksLikeNestedMessage(val.data)) {
        printProtoStructureRecursive(val.data, indent + 2, maxDepth);
      }
    }

    if (valueCount > MAX_VALUES_PER_FIELD) {
      console.log(`${prefix}  ... and ${valueCount - MAX_VALUES_PER_FIELD} more values`);
    }
  }
}

/**
 * Print comprehensive protobuf structure analysis
 */
function printProtoStructure(rawData: Buffer): void {
  console.log("\n" + "=".repeat(100));
  console.log("PROTOBUF STRUCTURE ANALYSIS");
  console.log("=".repeat(100));

  console.log(`\nResponse size: ${rawData.length} bytes`);
  console.log(`\n${"─".repeat(80)}`);
  console.log("FIELD STRUCTURE (recursive):");
  console.log(`${"─".repeat(80)}\n`);

  try {
    printProtoStructureRecursive(rawData, 0, 5);
  } catch (error) {
    console.error("\nError parsing protobuf structure:", error);
  }

  console.log(`\n${"─".repeat(80)}`);
  console.log("LEGEND:");
  console.log(`${"─".repeat(80)}`);
  console.log("  varint          - Variable-length integer (field numbers, IDs, counts)");
  console.log("  double (64-bit) - 64-bit floating point (odds values)");
  console.log("  float (32-bit)  - 32-bit floating point");
  console.log("  bytes/string/message - Length-delimited data (strings or nested messages)");
  console.log("  <nested message> - Bytes that parse as valid protobuf (recursively shown)");
  console.log("  (string)        - Bytes that decode as readable UTF-8 text");
  console.log("  (binary)        - Bytes that don't decode as text (shown as hex)");
}

/**
 * Print analysis summary
 */
function printSummary(analysis: MarketAnalysis, matchInfo: MatchInfo): void {
  console.log("\n" + "=".repeat(100));
  console.log("BETCLIC MARKET DISCOVERY - ANALYSIS SUMMARY");
  console.log("=".repeat(100));

  console.log(`\nMatch: ${matchInfo.matchName}`);
  console.log(`Match ID: ${matchInfo.matchId}`);
  console.log(`Home Team: ${matchInfo.homeTeam}`);
  console.log(`Away Team: ${matchInfo.awayTeam}`);

  console.log("\n" + "-".repeat(100));
  console.log(`TOTAL MARKETS: ${analysis.totalMarkets}`);
  console.log("-".repeat(100));

  // Markets by type
  console.log("\n" + "=".repeat(100));
  console.log("MARKETS BY TYPE");
  console.log("=".repeat(100));

  const sortedTypes = Array.from(analysis.byType.entries()).sort((a, b) => b[1].length - a[1].length);

  console.log(`\n${"Type".padEnd(25)} ${"Count".padEnd(8)} ${"Sample Markets"}`);
  console.log(`${"─".repeat(25)} ${"─".repeat(8)} ${"─".repeat(60)}`);

  for (const [type, markets] of sortedTypes) {
    const isExpected = EXPECTED_MARKET_TYPES.includes(type as typeof EXPECTED_MARKET_TYPES[number]);
    const isSuspicious = type === "OTHER" || type === "UNKNOWN";
    const prefix = isSuspicious ? "⚠️ " : isExpected ? "✅ " : "   ";

    const sampleNames = markets
      .slice(0, 2)
      .map((m) => m.name.substring(0, 25))
      .join(", ");

    console.log(`${prefix}${type.padEnd(22)} ${String(markets.length).padEnd(8)} ${sampleNames}`);
  }

  // Markets by groupName
  console.log("\n" + "=".repeat(100));
  console.log("MARKETS BY GROUP NAME");
  console.log("=".repeat(100));

  const sortedGroups = Array.from(analysis.byGroupName.entries()).sort((a, b) => b[1].length - a[1].length);

  console.log(`\n${"Group Name".padEnd(35)} ${"Count".padEnd(8)} ${"Types"}`);
  console.log(`${"─".repeat(35)} ${"─".repeat(8)} ${"─".repeat(50)}`);

  for (const [groupName, markets] of sortedGroups) {
    const types = [...new Set(markets.map((m) => m.type))].slice(0, 3).join(", ");
    console.log(`${groupName.substring(0, 34).padEnd(35)} ${String(markets.length).padEnd(8)} ${types}`);
  }

  // Missing expected types
  if (analysis.missingTypes.length > 0) {
    console.log("\n" + "=".repeat(100));
    console.log("MISSING EXPECTED MARKET TYPES");
    console.log("=".repeat(100));

    for (const type of analysis.missingTypes) {
      console.log(`  ❌ ${type}`);
    }
  } else {
    console.log("\n✅ All expected market types found!");
  }

  // Suspicious markets
  if (analysis.suspiciousMarkets.length > 0) {
    console.log("\n" + "=".repeat(100));
    console.log(`SUSPICIOUS MARKETS (type=OTHER or UNKNOWN): ${analysis.suspiciousMarkets.length}`);
    console.log("=".repeat(100));

    const maxToShow = VERBOSE ? analysis.suspiciousMarkets.length : 10;

    for (const market of analysis.suspiciousMarkets.slice(0, maxToShow)) {
      console.log(`\n  ⚠️  "${market.name}"`);
      console.log(`      Group: ${market.groupName}`);
      console.log(`      Type: ${market.type}`);
      console.log(`      Selections: ${market.selections.length}`);

      if (VERBOSE) {
        for (const sel of market.selections.slice(0, 5)) {
          console.log(`        - ${sel.name}: ${sel.odds.toFixed(2)}`);
        }
        if (market.selections.length > 5) {
          console.log(`        ... and ${market.selections.length - 5} more`);
        }
      }
    }

    if (!VERBOSE && analysis.suspiciousMarkets.length > maxToShow) {
      console.log(`\n  ... and ${analysis.suspiciousMarkets.length - maxToShow} more suspicious markets`);
      console.log("  Use --verbose to see all");
    }
  }
}

function printDetailedMarkets(analysis: MarketAnalysis): void {
  console.log("\n" + "=".repeat(100));
  console.log("DETAILED MARKET LIST");
  console.log("=".repeat(100));

  for (const market of analysis.allMarkets) {
    console.log(`\n${"─".repeat(80)}`);
    console.log(`Market: ${market.name}`);
    console.log(`  Type: ${market.type}`);
    console.log(`  Group: ${market.groupName}`);
    console.log(`  Selections (${market.selections.length}):`);

    for (const sel of market.selections.slice(0, 10)) {
      console.log(`    - ${sel.name.padEnd(30)} ${sel.odds.toFixed(2)}`);
    }

    if (market.selections.length > 10) {
      console.log(`    ... and ${market.selections.length - 10} more selections`);
    }
  }
}

// ============ Filter Testing Mode ============

function buildMatchDetailsRequestWithFilter(matchId: string, filterValue: number): Buffer {
  // Field 1 (match ID): tag 0x08 = field 1, wire type 0 (varint)
  const matchIdBytes = [0x08, ...encodeBigVarint(BigInt(matchId))];
  // Field 2 (filter): tag 0x10 = field 2, wire type 0 (varint)
  const filterBytes = [0x10, ...encodeVarint(filterValue)];
  return Buffer.from([...matchIdBytes, ...filterBytes]);
}

async function fetchMatchDetailsWithFilter(matchId: string, filterValue: number): Promise<Buffer | null> {
  try {
    console.log(`[Filter] Fetching match ${matchId} with Field 2 = ${filterValue}...`);
    const requestBody = buildMatchDetailsRequestWithFilter(matchId, filterValue);
    const response = await fetchGrpcStream(ENDPOINTS.match, requestBody);
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Filter] Request failed: ${errorMessage}`);
    return null;
  }
}

interface FilterTestResult {
  filterValue: number;
  responseSize: number;
  marketCount: number;
  marketGroups: string[];
  error?: string;
}

async function runFilterTest(matchId: string, filterValue: number): Promise<FilterTestResult> {
  const result: FilterTestResult = {
    filterValue,
    responseSize: 0,
    marketCount: 0,
    marketGroups: [],
  };

  try {
    const rawData = await fetchMatchDetailsWithFilter(matchId, filterValue);

    if (!rawData) {
      result.error = "No response received";
      return result;
    }

    result.responseSize = rawData.length;

    if (rawData.length < 100) {
      result.error = "Response too small (< 100 bytes)";
      return result;
    }

    const markets = parseAllMarketsFromProto(rawData);
    result.marketCount = markets.length;

    const groupSet = new Set<string>();
    for (const market of markets) {
      if (market.groupName) {
        groupSet.add(market.groupName);
      }
    }
    result.marketGroups = Array.from(groupSet).sort();

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}

function printFilterTestResult(result: FilterTestResult, baselineResult?: FilterTestResult): void {
  console.log(`\n${"─".repeat(80)}`);
  console.log(`FILTER VALUE: ${result.filterValue}`);
  console.log(`${"─".repeat(80)}`);

  if (result.error) {
    console.log(`  ❌ Error: ${result.error}`);
    return;
  }

  console.log(`  Response size: ${result.responseSize} bytes`);
  console.log(`  Markets parsed: ${result.marketCount}`);
  console.log(`  Market groups (${result.marketGroups.length}):`);

  for (const group of result.marketGroups) {
    console.log(`    - ${group}`);
  }

  if (baselineResult && !baselineResult.error) {
    const sizeDiff = result.responseSize - baselineResult.responseSize;
    const marketDiff = result.marketCount - baselineResult.marketCount;
    const sizeDiffStr = sizeDiff >= 0 ? `+${sizeDiff}` : `${sizeDiff}`;
    const marketDiffStr = marketDiff >= 0 ? `+${marketDiff}` : `${marketDiff}`;

    console.log(`\n  Comparison to baseline (no filter):`);
    console.log(`    Size diff: ${sizeDiffStr} bytes (${((sizeDiff / baselineResult.responseSize) * 100).toFixed(1)}%)`);
    console.log(`    Market diff: ${marketDiffStr} markets`);

    const newGroups = result.marketGroups.filter((g) => !baselineResult.marketGroups.includes(g));
    const missingGroups = baselineResult.marketGroups.filter((g) => !result.marketGroups.includes(g));

    if (newGroups.length > 0) {
      console.log(`    New groups: ${newGroups.join(", ")}`);
    }
    if (missingGroups.length > 0) {
      console.log(`    Missing groups: ${missingGroups.join(", ")}`);
    }
  }
}

async function runFilterTestMode(matchId: string, filterValue: number): Promise<void> {
  console.log("\n" + "=".repeat(100));
  console.log("BETCLIC FILTER TESTING MODE");
  console.log("=".repeat(100));
  console.log(`\nMatch ID: ${matchId}`);
  console.log(`Testing Field 2 with value: ${filterValue}`);

  console.log("\n" + "=".repeat(100));
  console.log("FETCHING BASELINE (no filter)");
  console.log("=".repeat(100));

  const baselineData = await fetchMatchDetails(matchId);
  let baselineResult: FilterTestResult | undefined;

  if (baselineData) {
    const markets = parseAllMarketsFromProto(baselineData);
    const groupSet = new Set<string>();
    for (const market of markets) {
      if (market.groupName) {
        groupSet.add(market.groupName);
      }
    }

    baselineResult = {
      filterValue: -1,
      responseSize: baselineData.length,
      marketCount: markets.length,
      marketGroups: Array.from(groupSet).sort(),
    };

    console.log(`\n  Baseline response size: ${baselineResult.responseSize} bytes`);
    console.log(`  Baseline markets: ${baselineResult.marketCount}`);
    console.log(`  Baseline groups (${baselineResult.marketGroups.length}):`);
    for (const group of baselineResult.marketGroups) {
      console.log(`    - ${group}`);
    }
  } else {
    console.log("\n  ⚠️  Could not fetch baseline (no filter) - comparison will be skipped");
  }

  console.log("\n" + "=".repeat(100));
  console.log(`TESTING FILTER VALUE: ${filterValue}`);
  console.log("=".repeat(100));

  const result = await runFilterTest(matchId, filterValue);
  printFilterTestResult(result, baselineResult);

  console.log("\n" + "=".repeat(100));
  console.log("SUMMARY");
  console.log("=".repeat(100));

  if (result.error) {
    console.log(`\n❌ Filter test failed: ${result.error}`);
  } else if (baselineResult) {
    const sizeDiff = result.responseSize - baselineResult.responseSize;
    const marketDiff = result.marketCount - baselineResult.marketCount;

    if (sizeDiff === 0 && marketDiff === 0) {
      console.log(`\n⚠️  Filter value ${filterValue} produced identical results to baseline`);
      console.log("   This filter value may not affect the response");
    } else {
      console.log(`\n✅ Filter value ${filterValue} produced different results:`);
      console.log(`   Response size: ${result.responseSize} bytes (${sizeDiff >= 0 ? "+" : ""}${sizeDiff})`);
      console.log(`   Markets: ${result.marketCount} (${marketDiff >= 0 ? "+" : ""}${marketDiff})`);
    }
  } else {
    console.log(`\n✅ Filter test completed:`);
    console.log(`   Response size: ${result.responseSize} bytes`);
    console.log(`   Markets: ${result.marketCount}`);
  }

  console.log("\n" + "=".repeat(100));
  console.log("TIPS");
  console.log("=".repeat(100));
  console.log(`
  Try different filter values to discover market group filters:
    --filter 0    Test filter value 0
    --filter 1    Test filter value 1
    --filter 5    Test filter value 5
    ...

  Combine with other flags:
    --filter 5 --proto    Show protobuf structure of filtered response
    --filter 5 --verbose  Show detailed market information
  `);
}

// ============ Main Entry Point ============

async function main(): Promise<void> {
  console.log("\n" + "=".repeat(100));
  console.log("BETCLIC MARKET DISCOVERY SCRIPT");
  console.log("=".repeat(100));

  let matchId: string;

  if (MATCH_ID_ARG) {
    matchId = MATCH_ID_ARG;
    console.log(`\nUsing provided match ID: ${matchId}`);
  } else if (URL_ARG) {
    const extracted = extractMatchIdFromUrl(URL_ARG);
    if (!extracted) {
      console.error(`\n❌ Could not extract match ID from URL: ${URL_ARG}`);
      process.exit(1);
    }
    matchId = extracted;
    console.log(`\nExtracted match ID from URL: ${matchId}`);
  } else {
    matchId = DEFAULT_MATCH_ID;
    console.log(`\nUsing default test match ID: ${matchId}`);
    console.log(`URL: ${DEFAULT_MATCH_URL}`);
  }

  if (FILTER_ARG !== undefined) {
    const filterValue = parseInt(FILTER_ARG, 10);
    if (isNaN(filterValue) || filterValue < 0) {
      console.error(`\n❌ Invalid filter value: ${FILTER_ARG}`);
      console.error("   Filter value must be a non-negative integer");
      process.exit(1);
    }
    await runFilterTestMode(matchId, filterValue);
    return;
  }

  console.log("\nFetching match data from Betclic gRPC API...");

  const rawData = await fetchMatchDetails(matchId);

  if (!rawData) {
    console.error("\n❌ Failed to fetch match data");
    process.exit(1);
  }

  console.log(`✅ Received ${rawData.length} bytes of data`);

  if (SHOW_PROTO) {
    printProtoStructure(rawData);
    console.log("\n✅ Proto structure analysis complete");
    return;
  }

  if (SHOW_RAW) {
    printRawStructure(rawData);
  }

  const matchInfo = extractMatchInfo(rawData, matchId);

  console.log("\nParsing markets from protobuf data...");
  const markets = parseAllMarketsFromProto(rawData);
  console.log(`✅ Parsed ${markets.length} markets`);

  if (markets.length === 0) {
    console.error("\n❌ No markets found in response");
    console.log("\nThis could mean:");
    console.log("  - The match has ended or been cancelled");
    console.log("  - The match ID is invalid");
    console.log("  - The API response format has changed");
    console.log("\nTry using --proto to inspect the protobuf structure");
    process.exit(1);
  }

  const analysis = analyzeMarkets(markets);

  printSummary(analysis, matchInfo);

  if (VERBOSE) {
    printDetailedMarkets(analysis);
  }

  console.log("\n" + "=".repeat(100));
  console.log("TIPS");
  console.log("=".repeat(100));
  console.log(`
  --match <id>    Use specific match ID
  --url <url>     Extract match ID from Betclic URL
  --verbose       Show detailed market information
  --raw           Show raw protobuf structure (basic)
  --proto         Show detailed protobuf structure analysis
  --filter <n>    Test filter value (Field 2 = n) in request
  `);

  if (analysis.missingTypes.length > 0 || analysis.suspiciousMarkets.length > 0) {
    console.log("\n⚠️  Some issues found - review the analysis above");
  } else {
    console.log("\n✅ All checks passed!");
  }
}

main().catch((error) => {
  console.error("\n❌ Script failed:", error);
  process.exit(1);
});
