import { lvbetScraper } from "../scrapers/bookmakers/lvbet.js";
import fs from 'fs';
import path from 'path';

async function debugLVBetMatchAPI() {
  // Budujemy link na podstawie Twojego wzoru
  const url = "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/chelseavsbournemouth/--/1/35148/37685/bc:28660758/";
  const debugDir = path.join(process.cwd(), 'debug');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);

  console.log(`Monitoring LVBet Match API for: ${url}`);
  
  try {
    const page = await (lvbetScraper as any).initBrowser();
    
    page.on('response', async response => {
      const reqUrl = response.url();
      const contentType = response.headers()['content-type'] || '';
      
      if (contentType.includes('application/json')) {
        try {
          const data = await response.json();
          // Szukamy danych o rynkach (markets)
          if (JSON.stringify(data).includes('market') || JSON.stringify(data).includes('outcome')) {
            const fileName = `lvbet_match_api_${Date.now()}.json`;
            fs.writeFileSync(path.join(debugDir, fileName), JSON.stringify({ url: reqUrl, data }, null, 2));
            console.log(`[FOUND] Potential match detail data in: debug/${fileName}`);
            console.log(`URL: ${reqUrl}`);
          }
        } catch (e) {}
      }
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await new Promise(r => setTimeout(r, 10000));
    
    await lvbetScraper.cleanup();
    console.log("Done.");
  } catch (err) {
    console.error("Error:", err);
  }
}

debugLVBetMatchAPI();
