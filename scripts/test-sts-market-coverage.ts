/**
 * STS Market Coverage Test
 *
 * Tests which of our 40 canonical markets are properly scraped from STS.
 * Compares STS market data against our market registry definitions.
 *
 * Usage:
 *   npx tsx scripts/test-sts-market-coverage.ts                    # Test default league (laliga)
 *   npx tsx scripts/test-sts-market-coverage.ts --league ekstraklasa  # Test specific league
 *   npx tsx scripts/test-sts-market-coverage.ts --all-leagues      # Test all 5 leagues
 */

import { chromium, type Page, type WebSocket } from "playwright";
import * as fs from "fs";
import {
  UNIFIED_MARKET_REGISTRY,
  type UnifiedMarketDefinition,
} from "../src/data/market-registry.js";
import {
  MARKET_IDS,
  MARKET_TYPES,
  CORRECT_SCORE_OUTCOMES,
  HALF_CORRECT_SCORE_OUTCOMES,
  LEAGUE_CONFIG,
} from "../src/scrapers/bookmakers/sts/constants.js";

// ============================================================================
// Types
// ============================================================================

interface WSCaptureResult {
  initialData: string;
  fixtureData: Map<string, any>;
}

interface STSMarketInfo {
  marketId: number;
  lineName: string;
  outcomeCount: number;
  sampleOutcomes: { id: string; name: string | null; odds: number }[];
}

interface CoverageResult {
  marketCode: string;
  numericId: number;
  label: string;
  category: string;
  stsIdMappings: number[];
  foundInSTS: boolean;
  matchedSTSMarkets: STSMarketInfo[];
  status: "COVERED" | "PARTIAL" | "MISSING" | "NO_MAPPING";
}

// ============================================================================
// WebSocket Capture (same as analyzer)
// ============================================================================

const WS_URL_PATTERN = "/sbk/api/sbk";

// ============================================================================
// LEAGUE CONFIGURATION
// ============================================================================
const ALL_LEAGUES = ["ekstraklasa", "premier-league", "laliga", "serie-a", "ligue-1"] as const;
type LeagueName = typeof ALL_LEAGUES[number];

// Parse command-line arguments
function parseArgs(): { leagues: LeagueName[]; specificMatchUrl?: string } {
  const args = process.argv.slice(2);

  // Check for --all-leagues flag
  if (args.includes("--all-leagues")) {
    return { leagues: [...ALL_LEAGUES] };
  }

  // Check for --league argument
  const leagueIndex = args.findIndex(a => a === "--league");
  if (leagueIndex !== -1 && args[leagueIndex + 1]) {
    const league = args[leagueIndex + 1] as LeagueName;
    if (ALL_LEAGUES.includes(league)) {
      return { leagues: [league] };
    }
    console.error(`Unknown league: ${league}`);
    console.error(`Available: ${ALL_LEAGUES.join(", ")}`);
    process.exit(1);
  }

  // Check for --url argument (specific match URL)
  const urlIndex = args.findIndex(a => a === "--url");
  const specificMatchUrl = urlIndex !== -1 ? args[urlIndex + 1] : undefined;

  // Default to laliga
  return { leagues: ["laliga"], specificMatchUrl };
}

function setupWebSocketCapture(page: Page, result: WSCaptureResult): void {
  page.on("websocket", (ws: WebSocket) => {
    if (!ws.url().includes(WS_URL_PATTERN)) return;

    ws.on("framereceived", (frame) => {
      const data = typeof frame.payload === "string" ? frame.payload : "";

      if (data.includes('"s":"i_pl"') && data.length > result.initialData.length) {
        result.initialData = data;
      }

      const fixtureMatch = data.match(/"s":"f_(f\d+)_pl"/);
      if (fixtureMatch && data.length > 1000) {
        try {
          const lines = data.split("\n");
          const jsonData = JSON.parse(lines[1] || lines[0]);
          result.fixtureData.set(fixtureMatch[1], jsonData);
        } catch { /* ignore */ }
      }
    });
  });
}

async function waitForData(
  checkCondition: () => boolean,
  maxWait: number = 10000,
  pollInterval: number = 500
): Promise<void> {
  const iterations = Math.ceil(maxWait / pollInterval);
  for (let i = 0; i < iterations; i++) {
    if (checkCondition()) return;
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

function parseWebSocketJson(rawData: string): any | null {
  try {
    const lines = rawData.split("\n");
    return JSON.parse(lines[1] || lines[0]);
  } catch {
    return null;
  }
}

// ============================================================================
// Main Test Function
// ============================================================================

interface LeagueCoverageResult {
  league: string;
  matchUrl: string;
  stsMarketsCount: number;
  coverageResults: CoverageResult[];
  unmappedSTSMarkets: STSMarketInfo[];
}

async function testSTSMarketCoverageForLeague(
  leagueName: LeagueName,
  browser: any,
  specificMatchUrl?: string
): Promise<LeagueCoverageResult | null> {
  const LEAGUE = LEAGUE_CONFIG[leagueName];
  if (!LEAGUE) {
    console.log(`[Test] League ${leagueName} not found in config`);
    return null;
  }
  const LEAGUE_URL = LEAGUE.url;

  console.log(`\n${"─".repeat(80)}`);
  console.log(`TESTING LEAGUE: ${leagueName.toUpperCase()}`);
  console.log(`${"─".repeat(80)}`);

  const context = await browser.newContext();
  const page = await context.newPage();

  const captureResult: WSCaptureResult = {
    initialData: "",
    fixtureData: new Map(),
  };

  setupWebSocketCapture(page, captureResult);

  try {
    // Navigate to league page to get initial data
    console.log(`[Test] Navigating to ${leagueName} page: ${LEAGUE_URL}`);
    await page.goto(LEAGUE_URL, {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });
    await new Promise((r) => setTimeout(r, 2000));

    // Accept cookies
    try {
      const cookieBtn = page.locator('text=Akceptuj wszystkie').first();
      if (await cookieBtn.isVisible({ timeout: 2000 })) {
        await cookieBtn.click();
      }
    } catch { /* ignore */ }

    await waitForData(() => captureResult.initialData.length > 10000, 10000);

    if (!captureResult.initialData) {
      throw new Error("No initial WebSocket data captured");
    }

    // Find a match and navigate to it
    const initialJson = parseWebSocketJson(captureResult.initialData);
    let matchUrl = "";
    let fixtureId = "";

    const football = initialJson?.B?.S?.["1"];
    if (football?.C) {
      for (const [, cat] of Object.entries(football.C) as [string, any][]) {
        if (!(cat.n || "").toLowerCase().includes(LEAGUE.countryFilter)) continue;
        for (const [, tourn] of Object.entries(cat.T || {}) as [string, any][]) {
          const tournName = (tourn.n || "").toLowerCase();
          // Match tournament filter, exclude secondary divisions
          if (!tournName.includes(LEAGUE.tournamentFilter)) continue;
          if (tournName.includes("2") || tournName.includes("hypermotion") || tournName.includes("segunda")) continue;
          for (const [fixId, fix] of Object.entries(tourn.FX || {}) as [string, any][]) {
            if (fix.H?.n && fix.A?.n) {
              const homeSlug = fix.H.n.toLowerCase().normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
              const awaySlug = fix.A.n.toLowerCase().normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
              matchUrl = `https://www.sts.pl/kursy/${homeSlug}-${awaySlug}/${fixId}`;
              fixtureId = fixId;
              console.log(`[Test] Found match: ${fix.H.n} vs ${fix.A.n}`);
              break;
            }
          }
          if (matchUrl) break;
        }
        if (matchUrl) break;
      }
    }

    // Use specific match URL if provided
    if (specificMatchUrl) {
      matchUrl = specificMatchUrl;
      const idMatch = specificMatchUrl.match(/\/(f\d+)/);
      fixtureId = idMatch?.[1] || "";
      console.log(`[Test] Using specific match URL: ${matchUrl}`);
      console.log(`[Test] Extracted fixture ID: ${fixtureId}`);
    }

    if (!matchUrl) {
      console.log(`[Test] No ${leagueName} match found - skipping`);
      await context.close();
      return null;
    }

    // Navigate to match page
    console.log(`[Test] Navigating to match: ${matchUrl}`);
    captureResult.fixtureData.clear();
    page.removeAllListeners("websocket");
    setupWebSocketCapture(page, captureResult);

    await page.goto(matchUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 3000)); // Extra wait for "wszystkie" bundle

    await waitForData(
      () => captureResult.fixtureData.has(fixtureId) || captureResult.initialData.length > 100000,
      20000 // Longer wait for full data
    );

    // Get fixture data - try both sources
    let fixtureData = captureResult.fixtureData.get(fixtureId);
    const initialData = parseWebSocketJson(captureResult.initialData);

    console.log(`[Test] Fixture data captured: ${fixtureData ? 'YES' : 'NO'}`);
    console.log(`[Test] Initial data parsed: ${initialData ? 'YES' : 'NO'}`);

    if (fixtureData) {
      console.log(`[Test] Fixture P keys: ${Object.keys(fixtureData.P || {}).slice(0, 5).join(", ")}...`);
    }
    if (initialData) {
      console.log(`[Test] Initial P keys: ${Object.keys(initialData.P || {}).slice(0, 5).join(", ")}...`);
    }

    // Combine both sources - fixture data often has more markets
    const allData = [fixtureData, initialData].filter(Boolean);

    if (allData.length === 0) {
      throw new Error("No fixture data captured");
    }

    // Extract all STS markets from all sources
    const stsMarkets = new Map<number, STSMarketInfo>();

    // Find the correct assocKey for our fixture (format: "1m{stsId}")
    // We need to find which assocKey contains football markets (1, 10, 25, 43, etc.)

    for (const data of allData) {
      for (const [assocKey, assocData] of Object.entries(data.P || {})) {
        const marketData = (assocData as any).m;
        if (!marketData) continue;

        // Check if this assocKey has football markets (1, 10, 25, 43)
        const marketIds = Object.keys(marketData).map(k => parseInt(k, 10));
        const hasFootballMarkets = marketIds.some(id => [1, 10, 25, 43].includes(id));

        if (!hasFootballMarkets && marketIds.length < 50) {
          // Skip non-football assocKeys (unless they have many markets)
          continue;
        }

        console.log(`[Test] Processing assocKey: ${assocKey} with ${marketIds.length} markets`);

        for (const [marketIdStr, market] of Object.entries(marketData)) {
          const marketId = parseInt(marketIdStr, 10);
          const mkt = market as any;

          for (const [, line] of Object.entries(mkt.l || {}) as [string, any][]) {
            const outcomes = line.o || {};
            const sampleOutcomes = Object.entries(outcomes).slice(0, 5).map(([id, o]: [string, any]) => ({
              id,
              name: o.n || null,
              odds: o.O,
            }));

            const existing = stsMarkets.get(marketId);
            if (!existing || Object.keys(outcomes).length > existing.outcomeCount) {
              stsMarkets.set(marketId, {
                marketId,
                lineName: line.n || `Line ${marketId}`,
                outcomeCount: Object.keys(outcomes).length,
                sampleOutcomes,
              });
            }
          }
        }
      }
    }

    console.log(`\n[Test] Found ${stsMarkets.size} unique STS markets\n`);

    // Build coverage report
    const coverageResults: CoverageResult[] = [];

    for (const market of UNIFIED_MARKET_REGISTRY) {
      const stsIdMappings = market.bookmakerData?.sts?.idMappings || [];
      const matchedSTSMarkets: STSMarketInfo[] = [];

      for (const stsId of stsIdMappings) {
        const stsMarket = stsMarkets.get(stsId);
        if (stsMarket) {
          matchedSTSMarkets.push(stsMarket);
        }
      }

      let status: CoverageResult["status"];
      if (stsIdMappings.length === 0) {
        status = "NO_MAPPING";
      } else if (matchedSTSMarkets.length === stsIdMappings.length) {
        status = "COVERED";
      } else if (matchedSTSMarkets.length > 0) {
        status = "PARTIAL";
      } else {
        status = "MISSING";
      }

      coverageResults.push({
        marketCode: market.code,
        numericId: market.numericId,
        label: market.labels.pl,
        category: market.category,
        stsIdMappings,
        foundInSTS: matchedSTSMarkets.length > 0,
        matchedSTSMarkets,
        status,
      });
    }

    // Show STS markets we're NOT mapping
    const mappedSTSIds = new Set<number>();
    for (const market of UNIFIED_MARKET_REGISTRY) {
      const ids = market.bookmakerData?.sts?.idMappings || [];
      ids.forEach(id => mappedSTSIds.add(id));
    }

    const unmappedSTSMarkets = Array.from(stsMarkets.values())
      .filter(m => !mappedSTSIds.has(m.marketId))
      .sort((a, b) => a.marketId - b.marketId);

    // Print summary for this league
    const byStatus = {
      COVERED: coverageResults.filter(r => r.status === "COVERED"),
      PARTIAL: coverageResults.filter(r => r.status === "PARTIAL"),
      MISSING: coverageResults.filter(r => r.status === "MISSING"),
      NO_MAPPING: coverageResults.filter(r => r.status === "NO_MAPPING"),
    };

    console.log(`\n[${leagueName}] Coverage: ✅${byStatus.COVERED.length} ⚠️${byStatus.PARTIAL.length} ❌${byStatus.MISSING.length} ⬜${byStatus.NO_MAPPING.length}`);
    console.log(`[${leagueName}] STS Markets: ${stsMarkets.size}, Unmapped: ${unmappedSTSMarkets.length}`);

    await context.close();

    return {
      league: leagueName,
      matchUrl,
      stsMarketsCount: stsMarkets.size,
      coverageResults,
      unmappedSTSMarkets,
    };
  } catch (error) {
    console.error(`[${leagueName}] Error:`, error);
    await context.close();
    return null;
  }
}

function printDetailedResults(results: LeagueCoverageResult[]): void {
  console.log("\n" + "═".repeat(80));
  console.log("AGGREGATED COVERAGE SUMMARY");
  console.log("═".repeat(80));

  // Aggregate all coverage results
  const allCoverage = new Map<string, CoverageResult>();
  const allUnmapped = new Map<number, STSMarketInfo>();

  for (const result of results) {
    for (const cr of result.coverageResults) {
      const existing = allCoverage.get(cr.marketCode);
      if (!existing || (cr.status === "COVERED" && existing.status !== "COVERED")) {
        allCoverage.set(cr.marketCode, cr);
      }
    }
    for (const um of result.unmappedSTSMarkets) {
      if (!allUnmapped.has(um.marketId)) {
        allUnmapped.set(um.marketId, um);
      }
    }
  }

  const coverageResults = Array.from(allCoverage.values());
  const byStatus = {
    COVERED: coverageResults.filter(r => r.status === "COVERED"),
    PARTIAL: coverageResults.filter(r => r.status === "PARTIAL"),
    MISSING: coverageResults.filter(r => r.status === "MISSING"),
    NO_MAPPING: coverageResults.filter(r => r.status === "NO_MAPPING"),
  };

  console.log(`\n✅ COVERED (${byStatus.COVERED.length} markets):`);
  for (const r of byStatus.COVERED) {
    console.log(`   [${r.numericId.toString().padStart(2)}] ${r.marketCode.padEnd(25)} (${r.label})`);
  }

  console.log(`\n⚠️  PARTIAL (${byStatus.PARTIAL.length} markets):`);
  for (const r of byStatus.PARTIAL) {
    const found = r.matchedSTSMarkets.map(m => m.marketId);
    const missing = r.stsIdMappings.filter(id => !found.includes(id));
    console.log(`   [${r.numericId.toString().padStart(2)}] ${r.marketCode.padEnd(25)} (${r.label})`);
    console.log(`        Found: ${found.join(", ")}, Missing: ${missing.join(", ")}`);
  }

  console.log(`\n❌ MISSING (${byStatus.MISSING.length} markets):`);
  for (const r of byStatus.MISSING) {
    console.log(`   [${r.numericId.toString().padStart(2)}] ${r.marketCode.padEnd(25)} (${r.label})`);
  }

  console.log(`\n⬜ NO MAPPING (${byStatus.NO_MAPPING.length} markets):`);
  for (const r of byStatus.NO_MAPPING) {
    console.log(`   [${r.numericId.toString().padStart(2)}] ${r.marketCode.padEnd(25)} (${r.label})`);
  }

  // Show unmapped STS markets
  const unmappedSTSMarkets = Array.from(allUnmapped.values()).sort((a, b) => a.marketId - b.marketId);
  console.log(`\n${"═".repeat(80)}`);
  console.log(`UNMAPPED STS MARKETS (${unmappedSTSMarkets.length} across all leagues)`);
  console.log("═".repeat(80));

  for (const m of unmappedSTSMarkets) {
    console.log(`\n   Market ${m.marketId}: "${m.lineName}" (${m.outcomeCount} outcomes)`);
    const samples = m.sampleOutcomes.slice(0, 3).map(o =>
      `${o.id}:"${o.name || 'NULL'}"=${o.odds}`
    ).join(", ");
    console.log(`        Sample: ${samples}`);
  }

  // Final stats
  console.log(`\n${"═".repeat(80)}`);
  console.log("FINAL STATISTICS");
  console.log("═".repeat(80));
  console.log(`\nLeagues tested: ${results.length}`);
  console.log(`Our Registry: ${UNIFIED_MARKET_REGISTRY.length} canonical markets`);
  console.log(`\nAggregated Coverage:`);
  console.log(`  ✅ Fully Covered:  ${byStatus.COVERED.length}`);
  console.log(`  ⚠️  Partial:        ${byStatus.PARTIAL.length}`);
  console.log(`  ❌ Missing:        ${byStatus.MISSING.length}`);
  console.log(`  ⬜ No STS Mapping: ${byStatus.NO_MAPPING.length}`);
  console.log(`\nTotal unmapped STS markets: ${unmappedSTSMarkets.length}`);
}

async function main(): Promise<void> {
  const { leagues, specificMatchUrl } = parseArgs();

  console.log("═".repeat(80));
  console.log("STS MARKET COVERAGE TEST");
  console.log("═".repeat(80));
  console.log(`\nTesting ${leagues.length} league(s): ${leagues.join(", ")}`);
  console.log("This test compares STS markets against our 40 canonical market definitions.\n");

  const browser = await chromium.launch({ headless: true });
  const results: LeagueCoverageResult[] = [];

  try {
    for (const league of leagues) {
      const result = await testSTSMarketCoverageForLeague(league, browser, specificMatchUrl);
      if (result) {
        results.push(result);

        // Save per-league report
        fs.mkdirSync("./logs", { recursive: true });
        fs.writeFileSync(
          `./logs/sts-coverage-report-${league}.json`,
          JSON.stringify(result, null, 2)
        );
      }
    }

    if (results.length > 0) {
      printDetailedResults(results);

      // Save combined report
      const combinedReport = {
        timestamp: new Date().toISOString(),
        leaguesTested: leagues,
        results,
      };
      fs.writeFileSync("./logs/sts-coverage-report.json", JSON.stringify(combinedReport, null, 2));
      console.log(`\nReports saved to: ./logs/sts-coverage-report*.json`);
    } else {
      console.log("\nNo results to report - no matches found in any league.");
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
