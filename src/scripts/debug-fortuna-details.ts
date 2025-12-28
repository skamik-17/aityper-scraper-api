import { fortunaScraper } from "../scrapers/bookmakers/fortuna.js";

async function debugFortunaDetails() {
  const url = "https://www.efortuna.pl/zaklady-bukmacherskie/pika-nozna/anglia-2/1-anglia-1/crystal-palace-tottenham?filter=live&tab=offer";
  try {
    const page = await (fortunaScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 5000));
    
    const pageData = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll(".odds-button2__label, .odds-button__label"));
      return {
        title: document.querySelector("h1")?.innerText,
        labels: labels.slice(0, 50).map(l => l.textContent?.trim())
      };
    });
    
    console.log("Page Debug:", JSON.stringify(pageData, null, 2));
    await fortunaScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugFortunaDetails();
