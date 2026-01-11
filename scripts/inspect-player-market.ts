#!/usr/bin/env npx tsx
import { chromium } from "playwright";
import { navigateAndCaptureMatchData, navigateAndCaptureLeagueData } from "../src/scrapers/bookmakers/sts/navigation.js";
import { parseWebSocketJson, parseFixtures, parseAllMarkets } from "../src/scrapers/bookmakers/sts/parser.js";
import type { STSWebSocketData, STSFixture } from "../src/scrapers/bookmakers/sts/types.js";
import { stsNormalizer } from "../src/services/normalization/bookmakers/sts-normalizer.js";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log("Fetching Premier League fixtures...");
    const leagueCapture = await navigateAndCaptureLeagueData(page, "laliga");
    if (!leagueCapture) {
      console.log("No league data");
      return;
    }
    
    const initialJson = parseWebSocketJson(leagueCapture.initialData);
    if (!initialJson) {
      console.log("No initial JSON");
      return;
    }
    
    const fixtures = parseFixtures(initialJson, "laliga");
    if (fixtures.length === 0) {
      console.log("No fixtures");
      return;
    }
    
    let bestFixture = fixtures[0];
    let bestCount = 0;
    
    for (const f of fixtures.slice(0, 5)) {
      const cap = await navigateAndCaptureMatchData(page, f.eventUrl);
      if (!cap) continue;
      const ws = cap.fixtureData.get(f.id) || parseWebSocketJson(cap.initialData);
      if (!ws) continue;
      
      let count = 0;
      for (const [, assocData] of Object.entries(ws.P || {})) {
        const md = (assocData as { m?: Record<string, unknown> }).m;
        if (md) count += Object.keys(md).length;
      }
      
      console.log(f.home + " vs " + f.away + ": " + count + " markets");
      if (count > bestCount) {
        bestCount = count;
        bestFixture = f;
      }
    }
    
    const fixture = bestFixture;
    console.log("\nUsing fixture: " + fixture.home + " vs " + fixture.away);
    console.log("URL: " + fixture.eventUrl + "\n");
    
    const capture = await navigateAndCaptureMatchData(page, fixture.eventUrl);
    if (!capture) {
      console.log("No match data captured");
      return;
    }
    
    let wsData: STSWebSocketData | null = null;
    if (capture.fixtureData.size > 0) {
      wsData = capture.fixtureData.get(fixture.id) || null;
    }
    if (!wsData) {
      wsData = parseWebSocketJson(capture.initialData);
    }
    
    if (!wsData) {
      console.log("No WS data");
      return;
    }
    
    const allMarketIds = new Set<number>();
    for (const [, assocData] of Object.entries(wsData.P || {})) {
      const marketData = (assocData as { m?: Record<string, unknown> }).m;
      if (!marketData) continue;
      for (const mId of Object.keys(marketData)) {
        allMarketIds.add(parseInt(mId, 10));
      }
    }
    
    const sortedIds = [...allMarketIds].sort((a, b) => a - b);
    console.log("All market IDs found: " + sortedIds.join(", "));
    console.log("\nPlayer market IDs (1845-1899): " + sortedIds.filter(id => id >= 1845 && id <= 1899).join(", "));
    console.log("Player market IDs (2000+): " + sortedIds.filter(id => id >= 2000 && id <= 2200).join(", "));
    
    const targetMarkets = [52, 54, 1051, 1851, 1845, 1855, 2004, 2005];
    
    for (const [, assocData] of Object.entries(wsData.P || {})) {
      const marketData = (assocData as { m?: Record<string, unknown> }).m;
      if (!marketData) continue;
      
      for (const targetId of targetMarkets) {
        const market = marketData[String(targetId)] as {
          n?: string;
          l?: Record<string, { n?: string; o?: Record<string, { n?: string; O?: number; v?: number }> }>;
        };
        if (!market) continue;
        
        console.log("\n" + "=".repeat(80));
        console.log("Market " + targetId + ": " + (market.n || "(no name)"));
        console.log("=".repeat(80));
        
        const lines = market.l || {};
        const lineEntries = Object.entries(lines);
        console.log("Total lines: " + lineEntries.length);
        
        console.log("\nFirst 5 lines:");
        let count = 0;
        for (const [lineId, line] of lineEntries) {
          if (count++ >= 5) break;
          console.log("\n  Line " + lineId + ":");
          console.log("    line.n (lineName): \"" + (line.n || "(empty)") + "\"");
          console.log("    Outcomes:");
          const outcomes = line.o || {};
          for (const [outId, outcome] of Object.entries(outcomes)) {
            const odds = outcome.O || outcome.v;
            console.log("      ID " + outId + ": name=\"" + (outcome.n || "(empty)") + "\", odds=" + odds);
          }
        }
      }
    }
    
    console.log("\n\n" + "=".repeat(80));
    console.log("TESTING parseAllMarkets() - Player stat markets");
    console.log("=".repeat(80));
    
    const allFixtures = parseFixtures(wsData, "laliga");
    const matchingFixture = allFixtures.find(f => f.home === fixture.home && f.away === fixture.away);
    
    if (!matchingFixture) {
      console.log("Could not find matching fixture with stsId");
      console.log("Looking at wsData.P keys:");
      for (const key of Object.keys(wsData.P || {})) {
        console.log("  " + key);
      }
      return;
    }
    
    console.log("Found fixture with stsId: " + matchingFixture.stsId);
    
    const stsFixture: STSFixture = matchingFixture;
    
    const parsedMarkets = parseAllMarkets(stsFixture, wsData, null);
    const playerStatMarkets = parsedMarkets.filter(m => m.name.includes("|"));
    
    console.log("\nTotal parsed markets: " + parsedMarkets.length);
    console.log("Player stat markets (with | separator): " + playerStatMarkets.length);
    
    const byMarketId = new Map<string, number>();
    for (const m of playerStatMarkets) {
      const marketId = m.name.split("|")[0];
      byMarketId.set(marketId, (byMarketId.get(marketId) || 0) + 1);
    }
    
    console.log("\nPlayer stat markets by market ID:");
    for (const [marketId, count] of byMarketId.entries()) {
      console.log("  " + marketId + ": " + count + " players");
    }
    
    console.log("\nSample player stat markets:");
    for (const m of playerStatMarkets.slice(0, 5)) {
      console.log("  " + m.name);
      console.log("    Selections: [" + m.selections.map(s => s.name + "@" + s.odds).join(", ") + "]");
    }
    
    console.log("\n\n" + "=".repeat(80));
    console.log("TESTING Normalization of player stat markets");
    console.log("=".repeat(80));
    
    const ctx = { homeTeam: stsFixture.home, awayTeam: stsFixture.away };
    
    const sampleMarkets = [
      ...playerStatMarkets.filter(m => m.name.includes("1051")).slice(0, 2),
      ...playerStatMarkets.filter(m => m.name.includes("1845")).slice(0, 2),
      ...playerStatMarkets.filter(m => m.name.includes("1851")).slice(0, 2),
      ...playerStatMarkets.filter(m => m.name.includes("1855")).slice(0, 2),
    ];
    for (const m of sampleMarkets) {
      const rawMarket = {
        name: m.name,
        bookmakerMarketId: undefined,
        selections: m.selections.map(s => ({ name: s.name, odds: s.odds })),
      };
      
      const normalized = stsNormalizer.normalizeMarket(rawMarket, ctx);
      if (normalized) {
        console.log("\n  " + m.name);
        console.log("    -> marketCode: " + normalized.marketCode);
        console.log("    -> paramValue (player): " + normalized.paramValue);
        console.log("    -> marketKey: " + normalized.marketKey);
        console.log("    -> selections: [" + normalized.selections.slice(0, 3).map(s => s.code + "@" + s.odds).join(", ") + "]");
      } else {
        console.log("\n  " + m.name + " -> FAILED TO NORMALIZE");
      }
    }
    
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
