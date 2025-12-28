import { totalbetScraper } from "../scrapers/bookmakers/totalbet.js";

async function debugTotalbetDetails() {
  const url = "https://totalbet.pl/sports/event/6214128";
  try {
    const page = await (totalbetScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 5000));
    
    const pageData = await page.evaluate(() => {
      return {
        h1: document.querySelector("h1")?.innerText,
        eventName: document.querySelector(".event-name")?.innerText,
        labels: Array.from(document.querySelectorAll(".btn-odd__label")).slice(0, 20).map(l => l.textContent?.trim())
      };
    });
    
    console.log("Totalbet Details Debug:", JSON.stringify(pageData, null, 2));
    await totalbetScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugTotalbetDetails();
