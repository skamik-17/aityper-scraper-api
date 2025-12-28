import { superbetScraper } from "../scrapers/bookmakers/superbet.js";

async function debugSuperbetDetails() {
  const url = "https://superbet.pl/kursy/pilka-nozna/chelsea-vs-bournemouth-8730869/?t=offer-prematch-106&marketGroup=-2";
  console.log(`Debugging Superbet Details: ${url}`);
  
  try {
    const page = await (superbetScraper as any).initBrowser();
    await page.setViewportSize({ width: 1920, height: 5000 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise(r => setTimeout(r, 10000));
    
    // Zrób screenshot
    await page.screenshot({ path: "superbet_dom.png", fullPage: true });
    console.log("Screenshot saved as superbet_dom.png");

    const info = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll("h3, .market-title, [class*='market-title']")).map(h => h.innerText);
      const buttons = Array.from(document.querySelectorAll("button")).slice(0, 50).map(b => b.innerText.replace(/\n/g, " "));
      return { headers, buttons };
    });
    
    console.log("Superbet Info:", JSON.stringify(info, null, 2));
    await superbetScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugSuperbetDetails();
