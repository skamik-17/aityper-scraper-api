#!/usr/bin/env npx tsx
/**
 * Market Catalog Validation Script
 * 
 * Validates:
 * 1. No duplicate numericIds in market-catalog.ts
 * 2. All STS market ID mappings point to valid canonical types
 * 3. ViewType expectations match selection counts
 */

import { MARKET_CATALOG, CANONICAL_MARKET_CODES, getMarketByCode } from "../src/data/market-catalog.js";
import { ViewType } from "../src/services/normalization/types.js";

interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

function validateNumericIdUniqueness(): ValidationResult {
  const result: ValidationResult = { passed: true, errors: [], warnings: [] };
  const idMap = new Map<number, string[]>();

  for (const entry of MARKET_CATALOG) {
    const id = entry.numericId;
    if (!idMap.has(id)) {
      idMap.set(id, []);
    }
    idMap.get(id)!.push(entry.code);
  }

  for (const [id, codes] of idMap.entries()) {
    if (codes.length > 1) {
      result.passed = false;
      result.errors.push(`Duplicate numericId ${id}: ${codes.join(", ")}`);
    }
  }

  return result;
}

function validateStsMarketMappings(): ValidationResult {
  const result: ValidationResult = { passed: true, errors: [], warnings: [] };
  
  const STS_MARKET_ID_TO_CODE: Record<number, string> = {
    1: "MATCH_WINNER",
    10: "DOUBLE_CHANCE",
    4: "DRAW_NO_BET",
    11: "DRAW_NO_BET",
    25: "TOTAL_GOALS",
    28: "TEAM_TOTAL_GOALS",
    31: "TEAM_TOTAL_GOALS",
    23: "TOTAL_GOALS_ASIAN",
    43: "BTTS",
    121: "SECOND_HALF_BTTS",
    8: "FIRST_TEAM_TO_SCORE",
    9: "FIRST_TEAM_TO_SCORE",
    44: "FIRST_TEAM_TO_SCORE",
    35: "TEAM_GOAL_RANGE",
    36: "TEAM_GOAL_RANGE",
    47: "WIN_TO_NIL",
    48: "WIN_TO_NIL",
    14: "EUROPEAN_HANDICAP",
    22: "EUROPEAN_HANDICAP",
    20: "ASIAN_HANDICAP",
    77: "ASIAN_HANDICAP",
    71: "HALF_TIME_RESULT",
    74: "DOUBLE_CHANCE",
    75: "DRAW_NO_BET",
    80: "HALF_TIME_TOTAL_GOALS",
    82: "HALF_TIME_TOTAL_GOALS",
    85: "HALF_TIME_TOTAL_GOALS",
    88: "HALF_TIME_TOTAL_GOALS",
    95: "HALF_TIME_BTTS",
    102: "SECOND_HALF_RESULT",
    110: "SECOND_HALF_TOTAL_GOALS",
    112: "SECOND_HALF_TOTAL_GOALS",
    283: "CORRECT_SCORE",
    101: "CORRECT_SCORE",
    124: "CORRECT_SCORE",
    52: "GOALSCORER_FIRST",
    53: "GOALSCORER_LAST",
    54: "GOALSCORER_ANYTIME",
    17: "WINNING_MARGIN",
    33: "GOAL_RANGE",
    90: "HALF_TIME_GOAL_RANGE",
    220: "CORNERS_RACE",
    221: "FIRST_CORNER",
    225: "CORNERS_HANDICAP",
    228: "CORNERS_TOTAL",
    235: "HALF_TIME_CORNERS_TOTAL",
    256: "HALF_TIME_CORNERS_RACE",
    258: "FIRST_GOAL_AND_RESULT",
    49: "RESULT_AND_BTTS",
    51: "RESULT_AND_TOTAL",
    58: "HALFTIME_FULLTIME",
    1229: "HOME_TEAM_TO_SCORE",
    1224: "AWAY_TEAM_TO_SCORE",
    40: "ODD_EVEN_GOALS",
    125: "FIRST_GOAL_TIME",
    132: "TIME_PERIOD_RESULT",
  };

  for (const [stsId, canonicalCode] of Object.entries(STS_MARKET_ID_TO_CODE)) {
    if (!CANONICAL_MARKET_CODES.has(canonicalCode)) {
      result.passed = false;
      result.errors.push(`STS ID ${stsId} maps to non-existent canonical code: ${canonicalCode}`);
    }
  }

  return result;
}

function validateViewTypeSelectionCounts(): ValidationResult {
  const result: ValidationResult = { passed: true, errors: [], warnings: [] };

  const expectedSelectionCounts: Record<string, { min: number; max: number }> = {
    [ViewType.BINARY_BUTTONS]: { min: 2, max: 2 },
    [ViewType.TRIPLE_BUTTONS]: { min: 2, max: 3 },
    [ViewType.PARAMETER_SLIDER]: { min: 2, max: 2 },
    [ViewType.HANDICAP_SELECTOR]: { min: 2, max: 3 },
    [ViewType.SCORE_GRID]: { min: 1, max: 100 },
    [ViewType.HALFTIME_FULLTIME]: { min: 9, max: 9 },
    [ViewType.COMBINATION]: { min: 4, max: 12 },
    [ViewType.PLAYER_DROPDOWN]: { min: 1, max: 100 },
    [ViewType.PLAYER_STAT_LINES]: { min: 2, max: 2 },
    [ViewType.STAT_RANGE]: { min: 2, max: 4 },
  };

  for (const entry of MARKET_CATALOG) {
    const expected = expectedSelectionCounts[entry.viewType];
    if (expected) {
      const selCount = entry.selections.length;
      if (selCount < expected.min || selCount > expected.max) {
        result.warnings.push(
          `${entry.code}: viewType=${entry.viewType} expects ${expected.min}-${expected.max} selections, has ${selCount}`
        );
      }
    }
  }

  return result;
}

async function main() {
  console.log("🔍 Market Catalog Validation\n");
  console.log("=".repeat(60));

  let allPassed = true;

  console.log("\n1️⃣  Checking numericId uniqueness...");
  const idResult = validateNumericIdUniqueness();
  if (idResult.passed) {
    console.log("   ✅ All numericIds are unique");
  } else {
    allPassed = false;
    idResult.errors.forEach((e) => console.log(`   ❌ ${e}`));
  }

  console.log("\n2️⃣  Checking STS market mappings...");
  const stsResult = validateStsMarketMappings();
  if (stsResult.passed) {
    console.log("   ✅ All STS mappings point to valid canonical codes");
  } else {
    allPassed = false;
    stsResult.errors.forEach((e) => console.log(`   ❌ ${e}`));
  }

  console.log("\n3️⃣  Checking viewType selection counts...");
  const viewResult = validateViewTypeSelectionCounts();
  if (viewResult.warnings.length === 0) {
    console.log("   ✅ All viewType selection counts are valid");
  } else {
    viewResult.warnings.forEach((w) => console.log(`   ⚠️  ${w}`));
  }

  console.log("\n" + "=".repeat(60));
  if (allPassed) {
    console.log("✅ ALL VALIDATIONS PASSED");
    process.exit(0);
  } else {
    console.log("❌ SOME VALIDATIONS FAILED");
    process.exit(1);
  }
}

main().catch(console.error);
