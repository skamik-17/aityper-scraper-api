/**
 * LeBull Network Exploration Script
 * Run: npx tsx backend/src/scrapers/bookmakers/lebull-network-test.ts
 */

import { chromium } from "playwright";

async function exploreNetwork() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
  });
  const page = await context.newPage();

  const apiCalls: { url: string; method: string; response?: any }[] = [];

  // Listen to all network responses
  page.on("response", async (response) => {
    const url = response.url();
    const method = response.request().method();

    // Filter for API-like requests
    if (url.includes("api") || url.includes("graphql") || url.includes("/v1/") || url.includes("/v2/") ||
        url.includes(".json") || (url.includes("lebull") && !url.includes(".css") && !url.includes(".js") &&
        !url.includes(".png") && !url.includes(".svg") && !url.includes(".woff"))) {

      console.log(`[${method}] ${url}`);

      try {
        const contentType = response.headers()["content-type"] || "";
        if (contentType.includes("json")) {
          const json = await response.json();
          console.log("Response preview:", JSON.stringify(json).slice(0, 500));
          apiCalls.push({ url, method, response: json });
        }
      } catch (e) {
        // Not JSON or failed to parse
      }
    }
  });

  console.log("\n=== Navigating to Premier League page ===\n");
  await page.goto("https://lebullpl-ssr.boxwebcdn.work/pl/league/1/4485", {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  console.log("\n=== Waiting for additional requests ===\n");
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log("\n=== Summary of API calls ===");
  apiCalls.forEach((call, i) => {
    console.log(`\n${i + 1}. ${call.method} ${call.url}`);
    if (call.response) {
      console.log("Keys:", Object.keys(call.response));
    }
  });

  // Try to click on a match to see match detail API
  console.log("\n=== Trying to click on a match ===\n");
  const matchLink = await page.$("a[href*='/event/']");
  if (matchLink) {
    const href = await matchLink.getAttribute("href");
    console.log("Found match link:", href);

    if (href) {
      await page.goto(href.startsWith("http") ? href : `https://lebullpl-ssr.boxwebcdn.work${href}`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  console.log("\n=== Final API calls summary ===");
  console.log(`Total API calls captured: ${apiCalls.length}`);

  await browser.close();
}

exploreNetwork().catch(console.error);
