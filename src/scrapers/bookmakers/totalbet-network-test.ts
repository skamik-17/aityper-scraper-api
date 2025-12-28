/**
 * TOTALbet Network Traffic Analysis Script
 * Run with: npx tsx backend/src/scrapers/bookmakers/totalbet-network-test.ts
 */

import { chromium } from "playwright";

async function analyzeNetwork() {
  const browser = await chromium.launch({ headless: false }); // headless: false to see the browser
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
  });
  const page = await context.newPage();

  const apiCalls: Array<{ url: string; method: string; status: number; contentType: string }> = [];

  // Listen to all responses
  page.on("response", async (response) => {
    const url = response.url();
    const status = response.status();
    const contentType = response.headers()["content-type"] || "";

    // Log API-like requests (JSON responses, excluding static assets)
    if (
      (url.includes("api") || url.includes("/v1/") || url.includes("/v2/") ||
       url.includes("events") || url.includes("sport") || url.includes("match") ||
       url.includes("odds") || url.includes("offer") || url.includes("bet") ||
       contentType.includes("json")) &&
      !url.includes(".js") && !url.includes(".css") && !url.includes(".png") &&
      !url.includes(".jpg") && !url.includes(".svg") && !url.includes(".woff")
    ) {
      apiCalls.push({
        url: url,
        method: response.request().method(),
        status,
        contentType,
      });

      // Try to get JSON body for interesting endpoints
      if (contentType.includes("json") && status === 200) {
        try {
          const json = await response.json();
          console.log("\n=== JSON RESPONSE ===");
          console.log("URL:", url);
          console.log("Sample data:", JSON.stringify(json, null, 2).substring(0, 2000));
          console.log("==================\n");
        } catch (e) {
          // Not JSON
        }
      }
    }
  });

  console.log("Navigating to TOTALbet Premier League page...");
  const url = "https://totalbet.pl/sports/events/Pi%C5%82ka-no%C5%BCna/7124?uncheckAll=true";

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait for dynamic content to load
  console.log("Waiting for page to fully load...");
  await page.waitForTimeout(8000);

  console.log("\n=== ALL API-LIKE CALLS ===");
  apiCalls.forEach((call, i) => {
    console.log(`${i + 1}. [${call.method}] ${call.status} - ${call.url.substring(0, 150)}`);
  });

  // Now navigate to a single match to see match details API
  console.log("\n\nLooking for match links...");
  const matchLinks = await page.evaluate(() => {
    const links: string[] = [];
    document.querySelectorAll("a[href*='/sports/event/'], a[href*='event']").forEach((a) => {
      const href = (a as HTMLAnchorElement).href;
      if (href && !links.includes(href)) links.push(href);
    });
    return links.slice(0, 5);
  });

  console.log("Found match links:", matchLinks);

  if (matchLinks.length > 0) {
    console.log(`\nNavigating to match: ${matchLinks[0]}`);
    apiCalls.length = 0; // Clear previous calls
    await page.goto(matchLinks[0], { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);

    console.log("\n=== MATCH DETAIL API CALLS ===");
    apiCalls.forEach((call, i) => {
      console.log(`${i + 1}. [${call.method}] ${call.status} - ${call.url.substring(0, 150)}`);
    });
  }

  await browser.close();
  console.log("\nDone!");
}

analyzeNetwork().catch(console.error);
