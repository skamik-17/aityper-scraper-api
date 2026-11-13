"""Fuksiarz HALF_WITH_MORE_GOALS 1ST/DRAW/2ND vs the peer median, one match.

usage: python3 -I hwmg_vs_peers.py <normalized-markets.json> [label]
Prints one line in the format of evidence/fuksiarz/hwmg-live-vs-peers-2026-11-06.txt.
"""
import json, statistics, sys

label = sys.argv[2] if len(sys.argv) > 2 else "match"
raw = open(sys.argv[1]).read()
try:
    nm = json.loads(raw)["data"]
except (ValueError, KeyError, TypeError):
    print(f"{label}: no data ({raw[:120]!r})")
    sys.exit(0)
codes = ("1ST_HALF", "DRAW", "2ND_HALF")
fk, peer = {}, {c: [] for c in codes}
for c in nm["categories"]:
    for m in c["markets"]:
        if m["type"] != "HALF_WITH_MORE_GOALS":
            continue
        for p in m["parameters"]:
            for b in p["bookmakers"]:
                for s in b["selections"]:
                    if s.get("type") not in codes:
                        continue
                    if b["bookmaker"] == "fuksiarz":
                        fk[s["type"]] = s["odds"]
                    else:
                        peer[s["type"]].append(s["odds"])
med = {c: (round(statistics.median(v), 3) if v else None) for c, v in peer.items()}
n = max((len(v) for v in peer.values()), default=0)
fmt = lambda d: "/".join(str(d.get(c)) for c in codes)
best2 = max(peer["2ND_HALF"]) if peer["2ND_HALF"] else None
print(f"{label}: fuksiarz {fmt(fk)} | median {fmt(med)} (n={n}) | best peer 2ND {best2}")
