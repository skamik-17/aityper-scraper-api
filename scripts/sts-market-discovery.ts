#!/usr/bin/env npx tsx
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

interface SelectionInfo {
  rawName: string;
  normalizedCode: string;
  isUnknown: boolean;
}

interface LineInfo {
  lineName: string;
  paramValue: string | undefined;
  selections: SelectionInfo[];
}

interface MarketInfo {
  id: number;
  marketIdName: string;
  normalizedCode: string | null;
  lines: LineInfo[];
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
  57: "Gole w obu połowach",
  58: "Połowa/Koniec (HT/FT)",
  59: "Gole w obu połowach (gosp)",
  60: "Gole w obu połowach (gość)",
  61: "Połowa z więcej goli",
  71: "Wynik 1. połowy",
  74: "Podwójna szansa 1. poł",
  75: "Remis = zwrot 1. poł",
  76: "Handicap europejski 1. poł",
  77: "Handicap azjatycki 1. poł",
  82: "Liczba goli 1. połowa",
  85: "Gole gosp 1. połowa",
  88: "Gole gości 1. połowa",
  90: "Przedział goli 1. poł",
  95: "BTTS 1. połowa",
  99: "Wynik + gole 1. poł",
  101: "Dokładny wynik 1. poł",
  102: "Wynik 2. połowy",
  105: "Remis = zwrot 2. poł",
  106: "Handicap europejski 2. poł",
  107: "Handicap azjatycki 2. poł",
  112: "Liczba goli 2. połowa",
  115: "Gole gosp 2. połowa",
  118: "Gole gości 2. połowa",
  121: "BTTS 2. połowa",
  124: "Dokładny wynik 2. poł",
  125: "Czas pierwszego gola",
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
  235: "Rzuty rożne 1. poł",
  231: "Rożne gosp handicap",
  234: "Rożne gości handicap",
  236: "Rzuty rożne gosp",
  237: "Rzuty rożne gości",
  256: "Więcej rożnych 1. poł",
  258: "Pierwszy gol + wynik",
  283: "Dokładny wynik",
  807: "DC + BTTS (var1)",
  808: "Wynik 2. poł + BTTS",
  809: "Wynik 2. poł + gole",
  812: "DC + gole",
  1012: "HT/FT + gole",
  1051: "Strzelec + wynik",
  1224: "Gość strzeli",
  1229: "Gospodarz strzeli",
  1845: "Asysty zawodnika",
  1850: "Strzelec (kiedykolwiek)",
  1851: "Strzały zawodnika",
  1852: "Celne strzały zawodnika",
  1853: "Podania zawodnika",
  1855: "Kartki zawodnika",
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
  1413: "Rzut karny",
  1561: "Więcej celnych strzałów",
  1562: "Celne strzały suma",
  1897: "Celne strzały gosp",
  1898: "Celne strzały gości",
  1899: "Czerwona + rzut karny",
};

const ALL_LEAGUES = ["ekstraklasa", "premier-league", "laliga", "serie-a", "ligue-1"];

const VERBOSE = process.argv.includes("--verbose") || process.argv.includes("-v");
const SHOW_ISSUES = process.argv.includes("--issues") || process.argv.includes("-i");
const SINGLE_LEAGUE = process.argv.find(arg => !arg.startsWith("-") && arg !== process.argv[0] && arg !== process.argv[1]);

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
  
  console.log(`🔍 Scanning ${leagues.length} league(s) for best fixture...\n`);
  
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

async function analyzeFixture(
  page: Page,
  candidate: FixtureCandidate
): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`🏆 BEST FIXTURE: ${candidate.fixture.home} vs ${candidate.fixture.away}`);
  console.log(`   League: ${candidate.league}, Markets: ${candidate.marketCount}`);
  console.log(`${"=".repeat(100)}\n`);
  
  const matchCapture = await navigateAndCaptureMatchData(page, candidate.fixture.eventUrl);
  if (!matchCapture) {
    console.log("❌ Failed to capture match data");
    return;
  }
  
  let wsData: STSWebSocketData | null = null;
  
  if (matchCapture.fixtureData.size > 0) {
    wsData = matchCapture.fixtureData.get(candidate.fixture.id) || null;
  }
  
  if (!wsData && matchCapture.initialData) {
    wsData = parseWebSocketJson(matchCapture.initialData);
  }
  
  if (!wsData) {
    console.log("❌ No market data available");
    return;
  }
  
  const ctx = { homeTeam: candidate.fixture.home, awayTeam: candidate.fixture.away };
  const marketsMap = new Map<number, MarketInfo>();
  
  for (const [, assocData] of Object.entries(wsData.P || {})) {
    const marketData = (assocData as { m?: Record<string, unknown> }).m;
    if (!marketData) continue;
    
    for (const [marketIdStr, market] of Object.entries(marketData)) {
      const marketId = parseInt(marketIdStr, 10);
      const mkt = market as { n?: string; l?: Record<string, { n?: string; o?: Record<string, { n?: string; v?: number }> }> };
      
      if (!marketsMap.has(marketId)) {
        marketsMap.set(marketId, {
          id: marketId,
          marketIdName: MARKET_ID_NAMES[marketId] || `(nieznany ID ${marketId})`,
          normalizedCode: null,
          lines: [],
          issues: [],
        });
      }
      
      const marketInfo = marketsMap.get(marketId)!;
      const lines = mkt.l || {};
      
      for (const [, line] of Object.entries(lines)) {
        const lineName = line.n || "";
        const outcomes = line.o || {};
        
        const rawSelections = Object.entries(outcomes).map(([outcomeIdStr, o]) => {
          const outcomeId = parseInt(outcomeIdStr, 10);
          let name = o.n || "";
          if (!name || name.length <= 1) {
            name = getSelectionNameByOutcomeId(outcomeId) || String(outcomeId);
          }
          return { name, odds: o.v || 0 };
        });
        
        const testResult = stsNormalizer.normalizeMarket(
          { 
            name: lineName || `Rynek ${marketId}`, 
            bookmakerMarketId: String(marketId), 
            selections: rawSelections 
          },
          ctx
        );
        
        if (testResult && !marketInfo.normalizedCode) {
          marketInfo.normalizedCode = testResult.marketCode;
        }
        
        const passthroughMarketTypes = [
          "GOAL_RANGE", "TEAM_GOAL_RANGE", "HALF_TIME_GOAL_RANGE", "SECOND_HALF_GOAL_RANGE",
          "CORNERS_TEAM", "HALF_TIME_CORNERS_TEAM", "HALF_TIME_CORNERS_TOTAL", "HALF_TIME_CORNERS_RACE",
          "TIME_PERIOD_RESULT", "WINNING_MARGIN", "FIRST_GOAL_TIME", "OTHER",
          "CARDS_TEAM", "CARDS_TOTAL", "FOULS_TOTAL",
        ];
        const marketCode = testResult?.marketCode || "";
        const isPassthroughMarket = passthroughMarketTypes.includes(marketCode);
        
        const lineInfo: LineInfo = {
          lineName,
          paramValue: testResult?.paramValue,
          selections: rawSelections.map(sel => {
            const normalizedSel = testResult?.selections.find(s => s.label === sel.name);
            const code = normalizedSel?.code || "NOT_NORMALIZED";
            if (marketCode === "OTHER") {
              return { rawName: sel.name, normalizedCode: code, isUnknown: false };
            }
            const isNumericPassthrough = /^\d+$/.test(code) && isPassthroughMarket;
            const isRangePassthrough = /^\d+-\d+$/.test(code) || /^\d+\+$/.test(code);
            return {
              rawName: sel.name,
              normalizedCode: code,
              isUnknown: code === "UNKNOWN" || code === "NOT_NORMALIZED" || 
                (/^\d+$/.test(code) && !isNumericPassthrough && !isRangePassthrough),
            };
          }),
        };
        
        marketInfo.lines.push(lineInfo);
      }
    }
  }

  for (const market of marketsMap.values()) {
    const unknownSelections = market.lines.flatMap(l => l.selections.filter(s => s.isUnknown));
    if (unknownSelections.length > 0) {
      const uniqueUnknown = [...new Set(unknownSelections.map(s => `${s.rawName} → ${s.normalizedCode}`))];
      market.issues.push(`UNKNOWN_SELECTIONS: ${uniqueUnknown.slice(0, 5).join(", ")}${uniqueUnknown.length > 5 ? ` (+${uniqueUnknown.length - 5} more)` : ""}`);
    }
    
    const linesWithParam = market.lines.filter(l => l.paramValue);
    const linesWithoutParam = market.lines.filter(l => !l.paramValue);
    if (linesWithParam.length > 0 && linesWithoutParam.length > 0) {
      market.issues.push(`MIXED_PARAMS: ${linesWithParam.length} with param, ${linesWithoutParam.length} without (will create 'base' parameter)`);
    }
    
    if (market.normalizedCode?.startsWith("PLAYER_") || market.normalizedCode?.startsWith("GOALSCORER_")) {
      const hasPlayerInSelection = market.lines.some(l => 
        l.selections.some(s => /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(s.rawName))
      );
      const hasPlayerAsParam = market.lines.some(l => l.paramValue && /[A-Z][a-z]+/.test(l.paramValue));
      const hasPlayerInLineName = market.lines.some(l => 
        /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(l.lineName)
      );
      
      if (!hasPlayerInSelection && !hasPlayerAsParam && !hasPlayerInLineName) {
        market.issues.push(`MISSING_PLAYER: Player name not preserved in selections, params, or line names`);
      }
    }
  }

  const markets = Array.from(marketsMap.values()).sort((a, b) => a.id - b.id);
  const mapped = markets.filter(m => m.normalizedCode !== null);
  const unmapped = markets.filter(m => m.normalizedCode === null);
  const withIssues = markets.filter(m => m.issues.length > 0);

  console.log("\n" + "=".repeat(100));
  console.log(`📊 SUMMARY`);
  console.log("=".repeat(100));
  console.log(`Total markets: ${markets.length}`);
  console.log(`✅ Mapped: ${mapped.length}`);
  console.log(`❌ Unmapped: ${unmapped.length}`);
  console.log(`⚠️  With issues: ${withIssues.length}`);

  console.log("\n" + "=".repeat(100));
  console.log(`✅ MAPPED MARKETS (${mapped.length})`);
  console.log("=".repeat(100));

  for (const m of mapped) {
    const issueFlag = m.issues.length > 0 ? " ⚠️" : "";
    const sampleSel = m.lines[0]?.selections.slice(0, 3).map(s => s.rawName).join(", ") || "";
    console.log(`ID ${m.id.toString().padStart(4)}: ${m.marketIdName.padEnd(30)} → ${m.normalizedCode}${issueFlag}`);
    
    if (VERBOSE) {
      console.log(`         Lines: ${m.lines.length}, Sample: [${sampleSel}]`);
      if (m.lines[0]?.paramValue) {
        console.log(`         ParamValue: ${m.lines[0].paramValue}`);
      }
    }
  }

  if (unmapped.length > 0) {
    console.log("\n" + "=".repeat(100));
    console.log(`❌ UNMAPPED MARKETS (${unmapped.length}) - need to add to sts-normalizer.ts`);
    console.log("=".repeat(100));

    for (const m of unmapped) {
      const sampleSel = m.lines[0]?.selections.slice(0, 3).map(s => s.rawName).join(", ") || "";
      console.log(`ID ${m.id.toString().padStart(4)}: ${m.marketIdName.padEnd(30)} [${sampleSel}]`);
    }

    console.log("\n📋 UNMAPPED IDS (copy to sts-normalizer.ts):");
    console.log(unmapped.map(m => m.id).join(", "));
  }

  if (withIssues.length > 0 && (SHOW_ISSUES || VERBOSE)) {
    console.log("\n" + "=".repeat(100));
    console.log(`⚠️  MARKETS WITH ISSUES (${withIssues.length})`);
    console.log("=".repeat(100));

    for (const m of withIssues) {
      console.log(`\nID ${m.id}: ${m.marketIdName} → ${m.normalizedCode || "UNMAPPED"}`);
      for (const issue of m.issues) {
        console.log(`   ⚠️  ${issue}`);
      }
      
      if (VERBOSE) {
        console.log(`   Lines (${m.lines.length}):`);
        for (const line of m.lines.slice(0, 3)) {
          const paramStr = line.paramValue ? ` [param: ${line.paramValue}]` : " [no param]";
          console.log(`     - "${line.lineName}"${paramStr}`);
          for (const sel of line.selections.slice(0, 5)) {
            const flag = sel.isUnknown ? "❌" : "✅";
            console.log(`       ${flag} "${sel.rawName}" → ${sel.normalizedCode}`);
          }
          if (line.selections.length > 5) {
            console.log(`       ... and ${line.selections.length - 5} more selections`);
          }
        }
        if (m.lines.length > 3) {
          console.log(`     ... and ${m.lines.length - 3} more lines`);
        }
      }
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log(`🔧 ISSUE BREAKDOWN`);
  console.log("=".repeat(100));
  
  const unknownSelIssues = withIssues.filter(m => m.issues.some(i => i.includes("UNKNOWN_SELECTIONS")));
  const mixedParamIssues = withIssues.filter(m => m.issues.some(i => i.includes("MIXED_PARAMS")));
  const missingPlayerIssues = withIssues.filter(m => m.issues.some(i => i.includes("MISSING_PLAYER")));
  
  console.log(`UNKNOWN_SELECTIONS: ${unknownSelIssues.length} markets - Selections mapping to UNKNOWN`);
  console.log(`MIXED_PARAMS: ${mixedParamIssues.length} markets - Will create unwanted 'base' parameter`);
  console.log(`MISSING_PLAYER: ${missingPlayerIssues.length} markets - Player name not preserved`);

  if (!SHOW_ISSUES && !VERBOSE && withIssues.length > 0) {
    console.log(`\n💡 Run with --issues or --verbose to see detailed issue breakdown`);
  }
}

async function discoverMarkets() {
  console.log(`🔍 STS Market Discovery - Multi-League Scanner\n`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const bestFixture = await findBestFixture(page);
    
    if (!bestFixture) {
      console.log("\n❌ No fixtures found in any league");
      return;
    }
    
    await analyzeFixture(page, bestFixture);
    
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await browser.close();
  }
}

discoverMarkets().catch(console.error);
