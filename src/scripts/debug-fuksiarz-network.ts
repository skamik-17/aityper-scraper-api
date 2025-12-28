import { fuksiarzScraper } from "../scrapers/bookmakers/fuksiarz.js";

async function debugFuksiarzNetwork() {
  const url = "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league";
  console.log(`Monitoring Fuksiarz Network for: ${url}`);
  
  try {
    const page = await (fuksiarzScraper as any).initBrowser();
    
    page.on('response', async response => {
      if (response.headers()['content-type']?.includes('application/json')) {
        const reqUrl = response.url();
        try {
          const data = await response.json();
          const str = JSON.stringify(data);
          if (str.includes('Chelsea') || str.includes('odds') || str.includes('matches')) {
            console.log(`[FOUND] Potential API: ${reqUrl.substring(0, 100)}...`);
          }
        } catch (e) {}
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise(r => setTimeout(r, 15000));
    
    await fuksiarzScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugFuksiarzNetwork();
