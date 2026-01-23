#!/usr/bin/env npx tsx
import { chromium, type Page, type Request, type Response } from "playwright";
import { buildMatchDetailsRequest } from "../src/scrapers/bookmakers/betclic/navigation.js";
import { parseAllMarketsFromProto } from "../src/scrapers/bookmakers/betclic/parser.js";

const TEST_MATCH_ID = "905675290968064";
const TEST_MATCH_URL = "https://www.betclic.pl/pilka-nozna-sfootball/premier-league-c3/west-ham-sunderland-m905675290968064";

// Tab names from screenshot analysis - exact UI labels
const TAB_NAMES = [
  "Top",
  "Wynik",
  "Strzelcy",
  "Gole",
  "Metoda gola",
  "Wynik/Handicap",
  "Statystyki",
] as const;

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose") || args.includes("-v");

let currentTab: string | null = null;

interface TabRequest {
  tabName: string;
  timestamp: Date;
  url: string;
  postData?: string;
  decodedPayload?: Buffer;
  responseSize?: number;
  responsePayload?: Buffer;
  marketCount?: number;
  hasNetworkRequest: boolean;
}

interface DiffResult {
  tab1: string;
  tab2: string;
  diffHex: string;
  diffPosition: number;
  diffBytes: number;
  same: boolean;
}

async function findAndClickTab(page: Page, tabName: string): Promise<boolean> {
  try {
    const selectors = [
      `button:has-text("${tabName}")`,
      `a:has-text("${tabName}")`,
      `div[role="tab"]:has-text("${tabName}")`,
      `[role="tab"]:has-text("${tabName}")`,
    ];

    for (const selector of selectors) {
      try {
        const element = page.locator(selector).first();
        await element.waitFor({ state: "visible", timeout: 2000 });
        console.log(`   ✓ Found tab using selector: ${selector}`);

        // Use force click to bypass stability checks - tabs may navigate the page
        await element.click({ timeout: 5000, force: true });
        return true;
      } catch (error) {
        // Check if this was a stability timeout - element might have been clicked
        if (error instanceof Error && error.message.includes("waiting for element to be stable")) {
          console.log(`   ⚠️  Element clicked but page navigated - considering success`);
          return true;
        }
        if (VERBOSE) {
          console.log(`   ⚠️  Selector ${selector} failed: ${error instanceof Error ? error.message : error}`);
        }
      }
    }

    console.log(`   ✗ Tab not found with any selector`);
    return false;
  } catch (error) {
    console.log(`   ✗ Error clicking tab: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

async function waitForGrpcResponse(page: Page, timeoutMs: number = 5000): Promise<Response | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      page.off("response", handler);
      resolve(null);
    }, timeoutMs);

    const handler = (response: Response) => {
      const url = response.url();
      if (url.includes("offering.begmedia.com") && url.includes("GetMatchWithNotification")) {
        clearTimeout(timer);
        page.off("response", handler);
        resolve(response);
      }
    };

    page.on("response", handler);
  });
}

function compareBuffers(buf1: Buffer, buf2: Buffer): DiffResult {
  const maxLen = Math.max(buf1.length, buf2.length);
  let firstDiff = -1;
  let diffCount = 0;

  for (let i = 0; i < maxLen; i++) {
    const byte1 = i < buf1.length ? buf1[i] : 0;
    const byte2 = i < buf2.length ? buf2[i] : 0;
    if (byte1 !== byte2) {
      if (firstDiff === -1) {
        firstDiff = i;
      }
      diffCount++;
    }
  }

  const diffHex =
    firstDiff >= 0
      ? buf1.subarray(Math.max(0, firstDiff - 5), Math.min(buf1.length, firstDiff + 20)).toString("hex")
      : "";

  return {
    tab1: "unknown",
    tab2: "unknown",
    diffHex,
    diffPosition: firstDiff,
    diffBytes: diffCount,
    same: diffCount === 0,
  };
}

function analyzeProtobufFieldDifference(
  buf1: Buffer,
  buf2: Buffer,
  diffPosition: number
): string {
  // Try to decode the protobuf field at the diff position
  // Protobuf varint encoding: tag = (byte & 0x7F) >> 3, wire_type = byte & 0x07

  const byte1 = buf1[diffPosition];
  const byte2 = buf2[diffPosition];

  if (!byte1 || !byte2) {
    return `Position ${diffPosition}: One buffer is shorter`;
  }

  const tag1 = (byte1 & 0x7f) >> 3;
  const wireType1 = byte1 & 0x07;

  const tag2 = (byte2 & 0x7f) >> 3;
  const wireType2 = byte2 & 0x07;

  let analysis = `Position ${diffPosition}:\n`;
  analysis += `  Buffer 1 byte: 0x${byte1.toString(16).padStart(2, "0")} (tag=${tag1}, wire_type=${wireType1})\n`;
  analysis += `  Buffer 2 byte: 0x${byte2.toString(16).padStart(2, "0")} (tag=${tag2}, wire_type=${wireType2})\n`;

  if (tag1 !== tag2) {
    analysis += `  ⚠️  Different protobuf field numbers detected!\n`;
    analysis += `  Field ${tag1} in buffer 1 → Field ${tag2} in buffer 2\n`;
  } else if (byte1 !== byte2) {
    analysis += `  ℹ️  Same field (${tag1}) but different value\n`;
  }

  // Try to decode varint values
  if (wireType1 === 0 && wireType2 === 0) {
    // Both are varint, try to decode
    const val1 = decodeVarint(buf1, diffPosition + 1);
    const val2 = decodeVarint(buf2, diffPosition + 1);
    analysis += `  Varint value 1: ${val1}\n`;
    analysis += `  Varint value 2: ${val2}\n`;
  }

  return analysis;
}

function decodeVarint(buf: Buffer, offset: number): number {
  let result = 0;
  let shift = 0;
  let byte: number;

  do {
    byte = buf[offset++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80 && offset < buf.length);

  return result;
}

async function captureTabRequests(page: Page): Promise<Map<string, TabRequest>> {
  const tabRequests = new Map<string, TabRequest>();

  // Set up response capture
  page.on("response", async (response: Response) => {
    const url = response.url();

    // Debug: log all Betclic requests
    if (url.includes("betclic") || url.includes("offering")) {
      if (VERBOSE) {
        console.log(`   🌐 Response: ${response.status()} ${url.substring(0, 100)}`);
      }
    }

    if (url.includes("offering.begmedia.com") && url.includes("GetMatchWithNotification")) {
      if (currentTab) {
        const existing = tabRequests.get(currentTab)!;
        try {
          const body = await response.body();
          const cleanBase64 = body.toString().replace(/[\r\n]/g, "");
          const frame = Buffer.from(cleanBase64, "base64");

          let decodedBody: Buffer | undefined;
          if (frame.length > 5) {
            const msgLen = frame.readUInt32BE(1);
            decodedBody = frame.slice(5, 5 + msgLen);
          }

          existing.hasNetworkRequest = true;
          existing.responseSize = body.length;
          existing.responsePayload = decodedBody;

          if (decodedBody) {
            const markets = parseAllMarketsFromProto(decodedBody);
            existing.marketCount = markets.length;
          }

          tabRequests.set(currentTab, existing);
        } catch (error) {
          console.log(`   ⚠️  Could not decode response: ${error}`);
        }
      }
    }
  });

  // Set up request capture
  page.on("request", (request: Request) => {
    const url = request.url();

    if (url.includes("offering.begmedia.com") && url.includes("GetMatchWithNotification")) {
      if (currentTab) {
        const existing = tabRequests.get(currentTab)!;
        const postData = request.postData();

        if (postData) {
          try {
            const cleanBase64 = postData.replace(/[\r\n]/g, "");
            const frame = Buffer.from(cleanBase64, "base64");

            if (frame.length > 5) {
              const msgLen = frame.readUInt32BE(1);
              const decodedPayload = frame.slice(5, 5 + msgLen);
              existing.decodedPayload = decodedPayload;
            }
          } catch (error) {
            console.log(`   ⚠️  Could not decode payload: ${error}`);
          }
        }

        existing.url = url;
        existing.postData = postData ?? undefined;
        tabRequests.set(currentTab, existing);
      }
    }
  });

  return tabRequests;
}

async function main() {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`🔍 Betclic Tab Click Network Capture`);
  console.log(`${"=".repeat(100)}`);
  console.log(`\nMatch ID: ${TEST_MATCH_ID}`);
  console.log(`Match URL: ${TEST_MATCH_URL}`);
  console.log(`Verbose mode: ${VERBOSE ? "ON" : "OFF"}`);
  console.log(`\nTabs to test: ${TAB_NAMES.join(", ")}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-web-security", "--disable-features=VizDisplayCompositor"],
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
    console.log(`📡 Setting up network capture...`);
    console.log(`${"─".repeat(80)}`);

    const tabRequests = await captureTabRequests(page);

    console.log(`\n${"─".repeat(80)}`);
    console.log(`🌐 Navigating to match page...`);
    console.log(`${"─".repeat(80)}`);

    await page.goto(TEST_MATCH_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log(`✅ Page loaded`);

    // Wait for initial requests to complete
    console.log(`\n⏳ Waiting for initial network requests...`);
    await page.waitForTimeout(3000);

    // Capture initial (baseline) request as "Top" tab
    const baselineRequest: TabRequest = {
      tabName: "Baseline (Initial Load)",
      timestamp: new Date(),
      url: "",
      hasNetworkRequest: false,
    };
    tabRequests.set("Baseline", baselineRequest);

    console.log(`\n${"─".repeat(80)}`);
    console.log(`🖱️  Clicking tabs and capturing requests...`);
    console.log(`${"─".repeat(80)}`);

    // Click each tab and capture request
    for (const tabName of TAB_NAMES) {
      console.log(`\n📌 Tab: "${tabName}"`);

      const request: TabRequest = {
        tabName,
        timestamp: new Date(),
        url: "",
        hasNetworkRequest: false,
      };
      tabRequests.set(tabName, request);

      const tabFound = await findAndClickTab(page, tabName);

      if (!tabFound) {
        console.log(`   ⚠️  Tab not found - skipping`);
        continue;
      }

      // Set current tab for request/response capture
      currentTab = tabName;

      // Wait for potential network request
      await page.waitForTimeout(500);

      const response = await waitForGrpcResponse(page, 2000);

      if (response) {
        console.log(`   ✅ Network request detected: ${response.status()}`);
      } else {
        console.log(`   ⚠️  No network request detected (may use cached data)`);
      }

      // Reset current tab
      currentTab = null;

      // Small delay between clicks
      await page.waitForTimeout(200);
    }

    // Wait a bit more for any delayed requests
    await page.waitForTimeout(2000);

    console.log(`\n${"─".repeat(80)}`);
    console.log(`📊 ANALYSIS RESULTS`);
    console.log(`${"─".repeat(80)}`);

    // Print results
    console.log(`\nTab Click Results:`);
    console.log(`${"─".repeat(80)}`);

    const allRequests = Array.from(tabRequests.entries());
    for (const [key, request] of allRequests) {
      console.log(`\n📌 ${request.tabName}:`);
      console.log(`   Timestamp: ${request.timestamp.toISOString()}`);
      console.log(`   Network request: ${request.hasNetworkRequest ? "✅ YES" : "❌ NO"}`);

      if (request.decodedPayload) {
        console.log(`   Request payload: ${request.decodedPayload.length} bytes`);
        if (VERBOSE) {
          console.log(`   Hex: ${request.decodedPayload.toString("hex")}`);
        }
      }

      if (request.responsePayload) {
        console.log(`   Response size: ${request.responseSize} bytes`);
        console.log(`   Decoded response: ${request.responsePayload.length} bytes`);
        console.log(`   Markets detected: ${request.marketCount || 0}`);
      }
    }

    // Compare payloads
    console.log(`\n\n${"─".repeat(80)}`);
    console.log(`🔬 PAYLOAD COMPARISON`);
    console.log(`${"─".repeat(80)}`);

    const tabsWithPayloads = allRequests
      .filter(([_, r]) => r.decodedPayload)
      .map(([k, r]) => ({ name: k, payload: r.decodedPayload! }));

    if (tabsWithPayloads.length > 1) {
      console.log(`\nComparing ${tabsWithPayloads.length} payloads...`);

      for (let i = 0; i < tabsWithPayloads.length; i++) {
        for (let j = i + 1; j < tabsWithPayloads.length; j++) {
          const tab1 = tabsWithPayloads[i];
          const tab2 = tabsWithPayloads[j];

          const diff = compareBuffers(tab1.payload, tab2.payload);
          const result: DiffResult = {
            ...diff,
            tab1: tab1.name,
            tab2: tab2.name,
          };

          console.log(`\n${tab1.name} vs ${tab2.name}:`);
          if (result.same) {
            console.log(`   ✅ Payloads are IDENTICAL`);
          } else {
            console.log(`   ⚠️  Payloads DIFFER at byte ${result.diffPosition}`);
            console.log(`   Different bytes: ${result.diffBytes}`);

            if (result.diffHex) {
              console.log(`   Hex around diff: ${result.diffHex}`);
            }

            const analysis = analyzeProtobufFieldDifference(
              tab1.payload,
              tab2.payload,
              result.diffPosition
            );
            console.log(`   ${analysis.split("\n").join("\n   ")}`);
          }
        }
      }
    } else {
      console.log(`\n⚠️  Not enough payloads to compare (need at least 2)`);
    }

    // Compare responses
    console.log(`\n\n${"─".repeat(80)}`);
    console.log(`📈 RESPONSE COMPARISON`);
    console.log(`${"─".repeat(80)}`);

    const tabsWithResponses = allRequests
      .filter(([_, r]) => r.responsePayload)
      .map(([k, r]) => ({
        name: k,
        payload: r.responsePayload!,
        size: r.responseSize || 0,
        markets: r.marketCount || 0,
      }));

    if (tabsWithResponses.length > 1) {
      console.log(`\nComparing ${tabsWithResponses.length} responses...`);

      for (let i = 0; i < tabsWithResponses.length; i++) {
        for (let j = i + 1; j < tabsWithResponses.length; j++) {
          const tab1 = tabsWithResponses[i];
          const tab2 = tabsWithResponses[j];

          const diff = compareBuffers(tab1.payload, tab2.payload);

          console.log(`\n${tab1.name} vs ${tab2.name}:`);
          console.log(`   Response sizes: ${tab1.size} vs ${tab2.size} bytes (diff: ${tab1.size - tab2.size})`);
          console.log(`   Market counts: ${tab1.markets} vs ${tab2.markets} (diff: ${tab1.markets - tab2.markets})`);

          if (diff.same) {
            console.log(`   ✅ Responses are IDENTICAL`);
          } else {
            console.log(`   ⚠️  Responses DIFFER at byte ${diff.diffPosition}`);
            console.log(`   Different bytes: ${diff.diffBytes}`);
          }
        }
      }
    } else {
      console.log(`\n⚠️  Not enough responses to compare (need at least 2)`);
    }

    // Save payloads to files
    console.log(`\n\n${"─".repeat(80)}`);
    console.log(`💾 SAVING PAYLOADS`);
    console.log(`${"─".repeat(80)}`);

    const fs = await import("fs");
    const path = await import("path");

    const outputDir = path.join(process.cwd(), "backend", "data", "betclic-tab-payloads");

    try {
      await fs.promises.mkdir(outputDir, { recursive: true });
      console.log(`\n✅ Created output directory: ${outputDir}`);
    } catch (error) {
      console.log(`\n⚠️  Could not create output directory: ${error}`);
    }

    for (const [key, request] of allRequests) {
      if (request.decodedPayload) {
        const fileName = `${key.replace(/\s+/g, "_").replace(/\//g, "_")}_request.bin`;
        const filePath = path.join(outputDir, fileName);

        try {
          await fs.promises.writeFile(filePath, request.decodedPayload);
          console.log(`   ✓ Saved: ${fileName} (${request.decodedPayload.length} bytes)`);
        } catch (error) {
          console.log(`   ✗ Could not save ${fileName}: ${error}`);
        }
      }

      if (request.responsePayload) {
        const fileName = `${key.replace(/\s+/g, "_").replace(/\//g, "_")}_response.bin`;
        const filePath = path.join(outputDir, fileName);

        try {
          await fs.promises.writeFile(filePath, request.responsePayload);
          console.log(`   ✓ Saved: ${fileName} (${request.responsePayload.length} bytes)`);
        } catch (error) {
          console.log(`   ✗ Could not save ${fileName}: ${error}`);
        }
      }
    }

    // Final summary
    console.log(`\n\n${"─".repeat(80)}`);
    console.log(`🎯 FINAL SUMMARY`);
    console.log(`${"─".repeat(80)}`);

    const tabsWithNetwork = allRequests.filter(([_, r]) => r.hasNetworkRequest).length;
    const tabsWithoutNetwork = TAB_NAMES.length - tabsWithNetwork;

    console.log(`\nTabs tested: ${TAB_NAMES.length}`);
    console.log(`Tabs with network requests: ${tabsWithNetwork}`);
    console.log(`Tabs without network requests: ${tabsWithoutNetwork}`);

    const payloadsDir = path.join(outputDir, "*.bin");
    console.log(`\nPayloads saved to: ${payloadsDir}`);

    if (tabsWithoutNetwork > 0) {
      console.log(`\n⚠️  ${tabsWithoutNetwork} tab(s) did not trigger network requests`);
      console.log(`   This suggests:`);
      console.log(`   - Tabs may use cached data from initial load`);
      console.log(`   - Tabs may filter data client-side without API call`);
      console.log(`   - Tabs may trigger WebSocket messages (not gRPC requests)`);
    } else {
      console.log(`\n✅ All tabs triggered network requests`);
      console.log(`   This suggests: Each tab makes its own API call with different filter parameter`);
    }

    console.log(`\n${"=".repeat(100)}`);
    console.log(`✅ Script completed successfully`);
    console.log(`${"=".repeat(100)}`);

  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack.split("\n").slice(0, 10).join("\n"));
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
