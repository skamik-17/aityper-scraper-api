#!/usr/bin/env npx tsx
import { chromium, type Page, type Request, type Response } from "playwright";
import { fetchGrpcStream, buildMatchDetailsRequest } from "../src/scrapers/bookmakers/betclic/navigation.js";
import { ENDPOINTS } from "../src/scrapers/bookmakers/betclic/constants.js";
import { parseAllMarketsFromProto } from "../src/scrapers/bookmakers/betclic/parser.js";

const TEST_MATCH_ID = "905675290968064";
const TEST_MATCH_URL = "https://www.betclic.pl/pilka-nozna-sfootball/premier-league-c3/west-ham-sunderland-m905675290968064";

const EXPECTED_TOP_TAB_MARKETS = [
  "1X2",
  "DOUBLE_CHANCE",
  "BTTS",
  "OVER_UNDER",
  "CORRECT_SCORE",
  "HANDICAP",
  "HALF_TIME_1X2",
  "GOALSCORER",
  "CORNERS_TOTAL",
] as const;

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose") || args.includes("-v");
const MATCH_ARG = args.find((_, i) => args[i - 1] === "--match" || args[i - 1] === "-m");

const MATCH_ID = MATCH_ARG || TEST_MATCH_ID;
const MATCH_URL = TEST_MATCH_URL;

interface CapturedGrpcRequest {
  timestamp: Date;
  method: string;
  url: string;
  headers: Record<string, string>;
  postData?: string;
  cookies?: string[];
  decodedPayload?: Buffer;
}

interface CapturedGrpcResponse {
  timestamp: Date;
  url: string;
  status: number;
  headers: Record<string, string>;
  bodySize?: number;
  decodedBody?: Buffer;
}

interface DirectApiCall {
  payload: Buffer;
  response: Buffer;
  markets: string[];
  marketCount: number;
}

interface BrowserNetworkCapture {
  requests: CapturedGrpcRequest[];
  responses: CapturedGrpcResponse[];
  cookies: string[];
}

interface ComparisonReport {
  hasDifference: boolean;
  headerDifferences: string[];
  cookiePresence: boolean;
  responseSizeDifference?: number;
  marketCountDifference?: number;
  analysis: string[];
}

function setupGrpcCapture(page: Page): BrowserNetworkCapture {
  const capture: BrowserNetworkCapture = {
    requests: [],
    responses: [],
    cookies: [],
  };

  console.log(`📡 Setting up gRPC network capture...`);

  page.on("request", (request: Request) => {
    const url = request.url();

    if (url.includes("offering.begmedia.com") && url.includes("GetMatchWithNotification")) {
      console.log(`\n📤 Capturing gRPC request: ${request.method()} ${url.substring(url.length - 80)}`);

      const headers = request.headers();
      const postData = request.postData();

      let decodedPayload: Buffer | undefined;
      let cookies: string[] = [];

      if (postData) {
        try {
          const cleanBase64 = postData.replace(/[\r\n]/g, "");
          const frame = Buffer.from(cleanBase64, "base64");

          if (frame.length > 5) {
            const msgLen = frame.readUInt32BE(1);
            decodedPayload = frame.slice(5, 5 + msgLen);

            if (VERBOSE) {
              console.log(`   📦 Decoded payload: ${decodedPayload.length} bytes`);
              console.log(`   🔢 Hex preview: ${decodedPayload.subarray(0, 32).toString("hex")}...`);
            }
          }

          const cookieHeader = headers["cookie"];
          if (cookieHeader) {
            cookies = cookieHeader.split("; ").map(c => c.split("=")[0]);
          }
        } catch (error) {
          console.log(`   ⚠️  Could not decode payload: ${error}`);
        }
      }

      const captured: CapturedGrpcRequest = {
        timestamp: new Date(),
        method: request.method(),
        url,
        headers,
        postData,
        cookies,
        decodedPayload,
      };
      capture.requests.push(captured);

      console.log(`   📋 Method: ${request.method()}`);
      console.log(`   🔗 Full URL: ${url}`);
      console.log(`   📏 Payload size: ${postData ? postData.length : 0} chars`);

      if (VERBOSE && headers) {
        const headerKeys = Object.keys(headers);
        console.log(`   📝 Headers (${headerKeys.length}):`);
        for (const key of headerKeys.slice(0, 10)) {
          console.log(`      ${key}: ${headers[key].substring(0, 50)}${headers[key].length > 50 ? "..." : ""}`);
        }
      }

      if (cookies.length > 0) {
        console.log(`   🍪 Cookies (${cookies.length}): ${cookies.join(", ")}`);
      }
    }
  });

  page.on("response", async (response: Response) => {
    const url = response.url();

    if (url.includes("offering.begmedia.com") && url.includes("GetMatchWithNotification")) {
      console.log(`\n📥 Capturing gRPC response: ${response.status()} ${url.substring(url.length - 80)}`);

      let decodedBody: Buffer | undefined;
      let bodySize: number | undefined;

      try {
        const buffer = await response.body();
        bodySize = buffer.length;

        const cleanBase64 = buffer.toString().replace(/[\r\n]/g, "");
        const frame = Buffer.from(cleanBase64, "base64");

        if (frame.length > 5) {
          const msgLen = frame.readUInt32BE(1);
          decodedBody = frame.slice(5, 5 + msgLen);

          if (VERBOSE) {
            console.log(`   📦 Decoded response: ${decodedBody.length} bytes`);
            console.log(`   🔢 Hex preview: ${decodedBody.subarray(0, 32).toString("hex")}...`);
          }
        }
      } catch (error) {
        console.log(`   ⚠️  Could not decode response body: ${error}`);
      }

      const captured: CapturedGrpcResponse = {
        timestamp: new Date(),
        url,
        status: response.status(),
        headers: response.headers(),
        bodySize,
        decodedBody,
      };
      capture.responses.push(captured);

      console.log(`   📏 Response size: ${bodySize ?? "unknown"} bytes`);
      console.log(`   📊 Status: ${response.status()} ${response.statusText()}`);

      if (decodedBody) {
        const markets = parseAllMarketsFromProto(decodedBody);
        console.log(`   📈 Markets detected: ${markets.length}`);
      }
    }
  });

  page.on("load", async () => {
    const context = page.context();
    const cookies = await context.cookies();
    capture.cookies = cookies.map(c => c.name);

    if (VERBOSE) {
      console.log(`\n🍪 Total cookies after page load: ${cookies.length}`);
      for (const cookie of cookies.slice(0, 10)) {
        console.log(`   ${cookie.name}: ${cookie.value.substring(0, 30)}...`);
      }
    }
  });

  return capture;
}

async function makeDirectApiCall(matchId: string): Promise<DirectApiCall> {
  console.log(`\n${"─".repeat(80)}`);
  console.log(`🔧 Making direct API call...`);
  console.log(`${"─".repeat(80)}`);

  const requestBody = buildMatchDetailsRequest(matchId);
  const response = await fetchGrpcStream(ENDPOINTS.match, requestBody);

  if (!response) {
    console.error("❌ Direct API call failed - got null response");
    throw new Error("Failed to fetch data from API");
  }

  const markets = parseAllMarketsFromProto(response);
  const marketSet = new Set(markets.map(m => m.name));
  const marketNames = Array.from(marketSet);

  console.log(`✅ Direct API call successful`);
  console.log(`   Request size: ${requestBody.length} bytes`);
  console.log(`   Response size: ${response.length} bytes`);
  console.log(`   Markets found: ${markets.length}`);
  console.log(`   Unique market names: ${marketNames.length}`);

  if (VERBOSE) {
    console.log(`\n   Market types found:`);
    const byType = new Map<string, number>();
    for (const market of markets) {
      byType.set(market.type, (byType.get(market.type) || 0) + 1);
    }
    for (const [type, count] of Array.from(byType.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`      ${type}: ${count}`);
    }
  }

  return {
    payload: requestBody,
    response,
    markets: marketNames,
    marketCount: markets.length,
  };
}

function compareCaptures(
  browser: BrowserNetworkCapture,
  direct: DirectApiCall
): ComparisonReport {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`📊 COMPARISON ANALYSIS`);
  console.log(`${"=".repeat(100)}`);

  const report: ComparisonReport = {
    hasDifference: false,
    headerDifferences: [],
    cookiePresence: browser.cookies.length > 0,
    responseSizeDifference: undefined,
    marketCountDifference: undefined,
    analysis: [],
  };

  if (browser.requests.length === 0) {
    report.analysis.push("⚠️  NO gRPC requests captured from browser");
    report.analysis.push("   This suggests: page loads data differently (WebSocket, pre-rendered, etc.)");
    return report;
  }

  report.analysis.push(`✅ Captured ${browser.requests.length} gRPC request(s) from browser`);

  const browserResponse = browser.responses[0];
  if (browserResponse && browserResponse.decodedBody) {
    const sizeDiff = (browserResponse.bodySize || 0) - direct.response.length;
    report.responseSizeDifference = sizeDiff;

    console.log(`\n📏 Response Size Comparison:`);
    console.log(`   Browser: ${browserResponse.bodySize} bytes`);
    console.log(`   Direct API: ${direct.response.length} bytes`);
    console.log(`   Difference: ${sizeDiff > 0 ? "+" : ""}${sizeDiff} bytes (${sizeDiff > 0 ? "larger" : sizeDiff < 0 ? "smaller" : "equal"})`);

    if (Math.abs(sizeDiff) > 100) {
      report.hasDifference = true;
      report.analysis.push(`⚠️  Significant size difference: ${Math.abs(sizeDiff)} bytes`);
    } else if (sizeDiff === 0) {
      report.analysis.push(`✅ Response sizes match exactly`);
    } else {
      report.analysis.push(`ℹ️  Small size difference (${sizeDiff} bytes)`);
    }

    const browserMarkets = parseAllMarketsFromProto(browserResponse.decodedBody);
    const browserMarketNames = [...new Set(browserMarkets.map(m => m.name))];

    console.log(`\n📈 Market Count Comparison:`);
    console.log(`   Browser parsed: ${browserMarkets.length} markets (${browserMarketNames.length} unique)`);
    console.log(`   Direct API: ${direct.marketCount} markets (${direct.markets.length} unique)`);

    const uniqueBrowser = browserMarketNames.filter(m => !direct.markets.includes(m));
    const uniqueDirect = direct.markets.filter(m => !browserMarketNames.includes(m));

    report.marketCountDifference = browserMarkets.length - direct.marketCount;

    if (uniqueBrowser.length > 0) {
      report.hasDifference = true;
      report.analysis.push(`⚠️  ${uniqueBrowser.length} markets ONLY in browser: ${uniqueBrowser.slice(0, 5).join(", ")}${uniqueBrowser.length > 5 ? "..." : ""}`);
    }

    if (uniqueDirect.length > 0) {
      report.hasDifference = true;
      report.analysis.push(`⚠️  ${uniqueDirect.length} markets ONLY in direct API: ${uniqueDirect.slice(0, 5).join(", ")}${uniqueDirect.length > 5 ? "..." : ""}`);
    }

    if (uniqueBrowser.length === 0 && uniqueDirect.length === 0) {
      report.analysis.push(`✅ Markets are identical between browser and direct API`);
    }

    const browserRequest = browser.requests[0];
    if (browserRequest && browserRequest.decodedPayload) {
      console.log(`\n📦 Request Payload Comparison:`);
      console.log(`   Browser: ${browserRequest.decodedPayload.length} bytes`);
      console.log(`   Direct API: ${direct.payload.length} bytes`);

      if (browserRequest.decodedPayload.equals(direct.payload)) {
        report.analysis.push(`✅ Request payloads match exactly`);
      } else {
        report.hasDifference = true;
        report.analysis.push(`⚠️  Request payloads differ`);

        const browserHex = browserRequest.decodedPayload.toString("hex");
        const directHex = direct.payload.toString("hex");
        let diffIndex = 0;
        for (let i = 0; i < Math.min(browserHex.length, directHex.length); i += 2) {
          if (browserHex[i] !== directHex[i] || browserHex[i + 1] !== directHex[i + 1]) {
            diffIndex = i;
            break;
          }
        }

        if (VERBOSE) {
          console.log(`   First difference at byte ${diffIndex}`);
          console.log(`   Browser:  ${browserHex.substring(diffIndex, diffIndex + 20)}...`);
          console.log(`   Direct:   ${directHex.substring(diffIndex, diffIndex + 20)}...`);
        }
      }
    }

    console.log(`\n🎯 Expected Top Tab Markets Check:`);
    const foundExpected = browserMarkets.filter(m => {
      const type = m.type.toUpperCase();
      return EXPECTED_TOP_TAB_MARKETS.includes(type as any);
    });

    console.log(`   Expected types: ${EXPECTED_TOP_TAB_MARKETS.length}`);
    console.log(`   Found in browser: ${foundExpected.length}`);

    const missingTypes = EXPECTED_TOP_TAB_MARKETS.filter(type => {
      return !browserMarkets.some(m => m.type.toUpperCase() === type);
    });

    if (missingTypes.length > 0) {
      report.hasDifference = true;
      report.analysis.push(`⚠️  Missing expected market types: ${missingTypes.join(", ")}`);
    } else {
      report.analysis.push(`✅ All expected Top tab market types found`);
    }

    console.log(`\n📝 Header Analysis:`);

    if (browserRequest) {
      console.log(`   Browser request headers count: ${Object.keys(browserRequest.headers).length}`);

      const requiredHeaders = [
        "content-type",
        "accept",
        "x-grpc-web",
        "x-bg-ref-brand",
        "x-bg-ref-platform",
        "x-bg-ref-regulator-zone",
        "origin",
        "referer",
      ];

      for (const header of requiredHeaders) {
        const exists = Object.keys(browserRequest.headers).some(h => h.toLowerCase() === header);
        if (!exists) {
          report.headerDifferences.push(`Missing: ${header}`);
        }
      }

      if (report.headerDifferences.length > 0) {
        report.hasDifference = true;
        report.analysis.push(`⚠️  Missing required headers: ${report.headerDifferences.join(", ")}`);
      } else {
        report.analysis.push(`✅ All required headers present`);
      }
    }

    console.log(`\n🍪 Cookie Analysis:`);
    console.log(`   Cookies present: ${report.cookiePresence ? "YES" : "NO"}`);
    console.log(`   Cookie count: ${browser.cookies.length}`);

    if (report.cookiePresence) {
      report.analysis.push(`ℹ️  Browser has ${browser.cookies.length} cookies - may affect API calls`);
      report.analysis.push(`ℹ️  Direct API call has NO cookies - check if cookies required`);
    } else {
      report.analysis.push(`ℹ️  No cookies in browser - cookies not required for API`);
    }
  } else {
    report.analysis.push("⚠️  No browser response captured - cannot compare market data");
  }

  return report;
}

function printFinalReport(report: ComparisonReport): void {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`📋 FINAL ANALYSIS REPORT`);
  console.log(`${"=".repeat(100)}`);

  console.log(`\nOverall Status: ${report.hasDifference ? "⚠️  DIFFERENCES DETECTED" : "✅ NO DIFFERENCES"}`);

  console.log(`\nKey Findings:`);
  for (let i = 0; i < report.analysis.length; i++) {
    console.log(`${i + 1}. ${report.analysis[i]}`);
  }

  if (report.headerDifferences.length > 0) {
    console.log(`\nMissing Headers:`);
    for (const diff of report.headerDifferences) {
      console.log(`  - ${diff}`);
    }
  }

  console.log(`\n${"=".repeat(100)}`);
  console.log(`🎯 RECOMMENDATIONS`);
  console.log(`${"=".repeat(100)}`);

  if (!report.hasDifference) {
    console.log(`✅ Browser and direct API calls produce IDENTICAL results`);
    console.log(`✅ No session/cookie dependency detected`);
    console.log(`✅ Pure API approach is viable for scraping`);
  } else {
    console.log(`⚠️  Browser and direct API calls produce DIFFERENT results`);
    console.log(`⚠️  This indicates: session/cookie dependency or dynamic data loading`);
    console.log(`\nPotential causes:`);
    console.log(`  1. API requires browser session/cookies`);
    console.log(`  2. API uses WebSocket for real-time updates (different endpoint)`);
    console.log(`  3. API response varies based on request headers/timing`);
    console.log(`  4. Page loads data through different mechanism (pre-rendered, CDN, etc.)`);
    console.log(`\nRecommended action:`);
    console.log(`  - Use hybrid approach (Playwright for initial load, API for data extraction)`);
    console.log(`  - Or investigate WebSocket/real-time endpoints for complete data`);
  }
}

async function main() {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`🔍 Betclic Browser Network Capture`);
  console.log(`${"=".repeat(100)}`);
  console.log(`\nMatch ID: ${MATCH_ID}`);
  console.log(`Match URL: ${MATCH_URL}`);
  console.log(`Verbose mode: ${VERBOSE ? "ON" : "OFF"}`);
  console.log(`\nExpected Top Tab Markets: ${EXPECTED_TOP_TAB_MARKETS.join(", ")}`);

  const directApiCall = await makeDirectApiCall(MATCH_ID);

  console.log(`\n${"─".repeat(80)}`);
  console.log(`🌐 Launching Playwright browser...`);
  console.log(`${"─".repeat(80)}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "pl-PL",
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  try {
    console.log(`\n${"─".repeat(80)}`);
    console.log(`📡 Setting up network interception...`);
    console.log(`${"─".repeat(80)}`);

    const capture = setupGrpcCapture(page);

    console.log(`\n${"─".repeat(80)}`);
    console.log(`🌐 Navigating to match page...`);
    console.log(`${"─".repeat(80)}`);

    await page.goto(MATCH_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log(`✅ Page loaded`);

    console.log(`\n⏳ Waiting for network requests to complete...`);
    await page.waitForTimeout(5000);

    const title = await page.title();
    const currentUrl = page.url();
    console.log(`\n📄 Page title: ${title}`);
    console.log(`📍 Current URL: ${currentUrl}`);

    const report = compareCaptures(capture, directApiCall);

    printFinalReport(report);

  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack.split("\n").slice(0, 5).join("\n"));
    }
  } finally {
    await browser.close();
    console.log(`\n🏁 Browser closed`);
    console.log(`\n${"=".repeat(100)}`);
    console.log(`✅ Script completed successfully`);
  }
}

main().catch(console.error);
