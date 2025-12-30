import { runAllScrapers } from './src/scrapers/aggregator.js';

console.log('Starting La Liga scraper test...');
const result = await runAllScrapers('laliga');
console.log('\n=== SCRAPER SUMMARY ===');
console.log(JSON.stringify(result.summary, null, 2));
console.log('\n=== TOTAL ODDS ===');
console.log('Total odds collected:', result.allOdds.length);
if (result.allOdds.length > 0) {
  console.log('\nSample match:', result.allOdds[0].homeTeam, 'vs', result.allOdds[0].awayTeam);
}
