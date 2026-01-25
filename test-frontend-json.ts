#!/usr/bin/env npx tsx

import { betclicNormalizer } from './src/services/normalization/bookmakers/betclic-normalizer.ts';
import { getMarketByCode } from './src/data/market-catalog.ts';
import { groupMarketsByTypeWithParameters } from './src/services/market-type-grouper.ts';
import type { ScrapedMarket } from './src/types/full-offer.ts';

const rawMarket = {
  name: 'Gol z rzutu karnego- 1. połowa',
  groupName: 'Rzut karny',
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

console.log('='.repeat(100));
console.log('RAW JSON');
console.log('='.repeat(100));
console.log(JSON.stringify(rawMarket, null, 2));
console.log();

if (normalized && normalized.marketCode !== 'OTHER') {
  const catalogEntry = getMarketByCode(normalized.marketCode);

  const scrapedMarket: ScrapedMarket = {
    name: rawMarket.name,
    groupName: rawMarket.groupName || 'Unknown',
    type: 'betclic',
    selections: rawMarket.selections.map(s => ({
      name: s.name,
      odds: s.odds,
      normalizedName: normalized.selections?.find(ns => ns.label === s.name)?.code as any,
    })),
    normalizedType: normalized.marketCode,
    marketKey: normalized.marketKey,
    paramValue: normalized.paramValue,
  };

  const grouped = groupMarketsByTypeWithParameters([{ market: scrapedMarket, bookmaker: 'betclic' }]);

  if (grouped.length > 0) {
    const result = grouped[0];

    console.log('='.repeat(100));
    console.log('FRONTEND JSON (MarketWithParams format)');
    console.log('='.repeat(100));
    console.log(JSON.stringify({
      marketKey: result.marketKey,
      type: result.type,
      category: result.category || 'INNE',
      label: catalogEntry?.labels.pl || rawMarket.name,
      description: result.description || '',
      displayOrder: result.displayOrder || 999,
      viewType: result.viewType || 'UNKNOWN',
      parameters: result.parameters.map(p => ({
        value: p.value,
        label: p.label,
        bookmakers: p.bookmakers.map(bm => ({
          bookmaker: bm.bookmaker,
          bookmakerName: bm.bookmakerName,
          selections: bm.selections.map(sel => ({
            type: sel.type,
            odds: sel.odds,
            hasNoTaxPromo: sel.hasNoTaxPromo || false,
          })),
        })),
      })),
      defaultParameter: result.defaultParameter || 'base',
      hasParameters: result.hasParameters || false,
    }, null, 2));
    console.log();
  }
}
