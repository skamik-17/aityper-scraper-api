# Approximate phase-1 normalized-market count per Betby event (integer AH -> ASIAN_HANDICAP).
import json, sys, re
NOSPEC = {"1","10","11","29","75","95","60","83","63","85","64","26","45","81","47","35","546","560","561","13670","52","50063"}
TOTALS_ANY = {"18","68","90"}
HALF_ONLY = {"19","20","37","36","547"}
AH = {"16","66"}
EH = {"14","65"}
OUT = {
 "1":{"1","2","3"},"10":{"9","10","11"},"11":{"4","5"},"18":{"12","13"},"68":{"12","13"},"90":{"12","13"},
 "19":{"12","13"},"20":{"12","13"},"16":{"1714","1715"},"66":{"1714","1715"},"14":{"1711","1712","1713"},"65":{"1711","1712","1713"},
 "29":{"74","76"},"75":{"74","76"},"95":{"74","76"},"60":{"1","2","3"},"83":{"1","2","3"},"63":{"9","10","11"},"85":{"9","10","11"},
 "64":{"4","5"},"26":{"70","72"},"47":{"418","420","422","424","426","428","430","432","434"},
 "35":{"78","80","82","84","86","88"},"37":{"794","796","798","800","802","804"},"36":{"90","92","94","96"},
 "546":{"1718","1719","1720","1721","1722","1723"},"547":{"1724","1725","1726","1727","1728","1729"},
 "560":{"74","76"},"561":{"74","76"},"8":{"6","7","8"},"13670":{"6","7","8"},"52":{"436","438","440"},
}
def cls(v):
    if (v*2) % 1 != 0: return "quarter"
    return "half" if (v*2) % 2 == 1 else "integer"
def ok_outcomes(mid, outs):
    good = []
    for oid, o in outs.items():
        if o.get("b"): continue
        try: k = float(o["k"])
        except: continue
        if not k >= 1.01: continue
        if mid in ("45","81","25"): good.append(oid); continue
        if mid == "50063":
            m = re.fullmatch(r"bb:exact_goals:(\d+)", oid)
            if m and int(m.group(1)) <= 9: good.append(oid)
            continue
        if oid in OUT.get(mid, set()): good.append(oid)
    return good
def count(markets):
    n = 0
    for mid, specs in markets.items():
        for spec, outs in specs.items():
            sp = dict(p.split("=",1) for p in spec.split("|")) if spec else {}
            if mid in NOSPEC: keep = spec == ""
            elif mid in TOTALS_ANY: keep = "total" in sp and len(sp) == 1
            elif mid in HALF_ONLY: keep = "total" in sp and cls(float(sp["total"])) == "half"
            elif mid in AH: keep = "hcp" in sp and cls(float(sp["hcp"])) != "quarter"
            elif mid in EH:
                a, b = sp.get("hcp","0:0").split(":"); keep = a != b
            elif mid == "8": keep = sp == {"goalnr": "1"}
            elif mid == "25": keep = sp == {"variant": "sr:goal_range:7+"}
            else: keep = False
            if keep and ok_outcomes(mid, outs): n += 1
    return n
for f in sys.argv[1:]:
    d = json.load(open(f))
    for eid, e in d["events"].items():
        print(eid, e["desc"]["scheduled"], [c["name"].strip() for c in e["desc"]["competitors"]], "ids=%d pairs=%d normalized=%d" % (len(e["markets"]), sum(len(v) for v in e["markets"].values()), count(e["markets"])))
