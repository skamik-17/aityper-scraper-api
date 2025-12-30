// Test extended markets for Betfan and Betcris
import { betfanScraper } from './src/scrapers/bookmakers/betfan.js';
import { betcrisScraper } from './src/scrapers/bookmakers/betcris.js';
import { lvbetScraper } from './src/scrapers/bookmakers/lvbet.js';

async function testBetfan() {
  console.log('\n=== BETFAN EXTENDED MARKETS ===');
  const result = await betfanScraper.scrapeLeague('laliga');
  if (!result.data || result.data.length === 0) {
    console.log('No matches found');
    return;
  }

  const eventUrl = result.data[0].eventUrl;
  console.log('Match:', result.data[0].homeTeam, 'vs', result.data[0].awayTeam);

  const details = await betfanScraper.scrapeMatchDetails(eventUrl);
  console.log('Status:', details.status);

  if (details.data) {
    console.log('1X2:', JSON.stringify(details.data.market1X2));
    console.log('DC:', JSON.stringify(details.data.marketDoubleChance));
    console.log('BTTS:', JSON.stringify(details.data.marketBTTS));
    console.log('O/U lines:', details.data.marketOverUnder ? Object.keys(details.data.marketOverUnder).join(', ') : 'none');
    if (details.data.marketOverUnder) {
      console.log('O/U 2.5:', JSON.stringify(details.data.marketOverUnder['2.5']));
    }
  }
}

async function testBetcris() {
  console.log('\n=== BETCRIS EXTENDED MARKETS ===');
  const result = await betcrisScraper.scrapeLeague('laliga');
  if (!result.data || result.data.length === 0) {
    console.log('No matches found');
    return;
  }

  const eventUrl = result.data[0].eventUrl;
  console.log('Match:', result.data[0].homeTeam, 'vs', result.data[0].awayTeam);

  const details = await betcrisScraper.scrapeMatchDetails(eventUrl);
  console.log('Status:', details.status);

  if (details.data) {
    console.log('1X2:', JSON.stringify(details.data.market1X2));
    console.log('DC:', JSON.stringify(details.data.marketDoubleChance));
    console.log('BTTS:', JSON.stringify(details.data.marketBTTS));
    console.log('O/U lines:', details.data.marketOverUnder ? Object.keys(details.data.marketOverUnder).join(', ') : 'none');
  }
}

async function testLvbet() {
  console.log('\n=== LVBET EXTENDED MARKETS ===');
  const result = await lvbetScraper.scrapeLeague('laliga');
  if (!result.data || result.data.length === 0) {
    console.log('No matches found');
    return;
  }

  const eventUrl = result.data[0].eventUrl;
  console.log('Match:', result.data[0].homeTeam, 'vs', result.data[0].awayTeam);

  const details = await lvbetScraper.scrapeMatchDetails(eventUrl);
  console.log('Status:', details.status);

  if (details.data) {
    console.log('1X2:', JSON.stringify(details.data.market1X2));
    console.log('DC:', JSON.stringify(details.data.marketDoubleChance));
    console.log('BTTS:', JSON.stringify(details.data.marketBTTS));
    console.log('O/U lines:', details.data.marketOverUnder ? Object.keys(details.data.marketOverUnder).join(', ') : 'none');
    if (details.data.marketOverUnder) {
      console.log('O/U 2.5:', JSON.stringify(details.data.marketOverUnder['2.5']));
    }
  }
}

const scraper = process.argv[2];
if (scraper === 'betfan') {
  testBetfan().catch(console.error);
} else if (scraper === 'betcris') {
  testBetcris().catch(console.error);
} else if (scraper === 'lvbet') {
  testLvbet().catch(console.error);
} else {
  // Test all
  testBetfan()
    .then(() => testBetcris())
    .then(() => testLvbet())
    .catch(console.error);
}
