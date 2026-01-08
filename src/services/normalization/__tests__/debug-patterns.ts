/**
 * Debug pattern matching
 */

import { matchPattern, getMatchingTypes } from "../core/pattern-engine.js";
import { MARKET_REGISTRY } from "../core/market-registry.js";

const testNames = [
  "Wynik meczu",
  "wynik meczu",
  "Obie drużyny strzelą gola",
  "Obie strzelą",
  "BTTS",
  "1X2",
  "Rynek 25",
  "Over/Under 2.5",
  "Powyżej 2.5",
];

console.log("========================================");
console.log("Pattern Matching Debug");
console.log("========================================\n");

for (const name of testNames) {
  const result = matchPattern(name, MARKET_REGISTRY);
  console.log(`Market: "${name}"`);
  if (result) {
    console.log(`  ✓ Matched: ${result.definition.id} (${result.definition.type})`);
    console.log(`  Category: ${result.definition.category}`);
    console.log(`  Param: ${result.param || "none"}`);
  } else {
    console.log(`  ✗ No match`);
    const allMatches = getMatchingTypes(name, MARKET_REGISTRY);
    if (allMatches.length > 0) {
      console.log(`  Debug: getMatchingTypes found: ${allMatches.join(", ")}`);
    }
  }
  console.log("");
}

// Direct test of specific patterns
console.log("========================================");
console.log("Direct Pattern Test (from registry)");
console.log("========================================\n");

const matchWinner = MARKET_REGISTRY.find((m) => m.id === "match-winner");
if (matchWinner) {
  console.log(`Testing: Wynik meczu`);
  console.log(`Patterns:`, matchWinner.patterns.map((p) => p.toString()).join(", "));
  for (const pattern of matchWinner.patterns) {
    const test = "Wynik meczu";
    const match = test.match(pattern);
    console.log(`  ${pattern.toString()}: ${match ? "✓ MATCH" : "✗ NO MATCH"}`);
  }
}

// Test lowercase version
console.log(`\nTesting: wynik meczu (lowercase)`);
for (const pattern of matchWinner!.patterns) {
  const test = "wynik meczu";
  const match = test.match(pattern);
  console.log(`  ${pattern.toString()}: ${match ? "✓ MATCH" : "✗ NO MATCH"}`);
}
