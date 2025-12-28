/**
 * Exploration script to discover forBET API endpoints
 */
import { chromium, type Response } from "playwright";

const PREMIER_LEAGUE_URL = "https://www.iforbet.pl/zaklady-bukmacherskie/155/199";

async function exploreForbet() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
  });
  const page = await context.newPage();

  const capturedUrls: string[] = [];
  const capturedData: { url: string; data: any }[] = [];

  // Listen to all responses
  page.on("response", async (response: Response) => {
    const url = response.url();
    const contentType = response.headers()["content-type"] || "";

    // Capture JSON API calls
    if (contentType.includes("application/json") || url.includes("/api/") || url.includes("graphql")) {
      capturedUrls.push(url);
      try {
        const json = await response.json();
        capturedData.push({ url, data: json });
        console.log(`[API] ${url.substring(0, 120)}...`);
      } catch {
        // Not JSON
      }
    }
  });

  console.log("Navigating to forBET Premier League page...");
  await page.goto(PREMIER_LEAGUE_URL, { waitUntil: "networkidle", timeout: 60000 });

  console.log("\n=== Captured API URLs ===");
  capturedUrls.forEach((url) => console.log(url));

  console.log("\n=== Captured API Data Samples ===");
  for (const { url, data } of capturedData.slice(0, 5)) {
    console.log(`\n--- ${url.substring(0, 100)} ---`);
    console.log(JSON.stringify(data, null, 2).substring(0, 2000));
  }

  await browser.close();
}

exploreForbet().catch(console.error);
