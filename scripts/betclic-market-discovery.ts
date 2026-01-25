#!/usr/bin/env npx tsx
/**
 * Betclic Market Discovery Script
 * 
 * Analyzes Betclic markets for normalization status.
 * Similar to sts-market-discovery.ts but uses gRPC API.
 * 
 * Usage:
 *   npx tsx scripts/betclic-market-discovery.ts                    # Scan all tabs
 *   npx tsx scripts/betclic-market-discovery.ts --market "Wynik meczu"  # Focus on specific market
 *   npx tsx scripts/betclic-market-discovery.ts --tab WYNIK        # Scan specific tab
 *   npx tsx scripts/betclic-market-discovery.ts --match 905675290968064  # Specific match ID
 *   npx tsx scripts/betclic-market-discovery.ts --all              # Show all details
 *   npx tsx scripts/betclic-market-discovery.ts --issues           # Show only markets with issues
 *   npx tsx scripts/betclic-market-discovery.ts --json             # Output as JSON for batch
 */

import {
  fetchGrpcStream,
  buildMatchDetailsRequest,
  buildMatchDetailsRequestWithFilter,
} from "../src/scrapers/bookmakers/betclic/navigation.js";
import { ENDPOINTS, MARKET_GROUP_FILTERS } from "../src/scrapers/bookmakers/betclic/constants.js";
import { betclicNormalizer } from "../src/services/normalization/bookmakers/betclic-normalizer.js";
import { getMarketByCode, type MarketCatalogEntry } from "../src/data/market-catalog.js";
import type { NormalizationContext, NormalizedMarketOutput } from "../src/services/normalization/types.js";
import { groupMarketsByTypeWithParameters } from "../src/services/market-type-grouper.js";
import type { ScrapedMarket, MarketSelection } from "../src/types/full-offer.js";

// ============================================================================
// TYPES
// ============================================================================

interface Selection {
  id: string;
  name: string;
  nameLong?: string;
  odds: number;
}

interface Market {
  id: string;
  name: string;
  nameLong?: string;
  selections: Selection[];
}

interface MarketGroup {
  id: string;
  name: string;
  markets: Market[];
}

interface Match {
  id: string;
  name: string;
  homeTeam: string;
  awayTeam: string;
}

interface MarketAnalysis {
  name: string;
  groupId: string;
  groupName: string;
  tabName: string;
  rawSelections: Selection[];
  normalized: NormalizedMarketOutput | null;
  catalogEntry?: MarketCatalogEntry;
  issues: string[];
}

interface FrontendMarketJson {
  marketKey: string;
  type: string;
  category: string;
  label: string;
  description: string;
  displayOrder: number;
  viewType: string;
  parameters: {
    value: string;
    label: string;
    bookmakers: {
      bookmaker: string;
      bookmakerName: string;
      selections: {
        type: string;
        odds: number;
        hasNoTaxPromo: boolean;
      }[];
    }[];
  }[];
  defaultParameter: string;
  hasParameters: boolean;
}

// ============================================================================
// PROTOBUF PARSING (simplified from betclic-grpc-to-clean-json.ts)
// ============================================================================

function readVarint(buf: Buffer, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < buf.length) {
    const b = buf[offset + bytesRead++];
    value |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return { value, bytesRead };
}

function readVarintBigInt(buf: Buffer, offset: number): { value: bigint; bytesRead: number } {
  let value = 0n;
  let shift = 0n;
  let bytesRead = 0;
  while (offset + bytesRead < buf.length) {
    const b = buf[offset + bytesRead++];
    value |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
  }
  return { value, bytesRead };
}

interface RawField {
  fieldNumber: number;
  wireType: number;
  value: number | bigint | string | Buffer | RawField[];
}

function parseProtobuf(buf: Buffer, depth: number = 0): RawField[] {
  const fields: RawField[] = [];
  let offset = 0;
  const maxDepth = 15;

  while (offset < buf.length) {
    const tagResult = readVarint(buf, offset);
    if (tagResult.bytesRead === 0) break;
    offset += tagResult.bytesRead;

    const fieldNumber = tagResult.value >> 3;
    const wireType = tagResult.value & 0x07;

    if (fieldNumber === 0 || fieldNumber > 536870911) break;

    let value: number | bigint | string | Buffer | RawField[];

    if (wireType === 0) {
      const result = readVarintBigInt(buf, offset);
      offset += result.bytesRead;
      value = result.value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result.value) : result.value;
    } else if (wireType === 1) {
      if (offset + 8 > buf.length) break;
      value = buf.readDoubleLE(offset);
      offset += 8;
    } else if (wireType === 2) {
      const lenResult = readVarint(buf, offset);
      offset += lenResult.bytesRead;
      const len = lenResult.value;
      if (offset + len > buf.length) break;
      const data = buf.slice(offset, offset + len);
      offset += len;

      const str = tryDecodeString(data);
      if (str !== null) {
        value = str;
      } else if (depth < maxDepth) {
        const nested = parseProtobuf(data, depth + 1);
        value = nested.length > 0 ? nested : data;
      } else {
        value = data;
      }
    } else if (wireType === 5) {
      if (offset + 4 > buf.length) break;
      value = buf.readFloatLE(offset);
      offset += 4;
    } else {
      break;
    }

    fields.push({ fieldNumber, wireType, value });
  }

  return fields;
}

function tryDecodeString(buf: Buffer): string | null {
  try {
    const str = buf.toString("utf8");
    if (/^[\x20-\x7E\xA0-\xFF\u0100-\uFFFF\s]+$/.test(str) && str.length > 0) {
      return str;
    }
    return null;
  } catch {
    return null;
  }
}

function getField(fields: RawField[], num: number): RawField | undefined {
  return fields.find(f => f.fieldNumber === num);
}

function getFieldValue<T>(fields: RawField[], num: number): T | undefined {
  const field = getField(fields, num);
  return field?.value as T | undefined;
}

function getAllFields(fields: RawField[], num: number): RawField[] {
  return fields.filter(f => f.fieldNumber === num);
}

// ============================================================================
// DATA EXTRACTION
// ============================================================================

function extractMatch(matchFields: RawField[]): Match {
  const id = String(getFieldValue<number | bigint>(matchFields, 1) || "");
  const name = getFieldValue<string>(matchFields, 2) || "";
  const [homeTeam, awayTeam] = name.split(" - ").map(s => s.trim());
  return { id, name, homeTeam: homeTeam || "", awayTeam: awayTeam || "" };
}

function extractSelection(selFields: RawField[]): Selection | null {
  const id = String(getFieldValue<number | bigint>(selFields, 1) || "");
  const name = getFieldValue<string>(selFields, 10) || "";
  const nameLong = getFieldValue<string>(selFields, 11);
  
  const oddsField = getField(selFields, 12);
  let odds = 0;
  if (oddsField?.wireType === 1) {
    odds = oddsField.value as number;
  }
  
  if (!name || odds <= 0 || odds > 1000) return null;
  odds = Math.round(odds * 100) / 100;
  
  return { id, name, nameLong: nameLong !== name ? nameLong : undefined, odds };
}

function extractMarket(marketFields: RawField[]): Market | null {
  const id = String(getFieldValue<number | bigint>(marketFields, 1) || "");
  const name = getFieldValue<string>(marketFields, 2) || "";
  const nameLong = getFieldValue<string>(marketFields, 3);
  
  if (!name) return null;
  
  const selections: Selection[] = [];
  
  // Strategy 1: Direct selections in Field 16 (TOP tab style)
  const directSelections = getAllFields(marketFields, 16);
  for (const selField of directSelections) {
    if (Array.isArray(selField.value)) {
      const sel = extractSelection(selField.value);
      if (sel) selections.push(sel);
    }
  }
  
  // Strategy 2: Nested selections in Field 10 (other tabs style)
  if (selections.length === 0) {
    const selectionGroups = getAllFields(marketFields, 10);
    for (const selGroup of selectionGroups) {
      if (Array.isArray(selGroup.value)) {
        for (const wrapper of selGroup.value) {
          if (wrapper.fieldNumber === 1 && Array.isArray(wrapper.value)) {
            for (const innerWrapper of wrapper.value) {
              if (innerWrapper.fieldNumber === 1 && Array.isArray(innerWrapper.value)) {
                const sel = extractSelection(innerWrapper.value);
                if (sel) selections.push(sel);
              }
            }
          }
        }
      }
    }
  }
  
  if (selections.length === 0) return null;
  
  return { id, name, nameLong: nameLong !== name ? nameLong : undefined, selections };
}

function extractMarketGroups(matchFields: RawField[]): MarketGroup[] {
  const groups: MarketGroup[] = [];
  const field11Entries = getAllFields(matchFields, 11);
  const ungroupedMarkets: Market[] = [];
  
  for (const entry of field11Entries) {
    if (!Array.isArray(entry.value)) continue;
    
    const groupId = getFieldValue<string>(entry.value, 1);
    const groupName = getFieldValue<string>(entry.value, 2);
    const marketFields = getAllFields(entry.value, 3);
    
    const hasGroupWrapper = typeof groupId === 'string' && typeof groupName === 'string' && groupName.length > 0;
    
    if (hasGroupWrapper) {
      const markets: Market[] = [];
      for (const marketField of marketFields) {
        if (Array.isArray(marketField.value)) {
          const market = extractMarket(marketField.value);
          if (market) markets.push(market);
        }
      }
      
      if (markets.length > 0) {
        groups.push({ id: groupId, name: groupName, markets });
      }
    } else {
      for (const marketField of marketFields) {
        if (Array.isArray(marketField.value)) {
          const market = extractMarket(marketField.value);
          if (market) ungroupedMarkets.push(market);
        }
      }
    }
  }
  
  if (ungroupedMarkets.length > 0) {
    groups.unshift({
      id: "top_markets",
      name: "Top zaklady",
      markets: ungroupedMarkets,
    });
  }
  
  return groups;
}

function parseResponse(buffer: Buffer): { match: Match; groups: MarketGroup[] } {
  const rootFields = parseProtobuf(buffer);
  const wrapperFields = getFieldValue<RawField[]>(rootFields, 1) || [];
  const matchFields = getFieldValue<RawField[]>(wrapperFields, 1) || [];
  
  const match = extractMatch(matchFields);
  const groups = extractMarketGroups(matchFields);
  
  return { match, groups };
}

// ============================================================================
// ANALYSIS
// ============================================================================

function analyzeMarket(
  market: Market,
  groupId: string,
  groupName: string,
  tabName: string,
  ctx: NormalizationContext
): MarketAnalysis {
  const issues: string[] = [];
  
  // Try to normalize
  const rawMarket = {
    name: market.name,
    bookmakerMarketId: market.id,
    selections: market.selections.map(s => ({
      name: s.name,
      odds: s.odds,
    })),
  };
  
  const normalized = betclicNormalizer.normalizeMarket(rawMarket, ctx);
  
  let catalogEntry: MarketCatalogEntry | undefined;
  if (normalized?.marketCode && normalized.marketCode !== "OTHER") {
    catalogEntry = getMarketByCode(normalized.marketCode);
  }
  
  // Check for issues
  if (!normalized) {
    issues.push("NORMALIZATION_FAILED: Market could not be normalized");
  } else if (normalized.marketCode === "OTHER") {
    issues.push("UNMAPPED: Market normalized to OTHER");
  }
  
  if (normalized?.selections) {
    const unknownSelections = normalized.selections.filter(
      s => s.code === "UNKNOWN" || /^\d+$/.test(s.code as string)
    );
    if (unknownSelections.length > 0) {
      const unknownList = unknownSelections.map(s => `"${s.label}" -> ${s.code}`).slice(0, 3);
      issues.push(`UNKNOWN_SELECTIONS: ${unknownList.join(", ")}${unknownSelections.length > 3 ? ` (+${unknownSelections.length - 3} more)` : ""}`);
    }
  }
  
  return {
    name: market.name,
    groupId,
    groupName,
    tabName,
    rawSelections: market.selections,
    normalized,
    catalogEntry,
    issues,
  };
}

/**
 * Pattern to match Over/Under selection names with line values
 * Matches: "Powyżej 2,5", "Poniżej 3,5", etc.
 */
const OVER_UNDER_SELECTION_PATTERN = /^(Powyżej|Poniżej)\s+(\d+[,\.]\d+)$/i;

/**
 * Split selections by line value for Over/Under markets
 * Returns a map of line -> selections for that line
 */
function splitSelectionsByLine(selections: Selection[]): Map<string, Selection[]> {
  const lineGroups = new Map<string, Selection[]>();
  
  for (const selection of selections) {
    const match = selection.name.match(OVER_UNDER_SELECTION_PATTERN);
    if (match) {
      // Normalize line: replace comma with dot (e.g., "2,5" -> "2.5")
      const line = match[2].replace(",", ".");
      if (!lineGroups.has(line)) {
        lineGroups.set(line, []);
      }
      lineGroups.get(line)!.push(selection);
    }
  }
  
  return lineGroups;
}

function buildFrontendJson(analysis: MarketAnalysis, ctx: NormalizationContext): FrontendMarketJson | null {
  if (!analysis.normalized) return null;
  
  // Check if this is an Over/Under market with multiple lines
  const lineGroups = splitSelectionsByLine(analysis.rawSelections);
  
  // If we have multiple lines, create separate markets for each line
  const marketsToGroup: Array<{ market: ScrapedMarket; bookmaker: string }> = [];
  
  if (lineGroups.size > 1) {
    // Multiple lines - create separate market for each line
    for (const [line, selections] of lineGroups) {
      // Only create market if we have both OVER and UNDER for this line
      const hasOver = selections.some(s => s.name.toLowerCase().includes("powyżej"));
      const hasUnder = selections.some(s => s.name.toLowerCase().includes("poniżej"));
      
      if (hasOver && hasUnder) {
        const scrapedMarket: ScrapedMarket = {
          name: analysis.name,
          groupName: analysis.groupName,
          type: "betclic",
          selections: selections.map(s => ({
            name: s.name,
            odds: s.odds,
            normalizedName: (analysis.normalized?.selections.find(ns => ns.label === s.name)?.code || undefined) as MarketSelection["normalizedName"],
          })),
          normalizedType: analysis.normalized.marketCode,
          marketKey: `${analysis.normalized.marketCode}:${line}`,
          paramValue: line,
        };
        marketsToGroup.push({ market: scrapedMarket, bookmaker: "betclic" });
      }
    }
  } else if (analysis.normalized.parameters && analysis.normalized.parameters.length > 0) {
    // Market with multiple parameters (e.g., ASIAN_HANDICAP_3WAY, player pairs)
    const isEuropeanHandicap = analysis.normalized.marketCode === "EUROPEAN_HANDICAP" ||
                           analysis.normalized.marketCode === "FIRST_HALF_EUROPEAN_HANDICAP" ||
                           analysis.normalized.marketCode === "SECOND_HALF_EUROPEAN_HANDICAP";

    const isPlayerMarket = analysis.normalized.marketCode === "TWO_PLAYERS_ANYTIME" ||
                          analysis.normalized.marketCode === "TWO_PLAYERS_COMBINED_GOALS" ||
                          analysis.normalized.marketCode === "THREE_PLAYERS_COMBINED_GOALS" ||
                          analysis.normalized.marketCode === "PLAYER_ASSIST_PAIRS" ||
                          analysis.normalized.marketCode === "PLAYER_ASSIST_TRIPLE";

    const paramGroups = new Map<string, Selection[]>();

    if (isPlayerMarket) {
      // Each selection (player pair) is a separate parameter
      for (const selection of analysis.rawSelections) {
        if (!paramGroups.has(selection.name)) {
          paramGroups.set(selection.name, []);
        }
        paramGroups.get(selection.name)!.push(selection);
      }
    } else if (isEuropeanHandicap) {
      for (const selection of analysis.rawSelections) {
        const match = selection.name.match(/([+-]?\d+[.,]?\d*)/);
        if (match) {
          const absValue = match[1].replace(/[+-]/g, "").replace(",", ".");
          const param = analysis.normalized.parameters.includes(absValue) ? absValue : `-${absValue}`;
          if (!paramGroups.has(param)) {
            paramGroups.set(param, []);
          }
          paramGroups.get(param)!.push(selection);
        }
      }
    } else {
      for (const selection of analysis.rawSelections) {
        const match = selection.name.match(/([+-]?\d+[.,]?\d*)/);
        if (match) {
          const param = match[1].replace(",", ".");
          if (!paramGroups.has(param)) {
            paramGroups.set(param, []);
          }
          paramGroups.get(param)!.push(selection);
        }
      }
    }

    for (const [param, selections] of paramGroups.entries()) {
      const scrapedMarket: ScrapedMarket = {
        name: analysis.name,
        groupName: analysis.groupName,
        type: "betclic",
        selections: selections.map(s => ({
          name: s.name,
          odds: s.odds,
          normalizedName: (analysis.normalized?.selections.find(ns => ns.label === s.name)?.code || undefined) as MarketSelection["normalizedName"],
        })),
        normalizedType: analysis.normalized.marketCode,
        marketKey: `${analysis.normalized.marketCode}:${param}`,
        paramValue: param,
      };
      marketsToGroup.push({ market: scrapedMarket, bookmaker: "betclic" });
    }
  } else {
    // Single line or no O/U pattern - use original market
    const scrapedMarket: ScrapedMarket = {
      name: analysis.name,
      groupName: analysis.groupName,
      type: "betclic",
      selections: analysis.rawSelections.map(s => ({
        name: s.name,
        odds: s.odds,
        normalizedName: (analysis.normalized?.selections.find(ns => ns.label === s.name)?.code || undefined) as MarketSelection["normalizedName"],
      })),
      normalizedType: analysis.normalized.marketCode,
      marketKey: analysis.normalized.marketKey,
      paramValue: analysis.normalized.paramValue,
    };
    marketsToGroup.push({ market: scrapedMarket, bookmaker: "betclic" });
  }
  
  if (marketsToGroup.length === 0) return null;
  
  const grouped = groupMarketsByTypeWithParameters(marketsToGroup);
  if (grouped.length === 0) return null;
  
  const result = grouped[0];
  
  return {
    marketKey: result.marketKey,
    type: result.type,
    category: result.category || "INNE",
    label: analysis.catalogEntry?.labels.pl || analysis.name,
    description: result.description || "",
    displayOrder: result.displayOrder || 999,
    viewType: result.viewType || "UNKNOWN",
    parameters: result.hasParameters ? result.parameters.map(p => ({
      value: p.value,
      label: p.label,
      bookmakers: p.bookmakers.map(bm => ({
        bookmaker: bm.bookmaker,
        bookmakerName: bm.bookmakerName,
        selections: bm.selections.map(sel => ({
          type: sel.type,
          odds: sel.odds,
          hasNoTaxPromo: sel.hasNoTaxPromo || false,
        })),
      })),
    })) : [],
    defaultParameter: result.hasParameters ? (result.defaultParameter || "base") : "",
    hasParameters: result.hasParameters || false,
  };
}

// ============================================================================
// OUTPUT
// ============================================================================

function printMarketDetail(analysis: MarketAnalysis, ctx: NormalizationContext): void {
  console.log(`\n${"─".repeat(100)}`);
  console.log(`📦 MARKET: ${analysis.name}`);
  console.log(`${"─".repeat(100)}`);
  
  console.log(`\n📋 TAB: ${analysis.tabName}`);
  console.log(`   Group: ${analysis.groupName} (${analysis.groupId})`);
  
  if (analysis.normalized) {
    console.log(`\n✅ NORMALIZED: ${analysis.normalized.marketCode}`);
    console.log(`   Market Key: ${analysis.normalized.marketKey || "N/A"}`);
    console.log(`   Param Value: ${analysis.normalized.paramValue || "none"}`);
    console.log(`   Matched By: ${analysis.normalized.debug?.matchedBy || "unknown"}`);
  } else {
    console.log(`\n❌ NOT NORMALIZED`);
  }
  
  if (analysis.catalogEntry) {
    console.log(`\n📚 CATALOG INFO:`);
    console.log(`   Code: ${analysis.catalogEntry.code}`);
    console.log(`   Polish: ${analysis.catalogEntry.labels.pl}`);
    console.log(`   ViewType: ${analysis.catalogEntry.viewType}`);
    console.log(`   Has Parameter: ${analysis.catalogEntry.hasParameter}`);
    console.log(`   Expected Selections: [${analysis.catalogEntry.selections.join(", ")}]`);
  }
  
  if (analysis.issues.length > 0) {
    console.log(`\n⚠️  ISSUES:`);
    for (const issue of analysis.issues) {
      console.log(`   - ${issue}`);
    }
  }
  
  console.log(`\n📊 RAW SELECTIONS (${analysis.rawSelections.length}):`);
  console.log(`   ${"Name".padEnd(35)} ${"Odds".padEnd(8)} ${"Normalized"}`);
  console.log(`   ${"─".repeat(35)} ${"─".repeat(8)} ${"─".repeat(20)}`);
  
  for (const sel of analysis.rawSelections) {
    const normalizedCode = analysis.normalized?.selections.find(s => s.label === sel.name)?.code || "?";
    console.log(`   ${sel.name.substring(0, 34).padEnd(35)} ${sel.odds.toFixed(2).padEnd(8)} ${normalizedCode}`);
  }
  
  // Frontend JSON
  const frontendJson = buildFrontendJson(analysis, ctx);
  if (frontendJson) {
    console.log(`\n📱 FRONTEND JSON (MarketWithParams format):`);
    console.log(JSON.stringify(frontendJson, null, 2));
  }
  
  // Raw JSON
  console.log(`\n🔧 RAW JSON:`);
  console.log(JSON.stringify({
    name: analysis.name,
    groupId: analysis.groupId,
    groupName: analysis.groupName,
    selections: analysis.rawSelections,
  }, null, 2));
}

function printSummary(analyses: MarketAnalysis[]): void {
  const mapped = analyses.filter(a => a.normalized && a.normalized.marketCode !== "OTHER");
  const unmapped = analyses.filter(a => !a.normalized || a.normalized.marketCode === "OTHER");
  const withIssues = analyses.filter(a => a.issues.length > 0);
  
  console.log("\n" + "=".repeat(100));
  console.log(`📊 SUMMARY`);
  console.log("=".repeat(100));
  console.log(`Total markets: ${analyses.length}`);
  console.log(`✅ Mapped: ${mapped.length}`);
  console.log(`❌ Unmapped/OTHER: ${unmapped.length}`);
  console.log(`⚠️  With issues: ${withIssues.length}`);
  
  if (mapped.length > 0) {
    console.log("\n" + "=".repeat(100));
    console.log(`✅ MAPPED MARKETS (${mapped.length})`);
    console.log("=".repeat(100));
    console.log(`${"Name".padEnd(40)} ${"→".padEnd(3)} ${"Code".padEnd(25)} ${"ViewType".padEnd(18)} ${"Issues"}`);
    console.log(`${"─".repeat(40)} ${"─".repeat(3)} ${"─".repeat(25)} ${"─".repeat(18)} ${"─".repeat(8)}`);
    
    for (const a of mapped) {
      const viewType = a.catalogEntry?.viewType || "N/A";
      const issueFlag = a.issues.length > 0 ? `⚠️ ${a.issues.length}` : "";
      console.log(`${a.name.substring(0, 39).padEnd(40)} → ${(a.normalized?.marketCode || "").padEnd(25)} ${String(viewType).substring(0, 17).padEnd(18)} ${issueFlag}`);
    }
  }
  
  if (unmapped.length > 0) {
    console.log("\n" + "=".repeat(100));
    console.log(`❌ UNMAPPED MARKETS (${unmapped.length}) - Add to betclic-normalizer.ts`);
    console.log("=".repeat(100));
    
    for (const a of unmapped) {
      const sampleSels = a.rawSelections.slice(0, 3).map(s => s.name).join(", ");
      console.log(`   ${a.name.padEnd(40)} [${sampleSels}]`);
    }
    
    console.log("\n📋 Suggested additions to BETCLIC_MARKET_NAME_TO_CODE:");
    for (const a of unmapped) {
      const normalized = a.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
      console.log(`  "${normalized}": "OTHER", // ${a.name}`);
    }
  }
  
  if (withIssues.length > 0) {
    console.log("\n" + "=".repeat(100));
    console.log(`⚠️  MARKETS WITH ISSUES (${withIssues.length})`);
    console.log("=".repeat(100));
    
    for (const a of withIssues) {
      console.log(`\n${a.name} → ${a.normalized?.marketCode || "UNMAPPED"}`);
      for (const issue of a.issues) {
        console.log(`   ⚠️  ${issue}`);
      }
    }
  }
}

function outputBatchJson(analyses: MarketAnalysis[]): void {
  const unmapped = analyses.filter(a => !a.normalized || a.normalized.marketCode === "OTHER" || a.issues.length > 0);
  
  const prompts = unmapped.map((a, i) => ({
    id: `betclic-market-${i + 1}`,
    title: `Normalize: ${a.name}`,
    text: `Normalize Betclic market "${a.name}" from group "${a.groupName}" (${a.groupId}).

Raw selections:
${a.rawSelections.map(s => `- "${s.name}" (odds: ${s.odds})`).join("\n")}

Current normalization: ${a.normalized?.marketCode || "NONE"}
Issues: ${a.issues.join(", ") || "none"}

Use @betclic-normalizer to fix this market normalization.`,
  }));
  
  console.log(JSON.stringify({
    prompts,
    options: {
      continueOnError: true,
      defaultAgent: "betclic-sequence-executor",
    },
  }, null, 2));
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  let matchId = "905675290968064"; // Default match ID
  let specificMarket: string | null = null;
  let specificTab: string | null = null;
  let showAll = false;
  let showIssues = false;
  let outputJson = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--match" && args[i + 1]) {
      matchId = args[i + 1];
      i++;
    } else if (args[i] === "--market" && args[i + 1]) {
      specificMarket = args[i + 1];
      i++;
    } else if (args[i] === "--tab" && args[i + 1]) {
      specificTab = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === "--all") {
      showAll = true;
    } else if (args[i] === "--issues") {
      showIssues = true;
    } else if (args[i] === "--json") {
      outputJson = true;
    }
  }
  
  if (!outputJson) {
    console.log("=".repeat(100));
    console.log("🔍 BETCLIC MARKET DISCOVERY");
    console.log("=".repeat(100));
    console.log(`Match ID: ${matchId}`);
    if (specificMarket) console.log(`🎯 Focusing on: "${specificMarket}"`);
    if (specificTab) console.log(`📁 Tab filter: ${specificTab}`);
    console.log();
  }
  
  const allAnalyses: MarketAnalysis[] = [];
  let match: Match | null = null;
  
  const tabsToFetch = specificTab 
    ? { [specificTab]: MARKET_GROUP_FILTERS[specificTab as keyof typeof MARKET_GROUP_FILTERS] }
    : MARKET_GROUP_FILTERS;
  
  const tabEntries = Object.entries(tabsToFetch);
  
  if (!outputJson) {
    console.log(`Fetching ${tabEntries.length} tabs in parallel...`);
  }
  
  const fetchPromises = tabEntries.map(async ([tabName, categoryId]) => {
    try {
      const requestBody = categoryId
        ? buildMatchDetailsRequestWithFilter(matchId, categoryId)
        : buildMatchDetailsRequest(matchId);
      
      const response = await fetchGrpcStream(ENDPOINTS.match, requestBody);
      const { match: m, groups } = parseResponse(response);
      
      return { tabName, match: m, groups, error: null };
    } catch (error) {
      return { tabName, match: null, groups: [], error };
    }
  });
  
  const results = await Promise.all(fetchPromises);
  
  for (const { tabName, match: m, groups, error } of results) {
    if (error) {
      if (!outputJson) {
        console.log(`  ${tabName}: ✗ Error: ${error instanceof Error ? error.message : error}`);
      }
      continue;
    }
    
    if (!match && m) {
      match = m;
    }
    
    const ctx: NormalizationContext = {
      homeTeam: match?.homeTeam || "",
      awayTeam: match?.awayTeam || "",
    };
    
    for (const group of groups) {
      for (const market of group.markets) {
        if (specificMarket && !market.name.toLowerCase().includes(specificMarket.toLowerCase())) {
          continue;
        }
        
        const analysis = analyzeMarket(market, group.id, group.name, tabName, ctx);
        allAnalyses.push(analysis);
      }
    }
    
    if (!outputJson) {
      console.log(`  ${tabName}: ✓ ${groups.reduce((sum, g) => sum + g.markets.length, 0)} markets`);
    }
  }
  
  // Deduplicate markets by name - same market may appear in multiple tabs
  const uniqueMarkets = new Map<string, MarketAnalysis>();
  for (const analysis of allAnalyses) {
    const key = `${analysis.name}:${analysis.normalized?.marketCode || 'UNMAPPED'}`;
    if (!uniqueMarkets.has(key)) {
      uniqueMarkets.set(key, analysis);
    }
  }
  const dedupedAnalyses = Array.from(uniqueMarkets.values());
  
  if (outputJson) {
    outputBatchJson(dedupedAnalyses);
    return;
  }
  
  if (!match) {
    console.error("Failed to fetch match data");
    process.exit(1);
  }
  
  console.log();
  console.log("=".repeat(100));
  console.log(`🏆 MATCH: ${match.name}`);
  console.log("=".repeat(100));
  
  const ctx: NormalizationContext = {
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };
  
  if (specificMarket) {
    // Show details for specific market(s)
    for (const analysis of dedupedAnalyses) {
      printMarketDetail(analysis, ctx);
    }
  } else if (showAll) {
    // Show all market details
    for (const analysis of dedupedAnalyses) {
      printMarketDetail(analysis, ctx);
    }
    printSummary(dedupedAnalyses);
  } else if (showIssues) {
    // Show only markets with issues
    const withIssues = dedupedAnalyses.filter(a => a.issues.length > 0);
    for (const analysis of withIssues) {
      printMarketDetail(analysis, ctx);
    }
    printSummary(dedupedAnalyses);
  } else if (specificMarket) {
    // Show specific market
    const targetAnalysis = dedupedAnalyses.find(a => 
      a.name.toLowerCase() === specificMarket!.toLowerCase()
    );
    
    if (targetAnalysis) {
      printMarketDetail(targetAnalysis, ctx);
    }
  } else {
    // Default: show summary only
    printSummary(dedupedAnalyses);
  }
  
  if (!specificMarket && !showAll && !showIssues) {
    console.log(`\n💡 Tips:`);
    console.log(`   --market "<name>"  Focus on specific market`);
    console.log(`   --tab WYNIK        Filter by tab`);
    console.log(`   --all              Show full details for ALL markets`);
    console.log(`   --issues           Show details for markets with issues`);
    console.log(`   --json             Output batch prompts JSON`);
  }
}

main().catch(console.error);
