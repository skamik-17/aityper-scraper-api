#!/usr/bin/env npx tsx
/**
 * STS Market Discovery Script
 * 
 * Usage:
 *   npx tsx scripts/sts-market-discovery.ts                    # Scan all leagues, find best fixture
 *   npx tsx scripts/sts-market-discovery.ts laliga             # Scan specific league
 *   npx tsx scripts/sts-market-discovery.ts --market 121       # Focus on specific market ID
 *   npx tsx scripts/sts-market-discovery.ts --all              # Show full details for ALL markets
 *   npx tsx scripts/sts-market-discovery.ts --raw              # Show raw WebSocket structure
 *   npx tsx scripts/sts-market-discovery.ts --verbose          # Show details for markets with issues
 *   npx tsx scripts/sts-market-discovery.ts --issues           # Show only markets with issues
 */

import { chromium, type Page } from "playwright";
import {
  navigateAndCaptureLeagueData,
  navigateAndCaptureMatchData,
} from "../src/scrapers/bookmakers/sts/navigation.js";
import {
  parseWebSocketJson,
  parseFixtures,
} from "../src/scrapers/bookmakers/sts/parser.js";
import { stsNormalizer } from "../src/services/normalization/bookmakers/sts-normalizer.js";
import type { STSWebSocketData } from "../src/scrapers/bookmakers/sts/types.js";
import { getSelectionNameByOutcomeId } from "../src/scrapers/bookmakers/sts/outcome-map.js";

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
}

const MARKET_ID_NAMES: Record<number, string> = {
  1: "Wynik meczu (1X2)",
  8: "Pierwszy gol",
  9: "Ostatni gol",
  10: "Podwójna szansa",
  11: "Remis = zwrot",
  14: "Handicap europejski",
  17: "Margines zwycięstwa",
  20: "Handicap azjatycki",
  22: "Handicap azjatycki (alt)",
  23: "Liczba goli (zwrot)",
  25: "Liczba goli",
  26: "Liczba goli 1. poł (var)",
  28: "Gole gospodarzy",
  31: "Gole gości",
  33: "Przedział goli",
  35: "Wygrana do zera (gosp)",
  36: "Czyste konto",
  40: "Parzyste/nieparzyste",
  41: "Parzyste/nieparzyste (gosp)",
  42: "Parzyste/nieparzyste (gość)",
  43: "Obie strzelą (BTTS)",
  44: "Która strzeli pierwsza",
  47: "Wygrana do zera (gosp)",
  48: "Wygrana do zera (gość)",
  49: "Wynik + BTTS",
  50: "Wynik + liczba goli",
  51: "Wynik + liczba goli (szczeg)",
  52: "Pierwszy strzelec",
  53: "Ostatni strzelec",
  54: "Strzelec w meczu",
  57: "HT/FT - Dokładny wynik",
  58: "Połowa/Koniec (HT/FT)",
  59: "Gole w obu połowach (gosp)",
  60: "Gole w obu połowach (gość)",
  61: "Połowa z więcej goli",
  71: "Wynik 1. połowy",
  73: "Pierwszy gol 1. poł",
  74: "Podwójna szansa 1. poł",
  75: "Remis = zwrot 1. poł",
  76: "Handicap europejski 1. poł",
  77: "Handicap azjatycki 1. poł",
  79: "Handicap europejski 1. poł (alt)",
  80: "Liczba goli 1. poł (alt)",
  82: "Liczba goli 1. połowa",
  85: "Gole gosp 1. połowa",
  88: "Gole gości 1. połowa",
  90: "Przedział goli 1. poł",
  94: "Parzyste/nieparzyste 1. poł",
  95: "BTTS 1. połowa",
  98: "1. poł - Wynik + BTTS",
  99: "Wynik + gole 1. poł",
  101: "Dokładny wynik 1. poł",
  102: "Wynik 2. połowy",
  103: "Pierwszy gol 2. poł",
  104: "Podwójna szansa 2. poł",
  105: "Remis = zwrot 2. poł",
  106: "Handicap europejski 2. poł",
  107: "Handicap azjatycki 2. poł",
  109: "Handicap europejski 2. poł (alt)",
  110: "Liczba goli 2. poł (alt)",
  112: "Liczba goli 2. połowa",
  115: "Gole gosp 2. połowa",
  118: "Gole gości 2. połowa",
  119: "Przedział goli gosp 2. poł",
  120: "Parzyste/nieparzyste 2. poł",
  121: "BTTS 2. połowa",
  124: "Dokładny wynik 2. poł",
  125: "Czas pierwszego gola",
  126: "Czas pierwszego gola (var)",
  132: "Wynik w X minucie",
  178: "Więcej kartek",
  179: "Pierwsza kartka",
  185: "Kartki suma",
  188: "Kartki gosp handicap",
  191: "Kartki gości handicap",
  192: "Kartki (zakres)",
  193: "Kartki gosp dokładnie",
  194: "Kartki gości dokładnie",
  196: "Czerwona kartka",
  197: "Czerwona kartka gosp",
  198: "Czerwona kartka gości",
  199: "Więcej kartek (var)",
  206: "Kartki suma (var)",
  217: "Czerwona kartka 1. poł",
  220: "Więcej rzutów rożnych",
  221: "Pierwszy rzut rożny",
  225: "Rzuty rożne handicap",
  228: "Rzuty rożne suma",
  231: "Rożne gosp handicap",
  234: "Rożne gości handicap",
  235: "Rzuty rożne 1. poł",
  236: "Rzuty rożne gosp",
  237: "Rzuty rożne gości",
  239: "Więcej rożnych (var)",
  244: "Rzuty rożne handicap (var)",
  247: "Rzuty rożne suma (var)",
  254: "Rożne gosp 1. poł",
  255: "Rożne gości 1. poł",
  256: "Więcej rożnych 1. poł",
  258: "Pierwszy gol + wynik",
  259: "Remis = zwrot (var)",
  283: "Dokładny wynik",
  314: "Remis = zwrot (var2)",
  368: "Remis = zwrot (var3)",
  807: "DC + BTTS (var1)",
  808: "Wynik 2. poł + BTTS",
  809: "Wynik 2. poł + gole",
  810: "DC + BTTS (var2)",
  811: "DC + BTTS (var3)",
  812: "DC + gole",
  813: "Przedział goli",
  814: "Przedział goli gosp",
  815: "Przedział goli gości",
  816: "Multiwynik",
  817: "Przedział goli 1. poł (var4)",
  818: "Przedział goli 2. poł",
  1012: "HT/FT + gole",
  1051: "Strzelec + wynik",
  1224: "Gość strzeli",
  1229: "Gospodarz strzeli",
  1232: "1. poł - Gość strzeli",
  1233: "1. poł - Gospodarz strzeli",
  1234: "2. poł - Gość strzeli",
  1235: "2. poł - Gospodarz strzeli",
  1244: "Margines zwycięstwa (var5)",
  1413: "Rzut karny",
  1561: "Więcej celnych strzałów",
  1562: "Celne strzały suma",
  1845: "Asysty zawodnika",
  1850: "Strzelec (kiedykolwiek)",
  1851: "Strzały zawodnika",
  1852: "Celne strzały zawodnika",
  1853: "Podania zawodnika",
  1855: "Kartki zawodnika",
  1897: "Celne strzały gosp",
  1898: "Celne strzały gości",
  1899: "Czerwona + rzut karny",
  2004: "Strzelec 2+ goli",
  2005: "Strzelec 3+ goli",
  2006: "Hat-trick",
  2011: "Liczba strzelców",
  2097: "Rożne każda drużyna",
  2098: "Kartki każda drużyna",
  2111: "Faule suma",
  2112: "Faule gosp",
  2113: "Faule gości",
  2114: "Gol samobójczy",
  2153: "Zawodnik (var)",
};

const ALL_LEAGUES = ["ekstraklasa", "premier-league", "laliga", "serie-a", "ligue-1"];

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose") || args.includes("-v");
const SHOW_ISSUES = args.includes("--issues") || args.includes("-i");
const SHOW_RAW = args.includes("--raw") || args.includes("-r");
const SHOW_ALL_DETAILS = args.includes("--all") || args.includes("-a");
const MARKET_ID_ARG = args.find((_, i) => args[i - 1] === "--market" || args[i - 1] === "-m");
const FOCUS_MARKET_ID = MARKET_ID_ARG ? parseInt(MARKET_ID_ARG, 10) : null;
const SINGLE_LEAGUE = args.find(arg => 
  !arg.startsWith("-") && 
  !["--market", "-m", "--verbose", "-v", "--issues", "-i", "--raw", "-r"].includes(args[args.indexOf(arg) - 1] || "") &&
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
      
      for (const fixture of fixtures.slice(0, 3)) {
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
            });
            console.log(`        ${fixture.home} vs ${fixture.away}: ${marketCount} markets`);
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
        marketsMap.set(marketId, {
          id: marketId,
          polishName: MARKET_ID_NAMES[marketId] || `(nieznany ID ${marketId})`,
          rawLines: [],
          normalized: {
            marketCode: null,
            paramValue: undefined,
            marketKey: undefined,
            selections: [],
            matchedBy: undefined,
          },
          issues: [],
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
          name: o.mappedName || o.rawName || String(o.outcomeId),
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

function printMarketDetail(analysis: MarketAnalysis, wsData?: STSWebSocketData): void {
  const { id, polishName, rawLines, normalized, issues } = analysis;
  
  console.log(`\n${"─".repeat(100)}`);
  console.log(`📦 MARKET ID ${id}: ${polishName}`);
  console.log(`${"─".repeat(100)}`);
  
  if (normalized.marketCode) {
    console.log(`\n✅ NORMALIZED: ${normalized.marketCode}`);
    console.log(`   Market Key: ${normalized.marketKey || "N/A"}`);
    console.log(`   Param Value: ${normalized.paramValue || "none"}`);
    console.log(`   Matched By: ${normalized.matchedBy || "unknown"}`);
  } else {
    console.log(`\n❌ NOT NORMALIZED (unmapped market ID)`);
  }
  
  if (issues.length > 0) {
    console.log(`\n⚠️  ISSUES:`);
    for (const issue of issues) {
      console.log(`   - ${issue}`);
    }
  }
  
  console.log(`\n📊 RAW DATA (${rawLines.length} line(s)):`);
  
  for (const line of rawLines.slice(0, VERBOSE ? 10 : 3)) {
    console.log(`\n   Line: "${line.lineName || "(empty)"}" [ID: ${line.lineId}]`);
    console.log(`   ${"─".repeat(80)}`);
    
    console.log(`   ${"OutcomeID".padEnd(10)} ${"Raw Name".padEnd(25)} ${"Mapped Name".padEnd(25)} ${"Odds".padEnd(8)}`);
    console.log(`   ${"─".repeat(10)} ${"─".repeat(25)} ${"─".repeat(25)} ${"─".repeat(8)}`);
    
    for (const outcome of line.outcomes.slice(0, VERBOSE ? 20 : 8)) {
      const rawDisplay = (outcome.rawName || "(empty)").substring(0, 24);
      const mappedDisplay = outcome.mappedName.substring(0, 24);
      console.log(`   ${String(outcome.outcomeId).padEnd(10)} ${rawDisplay.padEnd(25)} ${mappedDisplay.padEnd(25)} ${outcome.odds.toFixed(2).padEnd(8)}`);
    }
    
    if (line.outcomes.length > (VERBOSE ? 20 : 8)) {
      console.log(`   ... and ${line.outcomes.length - (VERBOSE ? 20 : 8)} more outcomes`);
    }
  }
  
  if (rawLines.length > (VERBOSE ? 10 : 3)) {
    console.log(`\n   ... and ${rawLines.length - (VERBOSE ? 10 : 3)} more lines`);
  }
  
  if (normalized.selections.length > 0) {
    console.log(`\n📤 NORMALIZED SELECTIONS (${normalized.selections.length}):`);
    console.log(`   ${"─".repeat(80)}`);
    console.log(`   ${"Status".padEnd(4)} ${"Code".padEnd(20)} ${"Original Label".padEnd(35)} ${"Odds".padEnd(8)}`);
    console.log(`   ${"─".repeat(4)} ${"─".repeat(20)} ${"─".repeat(35)} ${"─".repeat(8)}`);
    
    for (const sel of normalized.selections.slice(0, VERBOSE ? 30 : 10)) {
      const status = sel.isUnknown ? "❌" : "✅";
      const codeDisplay = sel.code.substring(0, 19);
      const labelDisplay = sel.label.substring(0, 34);
      console.log(`   ${status.padEnd(4)} ${codeDisplay.padEnd(20)} ${labelDisplay.padEnd(35)} ${sel.odds.toFixed(2).padEnd(8)}`);
    }
    
    if (normalized.selections.length > (VERBOSE ? 30 : 10)) {
      console.log(`   ... and ${normalized.selections.length - (VERBOSE ? 30 : 10)} more selections`);
    }
  }
  
  if (wsData && (SHOW_ALL_DETAILS || SHOW_RAW)) {
    printRawJsonInline(wsData, id);
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
      const lines = jsonStr.split("\n");
      const maxLines = VERBOSE ? 100 : 30;
      console.log(lines.slice(0, maxLines).join("\n"));
      if (lines.length > maxLines) {
        console.log(`   ... (${lines.length - maxLines} more lines)`);
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

  console.log("\n" + "=".repeat(100));
  console.log(`📊 SUMMARY`);
  console.log("=".repeat(100));
  console.log(`Total markets: ${allMarkets.length}`);
  console.log(`✅ Mapped: ${mapped.length}`);
  console.log(`❌ Unmapped: ${unmapped.length}`);
  console.log(`⚠️  With issues: ${withIssues.length}`);

  console.log("\n" + "=".repeat(100));
  console.log(`✅ MAPPED MARKETS (${mapped.length})`);
  console.log("=".repeat(100));
  console.log(`${"ID".padStart(6)} ${"Polish Name".padEnd(35)} ${"→".padEnd(3)} ${"Normalized Code".padEnd(30)} ${"Sel#".padEnd(5)} ${"Issues"}`);
  console.log(`${"─".repeat(6)} ${"─".repeat(35)} ${"─".repeat(3)} ${"─".repeat(30)} ${"─".repeat(5)} ${"─".repeat(15)}`);

  for (const m of mapped) {
    const issueFlag = m.issues.length > 0 ? `⚠️ ${m.issues.length}` : "";
    const selCount = m.normalized.selections.length;
    console.log(`${String(m.id).padStart(6)} ${m.polishName.substring(0, 34).padEnd(35)} → ${(m.normalized.marketCode || "").padEnd(30)} ${String(selCount).padEnd(5)} ${issueFlag}`);
  }

  if (unmapped.length > 0) {
    console.log("\n" + "=".repeat(100));
    console.log(`❌ UNMAPPED MARKETS (${unmapped.length}) - Add to sts-normalizer.ts`);
    console.log("=".repeat(100));

    for (const m of unmapped) {
      const sampleSels = m.rawLines[0]?.outcomes.slice(0, 3).map(o => o.mappedName).join(", ") || "";
      console.log(`ID ${String(m.id).padStart(4)}: ${m.polishName.padEnd(35)} [${sampleSels}]`);
    }

    console.log("\n📋 Copy to sts-normalizer.ts STS_MARKET_ID_TO_CODE:");
    for (const m of unmapped) {
      console.log(`  ${m.id}: "OTHER", // ${m.polishName}`);
    }
  }

  if (withIssues.length > 0) {
    console.log("\n" + "=".repeat(100));
    console.log(`⚠️  MARKETS WITH ISSUES (${withIssues.length})`);
    console.log("=".repeat(100));

    for (const m of withIssues) {
      console.log(`\nID ${m.id}: ${m.polishName} → ${m.normalized.marketCode || "UNMAPPED"}`);
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
    console.log(`${"=".repeat(100)}`);
    
    const matchCapture = await navigateAndCaptureMatchData(page, bestFixture.fixture.eventUrl);
    if (!matchCapture) {
      console.log("❌ Failed to capture match data");
      return;
    }
    
    let wsData: STSWebSocketData | null = null;
    
    if (matchCapture.fixtureData.size > 0) {
      wsData = matchCapture.fixtureData.get(bestFixture.fixture.id) || null;
    }
    
    if (!wsData && matchCapture.initialData) {
      wsData = parseWebSocketJson(matchCapture.initialData);
    }
    
    if (!wsData) {
      console.log("❌ No WebSocket data available");
      return;
    }
    
    if (SHOW_RAW && FOCUS_MARKET_ID) {
      printRawJson(wsData, FOCUS_MARKET_ID);
    }
    
    const markets = analyzeMarkets(wsData, bestFixture.fixture.home, bestFixture.fixture.away);
    
    if (FOCUS_MARKET_ID) {
      const market = markets.get(FOCUS_MARKET_ID);
      if (market) {
        printMarketDetail(market, wsData);
      } else {
        console.log(`\n❌ Market ID ${FOCUS_MARKET_ID} not found in fixture data`);
      }
    } else if (SHOW_ALL_DETAILS) {
      const allMarkets = Array.from(markets.values()).sort((a, b) => a.id - b.id);
      for (const market of allMarkets) {
        printMarketDetail(market, wsData);
      }
      printSummary(markets);
    } else if (VERBOSE) {
      const withIssues = Array.from(markets.values()).filter(m => m.issues.length > 0);
      for (const market of withIssues) {
        printMarketDetail(market, wsData);
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
