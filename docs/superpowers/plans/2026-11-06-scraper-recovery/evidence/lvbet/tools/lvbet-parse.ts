import * as fs from "node:fs";
// usage: [REPO_ROOT=<checkout>] tsx lvbet-parse.ts <markets.json> <home> <away> <out.json>
// REPO_ROOT selects the checkout whose parser runs (default: the main checkout).
const REPO = process.env.REPO_ROOT ?? "/home/skamik/Documents/repositories/personal/aityper-scraper-api";
const { parseAllMarkets } = await import(`${REPO}/src/scrapers/bookmakers/lvbet/parser.ts`);
const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = parseAllMarkets(raw, { homeTeam: process.argv[3], awayTeam: process.argv[4] });
const withParam = out.filter((m) => m.paramValue).length;
console.log(JSON.stringify({ rawCount: raw.length, parsed: out.length, withParam }));
fs.writeFileSync(process.argv[5], JSON.stringify(out));
