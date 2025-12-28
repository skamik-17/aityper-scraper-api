import { fuksiarzScraper } from "../scrapers/bookmakers/fuksiarz.js";

async function debugFuksiarz() {
  const url = "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league";
  try {
    const page = await (fuksiarzScraper as any).initBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise(r => setTimeout(r, 10000));
    
    const info = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a")).map(a => ({
        text: a.innerText.replace(/\n/g, " "),
        href: a.href
      })).filter(l => l.text.includes("-") || l.href.includes("szczegoly"));
      
      const buttons = Array.from(document.querySelectorAll("button")).slice(0, 20).map(b => b.innerText.replace(/\n/g, " "));
      
      return { links: links.slice(0, 20), buttons };
    });
    
    console.log("Fuksiarz Debug:", JSON.stringify(info, null, 2));
    await fuksiarzScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugFuksiarz();
