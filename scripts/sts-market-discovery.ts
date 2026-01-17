#!/usr/bin/env npx tsx
/**
 * STS Market Discovery Script
 * 
 * Usage:
 *   npx tsx scripts/sts-market-discovery.ts                    # Scan all leagues, find best fixture
 *   npx tsx scripts/sts-market-discovery.ts laliga             # Scan specific league
 *   npx tsx scripts/sts-market-discovery.ts --market 121       # Focus on specific market ID (full output, no truncation)
 *   npx tsx scripts/sts-market-discovery.ts --all              # Show full details for ALL markets
 *   npx tsx scripts/sts-market-discovery.ts --raw              # Show raw WebSocket structure
 *   npx tsx scripts/sts-market-discovery.ts --verbose          # Show details for markets with issues
 *   npx tsx scripts/sts-market-discovery.ts --issues           # Show only markets with issues
 *   npx tsx scripts/sts-market-discovery.ts --dir logs/out     # Output to files in directory
 */

import { chromium, type Page } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  navigateAndCaptureLeagueData,
  navigateAndCaptureMatchData,
} from "../src/scrapers/bookmakers/sts/navigation.js";
import {
  parseWebSocketJson,
  parseFixtures,
} from "../src/scrapers/bookmakers/sts/parser.js";
import { stsNormalizer, STS_MARKET_ID_TO_CODE } from "../src/services/normalization/bookmakers/sts-normalizer.js";
import type { STSWebSocketData } from "../src/scrapers/bookmakers/sts/types.js";
import { getSelectionNameByOutcomeId } from "../src/scrapers/bookmakers/sts/outcome-map.js";
import {
  getMarketByCode,
  type MarketCatalogEntry,
} from "../src/data/market-catalog.js";
import { ViewType, MarketCategory, type NormalizationContext } from "../src/services/normalization/types.js";
import { groupMarketsByTypeWithParameters } from "../src/services/market-type-grouper.js";
import type { ScrapedMarket, MarketSelection } from "../src/types/full-offer.js";

interface RawOutcomeInfo {
  outcomeId: number;
  rawName: string;
  mappedName: string;
  odds: number;
}

interface RawLineInfo {
  lineId: string;
  lineName: string;
  outcomes: RawOutcomeInfo[];
}

interface NormalizedSelectionInfo {
  code: string;
  label: string;
  odds: number;
  isUnknown: boolean;
}

interface MarketAnalysis {
  id: number;
  polishName: string;
  rawLines: RawLineInfo[];
  normalized: {
    marketCode: string | null;
    paramValue: string | undefined;
    marketKey: string | undefined;
    selections: NormalizedSelectionInfo[];
    matchedBy: "id" | "name" | undefined;
  };
  issues: string[];
  catalogEntry?: MarketCatalogEntry;
  inNormalizer: boolean;
}

/**
 * Frontend JSON format (MarketWithParams)
 * This is exactly what the frontend receives from the API
 */
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

interface FixtureCandidate {
  league: string;
  fixture: {
    id: string;
    home: string;
    away: string;
    eventUrl: string;
  };
  marketCount: number;
  wsData?: STSWebSocketData;
}

interface MarketInfo {
  polishName: string;
  catalogEntry: MarketCatalogEntry | undefined;
  normalizedCode: string | undefined;
  inNormalizer: boolean;
}

function getMarketInfo(marketId: number): MarketInfo {
  const normalizedCode = STS_MARKET_ID_TO_CODE[marketId];
  const catalogEntry = normalizedCode ? getMarketByCode(normalizedCode) : undefined;
  
  let polishName: string;
  if (catalogEntry) {
    polishName = catalogEntry.labels.pl;
  } else if (normalizedCode) {
    polishName = `(${normalizedCode})`;
  } else {
    polishName = `(nieznany ID ${marketId})`;
  }
  
  return {
    polishName,
    catalogEntry,
    normalizedCode,
    inNormalizer: normalizedCode !== undefined,
  };
}

const ALL_LEAGUES = ["ekstraklasa", "premier-league", "laliga", "serie-a", "ligue-1"];

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose") || args.includes("-v");
const SHOW_ISSUES = args.includes("--issues") || args.includes("-i");
const SHOW_RAW = args.includes("--raw") || args.includes("-r");
const OUTPUT_DIR = args.find((_, i) => args[i - 1] === "--dir") || null;
const SHOW_ALL_DETAILS = args.includes("--all") || args.includes("-a");
const MARKET_ID_ARG = args.find((_, i) => args[i - 1] === "--market" || args[i - 1] === "-m");
const FOCUS_MARKET_ID = MARKET_ID_ARG ? parseInt(MARKET_ID_ARG, 10) : null;
const SINGLE_LEAGUE = args.find(arg =>
  !arg.startsWith("-") &&
  !["--market", "-m", "--verbose", "-v", "--issues", "-i", "--raw", "-r", "--dir"].includes(args[args.indexOf(arg) - 1] || "") &&
  ALL_LEAGUES.includes(arg)
);

function countMarketsInWsData(wsData: STSWebSocketData): number {
  const marketIds = new Set<number>();
  for (const [, assocData] of Object.entries(wsData.P || {})) {
    const marketData = (assocData as { m?: Record<string, unknown> }).m;
    if (!marketData) continue;
    for (const marketIdStr of Object.keys(marketData)) {
      marketIds.add(parseInt(marketIdStr, 10));
    }
  }
  return marketIds.size;
}

async function findBestFixture(page: Page): Promise<FixtureCandidate | null> {
  const leagues = SINGLE_LEAGUE ? [SINGLE_LEAGUE] : ALL_LEAGUES;
  const candidates: FixtureCandidate[] = [];

  console.log(`\n🔍 Scanning ${leagues.length} league(s) for best fixture...\n`);

  for (const league of leagues) {
    try {
      console.log(`  📍 ${league}...`);
      const leagueCapture = await navigateAndCaptureLeagueData(page, league);

      if (!leagueCapture) {
        console.log(`     ❌ No data`);
        continue;
      }

      const initialJson = parseWebSocketJson(leagueCapture.initialData);
      if (!initialJson) {
        console.log(`     ❌ Parse failed`);
        continue;
      }

      const fixtures = parseFixtures(initialJson, league);
      if (fixtures.length === 0) {
        console.log(`     ❌ No fixtures`);
        continue;
      }

      console.log(`     ✅ Found ${fixtures.length} fixtures`);

      const maxFixtures = FOCUS_MARKET_ID !== null ? 1 : 3;
      for (const fixture of fixtures.slice(0, maxFixtures)) {
        try {
          const matchCapture = await navigateAndCaptureMatchData(page, fixture.eventUrl);
          if (!matchCapture) continue;

          let wsData: STSWebSocketData | null = null;

          if (matchCapture.fixtureData.size > 0) {
            wsData = matchCapture.fixtureData.get(fixture.id) || null;
          }

          if (!wsData && matchCapture.initialData) {
            wsData = parseWebSocketJson(matchCapture.initialData);
          }

          if (wsData) {
            const marketCount = countMarketsInWsData(wsData);
            candidates.push({
              league,
              fixture: {
                id: fixture.id,
                home: fixture.home,
                away: fixture.away,
                eventUrl: fixture.eventUrl,
              },
              marketCount,
              wsData,
            });
            console.log(`        ${fixture.home} vs ${fixture.away}: ${marketCount} markets`);
            
            if (FOCUS_MARKET_ID !== null) {
              const hasTargetMarket = checkIfHasMarket(wsData, FOCUS_MARKET_ID);
              if (hasTargetMarket) {
                console.log(`     🎯 Found target market ${FOCUS_MARKET_ID}, stopping scan`);
                return candidates[candidates.length - 1];
              }
            }
          }
        } catch {
        }
      }
    } catch (err) {
      console.log(`     ❌ Error: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.marketCount - a.marketCount);
  return candidates[0];
}

function checkIfHasMarket(wsData: STSWebSocketData, marketId: number): boolean {
  for (const [, assocData] of Object.entries(wsData.P || {})) {
    const marketData = (assocData as { m?: Record<string, unknown> }).m;
    if (!marketData) continue;
    if (marketData[String(marketId)]) return true;
  }
  return false;
}

function analyzeMarkets(
  wsData: STSWebSocketData,
  homeTeam: string,
  awayTeam: string
): Map<number, MarketAnalysis> {
  const ctx = { homeTeam, awayTeam };
  const marketsMap = new Map<number, MarketAnalysis>();

  for (const [, assocData] of Object.entries(wsData.P || {})) {
    const marketData = (assocData as { m?: Record<string, unknown> }).m;
    if (!marketData) continue;

    for (const [marketIdStr, market] of Object.entries(marketData)) {
      const marketId = parseInt(marketIdStr, 10);

      if (FOCUS_MARKET_ID !== null && marketId !== FOCUS_MARKET_ID) continue;

      const mkt = market as {
        n?: string;
        l?: Record<string, {
          n?: string;
          o?: Record<string, { n?: string; v?: number; O?: number }>
        }>
      };

      if (!marketsMap.has(marketId)) {
        const marketInfo = getMarketInfo(marketId);
        marketsMap.set(marketId, {
          id: marketId,
          polishName: marketInfo.polishName,
          rawLines: [],
          normalized: {
            marketCode: null,
            paramValue: undefined,
            marketKey: undefined,
            selections: [],
            matchedBy: undefined,
          },
          issues: [],
          catalogEntry: marketInfo.catalogEntry,
          inNormalizer: marketInfo.inNormalizer,
        });
      }

      const analysis = marketsMap.get(marketId)!;
      const lines = mkt.l || {};

      for (const [lineId, line] of Object.entries(lines)) {
        const lineName = line.n || "";
        const outcomes = line.o || {};

        const rawOutcomes: RawOutcomeInfo[] = Object.entries(outcomes).map(([outcomeIdStr, o]) => {
          const outcomeId = parseInt(outcomeIdStr, 10);
          const rawName = o.n || "";
          const mappedName = getSelectionNameByOutcomeId(outcomeId) || rawName || String(outcomeId);
          const odds = o.v ?? o.O ?? 0;
          return { outcomeId, rawName, mappedName, odds };
        });

        analysis.rawLines.push({
          lineId,
          lineName,
          outcomes: rawOutcomes,
        });

        const rawSelections = rawOutcomes.map(o => ({
          name: o.rawName || o.mappedName || String(o.outcomeId),
          odds: o.odds,
        }));

        const testResult = stsNormalizer.normalizeMarket(
          {
            name: lineName || `Rynek ${marketId}`,
            bookmakerMarketId: String(marketId),
            selections: rawSelections
          },
          ctx
        );

        if (testResult && !analysis.normalized.marketCode) {
          analysis.normalized.marketCode = testResult.marketCode;
          analysis.normalized.paramValue = testResult.paramValue;
          analysis.normalized.marketKey = testResult.marketKey;
          analysis.normalized.matchedBy = testResult.debug?.matchedBy as "id" | "name" | undefined;

          const passthroughMarketTypes = [
            "GOAL_RANGE", "TEAM_GOAL_RANGE", "HALF_TIME_GOAL_RANGE", "SECOND_HALF_GOAL_RANGE",
            "CORNERS_TEAM", "HALF_TIME_CORNERS_TEAM", "HALF_TIME_CORNERS_TOTAL", "HALF_TIME_CORNERS_RACE",
            "TIME_PERIOD_RESULT", "WINNING_MARGIN", "FIRST_GOAL_TIME", "OTHER",
            "CARDS_TEAM", "CARDS_TOTAL", "FOULS_TOTAL", "CORRECT_SCORE",
            "EXACT_GOALS", "HOME_EXACT_GOALS", "AWAY_EXACT_GOALS",
            "HALF_TIME_EXACT_GOALS", "SECOND_HALF_EXACT_GOALS",
            "SECOND_HALF_HOME_EXACT_GOALS",
          ];
          const isPassthroughMarket = passthroughMarketTypes.includes(testResult.marketCode);

          analysis.normalized.selections = testResult.selections.map(sel => {
            const code = sel.code as string;
            const isScore = /^\d+-\d+$/.test(code);
            const isRange = /^\d+\+$/.test(code) || /^\d+-\d+$/.test(code);
            const isNumeric = /^\d+$/.test(code);
          const isUnknown =
            code === "UNKNOWN" ||
            (isNumeric && !isPassthroughMarket && !isRange && !isScore);

          // Special case: For EXACT_GOALS type markets, treat "0", "1", "2" as valid (not unknown)
          const isExactGoalsMarket =
            testResult.marketCode?.startsWith("EXACT_GOALS") ||
            testResult.marketCode?.startsWith("HOME_EXACT_GOALS") ||
            testResult.marketCode?.startsWith("AWAY_EXACT_GOALS");
          
          if (isExactGoalsMarket && isNumeric && ["0", "1", "2"].includes(code)) {
            // Don't mark 0, 1, 2 as unknown for EXACT_GOALS markets
            return {
              code,
              label: sel.label,
              odds: sel.odds,
              isUnknown: false,
            };
          }

          // For non-EXACT_GOALS or non-0/1/2 codes, use original logic
          return {
            code,
            label: sel.label,
            odds: sel.odds,
            isUnknown,
          };
          });
        }
      }
    }
  }

  for (const analysis of marketsMap.values()) {
    const unknownSelections = analysis.normalized.selections.filter(s => s.isUnknown);
    if (unknownSelections.length > 0) {
      const uniqueUnknown = [...new Set(unknownSelections.map(s => `"${s.label}" → ${s.code}`))];
      analysis.issues.push(`UNKNOWN_SELECTIONS: ${uniqueUnknown.slice(0, 5).join(", ")}${uniqueUnknown.length > 5 ? ` (+${uniqueUnknown.length - 5} more)` : ""}`);
    }

    const linesWithParam = analysis.rawLines.filter(l => l.lineName && l.lineName.trim() !== "");
    const uniqueLineNames = [...new Set(linesWithParam.map(l => l.lineName))];
    if (uniqueLineNames.length > 1 && !analysis.normalized.paramValue) {
      analysis.issues.push(`MULTIPLE_LINES_NO_PARAM: ${uniqueLineNames.length} different line names but no param extracted`);
    }
  }

  return marketsMap;
}

function printMarketDetail(analysis: MarketAnalysis, ctx: NormalizationContext, wsData?: STSWebSocketData): void {
  const { id, polishName, rawLines, normalized, issues, catalogEntry, inNormalizer } = analysis;

  if (OUTPUT_DIR) {
    const fileName = `market-${id}-${polishName.replace(/[^a-z0-9]/gi, '_')}.txt`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    let output = "";
    output += `MARKET ID ${id}: ${polishName}\n`;
    output += `${"=".repeat(80)}\n\n`;

    output += `IN NORMALIZER: ${inNormalizer ? "YES" : "NO"}\n`;
    
    if (normalized.marketCode) {
      output += `NORMALIZED: ${normalized.marketCode}\n`;
      output += `Market Key: ${normalized.marketKey || "N/A"}\n`;
      output += `Param Value: ${normalized.paramValue || "none"}\n`;
    } else {
      output += `NOT NORMALIZED (unmapped market ID)\n`;
    }

    if (catalogEntry) {
      output += `\nCATALOG INFO:\n`;
      output += `  Code: ${catalogEntry.code}\n`;
      output += `  Polish Name: ${catalogEntry.labels.pl}\n`;
      output += `  English Name: ${catalogEntry.labels.en}\n`;
      output += `  Category: ${catalogEntry.category}\n`;
      output += `  ViewType: ${catalogEntry.viewType}\n`;
      output += `  Has Parameter: ${catalogEntry.hasParameter}\n`;
      output += `  Expected Selections: [${catalogEntry.selections.join(", ")}]\n`;
    }

    if (issues.length > 0) {
      output += `\nISSUES:\n`;
      issues.forEach(i => output += ` - ${i}\n`);
    }

    output += `\nRAW DATA:\n`;
    rawLines.forEach(line => {
      output += `Line: ${line.lineName} [ID: ${line.lineId}]\n`;
      line.outcomes.forEach(o => {
        output += `  ${o.outcomeId}: ${o.rawName} -> ${o.mappedName} (${o.odds})\n`;
      });
    });

    if (wsData) {
       for (const [assocKey, assocData] of Object.entries(wsData.P || {})) {
        const marketData = (assocData as { m?: Record<string, unknown> }).m;
        if (!marketData) continue;
    
        const market = marketData[String(id)];
        if (market) {
          output += `\nRAW JSON (assocKey: ${assocKey}):\n`;
          output += JSON.stringify(market, null, 2);
          output += "\n";
          break;
        }
      }
    }

    fs.writeFileSync(filePath, output);
    return;
  }

  console.log(`\n${"─".repeat(100)}`);
  console.log(`📦 MARKET ID ${id}: ${polishName}`);
  console.log(`${"─".repeat(100)}`);

  console.log(`\n📋 NORMALIZER STATUS: ${inNormalizer ? "✅ In STS_MARKET_ID_TO_CODE" : "❌ Not in normalizer"}`);

  if (normalized.marketCode) {
    console.log(`\n✅ NORMALIZED: ${normalized.marketCode}`);
    console.log(`   Market Key: ${normalized.marketKey || "N/A"}`);
    console.log(`   Param Value: ${normalized.paramValue || "none"}`);
    console.log(`   Matched By: ${normalized.matchedBy || "unknown"}`);
  } else {
    console.log(`\n❌ NOT NORMALIZED (unmapped market ID)`);
  }

  if (catalogEntry) {
    console.log(`\n📚 CATALOG INFO:`);
    console.log(`   Code: ${catalogEntry.code}`);
    console.log(`   Polish: ${catalogEntry.labels.pl}`);
    console.log(`   English: ${catalogEntry.labels.en}`);
    console.log(`   Category: ${catalogEntry.category}`);
    console.log(`   ViewType: ${catalogEntry.viewType}`);
    console.log(`   Has Parameter: ${catalogEntry.hasParameter}`);
    console.log(`   Expected Selections: [${catalogEntry.selections.join(", ")}]`);
  }

  if (issues.length > 0) {
    console.log(`\n⚠️  ISSUES:`);
    for (const issue of issues) {
      console.log(`   - ${issue}`);
    }
  }

  console.log(`\n📊 RAW DATA (${rawLines.length} line(s)):`);

  const noTruncation = FOCUS_MARKET_ID !== null;
  const maxLines = noTruncation ? rawLines.length : (VERBOSE ? 10 : 3);
  const maxOutcomes = noTruncation ? Infinity : (VERBOSE ? 20 : 8);

  for (const line of rawLines.slice(0, maxLines)) {
    console.log(`\n   Line: "${line.lineName || "(empty)"}" [ID: ${line.lineId}]`);
    console.log(`   ${"─".repeat(80)}`);

    console.log(`   ${"OutcomeID".padEnd(10)} ${"Raw Name".padEnd(25)} ${"Mapped Name".padEnd(25)} ${"Odds".padEnd(8)}`);
    console.log(`   ${"─".repeat(10)} ${"─".repeat(25)} ${"─".repeat(25)} ${"─".repeat(8)}`);

    for (const outcome of line.outcomes.slice(0, maxOutcomes)) {
      const rawDisplay = (outcome.rawName || "(empty)").substring(0, 24);
      const mappedDisplay = outcome.mappedName.substring(0, 24);
      console.log(`   ${String(outcome.outcomeId).padEnd(10)} ${rawDisplay.padEnd(25)} ${mappedDisplay.padEnd(25)} ${outcome.odds.toFixed(2).padEnd(8)}`);
    }

    if (!noTruncation && line.outcomes.length > maxOutcomes) {
      console.log(`   ... and ${line.outcomes.length - maxOutcomes} more outcomes`);
    }
  }

  if (!noTruncation && rawLines.length > maxLines) {
    console.log(`\n   ... and ${rawLines.length - maxLines} more lines`);
  }

  if (normalized.selections.length > 0) {
    console.log(`\n📤 NORMALIZED SELECTIONS (${normalized.selections.length}):`);
    console.log(`   ${"─".repeat(80)}`);
    console.log(`   ${"Status".padEnd(4)} ${"Code".padEnd(20)} ${"Original Label".padEnd(35)} ${"Odds".padEnd(8)}`);
    console.log(`   ${"─".repeat(4)} ${"─".repeat(20)} ${"─".repeat(35)} ${"─".repeat(8)}`);

    const maxSelections = noTruncation ? normalized.selections.length : (VERBOSE ? 30 : 10);
    for (const sel of normalized.selections.slice(0, maxSelections)) {
      const status = sel.isUnknown ? "❌" : "✅";
      const codeDisplay = sel.code.substring(0, 19);
      const labelDisplay = sel.label.substring(0, 34);
      console.log(`   ${status.padEnd(4)} ${codeDisplay.padEnd(20)} ${labelDisplay.padEnd(35)} ${sel.odds.toFixed(2).padEnd(8)}`);
    }

    if (!noTruncation && normalized.selections.length > maxSelections) {
      console.log(`   ... and ${normalized.selections.length - maxSelections} more selections`);
    }
  }

  if (wsData && (SHOW_ALL_DETAILS || SHOW_RAW || FOCUS_MARKET_ID !== null)) {
    printRawJsonInline(wsData, id);
  }

  if (FOCUS_MARKET_ID !== null) {
    printFrontendJson(analysis, ctx);
  }
}

function buildFrontendJsonProduction(analysis: MarketAnalysis, ctx: NormalizationContext): FrontendMarketJson | null {
  const { rawLines, id: marketId, polishName, catalogEntry } = analysis;
  
  const scrapedMarkets: ScrapedMarket[] = [];
  
  for (const line of rawLines) {
    const rawSelections = line.outcomes.map(o => ({
      name: o.rawName || o.mappedName || String(o.outcomeId),
      odds: o.odds,
    }));

    const lineName = line.lineName || `Rynek ${marketId}`;
    
    const normResult = stsNormalizer.normalizeMarket(
      {
        name: lineName,
        bookmakerMarketId: String(marketId),
        selections: rawSelections
      },
      ctx
    );

    if (normResult) {
      const selections: MarketSelection[] = normResult.selections.map(sel => ({
        name: sel.label,
        odds: sel.odds,
        normalizedName: sel.code,
      }));

      scrapedMarkets.push({
        name: lineName,
        groupName: catalogEntry?.category || "INNE",
        type: String(marketId),
        selections,
        normalizedType: normResult.marketCode,
        marketKey: normResult.marketKey,
        paramValue: normResult.paramValue,
      });
    }
  }

  if (scrapedMarkets.length === 0) {
    return null;
  }

  const marketsWithBookmakers = scrapedMarkets.map(market => ({
    market,
    bookmaker: "sts",
  }));

  const grouped = groupMarketsByTypeWithParameters(marketsWithBookmakers);
  
  if (grouped.length === 0) {
    return null;
  }

  const result = grouped[0];
  
  return {
    marketKey: result.marketKey,
    type: result.type,
    category: result.category || "INNE",
    label: catalogEntry?.labels.pl || polishName,
    description: result.description || "",
    displayOrder: result.displayOrder || 999,
    viewType: result.viewType || "UNKNOWN",
    parameters: result.parameters.map(p => ({
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
    })),
    defaultParameter: result.defaultParameter || "base",
    hasParameters: result.hasParameters || false,
  };
}

function printFrontendJson(analysis: MarketAnalysis, ctx: NormalizationContext): void {
  const json = buildFrontendJsonProduction(analysis, ctx);
  console.log(`\n📱 FRONTEND JSON (MarketWithParams format - using production code):`);
  if (json) {
    console.log(JSON.stringify(json, null, 2));
  } else {
    console.log("  (no normalized markets)");
  }
}

function printRawJsonInline(wsData: STSWebSocketData, marketId: number): void {
  for (const [assocKey, assocData] of Object.entries(wsData.P || {})) {
    const marketData = (assocData as { m?: Record<string, unknown> }).m;
    if (!marketData) continue;

    const market = marketData[String(marketId)];
    if (market) {
      console.log(`\n🔧 RAW JSON (assocKey: ${assocKey}):`);
      const jsonStr = JSON.stringify(market, null, 2);
      
      if (FOCUS_MARKET_ID !== null) {
        console.log(jsonStr);
      } else {
        const lines = jsonStr.split("\n");
        const maxLines = VERBOSE ? 100 : 30;
        console.log(lines.slice(0, maxLines).join("\n"));
        if (lines.length > maxLines) {
          console.log(`   ... (${lines.length - maxLines} more lines)`);
        }
      }
      return;
    }
  }
}

function printRawJson(wsData: STSWebSocketData, marketId: number): void {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`🔧 RAW JSON FOR MARKET ID ${marketId}`);
  console.log(`${"=".repeat(100)}\n`);

  for (const [assocKey, assocData] of Object.entries(wsData.P || {})) {
    const marketData = (assocData as { m?: Record<string, unknown> }).m;
    if (!marketData) continue;

    const market = marketData[String(marketId)];
    if (market) {
      console.log(`AssocKey: ${assocKey}`);
      console.log(JSON.stringify(market, null, 2));
      return;
    }
  }

  console.log(`Market ID ${marketId} not found in WebSocket data`);
}

function printSummary(markets: Map<number, MarketAnalysis>): void {
  const allMarkets = Array.from(markets.values()).sort((a, b) => a.id - b.id);
  const mapped = allMarkets.filter(m => m.normalized.marketCode !== null);
  const unmapped = allMarkets.filter(m => m.normalized.marketCode === null);
  const withIssues = allMarkets.filter(m => m.issues.length > 0);
  const inNormalizerCount = allMarkets.filter(m => m.inNormalizer).length;
  const inCatalogCount = allMarkets.filter(m => m.catalogEntry !== undefined).length;

  console.log("\n" + "=".repeat(100));
  console.log(`📊 SUMMARY`);
  console.log("=".repeat(100));
  console.log(`Total markets: ${allMarkets.length}`);
  console.log(`✅ Mapped: ${mapped.length}`);
  console.log(`❌ Unmapped: ${unmapped.length}`);
  console.log(`⚠️  With issues: ${withIssues.length}`);
  console.log(`📋 In STS_MARKET_ID_TO_CODE: ${inNormalizerCount}`);
  console.log(`📚 In Market Catalog: ${inCatalogCount}`);

  console.log("\n" + "=".repeat(100));
  console.log(`✅ MAPPED MARKETS (${mapped.length})`);
  console.log("=".repeat(100));
  console.log(`${"ID".padStart(6)} ${"Catalog Name".padEnd(30)} ${"→".padEnd(3)} ${"Code".padEnd(28)} ${"ViewType".padEnd(18)} ${"Cat".padEnd(12)} ${"Sel#".padEnd(5)} ${"Issues"}`);
  console.log(`${"─".repeat(6)} ${"─".repeat(30)} ${"─".repeat(3)} ${"─".repeat(28)} ${"─".repeat(18)} ${"─".repeat(12)} ${"─".repeat(5)} ${"─".repeat(8)}`);

  for (const m of mapped) {
    const issueFlag = m.issues.length > 0 ? `⚠️ ${m.issues.length}` : "";
    const selCount = m.normalized.selections.length;
    const catalogName = m.catalogEntry?.labels.pl || m.polishName;
    const viewType = m.catalogEntry?.viewType || "N/A";
    const category = m.catalogEntry?.category?.replace("MarketCategory.", "") || "N/A";
    console.log(`${String(m.id).padStart(6)} ${catalogName.substring(0, 29).padEnd(30)} → ${(m.normalized.marketCode || "").padEnd(28)} ${String(viewType).substring(0, 17).padEnd(18)} ${category.substring(0, 11).padEnd(12)} ${String(selCount).padEnd(5)} ${issueFlag}`);
  }

  if (unmapped.length > 0) {
    console.log("\n" + "=".repeat(100));
    console.log(`❌ UNMAPPED MARKETS (${unmapped.length}) - Add to sts-normalizer.ts`);
    console.log("=".repeat(100));

    for (const m of unmapped) {
      const sampleSels = m.rawLines[0]?.outcomes.slice(0, 3).map(o => o.mappedName).join(", ") || "";
      const inNormalizerFlag = m.inNormalizer ? "📋" : "❌";
      console.log(`${inNormalizerFlag} ID ${String(m.id).padStart(4)}: ${m.polishName.padEnd(35)} [${sampleSels}]`);
    }

    console.log("\n📋 Copy to sts-normalizer.ts STS_MARKET_ID_TO_CODE:");
    for (const m of unmapped) {
      if (!m.inNormalizer) {
        console.log(`  ${m.id}: "OTHER", // ${m.polishName}`);
      }
    }
  }

  if (withIssues.length > 0) {
    console.log("\n" + "=".repeat(100));
    console.log(`⚠️  MARKETS WITH ISSUES (${withIssues.length})`);
    console.log("=".repeat(100));

    for (const m of withIssues) {
      const catalogInfo = m.catalogEntry 
        ? `[${m.catalogEntry.viewType}, expects: ${m.catalogEntry.selections.slice(0, 3).join(",")}...]`
        : "[no catalog entry]";
      console.log(`\nID ${m.id}: ${m.polishName} → ${m.normalized.marketCode || "UNMAPPED"} ${catalogInfo}`);
      for (const issue of m.issues) {
        console.log(`   ⚠️  ${issue}`);
      }

      if (VERBOSE || SHOW_ISSUES) {
        const unknownSels = m.normalized.selections.filter(s => s.isUnknown);
        if (unknownSels.length > 0) {
          console.log(`   Sample unknown selections:`);
          for (const sel of unknownSels.slice(0, 5)) {
            console.log(`      "${sel.label}" → ${sel.code}`);
          }
        }
      }
    }
  }
}

async function main() {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`🔍 STS Market Discovery - Enhanced Analysis`);
  console.log(`${"=".repeat(100)}`);

  if (FOCUS_MARKET_ID) {
    console.log(`\n🎯 Focusing on Market ID: ${FOCUS_MARKET_ID}`);
  }
  if (SHOW_RAW) {
    console.log(`📄 Raw JSON output enabled`);
  }
  if (VERBOSE) {
    console.log(`📝 Verbose mode enabled`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const bestFixture = await findBestFixture(page);

    if (!bestFixture) {
      console.log("\n❌ No fixtures found in any league");
      return;
    }

    console.log(`\n${"=".repeat(100)}`);
    console.log(`🏆 ANALYZING: ${bestFixture.fixture.home} vs ${bestFixture.fixture.away}`);
    console.log(`   League: ${bestFixture.league}, Total Markets: ${bestFixture.marketCount}`);
    console.log(`   Match URL: ${bestFixture.fixture.eventUrl}`);
    console.log(`${"=".repeat(100)}`);

    let wsData: STSWebSocketData | null = bestFixture.wsData || null;

    if (!wsData) {
      const matchCapture = await navigateAndCaptureMatchData(page, bestFixture.fixture.eventUrl);
      if (!matchCapture) {
        console.log("❌ Failed to capture match data");
        return;
      }

      if (matchCapture.fixtureData.size > 0) {
        wsData = matchCapture.fixtureData.get(bestFixture.fixture.id) || null;
      }

      if (!wsData && matchCapture.initialData) {
        wsData = parseWebSocketJson(matchCapture.initialData);
      }
    }

    if (!wsData) {
      console.log("❌ No WebSocket data available");
      return;
    }

    if (SHOW_RAW && FOCUS_MARKET_ID) {
      printRawJson(wsData, FOCUS_MARKET_ID);
    }

    const ctx = { homeTeam: bestFixture.fixture.home, awayTeam: bestFixture.fixture.away };
    const markets = analyzeMarkets(wsData, bestFixture.fixture.home, bestFixture.fixture.away);

    if (FOCUS_MARKET_ID) {
      const market = markets.get(FOCUS_MARKET_ID);
      if (market) {
        printMarketDetail(market, ctx, wsData);
      } else {
        console.log(`\n❌ Market ID ${FOCUS_MARKET_ID} not found in fixture data`);
      }
    } else if (SHOW_ALL_DETAILS) {
      const allMarkets = Array.from(markets.values()).sort((a, b) => a.id - b.id);
      for (const market of allMarkets) {
        printMarketDetail(market, ctx, wsData);
      }
      printSummary(markets);
    } else if (VERBOSE) {
      const withIssues = Array.from(markets.values()).filter(m => m.issues.length > 0);
      for (const market of withIssues) {
        printMarketDetail(market, ctx, wsData);
      }
      printSummary(markets);
    } else {
      printSummary(markets);
    }

    if (!VERBOSE && !FOCUS_MARKET_ID && !SHOW_ALL_DETAILS) {
      console.log(`\n💡 Tips:`);
      console.log(`   --market <id>  Focus on specific market ID (e.g., --market 121)`);
      console.log(`   --all          Show full details for ALL markets`);
      console.log(`   --raw          Show raw WebSocket JSON (use with --market)`);
      console.log(`   --verbose      Show details for markets with issues`);
      console.log(`   --issues       Show detailed issue breakdown`);
    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
