/**
 * STS Market Analyzer
 *
 * Analyzes all markets from STS for a single match and saves detailed output.
 * Uses the same WebSocket capture approach as the actual STS scraper.
 *
 * Run: npx tsx scripts/analyze-sts-markets.ts [match-url]
 *
 * Example:
 *   npx tsx scripts/analyze-sts-markets.ts https://www.sts.pl/kursy/liverpool-arsenal/f1234567
 */

import { chromium, type Page, type WebSocket } from "playwright";
import * as fs from "fs";

// Constants from actual scraper
const BASE_URL = "https://www.sts.pl";
const WS_URL_PATTERN = "/sbk/api/sbk";
const DEFAULT_LEAGUE_URL = "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/175";
const CLI_MATCH_URL = process.argv[2];
const REQUEST_TIMEOUT = 30000;

interface MarketAnalysis {
  marketId: number;
  marketName: string | null;
  lineCount: number;
  lines: {
    lineId: string;
    lineName: string | null;
    outcomeCount: number;
    outcomes: {
      id: string;
      name: string | null;
      odds: number | null;
      rawData: any;
    }[];
  }[];
}

interface AnalysisResult {
  matchUrl: string;
  homeTeam: string;
  awayTeam: string;
  scrapedAt: string;
  totalMarkets: number;
  markets: MarketAnalysis[];
}

interface WSCaptureResult {
  initialData: string;
  fixtureData: Map<string, any>;
}

/**
 * Set up WebSocket listener - same approach as actual scraper
 */
function setupWebSocketCapture(page: Page, result: WSCaptureResult): void {
  page.on("websocket", (ws: WebSocket) => {
    // Filter by URL pattern - critical for capturing correct WebSocket
    if (!ws.url().includes(WS_URL_PATTERN)) {
      return;
    }

    console.log(`[Analyzer] WebSocket connected: ${ws.url()}`);

    ws.on("framereceived", (frame) => {
      const data = typeof frame.payload === "string" ? frame.payload : "";

      // Capture initial data (largest message with "i_pl" subscription)
      if (data.includes('"s":"i_pl"') && data.length > result.initialData.length) {
        result.initialData = data;
        console.log(`[Analyzer] Captured initial data: ${data.length} bytes`);
      }

      // Capture fixture-specific data (contains extended markets)
      // Format: "s":"f_{fixtureId}_pl"
      const fixtureMatch = data.match(/"s":"f_(f\d+)_pl"/);
      if (fixtureMatch && data.length > 1000) {
        try {
          const lines = data.split("\n");
          const jsonData = JSON.parse(lines[1] || lines[0]);
          result.fixtureData.set(fixtureMatch[1], jsonData);
          console.log(`[Analyzer] Captured fixture data for ${fixtureMatch[1]}: ${data.length} bytes`);
        } catch {
          // Ignore parse errors
        }
      }
    });
  });
}

/**
 * Wait for data condition with polling
 */
async function waitForData(
  checkCondition: () => boolean,
  maxWait: number = 10000,
  pollInterval: number = 500
): Promise<void> {
  const iterations = Math.ceil(maxWait / pollInterval);
  for (let i = 0; i < iterations; i++) {
    if (checkCondition()) {
      console.log(`[Analyzer] Data condition met after ${i * pollInterval}ms`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

/**
 * Handle cookie consent
 */
async function handleCookies(page: Page): Promise<void> {
  try {
    const cookieBtn = page.locator('text=Akceptuj wszystkie').first();
    if (await cookieBtn.isVisible({ timeout: 2000 })) {
      await cookieBtn.click();
      console.log("[Analyzer] Accepted cookies");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch {
    // Cookie dialog not present
  }
}

/**
 * Parse JSON from WebSocket raw data string
 */
function parseWebSocketJson(rawData: string): any | null {
  try {
    const lines = rawData.split("\n");
    return JSON.parse(lines[1] || lines[0]);
  } catch {
    return null;
  }
}

/**
 * Extract fixture ID from URL
 */
function extractFixtureIdFromUrl(url: string): string {
  const match = url.match(/f(\d+)/);
  return match ? `f${match[1]}` : "";
}

async function analyzeSTSMarkets(): Promise<void> {
  console.log("[Analyzer] Starting STS market analysis...");
  console.log("[Analyzer] Using same WebSocket capture as actual scraper");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Initialize capture result - same as scraper
  const captureResult: WSCaptureResult = {
    initialData: "",
    fixtureData: new Map(),
  };

  // Set up WebSocket capture BEFORE navigation
  setupWebSocketCapture(page, captureResult);

  let matchUrl = CLI_MATCH_URL || "";
  let homeTeam = "";
  let awayTeam = "";

  try {
    // If no match URL provided, find one from the league page
    if (!matchUrl) {
      console.log("[Analyzer] Navigating to Premier League page...");
      await page.goto(DEFAULT_LEAGUE_URL, {
        timeout: REQUEST_TIMEOUT,
        waitUntil: "domcontentloaded",
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));
      await handleCookies(page);

      // Wait for initial data
      await waitForData(() => captureResult.initialData.length > 10000, 10000);

      if (!captureResult.initialData) {
        throw new Error("No initial WebSocket data captured from league page");
      }

      console.log(`[Analyzer] Got initial data: ${captureResult.initialData.length} bytes`);

      // Parse fixtures from initial data
      const initialJson = parseWebSocketJson(captureResult.initialData);
      if (!initialJson) {
        throw new Error("Failed to parse initial WebSocket data");
      }

      // Find a Premier League match URL from the data
      const football = initialJson.B?.S?.["1"];
      if (football?.C) {
        for (const [, cat] of Object.entries(football.C) as [string, any][]) {
          const countryName = (cat.n || "").toLowerCase();
          if (!countryName.includes("angli")) continue;

          for (const [, tourn] of Object.entries(cat.T || {}) as [string, any][]) {
            const tournamentName = (tourn.n || "").toLowerCase();
            if (!tournamentName.includes("premier league")) continue;

            // Get first fixture
            for (const [fixId, fix] of Object.entries(tourn.FX || {}) as [string, any][]) {
              if (fix.H?.n && fix.A?.n) {
                const homeSlug = fix.H.n.toLowerCase()
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "");
                const awaySlug = fix.A.n.toLowerCase()
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "");
                matchUrl = `${BASE_URL}/kursy/${homeSlug}-${awaySlug}/${fixId}`;
                homeTeam = fix.H.n;
                awayTeam = fix.A.n;
                console.log(`[Analyzer] Found match: ${homeTeam} vs ${awayTeam}`);
                break;
              }
            }
            if (matchUrl) break;
          }
          if (matchUrl) break;
        }
      }

      if (!matchUrl) {
        throw new Error("No suitable Premier League match found in WebSocket data");
      }
    }

    // Navigate to match page and capture fixture-specific data
    console.log(`[Analyzer] Navigating to match: ${matchUrl}`);

    // Reset capture for match page
    captureResult.initialData = "";
    captureResult.fixtureData.clear();
    page.removeAllListeners("websocket");
    setupWebSocketCapture(page, captureResult);

    await page.goto(matchUrl, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));
    await handleCookies(page);

    // Extract fixture ID and wait for its data
    const fixtureId = extractFixtureIdFromUrl(matchUrl);
    console.log(`[Analyzer] Waiting for fixture data: ${fixtureId}`);

    await waitForData(
      () =>
        (fixtureId && captureResult.fixtureData.has(fixtureId)) ||
        captureResult.initialData.length > 100000,
      15000
    );

    // Get team names from page title if not already set
    if (!homeTeam || !awayTeam) {
      const titleText = await page.title();
      const teamMatch = titleText.match(/(.+?)\s*-\s*(.+?)\s*\|/);
      if (teamMatch) {
        homeTeam = teamMatch[1].trim();
        awayTeam = teamMatch[2].trim();
      }
    }

    console.log(`[Analyzer] Match: ${homeTeam} vs ${awayTeam}`);
    console.log(`[Analyzer] Initial data: ${captureResult.initialData.length} bytes`);
    console.log(`[Analyzer] Fixture data keys: ${Array.from(captureResult.fixtureData.keys()).join(", ") || "none"}`);

    // Use fixture-specific data if available, otherwise initial data
    let capturedData: any = null;
    if (fixtureId && captureResult.fixtureData.has(fixtureId)) {
      capturedData = captureResult.fixtureData.get(fixtureId);
      console.log("[Analyzer] Using fixture-specific data");
    } else if (captureResult.initialData) {
      capturedData = parseWebSocketJson(captureResult.initialData);
      console.log("[Analyzer] Using initial data");
    }

    if (!capturedData) {
      throw new Error("No WebSocket data captured - check if the page loads correctly");
    }

    // Analyze all markets
    const markets: MarketAnalysis[] = [];

    for (const [assocKey, assocData] of Object.entries(capturedData.P || {})) {
      const marketData = (assocData as any).m;
      if (!marketData) continue;

      for (const [marketIdStr, market] of Object.entries(marketData)) {
        const marketId = parseInt(marketIdStr, 10);
        const mkt = market as any;

        const lines: MarketAnalysis["lines"] = [];

        if (mkt.l) {
          for (const [lineIdStr, line] of Object.entries(mkt.l)) {
            const ln = line as any;
            const outcomes: MarketAnalysis["lines"][0]["outcomes"] = [];

            if (ln.o) {
              for (const [outcomeIdStr, outcome] of Object.entries(ln.o)) {
                const out = outcome as any;
                outcomes.push({
                  id: outcomeIdStr,
                  name: out.n || null,
                  odds: out.O || null,
                  rawData: out,
                });
              }
            }

            lines.push({
              lineId: lineIdStr,
              lineName: ln.n || null,
              outcomeCount: outcomes.length,
              outcomes: outcomes.slice(0, 50), // Limit for readability
            });
          }
        }

        markets.push({
          marketId,
          marketName: mkt.n || null,
          lineCount: lines.length,
          lines: lines.slice(0, 10), // Limit lines
        });
      }
    }

    // Sort by market ID
    markets.sort((a, b) => a.marketId - b.marketId);

    const result: AnalysisResult = {
      matchUrl,
      homeTeam,
      awayTeam,
      scrapedAt: new Date().toISOString(),
      totalMarkets: markets.length,
      markets,
    };

    // Save to file
    const outputPath = "./logs/sts-market-analysis.json";
    fs.mkdirSync("./logs", { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`[Analyzer] Results saved to ${outputPath}`);

    // Print summary
    console.log("\n" + "=".repeat(80));
    console.log("STS MARKET ANALYSIS SUMMARY");
    console.log("=".repeat(80));
    console.log(`Match: ${homeTeam} vs ${awayTeam}`);
    console.log(`Total Markets: ${markets.length}`);
    console.log("\nAll Markets:");
    console.log("-".repeat(80));

    for (const market of markets) {
      const firstLine = market.lines[0];
      const sampleOutcomes = firstLine?.outcomes.slice(0, 5).map(o =>
        `${o.id}:"${o.name || 'NULL'}"=${o.odds}`
      ).join(", ") || "no outcomes";

      console.log(`\nMarket ${market.marketId} (${market.marketName || 'unnamed'}):`);
      console.log(`  Lines: ${market.lineCount}, First line: "${firstLine?.lineName || 'NULL'}"`);
      console.log(`  Outcomes in first line: ${firstLine?.outcomeCount || 0}`);
      console.log(`  Sample: ${sampleOutcomes}`);
    }

    console.log("\n" + "=".repeat(80));
    console.log(`Full analysis saved to: ${outputPath}`);

  } finally {
    await browser.close();
  }
}

analyzeSTSMarkets().catch(console.error);
