import { PlaywrightScraper } from "../scrapers/base/playwright-base.js";
import fs from 'fs';
import path from 'path';

async function debugAPI(name: string, url: string) {
  const debugDir = path.join(process.cwd(), 'debug', name);
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  console.log(`[${name.toUpperCase()}] Monitoring Network for: ${url}`);
  
  const scraper = new (class extends PlaywrightScraper {
    async scrapeLeague() { return { status: "success" } as any; }
    async scrapeMatch() { return { status: "success" } as any; }
    async scrapeMatchDetails() { return { status: "success" } as any; }
    async extractEventUrls() { return []; }
  })();

  try {
    const page = await (scraper as any).initBrowser();
    
    page.on('response', async response => {
      const reqUrl = response.url();
      const contentType = response.headers()['content-type'] || '';
      
      if (contentType.includes('application/json')) {
        try {
          const data = await response.json();
          const strData = JSON.stringify(data);
          
          // Szukamy danych o meczach (Chelsea, Bournemouth, odds, markets)
          if (strData.includes('Chelsea') || strData.includes('odds') || strData.includes('markets') || strData.includes('events')) {
            const timestamp = Date.now();
            const fileName = `${name}_api_${timestamp}.json`;
            fs.writeFileSync(path.join(debugDir, fileName), JSON.stringify({ url: reqUrl, data }, null, 2));
            console.log(`[FOUND] Potential API data: debug/${name}/${fileName}`);
            console.log(`URL: ${reqUrl.substring(0, 100)}...`);
          }
        } catch (e) {}
      }
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await new Promise(r => setTimeout(r, 10000));
    
    await (scraper as any).cleanup();
    console.log(`Done scanning ${name}.`);
  } catch (err) {
    console.error(`Error scanning ${name}:`, err);
  }
}

const target = process.argv[2] || 'fuksiarz';
const urls: Record<string, string> = {
  fuksiarz: "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
  totalbet: "https://totalbet.pl/sports/events/Pi%C5%82ka-no%C5%BCna/7124",
  forbet: "https://www.iforbet.pl/zaklady-bukmacherskie/155/199",
  etoto: "https://www.etoto.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/206",
  betters: "https://www.betters.pl/sports/event-group/7124",
  lebull: "https://lebull.pl/sports/event-group/7124",
  betcris: "https://www.betcris.pl/sports/event-group/7124",
  pzbuk: "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league"
};

if (urls[target]) {
  debugAPI(target, urls[target]);
} else {
  console.error("Unknown target:", target);
}
