# Acceptance check for superbet exact-goals coverage (plan superbet.md, Task 2).
# usage: python3 -I exact_goals_check.py <normalized-markets.json> [<more.json> ...]
# Per file and code: superbet present? max |superbet/peer-median - 1| over selections whose peer median < 10.
import json, statistics, sys
CODES = ["EXACT_GOALS", "HOME_EXACT_GOALS", "AWAY_EXACT_GOALS", "HALF_TIME_EXACT_GOALS", "HALF_TIME_AWAY_EXACT_GOALS"]
fail = 0
for path in sys.argv[1:]:
    data = json.load(open(path))["data"]
    markets = {m["type"]: m for c in data["categories"] for m in c["markets"]}
    for code in CODES:
        m = markets.get(code)
        sels = [(b["bookmaker"], s["type"], s["odds"]) for p in (m["parameters"] if m else []) for b in p["bookmakers"] for s in b["selections"]]
        sb = {t: o for bm, t, o in sels if bm == "superbet"}
        if not sb:
            print(f"{path.split('/')[-1]} {code}: superbet ABSENT"); fail += 1; continue
        worst = 0.0
        for t, o in sb.items():
            peers = [x for bm, tt, x in sels if bm != "superbet" and tt == t]
            if peers and statistics.median(peers) < 10:
                worst = max(worst, abs(o / statistics.median(peers) - 1) * 100)
        flag = "OK" if worst <= 20 else "DEVIATION"
        fail += flag != "OK"
        print(f"{path.split('/')[-1]} {code}: superbet {sorted(sb)} maxDev<10={worst:.1f}% {flag}")
print("RESULT", "PASS" if fail == 0 else f"FAIL ({fail})")
sys.exit(1 if fail else 0)
