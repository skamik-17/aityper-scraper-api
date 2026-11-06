# LVBet live acceptance checks over normalized-markets dumps (GET /api/matches/<H>/<A>/normalized-markets).
# usage: python3 -I lvbet_ac.py [--ladders] nm-*.json
# Prints one line per file and exits 1 when any check fails.
#   tg   TOTAL_GOALS 2.5 and 3.5: LVBet present, legs exactly OVER/UNDER, each leg within +-10 % of the peer median
#   ht1  HALF_TIME_TOTAL_GOALS 1: LVBet present
#   goa  no LVBet PLAYER_GOAL_OR_ASSIST selection type contains " or "
# --ladders (matches whose player ladders are published):
#   codes  every REQUIRED code has an LVBet entry; LVBet EXACT_GOALS has >= 7 selections
#   tiers  PLAYER_SHOTS / PLAYER_FOULS / PLAYER_SAVES: >= 80 % of LVBet tiers quoted by >= 2 peers are within +-30 % of the peer median
#          (n/a when no tier has 2 peer quotes)
import json, statistics, sys

REQUIRED = ["PLAYER_SHOTS", "PLAYER_SHOTS_ON_TARGET", "PLAYER_FOULS", "PLAYER_FOULS_WON", "PLAYER_TACKLES",
            "PLAYER_SAVES", "PLAYER_ASSISTS", "PLAYER_OFFSIDES", "PLAYER_HEADER_SHOTS_ON_TARGET",
            "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX", "PLAYER_GOAL_AND_ASSIST", "HOME_EXACT_GOALS",
            "HALF_TIME_HOME_EXACT_GOALS", "RESULT_OR_TOTAL", "TWO_PLAYERS_COMBINED_GOALS"]
TIER_CODES = ["PLAYER_SHOTS", "PLAYER_FOULS", "PLAYER_SAVES"]
BM = "lvbet"


def dev(mine, peers):
    med = statistics.median(peers)
    return (mine - med) / med * 100


def check(path, ladders):
    markets = {m["type"]: m for c in json.load(open(path))["data"]["categories"] for m in c["markets"]}
    params = lambda code: {p["value"]: p["bookmakers"] for p in markets.get(code, {"parameters": []})["parameters"]}
    mine = lambda bms: next((b for b in bms if b["bookmaker"] == BM), None)
    fails, notes = [], []
    tg = params("TOTAL_GOALS")
    for line in ("2.5", "3.5"):
        b = mine(tg.get(line, []))
        if not b:
            fails.append(f"tg{line}:missing"); continue
        odds = {s["type"]: s["odds"] for s in b["selections"]}
        if sorted(odds) != ["OVER", "UNDER"]:
            fails.append(f"tg{line}:legs={sorted(odds)}"); continue
        for leg in ("OVER", "UNDER"):
            peers = [s["odds"] for p in tg[line] if p["bookmaker"] != BM for s in p["selections"] if s["type"] == leg]
            d = dev(odds[leg], peers)
            notes.append(f"tg{line}{leg[0]}={odds[leg]}({d:+.1f}%)")
            if abs(d) > 10: fails.append(f"tg{line}{leg}:{d:+.1f}%")
    if not mine(params("HALF_TIME_TOTAL_GOALS").get("1", [])): fails.append("ht1:missing")
    ors = sum(1 for bms in params("PLAYER_GOAL_OR_ASSIST").values() for b in bms if b["bookmaker"] == BM
              for s in b["selections"] if " or " in s["type"])
    if ors: fails.append(f"goa:{ors} pair selections")
    if ladders:
        missing = [c for c in REQUIRED if not any(mine(bms) for bms in params(c).values())]
        if missing: fails.append("codes:missing=" + ",".join(missing))
        exact = [b for bms in params("EXACT_GOALS").values() for b in bms if b["bookmaker"] == BM]
        if not exact or len(exact[0]["selections"]) < 7: fails.append("exact:<7 selections")
        for code in TIER_CODES:
            devs = []
            for bms in params(code).values():
                b = mine(bms)
                if not b: continue
                for s in b["selections"]:
                    peers = [x["odds"] for p in bms if p["bookmaker"] != BM for x in p["selections"] if x["type"] == s["type"]]
                    if len(peers) >= 2: devs.append(dev(s["odds"], peers))
            if not devs:
                notes.append(f"{code}:n/a"); continue  # presence is covered by the codes check
            share = 100 * sum(1 for d in devs if abs(d) <= 30) / len(devs)
            notes.append(f"{code}:{len(devs)}tiers/{share:.0f}%")
            if share < 80: fails.append(f"tiers:{code}={share:.0f}%")
    print(path.split("/")[-1], "PASS" if not fails else "FAIL " + " ".join(fails), "|", " ".join(notes))
    return not fails


args = [a for a in sys.argv[1:] if a != "--ladders"]
ok = all([check(p, "--ladders" in sys.argv) for p in args])
sys.exit(0 if ok else 1)
