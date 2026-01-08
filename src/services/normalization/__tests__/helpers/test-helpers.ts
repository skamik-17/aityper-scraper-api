/**
 * Test Helpers
 *
 * Reusable helper functions for tests.
 */

import type { NormalizedMarket, NormalizedSelection, NormalizedMarketType, MarketCategory } from "../../types.js";

// ============================================================================
// Custom Matchers
// ============================================================================

/**
 * Expect a normalized market to match expected properties
 */
export function expectNormalizedMarket(
  actual: NormalizedMarket,
  expected: {
    normalizedType: NormalizedMarketType;
    category: MarketCategory;
    paramValue?: string;
    selectionNames?: string[];
  }
): void {
  expect(actual.normalizedType).toBe(expected.normalizedType);
  expect(actual.category).toBe(expected.category);

  if (expected.paramValue !== undefined) {
    expect(actual.paramValue).toBe(expected.paramValue);
  } else {
    expect(actual.paramValue).toBeUndefined();
  }

  if (expected.selectionNames !== undefined) {
    expect(actual.selections).toHaveLength(expected.selectionNames.length);
    actual.selections.forEach((sel, i) => {
      expect(sel.name).toBe(expected.selectionNames![i]);
    });
  }
}

/**
 * Expect a normalized selection to match expected value
 */
export function expectNormalizedSelection(
  actual: { name: string; normalizedName: NormalizedSelection; odds: number },
  expectedName: NormalizedSelection
): void {
  expect(actual.normalizedName).toBe(expectedName);
}

// ============================================================================
// Test Data Generators
// ============================================================================

/**
 * Generate a test market with given name and selections
 */
export function createTestMarket(
  name: string,
  selections: Array<{ name: string; odds: number }> = [{ name: "Test", odds: 2.0 }]
) {
  return { name, selections };
}

/**
 * Generate multiple test markets
 */
export function createTestMarkets(count: number, prefix = "Market") {
  return Array.from({ length: count }, (_, i) =>
    createTestMarket(`${prefix} ${i + 1}`)
  );
}

/**
 * Generate selections for a given market type
 */
export function createSelectionsForType(
  marketType: NormalizedMarketType
): Array<{ name: string; odds: number }> {
  switch (marketType) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "CORRECT_SCORE":
    case "EUROPEAN_HANDICAP":
      return [
        { name: "1", odds: 2.5 },
        { name: "X", odds: 3.2 },
        { name: "2", odds: 2.8 },
      ];

    case "DOUBLE_CHANCE":
      return [
        { name: "1X", odds: 1.45 },
        { name: "X2", odds: 1.55 },
        { name: "12", odds: 1.25 },
      ];

    case "DRAW_NO_BET":
      return [
        { name: "1", odds: 1.85 },
        { name: "2", odds: 2.05 },
      ];

    case "TOTAL_GOALS":
    case "HALF_TIME_TOTAL_GOALS":
    case "ASIAN_HANDICAP":
    case "CORNERS_TOTAL":
    case "CARDS_TOTAL":
    case "FOULS_TOTAL":
    case "OFFSIDES_TOTAL":
      return [
        { name: "Over", odds: 1.85 },
        { name: "Under", odds: 1.95 },
      ];

    case "BTTS":
    case "HALF_TIME_BTTS":
      return [
        { name: "Tak", odds: 1.75 },
        { name: "Nie", odds: 2.10 },
      ];

    case "ODD_EVEN_GOALS":
      return [
        { name: "Odd", odds: 1.90 },
        { name: "Even", odds: 1.90 },
      ];

    default:
      return [{ name: "Test", odds: 2.0 }];
  }
}

// ============================================================================
// Bookmaker Test Helpers
// ============================================================================

/**
 * Get all supported bookmakers
 */
export const ALL_BOOKMAKERS = [
  "sts",
  "fortuna",
  "superbet",
  "betclic",
  "betcris",
  "betfan",
  "betters",
  "etoto",
  "forbet",
  "fuksiarz",
  "lebull",
  "lvbet",
  "pzbuk",
  "totalbet",
] as const;

/**
 * Test a market across all bookmakers
 */
export function testAllBookmakers(
  marketName: string,
  testFn: (bookmaker: string) => void
): void {
  describe.each(ALL_BOOKMAKERS)("Bookmaker: %s", (bookmaker) => {
    test(`${marketName}`, () => testFn(bookmaker));
  });
}

/**
 * Test normalization consistency across bookmakers
 */
export function expectCrossBookmakerConsistency(
  results: Array<{ bookmaker: string; result: NormalizedMarket }>,
  expectedType: NormalizedMarketType
): void {
  results.forEach(({ bookmaker, result }) => {
    expect(result.normalizedType).toBe(expectedType);
    expect(result.category).toBeDefined();
  });

  // All results should have the same market key (if no parameter)
  const firstKey = results[0].result.marketKey;
  results.forEach(({ bookmaker, result }) => {
    expect(result.marketKey).toBe(firstKey);
  });
}

// ============================================================================
// Performance Test Helpers
// ============================================================================

/**
 * Measure execution time of a function
 */
export async function measureTime<T>(
  fn: () => T,
  label: string
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;

  console.log(`${label}: ${duration.toFixed(2)}ms`);

  return { result, duration };
}

/**
 * Assert that a function completes within a time limit
 */
export async function expectToCompleteWithin<T>(
  fn: () => T,
  maxMs: number,
  label?: string
): Promise<T> {
  const { result, duration } = await measureTime(fn, label || "execution");

  expect(duration).toBeLessThan(maxMs);

  return result;
}

// ============================================================================
// Parameter Extraction Helpers
// ============================================================================

/**
 * Common parameter values for testing
 */
export const PARAMETER_VALUES = {
  decimalLines: ["0.5", "1.5", "2.5", "3.5", "4.5", "5.5", "6.5", "7.5"],
  handicaps: ["-2.5", "-2", "-1.5", "-1", "-0.5", "0", "+0.5", "+1", "+1.5", "+2", "+2.5"],
  integers: ["0", "1", "2", "3", "4", "5"],
  scores: ["1:0", "1:1", "0:1", "2:0", "0:2", "2:1", "1:2", "2:2", "3:0", "0:3"],
};

/**
 * Generate parameter variations (comma vs decimal point)
 */
export function generateParameterVariations(param: string): string[] {
  return [param, param.replace(".", ",")];
}

// ============================================================================
// Assertion Extensions
// ============================================================================

/**
 * Custom assertion for market type
 */
expect.extend({
  toBeMarketType(received: NormalizedMarketType, expected: NormalizedMarketType) {
    const pass = received === expected;
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be ${expected}`
          : `expected ${received} to be ${expected}`,
    };
  },
});

/**
 * Custom assertion for category
 */
expect.extend({
  toBeInCategory(received: MarketCategory, expected: MarketCategory) {
    const pass = received === expected;
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be in category ${expected}`
          : `expected ${received} to be in category ${expected}`,
    };
  },
});

// ============================================================================
// Fixture Builders
// ============================================================================

/**
 * Build a complete test scenario
 */
export interface TestScenario {
  marketName: string;
  bookmaker: string;
  homeTeam?: string;
  awayTeam?: string;
  expected: {
    type: NormalizedMarketType;
    category: MarketCategory;
    param?: string;
  };
}

/**
 * Run a test scenario
 */
export function runTestScenario(
  scenario: TestScenario,
  normalizer: { normalize: Function }
): NormalizedMarket {
  const market = createTestMarket(scenario.marketName);
  return normalizer.normalize(
    market,
    scenario.bookmaker,
    scenario.homeTeam,
    scenario.awayTeam
  );
}

/**
 * Assert test scenario results
 */
export function assertTestScenario(
  result: NormalizedMarket,
  scenario: TestScenario
): void {
  expectNormalizedMarket(result, {
    normalizedType: scenario.expected.type,
    category: scenario.expected.category,
    paramValue: scenario.expected.param,
  });
}

// ============================================================================
// Debug Helpers
// ============================================================================

/**
 * Log normalization result for debugging
 */
export function debugLog(result: NormalizedMarket, label = "Normalization Result"): void {
  console.log(`\n${label}:`);
  console.log(`  Name: ${result.name}`);
  console.log(`  Type: ${result.normalizedType}`);
  console.log(`  Key: ${result.marketKey}`);
  console.log(`  Category: ${result.category}`);
  console.log(`  Param: ${result.paramValue || "none"}`);
  console.log(`  Selections:`);
  result.selections.forEach((sel) => {
    console.log(`    - ${sel.name} -> ${sel.normalizedName} (${sel.odds})`);
  });
}

/**
 * Log all market registry entries for a category
 */
export function debugLogCategory(
  getCategoryFn: (category: string) => any[],
  category: string
): void {
  const markets = getCategoryFn(category);
  console.log(`\nCategory: ${category} (${markets.length} markets)`);
  markets.forEach((m: any) => {
    console.log(`  - ${m.id} (${m.type})`);
  });
}
