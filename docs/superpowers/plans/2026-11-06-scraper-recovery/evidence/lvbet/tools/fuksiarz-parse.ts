import * as fs from "node:fs";
import { parseAllMarkets, parseTeamNames } from "/home/skamik/Documents/repositories/personal/aityper-scraper-api/src/scrapers/bookmakers/fuksiarz/parser.ts";
const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ev = raw.data;
const out = parseAllMarkets(ev, parseTeamNames(ev.eventName));
console.log(JSON.stringify({ games: ev.eventGames.length, gamesCount: ev.gamesCount, parsed: out.length, withParam: out.filter((m) => m.paramValue).length }));
fs.writeFileSync(process.argv[3], JSON.stringify(out));
