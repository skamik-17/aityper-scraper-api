#!/usr/bin/env npx tsx

import { chromium } from "playwright";

async function scrapeBetclicMarket(matchUrl: string, marketName: string): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "pl-PL",
  });
  const page = await context.newPage();

  await page.setExtraHTTPHeaders({
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Cache-Control": "max-age=0",
  });

  try {
    console.log(`Navigating to ${matchUrl}...`);
    await page.goto(matchUrl, { waitUntil: "load", timeout: 45000 });

    await page.waitForTimeout(5000);

    console.log(`Page title: ${await page.title()}`);
    console.log(`Page URL: ${page.url()}`);

    const bodyText = await page.locator('body').textContent();
    console.log(`\nPage content length: ${bodyText?.length} chars`);

    if (bodyText) {
      console.log(`\nFirst 500 chars of body:\n${bodyText.substring(0, 500)}`);

      if (bodyText.includes("rzut wolny") || bodyText.includes("free kick")) {
        console.log(`\n✓ Found "rzut wolny" or "free kick" in page!`);
      }
    }

    console.log(`Scrolling to bottom to force render...`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    console.log(`Scrolling back to top...`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(2000);

    console.log(`\nSearching for market: "${marketName}"`);

    const marketSelectors = [
      `text="${marketName}"`,
      `*:text-is("${marketName}")`,
      `[class*="market"] text="${marketName}"`,
      `div:has-text("${marketName}")`,
      `span:has-text("${marketName}")`,
      `button:has-text("${marketName}")`,
    ];

    let found = false;
    for (const selector of marketSelectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.count() > 0) {
          console.log(`✓ Found market using selector: ${selector}`);

          const parent = element.locator('..');
          const html = await parent.innerHTML();
          console.log(`\nMarket HTML:\n${html}\n`);

          const oddsElements = await page.locator(`[class*="odd"], [data-odds]`).all();
          console.log(`\nFound ${oddsElements.length} odds elements:`);

          for (const oddsEl of oddsElements.slice(0, 10)) {
            const text = await oddsEl.textContent();
            console.log(`  - ${text?.trim()}`);
          }

          found = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!found) {
      console.log(`✗ Market "${marketName}" not found`);
      console.log(`\nAvailable markets on page:`);

      try {
        const allMarketNames = await page.locator(`[role="button"] span, [class*="market-name"]`).allTextContents();
        const uniqueMarkets = [...new Set(allMarketNames.map(n => n.trim()))].filter(n => n.length > 0);

        for (const name of uniqueMarkets.slice(0, 20)) {
          console.log(`  - ${name}`);
        }

        if (uniqueMarkets.length > 20) {
          console.log(`  ... and ${uniqueMarkets.length - 20} more`);
        }
      } catch (e) {
        console.log(`Could not extract market names: ${e}`);
      }
    }

    console.log(`\n\nTrying to click on "Metoda gola" tab...`);
    try {
      const tabButton = page.locator(`button:has-text("Metoda gola"), [role="tab"]:has-text("Metoda gola")`).first();
      if (await tabButton.count() > 0) {
        await tabButton.click();
        await page.waitForTimeout(2000);

        console.log(`\nMarkets in "Metoda gola" tab:`);
        const methodMarkets = await page.locator(`[role="button"] span, [class*="market-name"]`).allTextContents();
        const uniqueMethodMarkets = [...new Set(methodMarkets.map(n => n.trim()))].filter(n => n.length > 0);

        for (const name of uniqueMethodMarkets.slice(0, 20)) {
          console.log(`  - ${name}`);
          if (name.toLowerCase().includes("rzut wolny") || name.toLowerCase().includes("free kick")) {
            console.log(`    ← THIS IS OUR TARGET MARKET!`);
          }
        }
      } else {
        console.log(`"Metoda gola" tab not found`);
      }
    } catch (e) {
      console.log(`Could not click "Metoda gola" tab: ${e}`);
    }

  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let matchUrl = "https://www.betclic.pl/pilka-nozna-ekstraklasa";
  let marketName = "Gol bezpośrednio z rzutu wolnego w meczu";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      matchUrl = args[i + 1];
      i++;
    } else if (args[i] === "--market" && args[i + 1]) {
      marketName = args[i + 1];
      i++;
    }
  }

  console.log("=" .repeat(80));
  console.log("BETCLIC DOM MARKET SCRAPER");
  console.log("=".repeat(80));
  console.log(`URL: ${matchUrl}`);
  console.log(`Target Market: ${marketName}`);
  console.log();

  await scrapeBetclicMarket(matchUrl, marketName);
}

main().catch(console.error);
