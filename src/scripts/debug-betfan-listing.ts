import { betfanScraper } from "../scrapers/bookmakers/betfan.js";

async function debugBetfan() {
  const url = "https://betfan.pl/lista-zakladow/pilka-nozna/anglia/premier-league/244";
  try {
    const page = await (betfanScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 5000));
    
    const tileInfo = await page.evaluate(() => {
      const tile = document.querySelector(".eventCardHome__card");
      if (!tile) return "No tile found";
      const participants = Array.from(tile.querySelectorAll(".eventCardHome__info__participants__participant"));
      return {
        html: tile.innerHTML.substring(0, 1000),
        participantCount: participants.length,
        participantTexts: participants.map(p => p.textContent?.trim())
      };
    });
    
    console.log("Betfan Tile Debug:", JSON.stringify(tileInfo, null, 2));
    await betfanScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugBetfan();
