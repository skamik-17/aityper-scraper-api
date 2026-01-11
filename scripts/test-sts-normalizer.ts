#!/usr/bin/env npx tsx
import { stsNormalizer } from "../src/services/normalization/bookmakers/sts-normalizer.js";
import type { RawBookmakerMarket, NormalizationContext } from "../src/services/normalization/types.js";

interface TestCase {
  description: string;
  raw: RawBookmakerMarket;
  expectedCode: string;
}

const ctx: NormalizationContext = {
  homeTeam: "Liverpool",
  awayTeam: "Arsenal",
};

const testCases: TestCase[] = [
  {
    description: "Market ID 1 - Match Winner",
    raw: { name: "Wynik meczu", bookmakerMarketId: "1", selections: [{ name: "Liverpool", odds: 1.85 }, { name: "Remis", odds: 3.5 }, { name: "Arsenal", odds: 4.2 }] },
    expectedCode: "MATCH_WINNER",
  },
  {
    description: "Market ID 10 - Double Chance",
    raw: { name: "Podwójna szansa", bookmakerMarketId: "10", selections: [{ name: "1X", odds: 1.2 }, { name: "X2", odds: 1.5 }, { name: "12", odds: 1.3 }] },
    expectedCode: "DOUBLE_CHANCE",
  },
  {
    description: "Market ID 25 - Total Goals",
    raw: { name: "Liczba goli 2.5", bookmakerMarketId: "25", selections: [{ name: "Ponad 2.5", odds: 1.9 }, { name: "Poniżej 2.5", odds: 1.9 }] },
    expectedCode: "TOTAL_GOALS",
  },
  {
    description: "Market ID 43 - BTTS",
    raw: { name: "Obie drużyny strzelą", bookmakerMarketId: "43", selections: [{ name: "Tak", odds: 1.8 }, { name: "Nie", odds: 2.0 }] },
    expectedCode: "BTTS",
  },
  {
    description: "Market ID 20 - Asian Handicap",
    raw: { name: "Handicap azjatycki", bookmakerMarketId: "20", selections: [{ name: "Liverpool (-0.5)", odds: 1.9 }, { name: "Arsenal (+0.5)", odds: 1.9 }] },
    expectedCode: "ASIAN_HANDICAP",
  },
  {
    description: "Market ID 71 - Half Time Result",
    raw: { name: "Wynik 1. połowy", bookmakerMarketId: "71", selections: [{ name: "Liverpool", odds: 2.5 }, { name: "Remis", odds: 2.3 }, { name: "Arsenal", odds: 3.5 }] },
    expectedCode: "HALF_TIME_RESULT",
  },
  {
    description: "Market ID 49 - Result + BTTS",
    raw: { name: "Wynik + BTTS", bookmakerMarketId: "49", selections: [{ name: "1 + Tak", odds: 3.5 }] },
    expectedCode: "RESULT_AND_BTTS",
  },
  {
    description: "Market ID 221 - First Corner",
    raw: { name: "Pierwszy rzut rożny", bookmakerMarketId: "221", selections: [{ name: "Liverpool", odds: 1.9 }, { name: "Arsenal", odds: 1.9 }] },
    expectedCode: "FIRST_CORNER",
  },
  {
    description: "Market ID 228 - Corners Total",
    raw: { name: "Rzuty rożne", bookmakerMarketId: "228", selections: [{ name: "Ponad 9.5", odds: 1.9 }, { name: "Poniżej 9.5", odds: 1.9 }] },
    expectedCode: "CORNERS_TOTAL",
  },
  {
    description: "Market ID 179 - First Card",
    raw: { name: "Pierwsza kartka", bookmakerMarketId: "179", selections: [{ name: "Liverpool", odds: 1.9 }, { name: "Arsenal", odds: 1.9 }] },
    expectedCode: "FIRST_CARD",
  },
  {
    description: "Name-based fallback - Wynik meczu",
    raw: { name: "Wynik meczu", selections: [{ name: "Liverpool", odds: 1.85 }, { name: "Remis", odds: 3.5 }, { name: "Arsenal", odds: 4.2 }] },
    expectedCode: "MATCH_WINNER",
  },
  {
    description: "Name-based fallback - Obie drużyny strzelą",
    raw: { name: "Obie drużyny strzelą", selections: [{ name: "Tak", odds: 1.8 }, { name: "Nie", odds: 2.0 }] },
    expectedCode: "BTTS",
  },
  {
    description: "Name-based fallback - Liczba goli 2.5",
    raw: { name: "Liczba goli 2.5", selections: [{ name: "Ponad 2.5", odds: 1.9 }, { name: "Poniżej 2.5", odds: 1.9 }] },
    expectedCode: "TOTAL_GOALS",
  },
];

console.log("Testing STS Normalizer...\n");
console.log("=".repeat(80));

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = stsNormalizer.normalizeMarket(tc.raw, ctx);
  const actualCode = result?.marketCode ?? "null";
  const status = actualCode === tc.expectedCode ? "✅ PASS" : "❌ FAIL";
  
  if (actualCode === tc.expectedCode) {
    passed++;
  } else {
    failed++;
  }
  
  console.log(`\n${tc.description}`);
  console.log(`  Expected: ${tc.expectedCode}`);
  console.log(`  Actual:   ${actualCode}`);
  console.log(`  Key:      ${result?.marketKey ?? "null"}`);
  console.log(`  ${status}`);
}

console.log("\n" + "=".repeat(80));
console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
