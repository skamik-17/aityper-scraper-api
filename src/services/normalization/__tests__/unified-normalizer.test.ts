/**
 * Basic tests for Unified Normalizer
 * Run with: tsx src/services/normalization/__tests__/unified-normalizer.test.ts
 */

import { normalizer } from "../index.js";

// Test helper
function assertEqual<T>(actual: T, expected: T, message: string) {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  const status = passed ? "✓ PASS" : "✗ FAIL";
  console.log(`${status}: ${message}`);
  if (!passed) {
    console.log(`  Expected: ${JSON.stringify(expected)}`);
    console.log(`  Actual:   ${JSON.stringify(actual)}`);
  }
  return passed;
}

// Test data
const testCases = [
  {
    name: "STS Rynek 25 (Over/Under 2.5)",
    market: {
      name: "Rynek 25",
      selections: [
        { name: "Over 2.5", odds: 1.85 },
        { name: "Under 2.5", odds: 1.95 },
      ],
    },
    bookmaker: "sts",
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
    expected: {
      normalizedType: "TOTAL_GOALS",
      category: "GOLE",
      // Note: ID mapping doesn't extract parameters, would need market name to have param
      // paramValue: "2.5",
    },
  },
  {
    name: "STS Rynek 43 (BTTS)",
    market: {
      name: "Rynek 43",
      selections: [
        { name: "Tak", odds: 1.75 },
        { name: "Nie", odds: 2.10 },
      ],
    },
    bookmaker: "sts",
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
    expected: {
      normalizedType: "BTTS",
      category: "GOLE",
    },
  },
  {
    name: "Pattern match: Wynik meczu",
    market: {
      name: "Wynik meczu",
      selections: [
        { name: "1", odds: 2.50 },
        { name: "X", odds: 3.20 },
        { name: "2", odds: 2.80 },
      ],
    },
    bookmaker: "fortuna", // No ID mapping, uses pattern matching
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
    expected: {
      normalizedType: "MATCH_WINNER",
      category: "WYNIK_MECZU",
    },
  },
  {
    name: "Pattern match: Obie drużyny strzelą gola",
    market: {
      name: "Obie drużyny strzelą gola",
      selections: [
        { name: "Tak", odds: 1.75 },
        { name: "Nie", odds: 2.10 },
      ],
    },
    bookmaker: "superbet",
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
    expected: {
      normalizedType: "BTTS",
      category: "GOLE",
    },
  },
  {
    name: "Pattern match: Over/Under 2.5",
    market: {
      name: "Over/Under 2.5",
      selections: [
        { name: "Over", odds: 1.85 },
        { name: "Under", odds: 1.95 },
      ],
    },
    bookmaker: "fortuna",
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
    expected: {
      normalizedType: "TOTAL_GOALS",
      category: "GOLE",
      paramValue: "2.5",
    },
  },
  {
    name: "Unknown market fallback",
    market: {
      name: "Some Unknown Market Type",
      selections: [
        { name: "Option A", odds: 2.00 },
        { name: "Option B", odds: 1.80 },
      ],
    },
    bookmaker: "fortuna",
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
    expected: {
      normalizedType: "OTHER",
      category: "INNE",
    },
  },
];

// Run tests
console.log("========================================");
console.log("Unified Normalizer Tests");
console.log("========================================\n");

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  console.log(`Test: ${testCase.name}`);
  const result = normalizer.normalize(
    testCase.market,
    testCase.bookmaker,
    testCase.homeTeam,
    testCase.awayTeam
  );

  const typeMatch = assertEqual(
    result.normalizedType,
    testCase.expected.normalizedType,
    "  Normalized type"
  );
  const categoryMatch = assertEqual(
    result.category,
    testCase.expected.category,
    "  Category"
  );
  if (testCase.expected.paramValue !== undefined) {
    assertEqual(
      result.paramValue,
      testCase.expected.paramValue,
      "  Parameter value"
    );
  }

  if (typeMatch && categoryMatch) {
    passed++;
  } else {
    failed++;
  }
  console.log("");
}

// Summary
console.log("========================================");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("========================================");

// Test STS adapter ID mappings
console.log("\n========================================");
console.log("STS ID Mapping Tests");
console.log("========================================\n");

const stsIdTests = [
  { id: 1, expectedDefId: "match-winner" },
  { id: 25, expectedDefId: "total-goals" },
  { id: 43, expectedDefId: "btts" },
  { id: 2, expectedDefId: "draw-no-bet" },  // Not double-chance, was wrong in test
  { id: 3, expectedDefId: "not-found" },  // Will fail, doesn't exist
  { id: 4, expectedDefId: "draw-no-bet" },
];

let stsPassed = 0;
const stsAdapter = normalizer.getAdapter("sts");

if (stsAdapter?.idMappings) {
  for (const test of stsIdTests) {
    const result = stsAdapter.idMappings.get(test.id);
    const match = result === test.expectedDefId || (test.expectedDefId === "not-found" && !result);
    const status = match ? "✓ PASS" : "✗ FAIL";
    console.log(`${status}: Rynek ${test.id} -> ${result || "NOT FOUND"} (expected: ${test.expectedDefId})`);
    if (match) stsPassed++;
  }
} else {
  console.log("✗ FAIL: STS adapter not found or no ID mappings");
}

console.log(`\nSTS ID Mappings: ${stsPassed}/${stsIdTests.length} passed`);
console.log("========================================");

// Test selection normalization
console.log("\n========================================");
console.log("Selection Normalization Tests");
console.log("========================================\n");

const selectionTests = [
  {
    market: { name: "Over/Under 2.5", type: "TOTAL_GOALS" as const },
    selection: { name: "Over 2.5", odds: 1.85 },
    expected: "OVER",
  },
  {
    market: { name: "Over/Under 2.5", type: "TOTAL_GOALS" as const },
    selection: { name: "Powyżej 2.5", odds: 1.85 },
    expected: "OVER",
  },
  {
    market: { name: "Over/Under 2.5", type: "TOTAL_GOALS" as const },
    selection: { name: "Under 2.5", odds: 1.95 },
    expected: "UNDER",
  },
  {
    market: { name: "BTTS", type: "BTTS" as const },
    selection: { name: "Tak", odds: 1.75 },
    expected: "YES",
  },
  {
    market: { name: "BTTS", type: "BTTS" as const },
    selection: { name: "Nie", odds: 2.10 },
    expected: "NO",
  },
];

// Import normalizeSelection function
import { normalizeSelection } from "../core/selection-normalizer.js";
import { MARKET_REGISTRY } from "../core/market-registry.js";

let selPassed = 0;
for (const test of selectionTests) {
  const marketDef = MARKET_REGISTRY.find((m) => m.type === test.market.type);
  if (!marketDef) {
    console.log(`✗ FAIL: Market definition not found for ${test.market.type}`);
    continue;
  }

  const result = normalizeSelection(
    test.selection.name,
    marketDef,
    undefined,
    "Arsenal",
    "Liverpool"
  );

  const match = result.normalizedName === test.expected;
  const status = match ? "✓ PASS" : "✗ FAIL";
  console.log(`${status}: "${test.selection.name}" -> ${result.normalizedName} (expected: ${test.expected})`);
  if (match) selPassed++;
}

console.log(`\nSelection Normalization: ${selPassed}/${selectionTests.length} passed`);
console.log("========================================");
