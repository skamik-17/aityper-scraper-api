import { lvbetScraper } from "../scrapers/bookmakers/lvbet.js";

async function debugLVBetMarkets() {
  const matchId = "bc:28660758"; // Chelsea vs Bournemouth
  const apiUrl = `https://offer.lvbet.pl/client-api/v5/markets/search/?matches_ids=${matchId}&lang=pl`;
  
  try {
    const page = await (lvbetScraper as any).initBrowser();
    await page.goto("https://lvbet.pl", { waitUntil: "domcontentloaded" });
    
    console.log(`Fetching markets from: ${apiUrl}`);
    const data = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return res.json();
    }, apiUrl);

    if (Array.isArray(data)) {
      console.log("Found", data.length, "markets.");
      const samples = data.map(m => ({
        name: m.name,
        classId: m.markets_class_id,
        selections: m.selections.map((s: any) => s.name)
      }));
      
      console.log("Market IDs Mapping:");
      samples.forEach(s => {
        if (s.name.toLowerCase().includes("wynik") || s.name.toLowerCase().includes("szansa") || s.name.toLowerCase().includes("goli")) {
          console.log(`- ${s.name}: ID ${s.classId} (Sels: ${s.selections.join(', ')})`);
        }
      });
    }
    
    await lvbetScraper.cleanup();
  } catch (err) {
    console.error(err);
  }
}

debugLVBetMarkets();
