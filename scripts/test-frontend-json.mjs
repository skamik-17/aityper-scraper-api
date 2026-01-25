import { betclicNormalizer } from "../src/services/normalization/bookmakers/betclic-normalizer.js";
import { groupMarketsByTypeWithParameters } from "../src/services/market-type-grouper.js";

const rawMarket = {
  name: "Dokładny wynik w grupie",
  groupName: "Dokładny wynik",
  type: "betclic",
  selections: [
    { name: "1 - 0, 2 - 0 lub 3 - 0", odds: 3.7 },
    { name: "4 - 0, 5 - 0 lub 6 - 0", odds: 45 },
    { name: "2 - 1, 3 - 1 lub 4 - 1", odds: 5.4 },
    { name: "3 - 2, 4 - 2, 4 - 3 lub 5 - 1", odds: 18 },
    { name: "West Ham - Inny wynik", odds: 101 },
    { name: "Remis ", odds: 3.15 },
    { name: "0 - 1, 0 - 2 lub 0 - 3", odds: 5 },
    { name: "0 - 4, 0 - 5 lub 0 - 6", odds: 101 },
    { name: "1 - 2, 1 - 3 lub 1 - 4", odds: 7.2 },
    { name: "2 - 3, 2 - 4, 3 - 4 lub 1 - 5", odds: 25 },
    { name: "Sunderland - Inny wynik", odds: 101 }
  ]
};

const ctx = {
  homeTeam: "West Ham",
  awayTeam: "Sunderland"
};

const normalized = betclicNormalizer.normalizeMarket(rawMarket, ctx);
console.log("Market Code:", normalized.marketCode);

const marketsToGroup = [{
  market: {
    ...rawMarket,
    normalizedType: normalized.marketCode,
    marketKey: normalized.marketKey,
    paramValue: normalized.paramValue,
    selections: rawMarket.selections.map(s => ({
      ...s,
      normalizedName: normalized.selections.find(ns => ns.label === s.name)?.code
    }))
  },
  bookmaker: "betclic"
}];

const grouped = groupMarketsByTypeWithParameters(marketsToGroup);
console.log("\nFrontend JSON:");
console.log(JSON.stringify(grouped, null, 2));
