#!/usr/bin/env npx tsx
import { chromium } from "playwright";
import {
  navigateAndCaptureLeagueData,
  navigateAndCaptureMatchData,
} from "../src/scrapers/bookmakers/sts/navigation.js";
import {
  parseWebSocketJson,
  parseFixtures,
} from "../src/scrapers/bookmakers/sts/parser.js";
import type { STSWebSocketData } from "../src/scrapers/bookmakers/sts/types.js";

const LEAGUE = process.argv[2] || "laliga";
const TARGET_MARKET_ID = process.argv[3] ? parseInt(process.argv[3], 10) : null;

interface OutcomeRawData {
  outcomeId: number;
  n: string | undefined;
  O: number | undefined;
  allFields: Record<string, unknown>;
}

interface LineRawData {
  lineId: string;
  n: string | undefined;
  outcomes: OutcomeRawData[];
  allFields: Record<string, unknown>;
}

interface MarketRawData {
  marketId: number;
  n: string | undefined;
  lines: LineRawData[];
  allFields: Record<string, unknown>;
}

async function analyzeRawData() {
  console.log("STS Raw Data Analysis - " + LEAGUE);
  if (TARGET_MARKET_ID) {
    console.log("Targeting market ID: " + TARGET_MARKET_ID);
  }
  console.log("");
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("Navigating to " + LEAGUE + "...");
    
    const leagueCapture = await navigateAndCaptureLeagueData(page, LEAGUE);
    if (!leagueCapture) {
      console.log("No WebSocket data captured");
      return;
    }

    const initialJson = parseWebSocketJson(leagueCapture.initialData);
    if (!initialJson) {
      console.log("Failed to parse WebSocket data");
      return;
    }

    const fixtures = parseFixtures(initialJson, LEAGUE);
    if (fixtures.length === 0) {
      console.log("No fixtures found");
      return;
    }

    const firstFixture = fixtures[0];
    console.log("Match: " + firstFixture.home + " vs " + firstFixture.away);
    console.log("");

    const matchCapture = await navigateAndCaptureMatchData(page, firstFixture.eventUrl);
    if (!matchCapture) {
      console.log("No match data captured");
      return;
    }

    let wsData: STSWebSocketData | null = null;
    if (matchCapture.fixtureData.size > 0) {
      wsData = matchCapture.fixtureData.get(firstFixture.id) || null;
    }
    if (!wsData && matchCapture.initialData) {
      wsData = parseWebSocketJson(matchCapture.initialData);
    }
    
    if (!wsData) {
      console.log("No market data");
      return;
    }

    const markets: MarketRawData[] = [];
    const allOutcomeFields = new Set<string>();
    const allLineFields = new Set<string>();
    const allMarketFields = new Set<string>();
    
    for (const [, assocData] of Object.entries(wsData.P || {})) {
      const marketData = (assocData as { m?: Record<string, unknown> }).m;
      if (!marketData) continue;
      
      for (const [marketIdStr, market] of Object.entries(marketData)) {
        const marketId = parseInt(marketIdStr, 10);
        
        if (TARGET_MARKET_ID && marketId !== TARGET_MARKET_ID) continue;
        
        const mkt = market as Record<string, unknown>;
        
        for (const key of Object.keys(mkt)) {
          allMarketFields.add(key);
        }
        
        const marketRaw: MarketRawData = {
          marketId,
          n: mkt.n as string | undefined,
          lines: [],
          allFields: { ...mkt, l: "[lines]" },
        };
        
        const lines = (mkt.l || {}) as Record<string, Record<string, unknown>>;
        
        for (const [lineId, line] of Object.entries(lines)) {
          for (const key of Object.keys(line)) {
            allLineFields.add(key);
          }
          
          const lineRaw: LineRawData = {
            lineId,
            n: line.n as string | undefined,
            outcomes: [],
            allFields: { ...line, o: "[outcomes]" },
          };
          
          const outcomes = (line.o || {}) as Record<string, Record<string, unknown>>;
          
          for (const [outcomeIdStr, outcome] of Object.entries(outcomes)) {
            const outcomeId = parseInt(outcomeIdStr, 10);
            
            for (const key of Object.keys(outcome)) {
              allOutcomeFields.add(key);
            }
            
            lineRaw.outcomes.push({
              outcomeId,
              n: outcome.n as string | undefined,
              O: outcome.O as number | undefined,
              allFields: outcome,
            });
          }
          
          marketRaw.lines.push(lineRaw);
        }
        
        markets.push(marketRaw);
      }
    }

    console.log("=".repeat(100));
    console.log("FIELD DISCOVERY");
    console.log("=".repeat(100));
    console.log("");
    console.log("Market-level fields: " + [...allMarketFields].sort().join(", "));
    console.log("Line-level fields: " + [...allLineFields].sort().join(", "));
    console.log("Outcome-level fields: " + [...allOutcomeFields].sort().join(", "));

    const marketsWithEmptyNames = markets.filter(m => 
      m.lines.some(l => l.outcomes.some(o => !o.n || o.n.length <= 1))
    );
    const marketsWithNames = markets.filter(m => 
      m.lines.every(l => l.outcomes.every(o => o.n && o.n.length > 1))
    );

    console.log("");
    console.log("Statistics:");
    console.log("  Total markets analyzed: " + markets.length);
    console.log("  Markets with selection names: " + marketsWithNames.length);
    console.log("  Markets with empty/missing names: " + marketsWithEmptyNames.length);

    console.log("");
    console.log("=".repeat(100));
    console.log("MARKETS WITH SELECTION NAMES (working)");
    console.log("=".repeat(100));

    for (const m of marketsWithNames.slice(0, 5)) {
      console.log("");
      console.log("Market " + m.marketId + ": " + (m.n || "(no name)"));
      for (const line of m.lines.slice(0, 2)) {
        console.log("  Line: " + (line.n || "(no name)"));
        for (const o of line.outcomes.slice(0, 3)) {
          console.log("    Outcome " + o.outcomeId + ": n=" + JSON.stringify(o.n) + " O=" + o.O);
        }
      }
    }

    console.log("");
    console.log("=".repeat(100));
    console.log("MARKETS WITH EMPTY NAMES (broken) - Full outcome data");
    console.log("=".repeat(100));

    const interestingMarkets = [1, 10, 11, 33, 35, 36, 40, 43, 47, 48, 58];
    const toAnalyze = TARGET_MARKET_ID 
      ? marketsWithEmptyNames 
      : marketsWithEmptyNames.filter(m => interestingMarkets.includes(m.marketId));

    for (const m of toAnalyze.slice(0, 10)) {
      console.log("");
      console.log("-".repeat(80));
      console.log("Market " + m.marketId + ": " + (m.n || "(no name)"));
      console.log("Market fields: " + JSON.stringify(m.allFields, null, 2));
      
      for (const line of m.lines.slice(0, 2)) {
        console.log("");
        console.log("  Line " + line.lineId + ": " + (line.n || "(no name)"));
        console.log("  Line fields: " + JSON.stringify(line.allFields, null, 2));
        
        for (const o of line.outcomes.slice(0, 5)) {
          console.log("");
          console.log("    Outcome " + o.outcomeId + ":");
          console.log("    " + JSON.stringify(o.allFields, null, 2).split("\n").join("\n    "));
        }
        if (line.outcomes.length > 5) {
          console.log("    ... and " + (line.outcomes.length - 5) + " more outcomes");
        }
      }
    }

    console.log("");
    console.log("=".repeat(100));
    console.log("OUTCOME ID PATTERNS");
    console.log("=".repeat(100));

    const outcomeIdsByMarket = new Map<number, number[]>();
    for (const m of markets) {
      const ids: number[] = [];
      for (const l of m.lines) {
        for (const o of l.outcomes) {
          if (!ids.includes(o.outcomeId)) {
            ids.push(o.outcomeId);
          }
        }
      }
      outcomeIdsByMarket.set(m.marketId, ids.sort((a, b) => a - b));
    }

    console.log("");
    console.log("Outcome IDs by market (for markets with empty names):");
    for (const m of marketsWithEmptyNames.slice(0, 20)) {
      const ids = outcomeIdsByMarket.get(m.marketId) || [];
      console.log("  Market " + m.marketId.toString().padStart(4) + ": [" + ids.join(", ") + "]");
    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await browser.close();
  }
}

analyzeRawData().catch(console.error);
