"""Count Fuksiarz-only "I. Surname" rows stranded next to a compatible full-name row.

usage: python3 -I stranded_rows.py <normalized-markets.json>
A row is stranded when its label is an initial form quoted by fuksiarz alone and
the same market has a non-abbreviated row with the same surname and initial
(e.g. "J. van Hecke" [fuksiarz] next to "Jan Paul van Hecke" [betcris, lvbet]).
"""
import json, re, sys

ABBR = re.compile(r"^[A-ZÀ-Ž]\.\s")
d = json.load(open(sys.argv[1]))["data"]
stranded = []
for cat in d["categories"]:
    for m in cat["markets"]:
        vals = [(p["value"] or "", sorted({b["bookmaker"] for b in p["bookmakers"] if b["selections"]})) for p in m["parameters"]]
        for v, bms in vals:
            if not ABBR.match(v) or bms != ["fuksiarz"]:
                continue
            ini, sur = v[0].lower(), v.split(" ")[-1].lower()
            peers = [x for x, _ in vals if x != v and not ABBR.match(x) and x.lower().split(" ")[-1] == sur and x.lower().startswith(ini)]
            if peers:
                stranded.append((m["type"], v, peers))
print(json.dumps({"stranded": len(stranded), "sample": stranded[:20]}, ensure_ascii=False))
