import { pzbukScraper } from "../scrapers/bookmakers/pzbuk.js";

async function debugPZbuk() {
  const url = "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league";
  try {
    const page = await (pzbukScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 8000));
    
    const info = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("[class*='GameCardWrapper'], [class*='game-card']"));
      const links = Array.from(document.querySelectorAll("a")).map(a => ({
        text: a.innerText.replace(/\n/g, " "),
        href: a.href,
        class: a.className
      })).filter(l => l.text.includes("-") || l.href.includes("/event/"));
      
      return { cardCount: cards.length, links: links.slice(0, 20) };
    });
    
    console.log("PZBuk Debug:", JSON.stringify(info, null, 2));
    await pzbukScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugPZbuk();
