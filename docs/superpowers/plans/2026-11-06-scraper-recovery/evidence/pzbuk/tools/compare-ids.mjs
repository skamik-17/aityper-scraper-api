// Compare marketTypeId -> name between the July golden fixture and the fresh capture.
import fs from "node:fs";
const REPO = "/home/skamik/Documents/repositories/personal/aityper-scraper-api";
const golden = JSON.parse(fs.readFileSync(`${REPO}/src/services/normalization/__fixtures__/pzbuk/world-cup-2026_france_morocco.json`, "utf8"));
const expected = JSON.parse(fs.readFileSync(`${REPO}/src/services/normalization/__fixtures__/pzbuk/world-cup-2026_france_morocco.expected.json`, "utf8"));
const cap = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const fixedNorm = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));

const gName = {}, gCode = {};
for (const e of golden.entries) {
  const id = String(e.raw.bookmakerMarketId);
  (gName[id] ||= new Set()).add(e.raw.name);
  const x = expected.entries.find((y) => y.index === e.index);
  (gCode[id] ||= new Set()).add(x?.marketCode);
}
const placeholders = golden.entries.filter((e) => /^Rynek \d+/.test(e.raw.name)).length;
console.log(`golden entries=${golden.entries.length}, placeholder names=${placeholders}, distinct ids=${Object.keys(gName).length}`);

const cName = {}, cOrig = {};
for (const f of cap.frames.event) {
  if (f.dir !== "recv") continue;
  let env; try { env = JSON.parse(Buffer.from(f.b64, "base64").toString("utf8")); } catch { continue; }
  for (const m of env.payload || []) for (const mk of m.payload?.markets || []) {
    if ((m.payload.events || []).length !== 1) continue;
    const id = String(mk.marketType?.id);
    (cName[id] ||= new Set()).add(mk.name.trim());
    cOrig[id] = mk.marketType?.originalName;
  }
}
const nCode = {};
for (const n of fixedNorm) (nCode[n.bookmakerMarketId] ||= new Set()).add(n.normalizedType);

const shared = Object.keys(cName).filter((id) => gName[id]);
console.log(`capture distinct ids=${Object.keys(cName).length}, shared with golden=${shared.length}, new (not in golden)=${Object.keys(cName).length - shared.length}, golden-only=${Object.keys(gName).filter((id) => !cName[id]).length}`);
const rows = [];
for (const id of shared.sort((a, b) => Number(a) - Number(b))) {
  const g = [...gName[id]].join(" | ");
  const c = [...cName[id]].join(" | ");
  rows.push({ id, golden: g.slice(0, 70), now: c.slice(0, 70), orig: (cOrig[id] || "").slice(0, 60), goldenCode: [...gCode[id]].join(","), nowCode: [...(nCode[id] || [])].join(",") });
}
for (const r of rows) console.log(`${r.id.padStart(5)} | G: ${r.golden.padEnd(55)} | N: ${r.now.padEnd(55)} | ${r.orig.padEnd(45)} | ${r.goldenCode} -> ${r.nowCode}`);
console.log("\nGolden-only ids:", JSON.stringify(Object.keys(gName).filter((id) => !cName[id]).map((id) => [id, [...gName[id]][0]])));
fs.writeFileSync(process.argv[4], JSON.stringify({ rows, captureIds: Object.fromEntries(Object.entries(cName).map(([k, v]) => [k, { names: [...v], originalName: cOrig[k], nowCodes: [...(nCode[k] || [])] }])) }, null, 1));
