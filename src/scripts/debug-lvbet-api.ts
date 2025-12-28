import { lvbetScraper } from "../scrapers/bookmakers/lvbet.js";
import fs from 'fs';
import path from 'path';

async function debugLVBetNetwork() {
  const url = "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league";
  const debugDir = path.join(process.cwd(), 'debug');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);

  console.log(`Monitoring LVBet Network for: ${url}`);
  
  try {
    const page = await (lvbetScraper as any).initBrowser();
    
    page.on('response', async response => {
      const reqUrl = response.url();
      const contentType = response.headers()['content-type'] || '';
      
      if (contentType.includes('application/json')) {
        try {
          const data = await response.json();
          const strData = JSON.stringify(data);
          
          // Szukamy czegokolwiek co wygląda na listę meczów (np. nazwy drużyn Premier League)
          if (strData.includes('Chelsea') || strData.includes('Bournemouth') || strData.includes('matches') || strData.includes('primaryMarkets')) {
            const fileName = `lvbet_api_${Date.now()}.json`;
            fs.writeFileSync(path.join(debugDir, fileName), JSON.stringify({ url: reqUrl, data }, null, 2));
            console.log(`[FOUND] Potential match data in: debug/${fileName} (URL: ${reqUrl.substring(0, 60)}...)`);
          }
        } catch (e) {}
      }
    });

    // Networkidle jest kluczowe by złapać wszystkie requesty API
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    console.log("Page loaded, waiting for background API calls...");
    await new Promise(r => setTimeout(r, 10000));
    
    await lvbetScraper.cleanup();
    console.log("Done scanning LVBet.");
  } catch (err) {
    console.error("Error:", err);
  }
}

debugLVBetNetwork();
