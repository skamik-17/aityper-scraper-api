/**
 * Network Capture Discovery Script
 * Captures all JSON responses and WebSocket frames from bookmaker pages
 *
 * Usage:
 *   npx tsx backend/src/scrapers/bookmakers/discovery/network-capture.ts <bookmaker>
 *
 * Examples:
 *   npx tsx backend/src/scrapers/bookmakers/discovery/network-capture.ts sts
 *   npx tsx backend/src/scrapers/bookmakers/discovery/network-capture.ts fortuna
 *   npx tsx backend/src/scrapers/bookmakers/discovery/network-capture.ts pzbuk
 *   npx tsx backend/src/scrapers/bookmakers/discovery/network-capture.ts betcris
 *   npx tsx backend/src/scrapers/bookmakers/discovery/network-capture.ts betclic
 */

import { chromium, type Page, type Browser, type BrowserContext } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Bookmaker configurations
const BOOKMAKERS: Record<string, { name: string; urls: string[] }> = {
  sts: {
    name: "STS",
    urls: [
      "https://www.sts.pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa/1/46/201",
    ],
  },
  fortuna: {
    name: "Fortuna",
    urls: [
      "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/polska-ekstraklasa",
    ],
  },
  pzbuk: {
    name: "PZBuk",
    urls: [
      "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league",
    ],
  },
  betcris: {
    name: "Betcris",
    urls: [
      "https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/68",
    ],
  },
  betclic: {
    name: "Betclic",
    urls: [
      "https://www.betclic.pl/pilka-nozna-sfootball/anglia-premier-league-c3",
    ],
  },
};

// Output directory for captured data
const OUTPUT_DIR = path.join(__dirname, "captured-data");

interface CapturedResponse {
  url: string;
  status: number;
  contentType: string;
  size: number;
  timestamp: string;
  data?: any;
}

interface CapturedWebSocket {
  url: string;
  frames: {
    direction: "sent" | "received";
    timestamp: string;
    payload: string;
  }[];
}

interface CaptureResult {
  bookmaker: string;
  capturedAt: string;
  pageUrl: string;
  jsonResponses: CapturedResponse[];
  webSockets: CapturedWebSocket[];
  embeddedState: {
    nextData?: any;
    nuxtData?: any;
    reduxState?: any;
    customState?: any[];
  };
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureNetworkTraffic(
  bookmaker: string,
  pageUrl: string
): Promise<CaptureResult> {
  const result: CaptureResult = {
    bookmaker,
    capturedAt: new Date().toISOString(),
    pageUrl,
    jsonResponses: [],
    webSockets: [],
    embeddedState: {},
  };

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    console.log(`\n[${bookmaker.toUpperCase()}] Starting capture for: ${pageUrl}`);
    console.log("=".repeat(80));

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "pl-PL",
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    // Capture JSON responses
    page.on("response", async (response) => {
      const url = response.url();
      const contentType = response.headers()["content-type"] || "";

      // Skip static assets
      if (url.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ico)(\?|$)/)) {
        return;
      }

      if (contentType.includes("json") || url.includes("api") || url.includes("offer")) {
        try {
          const status = response.status();
          const text = await response.text();
          let data: any = null;

          try {
            data = JSON.parse(text);
          } catch {
            // Not valid JSON
          }

          const captured: CapturedResponse = {
            url,
            status,
            contentType,
            size: text.length,
            timestamp: new Date().toISOString(),
            data,
          };

          result.jsonResponses.push(captured);

          // Log to console
          const prefix = data ? "[JSON]" : "[RESP]";
          console.log(`${prefix} ${status} ${url.substring(0, 100)}${url.length > 100 ? "..." : ""}`);

          if (data) {
            // Show structure preview
            const keys = Object.keys(data).slice(0, 5).join(", ");
            const isArray = Array.isArray(data);
            console.log(`       ${isArray ? `Array[${data.length}]` : `{${keys}...}`}`);
          }
        } catch (e) {
          // Ignore response read errors
        }
      }
    });

    // Capture WebSocket connections
    page.on("websocket", (ws) => {
      const wsUrl = ws.url();
      console.log(`[WS CONNECT] ${wsUrl}`);

      const wsCapture: CapturedWebSocket = {
        url: wsUrl,
        frames: [],
      };
      result.webSockets.push(wsCapture);

      ws.on("framesent", (frame) => {
        const payload = frame.payload.toString().slice(0, 500);
        wsCapture.frames.push({
          direction: "sent",
          timestamp: new Date().toISOString(),
          payload,
        });
        console.log(`[WS SEND] ${payload.slice(0, 100)}${payload.length > 100 ? "..." : ""}`);
      });

      ws.on("framereceived", (frame) => {
        const payload = frame.payload.toString().slice(0, 2000);
        wsCapture.frames.push({
          direction: "received",
          timestamp: new Date().toISOString(),
          payload,
        });
        console.log(`[WS RECV] ${payload.slice(0, 100)}${payload.length > 100 ? "..." : ""}`);
      });

      ws.on("close", () => {
        console.log(`[WS CLOSE] ${wsUrl}`);
      });
    });

    // Navigate to page
    console.log(`\n[NAVIGATE] Going to ${pageUrl}`);
    await page.goto(pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Wait for dynamic content
    console.log("[WAIT] Waiting for dynamic content (10s)...");
    await delay(10000);

    // Scroll to trigger lazy loading
    console.log("[SCROLL] Scrolling page to trigger lazy loading...");
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await delay(3000);

    // Extract embedded state
    console.log("\n[STATE] Checking for embedded state...");
    const pageContent = await page.content();

    // Next.js __NEXT_DATA__
    const nextDataMatch = pageContent.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (nextDataMatch) {
      try {
        result.embeddedState.nextData = JSON.parse(nextDataMatch[1]);
        console.log("[STATE] Found __NEXT_DATA__");
      } catch {
        console.log("[STATE] Found __NEXT_DATA__ (parse error)");
      }
    }

    // Nuxt.js __NUXT__
    const nuxtMatch = pageContent.match(
      /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/
    );
    if (nuxtMatch) {
      console.log("[STATE] Found __NUXT__ (raw)");
      result.embeddedState.nuxtData = nuxtMatch[1].slice(0, 5000);
    }

    // Redux state
    const reduxMatch = pageContent.match(
      /window\.__REDUX_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/
    );
    if (reduxMatch) {
      try {
        result.embeddedState.reduxState = JSON.parse(reduxMatch[1]);
        console.log("[STATE] Found __REDUX_STATE__");
      } catch {
        console.log("[STATE] Found __REDUX_STATE__ (parse error)");
      }
    }

    // Custom state patterns
    const customStatePatterns = [
      /window\.initialState\s*=\s*(\{[\s\S]*?\});/,
      /window\.appState\s*=\s*(\{[\s\S]*?\});/,
      /window\.DATA\s*=\s*(\{[\s\S]*?\});/,
      /window\.INITIAL_DATA\s*=\s*(\{[\s\S]*?\});/,
    ];

    result.embeddedState.customState = [];
    for (const pattern of customStatePatterns) {
      const match = pageContent.match(pattern);
      if (match) {
        console.log(`[STATE] Found custom state pattern`);
        result.embeddedState.customState.push(match[1].slice(0, 2000));
      }
    }

    // Look for any large inline JSON in script tags
    const inlineJsonMatches = pageContent.matchAll(
      /<script[^>]*>(\{[\s\S]{500,}?\})<\/script>/g
    );
    for (const match of inlineJsonMatches) {
      try {
        const data = JSON.parse(match[1]);
        if (data && typeof data === "object" && !result.embeddedState.customState?.includes(match[1])) {
          console.log(`[STATE] Found inline JSON (${Object.keys(data).slice(0, 3).join(", ")}...)`);
          result.embeddedState.customState?.push(match[1].slice(0, 2000));
        }
      } catch {
        // Not valid JSON
      }
    }

    return result;
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

function saveResult(bookmaker: string, result: CaptureResult): void {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${bookmaker}-${timestamp}.json`;
  const filepath = path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
  console.log(`\n[SAVE] Results saved to: ${filepath}`);
}

function printSummary(result: CaptureResult): void {
  console.log("\n" + "=".repeat(80));
  console.log("CAPTURE SUMMARY");
  console.log("=".repeat(80));

  console.log(`\nBookmaker: ${result.bookmaker}`);
  console.log(`Page URL: ${result.pageUrl}`);
  console.log(`Captured at: ${result.capturedAt}`);

  console.log(`\nJSON Responses: ${result.jsonResponses.length}`);
  if (result.jsonResponses.length > 0) {
    console.log("\nInteresting endpoints:");
    for (const resp of result.jsonResponses) {
      if (resp.data) {
        const isArray = Array.isArray(resp.data);
        const preview = isArray
          ? `Array[${resp.data.length}]`
          : `{${Object.keys(resp.data).slice(0, 3).join(", ")}...}`;
        console.log(`  - ${resp.url.split("?")[0]}`);
        console.log(`    ${preview}`);
      }
    }
  }

  console.log(`\nWebSocket Connections: ${result.webSockets.length}`);
  for (const ws of result.webSockets) {
    console.log(`  - ${ws.url}`);
    console.log(`    Frames: ${ws.frames.length} (sent: ${ws.frames.filter((f) => f.direction === "sent").length}, received: ${ws.frames.filter((f) => f.direction === "received").length})`);
  }

  console.log("\nEmbedded State:");
  console.log(`  - __NEXT_DATA__: ${result.embeddedState.nextData ? "Found" : "Not found"}`);
  console.log(`  - __NUXT__: ${result.embeddedState.nuxtData ? "Found" : "Not found"}`);
  console.log(`  - __REDUX_STATE__: ${result.embeddedState.reduxState ? "Found" : "Not found"}`);
  console.log(`  - Custom state: ${result.embeddedState.customState?.length || 0} patterns found`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log("Network Capture Discovery Script");
    console.log("================================");
    console.log("\nUsage:");
    console.log("  npx tsx backend/src/scrapers/bookmakers/discovery/network-capture.ts <bookmaker>");
    console.log("\nAvailable bookmakers:");
    for (const [key, config] of Object.entries(BOOKMAKERS)) {
      console.log(`  - ${key}: ${config.name}`);
    }
    console.log("\nExample:");
    console.log("  npx tsx backend/src/scrapers/bookmakers/discovery/network-capture.ts sts");
    return;
  }

  const bookmaker = args[0].toLowerCase();

  if (!BOOKMAKERS[bookmaker]) {
    console.error(`Unknown bookmaker: ${bookmaker}`);
    console.error("Available:", Object.keys(BOOKMAKERS).join(", "));
    process.exit(1);
  }

  const config = BOOKMAKERS[bookmaker];

  for (const url of config.urls) {
    const result = await captureNetworkTraffic(bookmaker, url);
    printSummary(result);
    saveResult(bookmaker, result);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
