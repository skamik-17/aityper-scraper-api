function normalizeName(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const tests = [
  "1 - 0, 2 - 0 lub 3 - 0",
  "4 - 0, 5 - 0 lub 6 - 0",
  "Remis ",
  "West Ham - Inny wynik",
  "Sunderland - Inny wynik"
];

console.log("Testing regex patterns:");
for (const test of tests) {
  const normalized = normalizeName(test);
  console.log(`\nOriginal: "${test}"`);
  console.log(`Normalized: "${normalized}"`);
  
  console.log(`  Pattern 1-0 to 3-0: ${/^1\s*-\s*0\s*,\s*2\s*-\s*0\s*,\s*3\s*-\s*0$/i.test(normalized)}`);
  console.log(`  Pattern 4-0 to 6-0: ${/^4\s*-\s*0\s*,\s*5\s*-\s*0\s*,\s*6\s*-\s*0$/i.test(normalized)}`);
  console.log(`  Pattern starts with remis: ${normalized.startsWith("remis")}`);
  console.log(`  Pattern includes inny wynik: ${normalized.includes("inny wynik")}`);
}
