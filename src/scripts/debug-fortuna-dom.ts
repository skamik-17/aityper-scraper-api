import { fortunaScraper } from "../scrapers/bookmakers/fortuna.js";

async function debugFortunaDOM() {
  const url = "https://www.efortuna.pl/zaklady-bukmacherskie/pika-nozna/anglia-2/1-anglia-1/chelsea-bournemouth?tab=offer";
  try {
    const page = await (fortunaScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 10000));
    
    const info = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll("button")).map(b => ({
        text: b.innerText.substring(0, 50).replace(/\n/g, " "),
        className: b.className
      })).slice(0, 50);
      
      const marketDivs = Array.from(document.querySelectorAll("div[class*='market'], div[class*='fixture']")).map(d => ({
        className: d.className,
        text: d.innerText.substring(0, 50).replace(/\n/g, " ")
      })).slice(0, 20);
      
      return { allButtons, marketDivs };
    });
    
    console.log("Fortuna DOM Debug:", JSON.stringify(info, null, 2));
    await fortunaScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugFortunaDOM();

