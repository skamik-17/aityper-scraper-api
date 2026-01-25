#!/usr/bin/env npx tsx

import { betclicNormalizer } from './src/services/normalization/bookmakers/betclic-normalizer.ts';
import { getMarketByCode } from './src/data/market-catalog.ts';

const rawMarket = {
  name: 'Gol z rzutu karnego- 1. połowa',
  bookmakerMarketId: '1011617328713744',
  selections: [
    { name: 'Manchester City strzeli rzut karny', odds: 6.5 },
    { name: 'Wolverhampton strzeli rzut karny', odds: 20 },
    { name: 'Którykolwiek zawodnik strzeli rzut karny', odds: 5 },
  ],
};

const ctx = {
  homeTeam: 'Manchester City',
  awayTeam: 'Wolverhampton',
};

const normalized = betclicNormalizer.normalizeMarket(rawMarket, ctx);

console.log('='.repeat(80));
console.log('MARKET: ' + rawMarket.name);
console.log('='.repeat(80));
console.log();
console.log('NORMALIZED MARKET CODE:', normalized?.marketCode || 'FAILED');
console.log('MATCHED BY:', normalized?.debug?.matchedBy || 'UNKNOWN');
console.log();

if (normalized?.marketCode && normalized.marketCode !== 'OTHER') {
  const catalogEntry = getMarketByCode(normalized.marketCode);
  if (catalogEntry) {
    console.log('CATALOG ENTRY:');
    console.log('  Code:', catalogEntry.code);
    console.log('  Polish Label:', catalogEntry.labels.pl);
    console.log('  Category:', catalogEntry.category);
    console.log('  ViewType:', catalogEntry.viewType);
    console.log('  Expected Selections:', catalogEntry.selections.join(', '));
    console.log();
  }
}

console.log('NORMALIZED SELECTIONS:');
normalized?.selections?.forEach((sel, i) => {
  console.log(`  ${i + 1}. "${sel.label}" → ${sel.code}`);
});
console.log();

const hasUnknown = normalized?.selections?.some(s => s.code === 'UNKNOWN');
if (hasUnknown) {
  console.log('ERROR: Some selections are UNKNOWN');
} else {
  console.log('OK: All selections are normalized');
}
