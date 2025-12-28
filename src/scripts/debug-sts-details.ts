import { stsScraper } from "../scrapers/bookmakers/sts.js";

async function debugSTS() {
  const url = "https://www.sts.pl/kursy/burnley-newcastle/f1160380";
  console.log(`Debugging STS details for: ${url}`);
  
  try {
    const page = await (stsScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 5000));
    
    const marketInfo = await page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll(".market-section, .markets-container, [class*='market']"));
      return sections.map(s => ({
        header: s.querySelector("h2, h3, .market-header, .market-name")?.textContent?.trim(),
        buttonCount: s.querySelectorAll("button").length,
        buttons: Array.from(s.querySelectorAll("button")).slice(0, 3).map(b => ({
          text: b.innerText.replace(/\n/g, " "),
          html: b.innerHTML.substring(0, 100)
        }))
      })).filter(s => s.buttonCount > 0);
    });
    
    console.log("Markets found:", JSON.stringify(marketInfo, null, 2));
    
    await stsScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugSTS();
