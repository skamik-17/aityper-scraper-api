// Test single scraper for La Liga
// Usage: npx tsx test-single-laliga.mts <scraper-name>
// Example: npx tsx test-single-laliga.mts sts

import { stsScraper } from './src/scrapers/bookmakers/sts.js';
import { fortunaScraper } from './src/scrapers/bookmakers/fortuna.js';
import { superbetScraper } from './src/scrapers/bookmakers/superbet.js';
import { betclicPlaywrightScraper } from './src/scrapers/bookmakers/betclic.js';
import { lvbetScraper } from './src/scrapers/bookmakers/lvbet.js';
import { etotoScraper } from './src/scrapers/bookmakers/etoto.js';
import { fuksiarzScraper } from './src/scrapers/bookmakers/fuksiarz.js';
import { betfanScraper } from './src/scrapers/bookmakers/betfan.js';
import { totalbetScraper } from './src/scrapers/bookmakers/totalbet.js';
import { forbetScraper } from './src/scrapers/bookmakers/forbet.js';
import { bettersScraper } from './src/scrapers/bookmakers/betters.js';
import { lebullScraper } from './src/scrapers/bookmakers/lebull.js';
import { betcrisScraper } from './src/scrapers/bookmakers/betcris.js';
import { pzbukScraper } from './src/scrapers/bookmakers/pzbuk.js';

const scrapers: Record<string, any> = {
  sts: stsScraper,
  fortuna: fortunaScraper,
  superbet: superbetScraper,
  betclic: betclicPlaywrightScraper,
  lvbet: lvbetScraper,
  etoto: etotoScraper,
  fuksiarz: fuksiarzScraper,
  betfan: betfanScraper,
  totalbet: totalbetScraper,
  forbet: forbetScraper,
  betters: bettersScraper,
  lebull: lebullScraper,
  betcris: betcrisScraper,
  pzbuk: pzbukScraper,
};

const scraperName = process.argv[2];

if (!scraperName) {
  console.log('Usage: npx tsx test-single-laliga.mts <scraper-name>');
  console.log('Available scrapers:', Object.keys(scrapers).join(', '));
  process.exit(1);
}

const scraper = scrapers[scraperName];
if (!scraper) {
  console.log(`Unknown scraper: ${scraperName}`);
  console.log('Available scrapers:', Object.keys(scrapers).join(', '));
  process.exit(1);
}

console.log(`Testing ${scraperName.toUpperCase()} scraper for La Liga...`);
const startTime = Date.now();

try {
  const result = await scraper.scrapeLeague('laliga');
  const duration = Date.now() - startTime;

  console.log(`\n=== ${scraperName.toUpperCase()} RESULT ===`);
  console.log('Status:', result.status);
  console.log('Duration:', duration, 'ms');
  console.log('Matches:', result.data?.length ?? 0);

  if (result.data && result.data.length > 0) {
    console.log('\nSample matches:');
    result.data.slice(0, 3).forEach((m: any, i: number) => {
      console.log(`  ${i + 1}. ${m.homeTeam} vs ${m.awayTeam} - 1: ${m.homeOdds}, X: ${m.drawOdds}, 2: ${m.awayOdds}`);
    });
  }

  if (result.error) {
    console.log('\nError:', result.error);
  }
} catch (error) {
  console.error('Exception:', error);
}
