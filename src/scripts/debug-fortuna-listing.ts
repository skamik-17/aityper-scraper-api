import { fortunaScraper } from "../scrapers/bookmakers/fortuna.js";

async function debugFortuna() {
  const url = "https://www.efortuna.pl/zaklady-bukmacherskie/pika-nozna/anglia-2/1-anglia-1";
  try {
    const page = await (fortunaScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 5000));
    
    const debugInfo = await page.evaluate(() => {
      const tile = document.querySelector(".fixture-card");
      if (!tile) return "No .fixture-card found";
      
      const participants = Array.from(tile.querySelectorAll("*")).filter(el => (el as HTMLElement).innerText?.includes("Chelsea") || (el as HTMLElement).innerText?.includes("Bournemouth"));
      
      return {
        outerHTML: tile.outerHTML.substring(0, 2000),
        participants: participants.map(p => ({
          tag: p.tagName,
          className: p.className,
          text: (p as HTMLElement).innerText
        }))
      };
    });
    console.log("Fortuna Tile Deep Debug:", JSON.stringify(debugInfo, null, 2));
    await fortunaScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugFortuna();

