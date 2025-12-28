import { fortunaScraper } from "../scrapers/bookmakers/fortuna.js";

async function debugFortunaWithScreenshot() {
  const url = "https://www.efortuna.pl/zaklady-bukmacherskie/pika-nozna/anglia-2/1-anglia-1";
  console.log(`Debugging Fortuna Listing with screenshot: ${url}`);
  
  try {
    const page = await (fortunaScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise(r => setTimeout(r, 10000));
    
    // Zrób screenshot listy
    await page.screenshot({ path: "fortuna_listing.png", fullPage: true });
    console.log("Screenshot saved as fortuna_listing.png");

    const data = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a")).map(a => ({
        label: a.getAttribute("aria-label"),
        href: a.href,
        text: a.innerText.substring(0, 50)
      })).filter(l => l.label && l.label.includes("-"));
      
      return {
        title: document.title,
        matchLinks: links
      };
    });
    
    console.log("Debug Data:", JSON.stringify(data, null, 2));
    await fortunaScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugFortunaWithScreenshot();
