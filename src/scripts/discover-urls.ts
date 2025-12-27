/**
 * Discover Premier League URLs by navigating through bookmaker sites
 */

import { chromium } from "playwright";
import fs from "fs/promises";

const DEBUG_DIR = "/home/skamik/Documents/repositories/personal/aityper/backend/debug";

interface UrlDiscoveryResult {
  bookmaker: string;
  baseUrl: string;
  foundUrl: string | null;
  method: string;
  screenshot: string;
}

async function discoverLVBetUrl(): Promise<UrlDiscoveryResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    // Start at the main sports betting page
    await page.goto("https://lvbet.pl/pl/zaklady-bukmacherskie/", {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(5000);

    // Look for Premier League link in the page
    const premierLeagueLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      for (const link of links) {
        const text = link.textContent?.toLowerCase() || "";
        const href = link.href || "";
        if (
          (text.includes("premier league") || href.includes("premier-league")) &&
          href.includes("anglia")
        ) {
          return href;
        }
      }
      // Also check for any link with "anglia" that might be Premier League
      for (const link of links) {
        const href = link.href || "";
        if (href.includes("anglia") && href.includes("premier")) {
          return href;
        }
      }
      return null;
    });

    await page.screenshot({
      path: `${DEBUG_DIR}/lvbet-discover.png`,
      fullPage: true,
    });

    await browser.close();

    return {
      bookmaker: "lvbet",
      baseUrl: "https://lvbet.pl/pl/zaklady-bukmacherskie/",
      foundUrl: premierLeagueLink,
      method: "link search",
      screenshot: `${DEBUG_DIR}/lvbet-discover.png`,
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function discoverFuksiarzUrl(): Promise<UrlDiscoveryResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    // Start at the football betting page
    await page.goto("https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna", {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(5000);

    // Look for Premier League or England link
    const premierLeagueLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      for (const link of links) {
        const text = link.textContent?.toLowerCase() || "";
        const href = link.href || "";
        if (
          text.includes("premier league") ||
          (text.includes("anglia") && href.includes("premier"))
        ) {
          return href;
        }
      }
      // Check sidebar/menu items
      const menuItems = Array.from(
        document.querySelectorAll("[class*='menu'], [class*='sidebar'], [class*='nav'] a")
      );
      for (const item of menuItems) {
        const text = (item as HTMLElement).textContent?.toLowerCase() || "";
        const href = (item as HTMLAnchorElement).href || "";
        if (text.includes("premier") || text.includes("anglia")) {
          return href;
        }
      }
      return null;
    });

    await page.screenshot({
      path: `${DEBUG_DIR}/fuksiarz-discover.png`,
      fullPage: true,
    });

    await browser.close();

    return {
      bookmaker: "fuksiarz",
      baseUrl: "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna",
      foundUrl: premierLeagueLink,
      method: "link search",
      screenshot: `${DEBUG_DIR}/fuksiarz-discover.png`,
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function discoverBetclicUrl(): Promise<UrlDiscoveryResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    // Start at the football betting page
    await page.goto("https://www.betclic.pl/pilka-nozna-sfootball", {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(5000);

    // Look for Premier League link
    const premierLeagueLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      for (const link of links) {
        const text = link.textContent?.toLowerCase() || "";
        const href = link.href || "";
        if (
          text.includes("premier league") ||
          (text.includes("anglia") && text.includes("premier"))
        ) {
          return href;
        }
      }
      return null;
    });

    await page.screenshot({
      path: `${DEBUG_DIR}/betclic-discover.png`,
      fullPage: true,
    });

    await browser.close();

    return {
      bookmaker: "betclic",
      baseUrl: "https://www.betclic.pl/pilka-nozna-sfootball",
      foundUrl: premierLeagueLink,
      method: "link search",
      screenshot: `${DEBUG_DIR}/betclic-discover.png`,
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function testDirectUrls() {
  console.log("Testing direct Premier League URLs...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // URLs to test based on patterns found
  const urlsToTest = [
    // LVBet - try different ID patterns
    {
      bookmaker: "lvbet",
      url: "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/--/1/35148/37685/",
    },
    {
      bookmaker: "lvbet",
      url: "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/--/1/35148/",
    },
    // Fuksiarz - different URL patterns
    {
      bookmaker: "fuksiarz",
      url: "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
    },
    {
      bookmaker: "fuksiarz",
      url: "https://fuksiarz.pl/zaklady-bukmacherskie#soccer-anglia-premier_league",
    },
    // Betclic - different competition IDs
    {
      bookmaker: "betclic",
      url: "https://www.betclic.pl/pilka-nozna-sfootball/anglia-premier-league-c3",
    },
    {
      bookmaker: "betclic",
      url: "https://www.betclic.pl/pilka-nozna-sfootball/anglia-c3",
    },
  ];

  for (const { bookmaker, url } of urlsToTest) {
    console.log(`Testing ${bookmaker}: ${url}`);
    try {
      await page.goto(url, { timeout: 20000, waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      const title = await page.title();
      const finalUrl = page.url();
      const hasContent = await page.evaluate(() => {
        // Check for common match/event selectors
        const selectors = [
          ".event",
          "[class*='event']",
          "[class*='match']",
          ".fixture",
          "[class*='fixture']",
          "[data-event-id]",
          "li.eventListPeriodItemPartial",
          ".scoreboard_contestantLabel",
        ];
        for (const sel of selectors) {
          if (document.querySelectorAll(sel).length > 0) {
            return `Found: ${sel} (${document.querySelectorAll(sel).length})`;
          }
        }
        return "No event content found";
      });

      console.log(`  Title: ${title}`);
      console.log(`  Final URL: ${finalUrl}`);
      console.log(`  Content: ${hasContent}`);
      console.log("");
    } catch (error) {
      console.log(`  Error: ${error}`);
      console.log("");
    }
  }

  await browser.close();
}

async function main() {
  await fs.mkdir(DEBUG_DIR, { recursive: true });

  console.log("=== DISCOVERING PREMIER LEAGUE URLS ===\n");

  // Test direct URLs first
  await testDirectUrls();

  console.log("\n=== ATTEMPTING NAVIGATION-BASED DISCOVERY ===\n");

  try {
    const lvbetResult = await discoverLVBetUrl();
    console.log("LVBet:", lvbetResult.foundUrl || "Not found");
  } catch (error) {
    console.log("LVBet error:", error);
  }

  try {
    const fuksiarzResult = await discoverFuksiarzUrl();
    console.log("Fuksiarz:", fuksiarzResult.foundUrl || "Not found");
  } catch (error) {
    console.log("Fuksiarz error:", error);
  }

  try {
    const betclicResult = await discoverBetclicUrl();
    console.log("Betclic:", betclicResult.foundUrl || "Not found");
  } catch (error) {
    console.log("Betclic error:", error);
  }

  console.log("\nDone!");
}

main().catch(console.error);
