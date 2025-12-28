import { lvbetScraper } from "../scrapers/bookmakers/lvbet.js";

async function debugLVBet() {
  const url = "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/";
  try {
    const page = await (lvbetScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 8000));
    
    const info = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a")).map(a => ({
        text: a.innerText.replace(/\n/g, " "),
        href: a.href
      })).filter(l => l.text.includes("-") || l.href.includes("/zaklady-bukmacherskie/"));
      
      const buttons = Array.from(document.querySelectorAll("button")).slice(0, 20).map(b => b.innerText.replace(/\n/g, " "));
      
      return { links: links.slice(0, 20), buttons };
    });
    
    console.log("LVBet Debug:", JSON.stringify(info, null, 2));
    await lvbetScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugLVBet();
