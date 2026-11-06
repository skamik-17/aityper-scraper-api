"""Count player parameters whose displayed label is an initial form ("O. Zambrano").

usage: python3 -I abbreviated_labels.py <normalized-markets.json>
  withPeers   = abbreviated label that also carries another bookmaker (a full
                name was folded INTO the initial form -> label regression)
  fuksiarzOnly = abbreviated label quoted by fuksiarz alone
"""
import json, re, sys

d = json.load(open(sys.argv[1]))["data"]
with_peers, fuks_only = [], []
for cat in d["categories"]:
    for m in cat["markets"]:
        for p in m["parameters"]:
            v = p["value"] or ""
            if not re.match(r"^[A-ZÀ-Ž]\.\s", v):
                continue
            bms = sorted({b["bookmaker"] for b in p["bookmakers"] if b["selections"]})
            if len(bms) > 1:
                with_peers.append((m["type"], v, bms))
            elif bms == ["fuksiarz"]:
                fuks_only.append((m["type"], v))
print(json.dumps({"withPeers": len(with_peers), "fuksiarzOnly": len(fuks_only), "sampleWithPeers": with_peers[:5]}, ensure_ascii=False))
