/**
 * Analyze Fortuna UFO market type IDs
 *
 * Extracts the market type IDs that are not yet mapped in constants.ts
 * and shows sample selections to understand what each market type represents.
 */

import { FortunaPlaywrightScraper } from '../scrapers/bookmakers/fortuna/index.js';

interface MarketInfo {
  count: number;
  groupName: string;
  sampleSelections: string[];
}

async function analyze() {
  const scraper = new FortunaPlaywrightScraper();

  try {
    console.log('Scraping Fortuna Premier League full offer...\n');
    const result = await scraper.scrapeFullOffer('premier-league');

    // Collect all unique market type IDs with their names and selections
    const idToInfo = new Map<string, MarketInfo>();

    for (const match of result.matches) {
      for (const market of match.markets) {
        // Extract the ufo:mtyp ID from market name if it starts with 'Rynek'
        const idMatch = market.name.match(/Rynek (ufo:mtyp:[^\s]+)/);
        if (idMatch) {
          const id = idMatch[1];
          if (!idToInfo.has(id)) {
            idToInfo.set(id, {
              count: 0,
              groupName: market.groupName || 'Unknown',
              sampleSelections: []
            });
          }
          const info = idToInfo.get(id)!;
          info.count++;
          if (info.sampleSelections.length < 3) {
            const selNames = market.selections.map(s => s.name).join(', ');
            if (!info.sampleSelections.includes(selNames)) {
              info.sampleSelections.push(selNames);
            }
          }
        }
      }
    }

    // Sort by count descending
    const sorted = [...idToInfo.entries()].sort((a, b) => b[1].count - a[1].count);

    console.log('UFO Market Type ID Analysis:');
    console.log('============================\n');

    for (const [id, info] of sorted) {
      console.log(`${id} (${info.count}x):`);
      console.log(`  Group: ${info.groupName}`);
      for (let i = 0; i < info.sampleSelections.length; i++) {
        console.log(`  Selections ${i + 1}: ${info.sampleSelections[i]}`);
      }
      console.log('');
    }

  } finally {
    await scraper.close();
  }
}

analyze().catch(console.error);
