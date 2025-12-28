/**
 * Temporary test script to discover STS API endpoints
 * Run: npx tsx backend/src/scrapers/bookmakers/sts-api-test.ts
 */

import { chromium } from "playwright";

const PREMIER_LEAGUE_URL = "https://www.sts.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/1/1/17";

async function discoverSTSApi() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
  });
  const page = await context.newPage();

  const apiCalls: { url: string; method: string; type: string }[] = [];

  // Intercept all responses
  page.on("response", async (response) => {
    const url = response.url();
    const method = response.request().method();
    const contentType = response.headers()["content-type"] || "";

    // Filter for API-like calls (JSON responses)
    if (contentType.includes("json") || url.includes("/api/") || url.includes("offer") || url.includes("event")) {
      apiCalls.push({ url, method, type: contentType });

      console.log(`\n[API CALL] ${method} ${url}`);
      console.log(`Content-Type: ${contentType}`);

      try {
        const json = await response.json();
        console.log("Response sample:", JSON.stringify(json, null, 2).substring(0, 2000));
      } catch {
        // Not JSON
      }
    }
  });

  console.log(`Navigating to: ${PREMIER_LEAGUE_URL}`);
  await page.goto(PREMIER_LEAGUE_URL, { waitUntil: "networkidle", timeout: 60000 });

  console.log("\n\n=== SUMMARY OF API CALLS ===\n");
  apiCalls.forEach((call, i) => {
    console.log(`${i + 1}. [${call.method}] ${call.url}`);
  });

  await browser.close();
}

discoverSTSApi().catch(console.error);
