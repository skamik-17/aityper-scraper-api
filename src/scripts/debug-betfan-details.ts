import { betfanScraper } from "../scrapers/bookmakers/betfan.js";

async function debugBetfanDetails() {
  const url = "https://betfan.pl/lista-zakladow/pilka-nozna/anglia/premier-league/burnley-newcastle/34785447";
  try {
    const page = await (betfanScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 5000));
    
    const pageData = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll(".oddsButton__label"));
      return {
        h1: document.querySelector("h1")?.innerText,
        participants: Array.from(document.querySelectorAll(".eventHeader__participants__participant")).map(p => p.textContent?.trim()),
        labels: labels.slice(0, 20).map(l => l.textContent?.trim())
      };
    });
    
    console.log("Betfan Details Debug:", JSON.stringify(pageData, null, 2));
    await betfanScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugBetfanDetails();
