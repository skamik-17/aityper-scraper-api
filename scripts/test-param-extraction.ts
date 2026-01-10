/**
 * Quick test to verify param extraction from selections works correctly
 */
import { stsAdapter } from "../src/services/normalization/bookmakers/sts-adapter.js";
import { UnifiedNormalizer } from "../src/services/normalization/core/unified-normalizer.js";

// Sample STS market data mimicking what comes from the scraper
const sampleMarkets = [
  {
    name: "Rynek 25", // Total goals via ID mapping
    groupName: "Gole",
    type: undefined, // No type set - goes through ID mapping
    selections: [
      { name: "+2.5", odds: 1.85 },
      { name: "-2.5", odds: 1.92 },
    ],
  },
  {
    name: "Liczba goli 2.5", // Total goals with line in name
    groupName: "Gole",
    type: "OVER_UNDER",
    selections: [
      { name: "+2.5", odds: 1.85 },
      { name: "-2.5", odds: 1.92 },
    ],
  },
  {
    name: "Rynek 23", // Another total goals market via ID
    groupName: "Gole",
    type: undefined,
    selections: [
      { name: "+1.5", odds: 1.35 },
      { name: "-1.5", odds: 3.10 },
    ],
  },
];

const normalizer = new UnifiedNormalizer([stsAdapter]);

console.log("Testing param extraction from STS markets:\n");

for (const market of sampleMarkets) {
  const normalized = normalizer.normalize(
    market,
    "sts",
    "Real Madrid",
    "Barcelona"
  );

  console.log(`Input: name="${market.name}", type="${market.type || "undefined"}"`);
  console.log(`  selections: ${market.selections.map((s) => s.name).join(", ")}`);
  console.log(`Result:`);
  console.log(`  normalizedType: ${normalized.normalizedType}`);
  console.log(`  marketKey: ${normalized.marketKey}`);
  console.log(`  paramValue: ${normalized.paramValue || "(none)"}`);
  console.log("");
}
