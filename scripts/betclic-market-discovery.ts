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
 *   npx tsx scripts/betclic-market-discovery.ts --raw                     # Show raw protobuf structure
 */

import { fetchMatchDetails, extractMatchIdFromUrl } from "../src/scrapers/bookmakers/betclic/navigation.js";
import { parseAllMarketsFromProto, parseFields, getMessage, getString } from "../src/scrapers/bookmakers/betclic/parser.js";
import { MARKET_TYPES, MARKET_GROUPS, PROTO_FIELDS, TEAM_SEPARATOR } from "../src/scrapers/bookmakers/betclic/constants.js";
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
const MATCH_ID_ARG = args.find((_, i) => args[i - 1] === "--match" || args[i - 1] === "-m");
const URL_ARG = args.find((_, i) => args[i - 1] === "--url" || args[i - 1] === "-u");

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

/**
 * Print detailed market information (verbose mode)
 */
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

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log("\n" + "=".repeat(100));
  console.log("BETCLIC MARKET DISCOVERY SCRIPT");
  console.log("=".repeat(100));

  // Determine match ID
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

  // Fetch match data
  console.log("\nFetching match data from Betclic gRPC API...");

  const rawData = await fetchMatchDetails(matchId);

  if (!rawData) {
    console.error("\n❌ Failed to fetch match data");
    process.exit(1);
  }

  console.log(`✅ Received ${rawData.length} bytes of data`);

  // Show raw structure if requested
  if (SHOW_RAW) {
    printRawStructure(rawData);
  }

  // Extract match info
  const matchInfo = extractMatchInfo(rawData, matchId);

  // Parse markets
  console.log("\nParsing markets from protobuf data...");
  const markets = parseAllMarketsFromProto(rawData);
  console.log(`✅ Parsed ${markets.length} markets`);

  if (markets.length === 0) {
    console.error("\n❌ No markets found in response");
    console.log("\nThis could mean:");
    console.log("  - The match has ended or been cancelled");
    console.log("  - The match ID is invalid");
    console.log("  - The API response format has changed");
    console.log("\nTry using --raw to inspect the protobuf structure");
    process.exit(1);
  }

  // Analyze markets
  const analysis = analyzeMarkets(markets);

  // Print summary
  printSummary(analysis, matchInfo);

  // Print detailed markets if verbose
  if (VERBOSE) {
    printDetailedMarkets(analysis);
  }

  // Print tips
  console.log("\n" + "=".repeat(100));
  console.log("TIPS");
  console.log("=".repeat(100));
  console.log(`
  --match <id>    Use specific match ID
  --url <url>     Extract match ID from Betclic URL
  --verbose       Show detailed market information
  --raw           Show raw protobuf structure
  `);

  // Exit with appropriate code
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
