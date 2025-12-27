/**
 * Debug script for Premier League scrapers
 * Captures screenshots and HTML content to diagnose issues
 */

import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";

const DEBUG_DIR = "/home/skamik/Documents/repositories/personal/aityper/backend/debug";

const PREMIER_LEAGUE_URLS: Record<string, string> = {
  sts: "https://www.sts.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/1/39/192",
  fortuna:
    "https://www.efortuna.pl/zaklady-bukmacherskie/pika-nozna/anglia-8/premier-league-anglia",
  betclic: "https://www.betclic.pl/pilka-nozna-sfootball/anglia-premier-league-c5",
  superbet:
    "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
  lvbet:
    "https://www.lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
  fuksiarz:
    "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/39/1",
};

async function debugBookmaker(bookmaker: string, url: string): Promise<void> {
  console.log(`\nDebugging ${bookmaker}...`);
  console.log(`URL: ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
    viewport: { width: 1920, height: 5000 },
  });

  const page = await context.newPage();

  try {
    // Navigate
    console.log(`  Navigating...`);
    await page.goto(url, {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });

    // Wait for content to load
    console.log(`  Waiting for content...`);
    await page.waitForTimeout(5000);

    // Take screenshot
    const screenshotPath = path.join(DEBUG_DIR, `${bookmaker}-pl.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`  Screenshot saved: ${screenshotPath}`);

    // Get page title
    const title = await page.title();
    console.log(`  Page title: ${title}`);

    // Get page URL (in case of redirects)
    const currentUrl = page.url();
    if (currentUrl !== url) {
      console.log(`  Redirected to: ${currentUrl}`);
    }

    // Check for common elements
    const selectors: Record<string, string[]> = {
      sts: [
        ".one-ticket-match-tile",
        ".odds-button__odd-value",
        ".match-tile",
        "[data-testid]",
      ],
      fortuna: [
        ".fixture-card__market-outcomes",
        ".odds-button2__value",
        ".fixture-card",
        "[data-qa]",
      ],
      betclic: [
        "[data-qa='event-card']",
        ".oddValue",
        ".scoreboard_contestantLabel",
        ".event",
      ],
      superbet: [
        ".event-card__main-content",
        ".e2e-event-team1-name",
        ".odd-button__odd-value",
        "[data-testid]",
      ],
      lvbet: [
        "[class*='EventRow']",
        "[class*='TeamName']",
        "[class*='OddsButton']",
        ".event",
      ],
      fuksiarz: [
        "li.eventListPeriodItemPartial",
        "button.btn-odd",
        ".eventList",
        "[data-event-id]",
      ],
    };

    console.log(`  Checking selectors:`);
    for (const selector of selectors[bookmaker] || []) {
      const count = await page.locator(selector).count();
      console.log(`    ${selector}: ${count} elements`);
    }

    // Save HTML snippet (first 50KB)
    const html = await page.content();
    const htmlPath = path.join(DEBUG_DIR, `${bookmaker}-pl.html`);
    await fs.writeFile(htmlPath, html.slice(0, 100000));
    console.log(`  HTML saved: ${htmlPath} (${html.length} bytes)`);
  } catch (error) {
    console.error(`  Error: ${error}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  // Create debug directory
  await fs.mkdir(DEBUG_DIR, { recursive: true });

  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Debug specific bookmaker
    const bookmaker = args[0];
    const url = PREMIER_LEAGUE_URLS[bookmaker];
    if (!url) {
      console.error(`Unknown bookmaker: ${bookmaker}`);
      console.error(`Available: ${Object.keys(PREMIER_LEAGUE_URLS).join(", ")}`);
      process.exit(1);
    }
    await debugBookmaker(bookmaker, url);
  } else {
    // Debug all failing scrapers
    const failingBookmakers = ["sts", "fortuna", "betclic", "lvbet", "fuksiarz"];

    for (const bookmaker of failingBookmakers) {
      await debugBookmaker(bookmaker, PREMIER_LEAGUE_URLS[bookmaker]);
    }
  }

  console.log("\nDone! Check the debug directory for screenshots and HTML.");
}

main().catch(console.error);
