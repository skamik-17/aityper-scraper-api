import { forbetScraper } from "../scrapers/bookmakers/forbet.js";

async function debugForbetDetails() {
  const url = "https://www.iforbet.pl/zaklady-bukmacherskie/event/52071169";
  try {
    const page = await (forbetScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 5000));
    
    const pageData = await page.evaluate(() => {
      return {
        h1: document.querySelector("h1")?.innerText,
        buttons: Array.from(document.querySelectorAll("button")).slice(0, 20).map(b => ({
          text: b.innerText.replace(/\n/g, " "),
          dataTest: b.getAttribute("data-test")
        }))
      };
    });
    
    console.log("Forbet Details Debug:", JSON.stringify(pageData, null, 2));
    await forbetScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugForbetDetails();

