"""Count Fuksiarz-only "I. Hyphen-Surname" rows stranded next to a spaced peer spelling.

usage: python3 -I hyphen_split.py <normalized-markets.json>
A row is a hyphen split when its label is an initial form with a hyphenated
surname quoted by fuksiarz alone and the same market has a non-abbreviated row
with the same initial whose surname is the hyphen-free spelling
(e.g. "J. Hjerto-Dahl" [fuksiarz] next to "Jens Hjerto Dahl" [betfan, fortuna]).
Prints {"hyphenSplit": N, "sample": [[marketType, label, [peer labels]], ...]};
the expected value after the grouper fix (ef98d8e) is "hyphenSplit": 0.
"""
import json,re,sys
A=re.compile(r"^[A-ZÀ-Ž]\.\s"); d=json.load(open(sys.argv[1]))["data"]; out=[]
for c in d["categories"]:
    for m in c["markets"]:
        vals=[(p["value"] or "",sorted({b["bookmaker"] for b in p["bookmakers"] if b["selections"]})) for p in m["parameters"]]
        for v,bms in vals:
            if not A.match(v) or bms!=["fuksiarz"] or "-" not in v: continue
            tail=" ".join(v.split(" ")[1:]).replace("-"," ").lower()
            peers=[x for x,_ in vals if x!=v and not A.match(x) and x.lower().endswith(" "+tail) and x.lower().startswith(v[0].lower())]
            if peers: out.append((m["type"],v,peers))
print(json.dumps({"hyphenSplit":len(out),"sample":out[:20]},ensure_ascii=False))
