import { fortunaScraper } from "../scrapers/bookmakers/fortuna.js";

async function debugFortunaMatch() {
  const url = "https://www.efortuna.pl/zaklady-bukmacherskie/pika-nozna/anglia-2/1-anglia-1/chelsea-bournemouth?tab=offer";
  console.log(`Debugging Fortuna Details (Strict): ${url}`);
  
  try {
    const page = await (fortunaScraper as any).initBrowser();
    
    // Manual navigation to control process
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    console.log("Navigation finished (load)");
    
    await new Promise(r => setTimeout(r, 15000));
    console.log("Wait finished (15s)");
    
    const content = await page.content();
    console.log("Content length:", content.length);
    console.log("Title:", await page.title());
    
    const pageInfo = await page.evaluate(() => {
      return {
        allButtons: document.querySelectorAll("button").length,
        oddsButtons: document.querySelectorAll(".odds-button2, .odds-button").length,
        iframes: document.querySelectorAll("iframe").length,
        bodyText: document.body.innerText.substring(0, 500)
      };
    });
    
    console.log("Page Info:", JSON.stringify(pageInfo, null, 2));
    
    if (pageInfo.allButtons === 0) {
      await page.screenshot({ path: "fortuna_debug_strict.png", fullPage: true });
      console.log("Zero buttons found! Screenshot saved.");
    }
    
    await fortunaScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugFortunaMatch();
