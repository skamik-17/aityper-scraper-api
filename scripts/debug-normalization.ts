const name = 'Gole Powyżej/Poniżej';

const normalized = name
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .replace(/ł/g, "l")
  .replace(/Ł/g, "L")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();
console.log('Original:', name);
console.log('Normalized:', normalized);

const pattern1 = /^gole\s+powyżej\s*\/\s*poniżej/i;
const pattern2 = /^gole.*powyżej.*poniżej/i;

console.log('Pattern 1 (/^gole\\s+powyżej\\s*\\/\\s*poniżej/i):', pattern1.test(normalized));
console.log('Pattern 2 (/^gole.*powyżej.*poniżej/i):', pattern2.test(normalized));

console.log('\n--- Char codes of normalized string ---');
for (let i = 0; i < normalized.length; i++) {
  const char = normalized[i];
  const code = char.charCodeAt(0);
  console.log(`Index ${i}: '${char}' (code ${code})`);
}
