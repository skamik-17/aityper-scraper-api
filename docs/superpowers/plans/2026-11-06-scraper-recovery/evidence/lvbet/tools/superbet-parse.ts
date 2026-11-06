import * as fs from "node:fs";
import { parseAllMarkets } from "/home/skamik/Documents/repositories/personal/aityper-scraper-api/src/scrapers/bookmakers/superbet/parser.ts";
const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ev = Array.isArray(raw.data) ? raw.data[0] : raw.data;
const out = parseAllMarkets(ev);
console.log(JSON.stringify({ odds: ev.odds.length, marketCount: ev.marketCount, parsed: out.length, withParam: out.filter((m) => m.paramValue).length }));
fs.writeFileSync(process.argv[3], JSON.stringify(out));
