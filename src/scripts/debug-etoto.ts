import { etotoScraper } from "../scrapers/bookmakers/etoto.js";

async function debugEtoto() {
  const url = "https://www.etoto.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/206";
  try {
    const page = await (etotoScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 5000));
    
    const info = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a")).filter(a => a.innerText.includes("-")).map(a => a.innerText.replace(/\n/g, " "));
      const buttons = Array.from(document.querySelectorAll("button")).slice(0, 20).map(b => b.innerText.replace(/\n/g, " "));
      return { links, buttons };
    });
    
    console.log("Etoto Debug:", JSON.stringify(info, null, 2));
    await etotoScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugEtoto();

