import fs from "fs";
import { normalizeMarketsForBookmaker } from "/home/skamik/Documents/repositories/personal/aityper-scraper-api/src/services/normalization/index.ts";
const d = JSON.parse(fs.readFileSync("/home/skamik/Documents/repositories/personal/aityper/docs/match-audit/.tmp/raw/premier_league_arsenal_coventry_city.json", "utf8"));
const ms = d.bookmakers.fortuna.markets;
const warns: string[] = []; const w = console.warn; console.warn = (...a: any[]) => warns.push(a.join(" "));
const out = normalizeMarketsForBookmaker(JSON.parse(JSON.stringify(ms)), "fortuna", "Arsenal", "Coventry City", "premier-league");
console.warn = w;
const unk = warns.filter((x) => x.startsWith("[fortuna] Unknown"));
console.log("aug raw", ms.length, "OTHER", out.filter((m: any) => m.normalizedType === "OTHER").length, "unknown warnings", unk.length);
for (const id of ["00-2n","00-1h","00-1o","00-1r","00-2b","00-09","00-19","00-16","00-0n","00-30","00-6z","00-hs","00-lq"]) {
  const i = ms.findIndex((m: any) => m.bookmakerMarketId === "ufo:mtyp:" + id);
  console.log(id, i >= 0 ? JSON.stringify(ms[i].name).slice(0, 60) + " -> " + out[i].normalizedType : "absent");
}
