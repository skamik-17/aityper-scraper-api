/**
 * Fuksiarz Network Discovery Script
 * Discovers API endpoints used by Fuksiarz website
 */

import { chromium } from "playwright";

async function discoverFuksiarzAPI() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
  });
  const page = await context.newPage();

  const apiCalls: { url: string; method: string; status: number; contentType: string }[] = [];

  page.on("response", async (response) => {
    const url = response.url();
    const request = response.request();

    // Filter for API calls (skip static resources)
    if (
      url.includes("/api/") ||
      url.includes("/rest/") ||
      url.includes("/graphql") ||
      url.includes("content-type=application/json") ||
      (response.headers()["content-type"]?.includes("application/json") && !url.includes(".js"))
    ) {
      const info = {
        url: url.substring(0, 200),
        method: request.method(),
        status: response.status(),
        contentType: response.headers()["content-type"] || "unknown",
      };
      apiCalls.push(info);
      console.log(`[API] ${info.method} ${info.status} ${info.url}`);

      // Try to log the response body for interesting endpoints
      if (response.status() === 200 && url.includes("api")) {
        try {
          const json = await response.json();
          console.log(`  -> Response keys: ${Object.keys(json).join(", ")}`);
          if (json.data) {
            console.log(`  -> data length: ${Array.isArray(json.data) ? json.data.length : "object"}`);
          }
          if (json.events) {
            console.log(`  -> events length: ${Array.isArray(json.events) ? json.events.length : "object"}`);
          }
        } catch {}
      }
    }
  });

  console.log("\n=== Navigating to Fuksiarz Premier League page ===\n");
  await page.goto("https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league", {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  await page.waitForTimeout(5000);

  console.log("\n=== API Calls Summary ===\n");
  apiCalls.forEach((call, i) => {
    console.log(`${i + 1}. ${call.method} ${call.status} ${call.url}`);
  });

  await browser.close();
  console.log("\n=== Done ===\n");
}

discoverFuksiarzAPI().catch(console.error);
