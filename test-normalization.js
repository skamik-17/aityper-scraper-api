const betclicNormalizer = require('./dist/services/normalization/bookmakers/betclic-normalizer.js');

const mockMarket = {
  name: "Podwójna szansa & oba zespoły strzelą",
  bookmakerMarketId: null,
  selections: [
    { name: "Arsenal / Remis & Tak", odds: 2.50 },
    { name: "Arsenal / Remis & Nie", odds: 1.40 },
    { name: "Manchester United / Remis & Tak", odds: 1.80 },
    { name: "Manchester United / Remis & Nie", odds: 1.60 },
    { name: "Arsenal / Manchester Utd & Tak", odds: 3.00 },
    { name: "Arsenal / Manchester Utd & Nie", odds: 1.30 },
  ]
};

const ctx = {
  homeTeam: "Arsenal",
  awayTeam: "Manchester United"
};

try {
  const result = betclicNormalizer.betclicNormalizer.normalizeMarket(mockMarket, ctx);
  console.log("✅ Normalization successful:");
  console.log("Market code:", result.marketCode);
  console.log("Selections:");
  result.selections.forEach(sel => {
    console.log(`  ${sel.label} -> ${sel.code}`);
  });
} catch (error) {
  console.error("❌ Error:", error.message);
}
