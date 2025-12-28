/**
 * eToto API Discovery Script
 * Intercepts network requests to find API endpoints for odds data
 */

import { chromium } from "playwright";

const LEAGUE_URL = "https://www.etoto.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/206";

async function discoverEtotoApi() {
  console.log("[eToto Discovery] Starting browser...");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
  });

  const page = await context.newPage();

  const apiCalls: { url: string; method: string; data?: any }[] = [];

  // Intercept all network responses
  page.on("response", async (response) => {
    const url = response.url();
    const method = response.request().method();

    // Filter for API-like URLs
    if (
      url.includes("/api/") ||
      url.includes("/gql") ||
      url.includes("/graphql") ||
      url.includes("offer") ||
      url.includes("events") ||
      url.includes("matches") ||
      url.includes("odds") ||
      url.includes("sports") ||
      url.includes("markets") ||
      (url.includes(".json") && !url.includes("manifest"))
    ) {
      console.log(`\n[API] ${method} ${url}`);

      try {
        const contentType = response.headers()["content-type"] || "";
        if (contentType.includes("application/json")) {
          const json = await response.json();
          console.log("[Response preview]:", JSON.stringify(json).slice(0, 500));
          apiCalls.push({ url, method, data: json });
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  });

  console.log(`[eToto Discovery] Navigating to ${LEAGUE_URL}`);
  await page.goto(LEAGUE_URL, { waitUntil: "networkidle", timeout: 60000 });

  // Wait for dynamic content
  await page.waitForTimeout(5000);

  // Try scrolling to trigger lazy loading
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);

  console.log("\n\n=== Summary of API Calls ===");
  for (const call of apiCalls) {
    console.log(`\n${call.method} ${call.url}`);
    if (call.data) {
      // Check for match-related data structures
      const dataStr = JSON.stringify(call.data);
      if (
        dataStr.includes("home") ||
        dataStr.includes("away") ||
        dataStr.includes("odds") ||
        dataStr.includes("event") ||
        dataStr.includes("match")
      ) {
        console.log(">>> POTENTIAL MATCH DATA <<<");
        console.log(JSON.stringify(call.data, null, 2).slice(0, 2000));
      }
    }
  }

  await browser.close();
  console.log("\n[eToto Discovery] Done");
}

discoverEtotoApi().catch(console.error);
