import { superbetScraper } from "../scrapers/bookmakers/superbet.js";

async function debugSuperbetDetails() {
  const url = "https://superbet.pl/kursy/pilka-nozna/crystal-palace-vs-tottenham-8712114/?t=offer-live-106&marketGroup=-2";
  try {
    const page = await (superbetScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 5000));
    
    const pageData = await page.evaluate(() => {
      const markets = Array.from(document.querySelectorAll("[class*='market-group'], .markets-container, [class*='event-markets']"));
      return markets.map(m => ({
        header: m.querySelector("[class*='market-title'], h3")?.innerText,
        odds: Array.from(m.querySelectorAll(".odd-button")).map((b: any) => ({
          label: b.querySelector(".odd-button__odd-name")?.innerText,
          value: b.querySelector(".odd-button__odd-value")?.innerText
        }))
      })).filter(m => m.odds.length > 0);
    });
    
    console.log("Superbet Debug:", JSON.stringify(pageData, null, 2));
    await superbetScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugSuperbetDetails();
