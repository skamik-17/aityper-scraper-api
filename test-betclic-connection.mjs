import { fetchLeagueMatches } from './src/scrapers/bookmakers/betclic/navigation.js';

(async () => {
  console.log('Testing Betclic listing endpoint...');
  const result = await fetchLeagueMatches('premier-league');
  console.log('Result:', result ? result.length + ' bytes' : 'null');
})();
