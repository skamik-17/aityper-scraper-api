import { superbetScraper } from "../scrapers/bookmakers/superbet.js";
import fs from 'fs';
import path from 'path';

async function debugSuperbetNetwork() {
  const url = "https://superbet.pl/kursy/pilka-nozna/chelsea-vs-bournemouth-8730869";
  const debugDir = path.join(process.cwd(), 'debug');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);

  console.log(`Monitoring Superbet Network for: ${url}`);
  
  try {
    const page = await (superbetScraper as any).initBrowser();
    
    page.on('response', async response => {
      const reqUrl = response.url();
      if (response.headers()['content-type']?.includes('application/json')) {
        try {
          const data = await response.json();
          const strData = JSON.stringify(data);
          
          // Szukamy danych o meczu lub kursach
          if (strData.includes('market') || strData.includes('match') || strData.includes('outcome')) {
            const fileName = `superbet_api_${Date.now()}.json`;
            fs.writeFileSync(path.join(debugDir, fileName), JSON.stringify({ url: reqUrl, data }, null, 2));
            console.log(`[FOUND] Potential data saved to debug/${fileName} (URL: ${reqUrl.substring(0, 60)}...)`);
          }
        } catch (e) {}
      }
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    console.log("Page loaded, waiting for background requests...");
    await new Promise(r => setTimeout(r, 10000));
    
    await superbetScraper.cleanup();
    console.log("Done.");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

debugSuperbetNetwork();