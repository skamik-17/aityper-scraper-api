// Feasibility check: talk to the Betcris Swarm endpoint directly from Node (no browser).
// Usage: GID=<game id> node direct-swarm.mjs [wssUrl] <outPrefix>  -> <outPrefix>-list.json, <outPrefix>-game.json
import WebSocket from "/home/skamik/Documents/repositories/personal/aityper-scraper-api/node_modules/ws/index.js";
import fs from "node:fs";

const URL = process.argv[2] ?? "wss://eu-swarm-springre.trexname.com/";
const OUT = process.argv[3] ?? "out/direct";
const t0 = Date.now();
const ws = new WebSocket(URL, {
  headers: {
    Origin: "https://www.betcris.pl",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
});
const send = (o) => ws.send(JSON.stringify(o));
const log = (...a) => console.log(`[${Date.now() - t0}ms]`, ...a);
ws.on("open", () => {
  log("open");
  send({ command: "request_session", params: { language: "pol", site_id: "1874631", source: 42 }, rid: "s1" });
});
ws.on("message", (buf) => {
  const p = buf.toString();
  const m = JSON.parse(p);
  log("rid", m.rid, "code", m.code, "len", p.length);
  if (m.rid === "s1") {
    send({
      command: "get",
      rid: "list",
      params: {
        source: "betting",
        what: {
          sport: ["id", "name", "alias"],
          region: ["id", "name", "alias"],
          competition: ["id", "name"],
          game: [["id", "team1_name", "team2_name", "start_ts", "markets_count", "game_number"]],
          market: ["name", "type", "id", "base", "market_type"],
          event: ["id", "name", "price", "base", "type_1", "type_id"],
        },
        where: { sport: { alias: "Soccer" }, competition: { id: 538 }, market: { type: "P1XP2" } },
        subscribe: false,
      },
    });
  } else if (m.rid === "list") {
    fs.writeFileSync(`${OUT}-list.json`, p);
    const games = [];
    for (const s of Object.values(m.data?.data?.sport ?? {}))
      for (const r of Object.values(s.region ?? {}))
        for (const c of Object.values(r.competition ?? {}))
          for (const g of Object.values(c.game ?? {})) games.push(g);
    log("games", games.length, games.slice(0, 3).map((g) => `${g.id} ${g.team1_name}-${g.team2_name} mc=${g.markets_count}`));
    const gid = Number(process.env.GID) || games[0]?.id;
    send({
      command: "get",
      rid: "game",
      params: {
        source: "betting",
        what: {
          sport: ["id", "name", "alias"],
          region: ["id", "name", "alias"],
          competition: ["id", "name"],
          game: ["id", "team1_name", "team2_name", "start_ts", "markets_count", "game_number"],
          market: ["type", "name", "order", "id", "base", "col_count", "group_id", "group_name", "market_type", "display_key", "display_sub_key", "extra_info"],
          event: ["name", "id", "price", "base", "order", "type_1", "type_id", "extra_info"],
        },
        where: { game: { id: gid } },
        subscribe: false,
      },
    });
  } else if (m.rid === "game") {
    fs.writeFileSync(`${OUT}-game.json`, p);
    let n = 0, mc = 0;
    for (const s of Object.values(m.data?.data?.sport ?? {}))
      for (const r of Object.values(s.region ?? {}))
        for (const c of Object.values(r.competition ?? {}))
          for (const g of Object.values(c.game ?? {})) {
            n += Object.keys(g.market ?? {}).length;
            mc = g.markets_count;
          }
    log("single game markets", n, "self-reported markets_count", mc);
    ws.close();
  }
});
ws.on("close", (c) => log("close", c));
ws.on("error", (e) => log("error", String(e)));
setTimeout(() => { log("timeout"); process.exit(1); }, 20000).unref();
