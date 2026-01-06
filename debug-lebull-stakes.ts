import { LebullPlaywrightScraper } from './src/scrapers/bookmakers/lebull/index.js';

async function debug() {
  const scraper = new LebullPlaywrightScraper();
  await scraper.initBrowser();

  const result = await scraper.scrapeFullOffer('premier-league');

  if (result.success && result.data) {
    // Find markets with "Rynek XXX" names
    const rynekMarkets = new Map<string, { count: number; samples: string[] }>();

    for (const match of result.data.matches) {
      for (const market of match.markets) {
        if (market.name.startsWith('Rynek')) {
          if (!rynekMarkets.has(market.name)) {
            rynekMarkets.set(market.name, { count: 0, samples: [] });
          }
          const info = rynekMarkets.get(market.name)!;
          info.count++;

          // Collect sample selections
          if (info.samples.length < 10) {
            for (const sel of market.selections.slice(0, 3)) {
              info.samples.push(`  ${sel.name} @ ${sel.odds}`);
            }
          }
        }
      }
    }

    console.log('=== "Rynek" Markets Found ===\n');
    for (const [name, info] of rynekMarkets) {
      console.log(`${name} (${info.count} occurrences)`);
      console.log('Sample selections:');
      for (const sample of info.samples.slice(0, 5)) {
        console.log(sample);
      }
      console.log('');
    }
  }
}

debug().catch(console.error);
