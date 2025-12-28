/**
 * BETFAN API Discovery Script
 * Run this to identify the API endpoints used by BETFAN
 */

import { chromium } from "playwright";

const PREMIER_LEAGUE_URL = "https://betfan.pl/lista-zakladow/pilka-nozna/anglia/premier-league/244";

async function discoverBetfanApi() {
  const browser = await chromium.launch({ headless: true }); // Use headless mode
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
  });
  const page = await context.newPage();

  const apiCalls: { url: string; method: string; response?: any }[] = [];

  // Listen for all network responses
  page.on("response", async (response) => {
    const url = response.url();
    const method = response.request().method();

    // Filter for API calls (JSON responses, specific paths)
    if (
      url.includes("/api/") ||
      url.includes("/events") ||
      url.includes("/matches") ||
      url.includes("/offer") ||
      url.includes("/sport") ||
      url.includes("/odds") ||
      url.includes("/market") ||
      url.includes("/competition") ||
      url.includes("/tournament") ||
      url.includes("/prematch") ||
      url.includes("graphql") ||
      url.includes(".json")
    ) {
      console.log(`\n[${method}] ${url}`);
      try {
        const contentType = response.headers()["content-type"] || "";
        if (contentType.includes("application/json")) {
          const json = await response.json();
          console.log("Response structure:", JSON.stringify(json, null, 2).substring(0, 2000));
          apiCalls.push({ url, method, response: json });
        }
      } catch (e) {
        // Not JSON or failed to parse
      }
    }
  });

  console.log("Navigating to BETFAN Premier League page...");
  await page.goto(PREMIER_LEAGUE_URL, { waitUntil: "networkidle", timeout: 60000 });

  // Wait extra time for any lazy-loaded data
  console.log("Waiting for additional API calls...");
  await page.waitForTimeout(5000);

  console.log("\n\n=== DISCOVERED API CALLS ===");
  apiCalls.forEach((call, i) => {
    console.log(`\n${i + 1}. ${call.method} ${call.url}`);
    if (call.response) {
      const keys = Object.keys(call.response);
      console.log("   Top-level keys:", keys);
      if (call.response.data && Array.isArray(call.response.data)) {
        console.log("   data[] length:", call.response.data.length);
        if (call.response.data[0]) {
          console.log("   data[0] keys:", Object.keys(call.response.data[0]));
        }
      }
    }
  });

  // Try clicking on a match to see detail page API calls
  console.log("\n\nLooking for match links...");
  const matchLinks = await page.$$("a[href*='/lista-zakladow/']");
  console.log(`Found ${matchLinks.length} match links`);

  if (matchLinks.length > 0) {
    const firstMatchHref = await matchLinks[0].getAttribute("href");
    console.log("First match link:", firstMatchHref);

    if (firstMatchHref) {
      console.log("\nNavigating to match detail page...");
      apiCalls.length = 0; // Clear previous calls

      await page.goto(`https://betfan.pl${firstMatchHref}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(3000);

      console.log("\n=== MATCH DETAIL API CALLS ===");
      apiCalls.forEach((call, i) => {
        console.log(`\n${i + 1}. ${call.method} ${call.url}`);
      });
    }
  }

  await browser.close();
}

discoverBetfanApi().catch(console.error);
