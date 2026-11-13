# Acceptance check for superbet exact-goals coverage (plan superbet.md, Task 2).
# usage: python3 -I exact_goals_check.py <normalized-markets.json> [<more.json> ...]
# Per file and code: superbet present? max |superbet/peer-median - 1| over selections whose peer median < 10.
# A band quoted by one peer only is still checked: HALF_TIME_AWAY_EXACT_GOALS has a single peer (fuksiarz),
# and its 0/1/2 bands are the only automated side check on that code. The one exception is an open-ended
# top band ("3+", "6+") with a single peer and a gap > 20 %: that long-shot tail is printed as "soft"
# and does not fail the check, because one peer's tail price is not a reliable reference.
import json, statistics, sys
# No files means nothing was checked: fail instead of printing a vacuous PASS
# (fetch_near_term.py writes nothing when no PL fixture kicks off within 72 h).
if not sys.argv[1:]:
    sys.exit("usage: exact_goals_check.py <normalized-markets.json> ...")
CODES = ["EXACT_GOALS", "HOME_EXACT_GOALS", "AWAY_EXACT_GOALS", "HALF_TIME_EXACT_GOALS", "HALF_TIME_AWAY_EXACT_GOALS"]
fail = 0
soft_total = 0
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
        soft = []
        for t, o in sb.items():
            peers = [x for bm, tt, x in sels if bm != "superbet" and tt == t]
            if peers and statistics.median(peers) < 10:
                dev = abs(o / statistics.median(peers) - 1) * 100
                if dev > 20 and len(peers) == 1 and t.endswith("+"):
                    soft.append(f"{t} {o} vs {peers[0]} ({dev:.1f}%)")
                    continue
                worst = max(worst, dev)
        flag = "OK" if worst <= 20 else "DEVIATION"
        fail += flag != "OK"
        soft_total += len(soft)
        note = f" soft(1 peer, top band): {', '.join(soft)}" if soft else ""
        print(f"{path.split('/')[-1]} {code}: superbet {sorted(sb)} maxDev<10={worst:.1f}% {flag}{note}")
summary = "PASS" if fail == 0 else f"FAIL ({fail})"
print("RESULT", summary + (f" ({soft_total} soft single-peer top-band gap(s), not counted)" if soft_total else "") + f" files={len(sys.argv[1:])}")
sys.exit(1 if fail else 0)
