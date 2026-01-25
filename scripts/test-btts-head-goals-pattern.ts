const BETCLIC_MARKET_PATTERNS = [
  { pattern: /^oba (?:druzyny|zespoly) strzela.*gola.*glowa/i, code: "BTTS_HEAD_GOALS" },
];

function testPattern(marketName) {
  console.log(`Testing: "${marketName}"`);

  for (const { pattern, code } of BETCLIC_MARKET_PATTERNS) {
    if (pattern.test(marketName)) {
      console.log(`  ✅ MATCHED: ${code}`);
      return code;
    }
  }

  console.log(`  ❌ NO MATCH`);
  return null;
}

testPattern("Obie drużyny strzelą gola głową");
testPattern("oba drużyny strzela gola głowa");
testPattern("oba zespoly strzela gola głowa");
testPattern("Obie druzyny strzela gola głowa");

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z');
}

console.log("\nNormalized test:");
const normalizedName = normalizeName("Obie drużyny strzelą gola głową");
console.log(`Normalized: "${normalizedName}"`);
testPattern(normalizedName);
