"""Fuksiarz PLAYER_HEADER_SHOTS_ON_TARGET "1+" odds vs the peer median, per player.

usage:
  python3 -I header_shots_vs_peers.py <normalized-markets.json>
      post-deploy: fuksiarz and peers share one parameter row
  python3 -I header_shots_vs_peers.py <normalized-markets.json> --fuksiarz-event <event.json>
      pre-fix baseline: fuksiarz odds come from the raw event (gameType -4895),
      matched to a peer row by initial + surname
"""
import json, statistics, sys

nm = json.load(open(sys.argv[1]))["data"]
peer, fk = {}, {}
for c in nm["categories"]:
    for m in c["markets"]:
        if m["type"] != "PLAYER_HEADER_SHOTS_ON_TARGET":
            continue
        for p in m["parameters"]:
            for b in p["bookmakers"]:
                for s in b["selections"]:
                    if s.get("type") != "1+":
                        continue
                    if b["bookmaker"] == "fuksiarz":
                        fk[p["value"]] = s["odds"]
                    else:
                        peer.setdefault(p["value"], []).append(s["odds"])
if "--fuksiarz-event" in sys.argv:
    ev = json.load(open(sys.argv[sys.argv.index("--fuksiarz-event") + 1]))
    raw = {o["outcomeName"]: o["outcomeOdds"] for g in ev["data"]["eventGames"] if str(g["gameType"]) == "-4895" for o in g["outcomes"]}
    fk = {}
    for name, odds in raw.items():
        ini, sur = name[0].lower(), name.split()[-1].lower()
        rows = [v for v in peer if v and v.split()[-1].lower() == sur and v[0].lower() == ini]
        fk[rows[0] if len(rows) == 1 else name] = odds
rows = []
for name, odds in sorted(fk.items()):
    if name not in peer:
        rows.append((name, odds, None, None))
        continue
    med = statistics.median(peer[name])
    rows.append((name, odds, med, odds / med - 1))
shared = [r for r in rows if r[2] is not None]
devs = [abs(r[3]) for r in shared]
print(json.dumps({
    "fuksiarzPlayers": len(rows),
    "sharedWithPeer": len(shared),
    "medianAbsDevPct": round(statistics.median(devs) * 100, 1) if devs else None,
    "maxRatio": round(max(max(r[1] / r[2], r[2] / r[1]) for r in shared), 2) if shared else None,
    "rows": [(n, o, m, None if d is None else f"{d * 100:+.1f}%") for n, o, m, d in rows],
}, ensure_ascii=False))
