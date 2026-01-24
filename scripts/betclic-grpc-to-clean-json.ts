#!/usr/bin/env npx tsx
/**
 * Betclic gRPC to Clean JSON
 * 
 * Converts raw protobuf to human-readable structured JSON.
 * 
 * Usage:
 *   npx tsx scripts/betclic-grpc-to-clean-json.ts --match 905675290968064
 *   npx tsx scripts/betclic-grpc-to-clean-json.ts --match 905675290968064 --tab HANDICAP
 *   npx tsx scripts/betclic-grpc-to-clean-json.ts --match 905675290968064 --all
 */

import * as fs from "fs";
import * as path from "path";
import {
  fetchGrpcStream,
  buildMatchDetailsRequest,
  buildMatchDetailsRequestWithFilter,
} from "../src/scrapers/bookmakers/betclic/navigation.js";
import { ENDPOINTS, MARKET_GROUP_FILTERS } from "../src/scrapers/bookmakers/betclic/constants.js";

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

interface Tab {
  id: string;
  name: string;
}

interface Competition {
  id: number;
  name: string;
  sport: string;
}

interface Match {
  id: string;
  name: string;
  homeTeam: string;
  awayTeam: string;
  datetime: string;
  competition: Competition;
}

interface CleanData {
  fetchedAt: string;
  source: string;
  match: Match;
  tabs: Tab[];
  marketGroups: MarketGroup[];
  stats: {
    totalMarkets: number;
    totalSelections: number;
    groupsCount: number;
  };
}

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

function extractMatch(matchFields: RawField[]): Match {
  const id = String(getFieldValue<number | bigint>(matchFields, 1) || "");
  const name = getFieldValue<string>(matchFields, 2) || "";
  const datetime = getFieldValue<string>(matchFields, 3) || "";
  
  const [homeTeam, awayTeam] = name.split(" - ").map(s => s.trim());
  
  const compFields = getFieldValue<RawField[]>(matchFields, 8) || [];
  const sportFields = getFieldValue<RawField[]>(compFields, 3) || [];
  
  const competition: Competition = {
    id: getFieldValue<number>(compFields, 1) || 0,
    name: getFieldValue<string>(compFields, 2) || "",
    sport: getFieldValue<string>(sportFields, 1) || "",
  };

  return { id, name, homeTeam, awayTeam, datetime, competition };
}

function extractTabs(matchFields: RawField[]): Tab[] {
  const tabs: Tab[] = [];
  const tabFields = getAllFields(matchFields, 10);
  
  for (const tabField of tabFields) {
    if (Array.isArray(tabField.value)) {
      const id = getFieldValue<string>(tabField.value, 2) || "";
      const name = getFieldValue<string>(tabField.value, 3) || "";
      if (id && name) {
        tabs.push({ id, name });
      }
    }
  }
  
  return tabs;
}

function extractSelection(selFields: RawField[]): Selection | null {
  const id = String(getFieldValue<number | bigint>(selFields, 1) || "");
  const name = getFieldValue<string>(selFields, 10) || "";
  const nameLong = getFieldValue<string>(selFields, 11);
  
  const oddsField = getField(selFields, 12);
  const odds = oddsField?.wireType === 1 ? (oddsField.value as number) : 0;
  
  if (!name || odds <= 0 || odds > 1000) return null;
  
  return { id, name, nameLong: nameLong !== name ? nameLong : undefined, odds };
}

function extractMarket(marketFields: RawField[]): Market | null {
  const id = String(getFieldValue<number | bigint>(marketFields, 1) || "");
  const name = getFieldValue<string>(marketFields, 2) || "";
  const nameLong = getFieldValue<string>(marketFields, 3);
  
  if (!name) return null;
  
  const selections: Selection[] = [];
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
  
  if (selections.length === 0) return null;
  
  return { id, name, nameLong: nameLong !== name ? nameLong : undefined, selections };
}

function extractMarketGroups(matchFields: RawField[]): MarketGroup[] {
  const groups: MarketGroup[] = [];
  const groupFields = getAllFields(matchFields, 11);
  
  for (const groupField of groupFields) {
    if (!Array.isArray(groupField.value)) continue;
    
    const id = getFieldValue<string>(groupField.value, 1) || "";
    const name = getFieldValue<string>(groupField.value, 2) || "";
    
    if (!name) continue;
    
    const markets: Market[] = [];
    const marketFields = getAllFields(groupField.value, 3);
    
    for (const marketField of marketFields) {
      if (Array.isArray(marketField.value)) {
        const market = extractMarket(marketField.value);
        if (market) markets.push(market);
      }
    }
    
    if (markets.length > 0) {
      groups.push({ id, name, markets });
    }
  }
  
  return groups;
}

function parseToCleanStructure(buffer: Buffer, source: string): CleanData {
  const rootFields = parseProtobuf(buffer);
  const wrapperFields = getFieldValue<RawField[]>(rootFields, 1) || [];
  const matchFields = getFieldValue<RawField[]>(wrapperFields, 1) || [];
  
  const match = extractMatch(matchFields);
  const tabs = extractTabs(matchFields);
  const marketGroups = extractMarketGroups(matchFields);
  
  let totalMarkets = 0;
  let totalSelections = 0;
  for (const group of marketGroups) {
    totalMarkets += group.markets.length;
    for (const market of group.markets) {
      totalSelections += market.selections.length;
    }
  }
  
  return {
    fetchedAt: new Date().toISOString(),
    source,
    match,
    tabs,
    marketGroups,
    stats: {
      totalMarkets,
      totalSelections,
      groupsCount: marketGroups.length,
    },
  };
}

async function fetchAndParse(matchId: string, categoryId: string | null, tabName: string): Promise<CleanData> {
  const requestBody = categoryId
    ? buildMatchDetailsRequestWithFilter(matchId, categoryId)
    : buildMatchDetailsRequest(matchId);
  
  const response = await fetchGrpcStream(ENDPOINTS.match, requestBody);
  const source = categoryId ? `${tabName} (${categoryId})` : `${tabName} (no filter)`;
  
  return parseToCleanStructure(response, source);
}

async function main() {
  const args = process.argv.slice(2);
  
  let matchId = "905675290968064";
  let specificTab: string | null = null;
  let fetchAll = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--match" && args[i + 1]) {
      matchId = args[i + 1];
      i++;
    } else if (args[i] === "--tab" && args[i + 1]) {
      specificTab = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === "--all") {
      fetchAll = true;
    }
  }

  console.log("=".repeat(80));
  console.log("BETCLIC gRPC TO CLEAN JSON");
  console.log("=".repeat(80));
  console.log(`Match ID: ${matchId}`);
  console.log();

  const outputDir = path.join(process.cwd(), "data", "betclic-clean");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (fetchAll) {
    console.log("Fetching ALL tabs...\n");
    
    const allData: Record<string, CleanData> = {};
    
    for (const [tabName, categoryId] of Object.entries(MARKET_GROUP_FILTERS)) {
      const categoryDisplay = categoryId || "(no filter)";
      console.log(`Fetching ${tabName} (${categoryDisplay})...`);
      
      try {
        const data = await fetchAndParse(matchId, categoryId, tabName);
        allData[tabName] = data;
        console.log(`  ✓ ${data.stats.groupsCount} groups, ${data.stats.totalMarkets} markets, ${data.stats.totalSelections} selections`);
      } catch (error) {
        console.log(`  ✗ Error: ${error instanceof Error ? error.message : error}`);
      }
      
      await new Promise(r => setTimeout(r, 100));
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const filename = `match-${matchId}-all-clean-${timestamp}.json`;
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, JSON.stringify(allData, null, 2));
    
    console.log();
    console.log("=".repeat(80));
    console.log(`Output saved to: ${outputPath}`);
    
  } else {
    const tabName = specificTab || "TOP";
    const categoryId = specificTab 
      ? MARKET_GROUP_FILTERS[specificTab as keyof typeof MARKET_GROUP_FILTERS]
      : null;
    
    if (specificTab && categoryId === undefined) {
      console.error(`Unknown tab: ${specificTab}`);
      console.log(`Available tabs: ${Object.keys(MARKET_GROUP_FILTERS).join(", ")}`);
      process.exit(1);
    }
    
    console.log(`Fetching ${tabName}...`);
    const data = await fetchAndParse(matchId, categoryId ?? null, tabName);
    
    console.log(`  ✓ ${data.stats.groupsCount} groups, ${data.stats.totalMarkets} markets, ${data.stats.totalSelections} selections`);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const filename = `match-${matchId}-${tabName.toLowerCase()}-clean-${timestamp}.json`;
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    
    console.log();
    console.log("=".repeat(80));
    console.log(`Output saved to: ${outputPath}`);
    
    console.log();
    console.log("Preview:");
    console.log("-".repeat(80));
    console.log(`Match: ${data.match.name}`);
    console.log(`Competition: ${data.match.competition.name}`);
    console.log();
    
    for (const group of data.marketGroups.slice(0, 2)) {
      console.log(`📁 ${group.name}`);
      for (const market of group.markets.slice(0, 2)) {
        console.log(`  📊 ${market.name}`);
        for (const sel of market.selections.slice(0, 3)) {
          console.log(`    • ${sel.name.padEnd(35)} ${sel.odds.toFixed(2)}`);
        }
        if (market.selections.length > 3) {
          console.log(`    ... (+${market.selections.length - 3} more)`);
        }
      }
      if (group.markets.length > 2) {
        console.log(`  ... (+${group.markets.length - 2} more markets)`);
      }
    }
  }
  
  console.log("=".repeat(80));
}

main().catch(console.error);
