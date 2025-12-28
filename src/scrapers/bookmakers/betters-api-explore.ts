/**
 * Betters API Explorer
 * Script to discover API endpoints used by betterspl-ssr.boxwebcdn.work
 */

import { chromium } from "playwright";

async function exploreBettersAPI() {
  const browser = await chromium.launch({ headless: false }); // Use headed mode to see
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  const apiEndpoints: { url: string; method: string; data?: any }[] = [];

  // Intercept all network requests
  page.on("response", async (response) => {
    const url = response.url();
    const method = response.request().method();

    // Focus on API calls (JSON responses)
    if (
      url.includes("api") ||
      url.includes("/events") ||
      url.includes("/matches") ||
      url.includes("/odds") ||
      url.includes("/league") ||
      url.includes("/fixture") ||
      url.includes("/sport") ||
      url.includes("/market")
    ) {
      try {
        const contentType = response.headers()["content-type"] || "";
        if (contentType.includes("application/json")) {
          const json = await response.json();
          console.log("\n=== API ENDPOINT FOUND ===");
          console.log("URL:", url);
          console.log("Method:", method);
          console.log("Data preview:", JSON.stringify(json, null, 2).slice(0, 2000));
          apiEndpoints.push({ url, method, data: json });
        }
      } catch (e) {
        // Not JSON or error parsing
      }
    }
  });

  // Also log XHR/fetch requests
  page.on("request", (request) => {
    if (request.resourceType() === "xhr" || request.resourceType() === "fetch") {
      console.log(`[${request.method()}] ${request.url()}`);
    }
  });

  // Navigate to Premier League page
  const url = "https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485";
  console.log(`\nNavigating to: ${url}\n`);

  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

  // Wait a bit for any lazy-loaded content
  await new Promise((r) => setTimeout(r, 5000));

  // Try clicking on a match to see detail page API
  const matchLinks = await page.$$("a[href*='/event/']");
  if (matchLinks.length > 0) {
    console.log("\n\n=== CLICKING ON FIRST MATCH ===\n");
    await matchLinks[0].click();
    await page.waitForLoadState("networkidle");
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log("\n\n=== SUMMARY ===");
  console.log(`Found ${apiEndpoints.length} API endpoints:\n`);
  apiEndpoints.forEach((ep, i) => {
    console.log(`${i + 1}. ${ep.method} ${ep.url}`);
  });

  await browser.close();
}

exploreBettersAPI().catch(console.error);
