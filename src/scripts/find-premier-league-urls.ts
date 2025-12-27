/**
 * Script to discover correct Premier League URLs for all bookmakers
 */

import { chromium } from "playwright";

async function findUrls() {
  const browser = await chromium.launch({ headless: false }); // headed mode to see what's happening
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  // Test URLs found from search or manual exploration
  const testUrls: Record<string, string[]> = {
    lvbet: [
      "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/--/1/35148/37685/",
      "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/--/1/35148/",
    ],
    fuksiarz: [
      "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/anglia",
      "https://fuksiarz.pl/zaklady-bukmacherskie#soccer-anglia-premier_league",
    ],
    betclic: [
      "https://www.betclic.pl/pilka-nozna-sfootball/anglia-premier-league-c3",
      "https://www.betclic.pl/pilka-nozna-sfootball/premier-league-c3",
    ],
    fortuna: [
      "https://www.efortuna.pl/zaklady-bukmacherskie/pika-nozna/anglia-8/premier-league-anglia",
      "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
    ],
    sts: [
      "https://www.sts.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/1/39/192",
      "https://www.sts.pl/zaklady-bukmacherskie/pilka-nozna/anglia/1/39",
    ],
  };

  for (const [bookmaker, urls] of Object.entries(testUrls)) {
    console.log(`\n=== ${bookmaker.toUpperCase()} ===`);
    for (const url of urls) {
      try {
        console.log(`Testing: ${url}`);
        await page.goto(url, { timeout: 15000, waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);
        const title = await page.title();
        const currentUrl = page.url();
        console.log(`  Title: ${title}`);
        if (currentUrl !== url) {
          console.log(`  Redirected to: ${currentUrl}`);
        }
        console.log(`  Status: OK`);
      } catch (error) {
        console.log(`  Error: ${error}`);
      }
    }
  }

  await browser.close();
}

findUrls().catch(console.error);
