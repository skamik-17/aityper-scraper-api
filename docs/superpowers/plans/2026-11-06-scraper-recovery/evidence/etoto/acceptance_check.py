"""etoto acceptance check: read-only GETs against the local API (localhost:3001).

Usage: python3 -I acceptance_check.py
Prints one line per criterion. Thresholds are the plan's acceptance criteria.
"""
import json
import statistics
import urllib.parse
import urllib.request

BASE = "http://localhost:3001"
SHOT_CODES = ("TEAM_TOTAL_SHOTS", "TEAM_TOTAL_SHOTS_ON_TARGET", "TEAM_TOTAL_FOULS")
FOUL_CODES = ("HOME_TEAM_TOTAL_FOULS", "AWAY_TEAM_TOTAL_FOULS")


def get(path):
    return json.load(urllib.request.urlopen(BASE + path))


def dev_pct(value, peers):
    med = statistics.median(peers)
    return abs(value - med) / med * 100


matches = get("/api/odds?league=premier-league")["data"]["matches"]

# Fixtures and orphans (etoto alone on a matchId).
etoto_matches = [m for m in matches if "etoto" in m["markets"].get("MATCH_WINNER", {}).get("bookmakerOdds", {})]
orphans = [m["matchId"] for m in etoto_matches if len(m["markets"]["MATCH_WINNER"]["bookmakerOdds"]) == 1]
print("fixtures", len(etoto_matches), "orphans", len(orphans))

# 1X2 vs the median of the other bookmakers.
devs = []
for m in etoto_matches:
    bo = m["markets"]["MATCH_WINNER"]["bookmakerOdds"]
    sel = lambda bm: {s["normalizedName"]: s["odds"] for s in bo[bm]["selections"]}
    mine = sel("etoto")
    for code in ("HOME", "DRAW", "AWAY"):
        peers = [sel(b)[code] for b in bo if b != "etoto" and code in sel(b)]
        if code in mine and peers:
            devs.append(dev_pct(mine[code], peers))
print("1x2_n", len(devs), "max_pct", round(max(devs), 1) if devs else None,
      "mean_pct", round(statistics.mean(devs), 1) if devs else None, "over10", sum(d > 10 for d in devs))

sideless = shared = solo = foul_rows = foul_shared = unknown = 0
ou_devs, pen = [], []
for m in etoto_matches:
    url = "/api/matches/%s/%s/normalized-markets?league=premier-league" % (
        urllib.parse.quote(m["homeTeam"]), urllib.parse.quote(m["awayTeam"]))
    for cat in get(url)["data"]["categories"]:
        for mk in cat["markets"]:
            for p in mk["parameters"]:
                rows = {b["bookmaker"]: {s["type"]: s["odds"] for s in b["selections"]} for b in p["bookmakers"]}
                if "etoto" not in rows:
                    continue
                unknown += sum(1 for code in rows["etoto"] if code == "UNKNOWN")
                peers = {b: r for b, r in rows.items() if b != "etoto"}
                if mk["type"] in SHOT_CODES:
                    if ":" not in p["value"]:
                        sideless += 1
                        print("  SIDELESS", m["matchId"], mk["type"], p["value"])
                    elif peers:
                        shared += 1
                    else:
                        solo += 1
                elif mk["type"] in FOUL_CODES:
                    foul_rows += 1
                    foul_shared += bool(peers)
                elif mk["type"] == "TOTAL_GOALS" and p["value"] == "2.5":
                    for code in ("OVER", "UNDER"):
                        vals = [r[code] for r in peers.values() if code in r]
                        if code in rows["etoto"] and vals:
                            ou_devs.append(dev_pct(rows["etoto"][code], vals))
                elif mk["type"] == "PENALTY_AWARDED":
                    vals = [r["YES"] for r in peers.values() if "YES" in r]
                    if "YES" in rows["etoto"] and vals:
                        pen.append((m["matchId"], rows["etoto"]["YES"], round(dev_pct(rows["etoto"]["YES"], vals), 1)))

print("etoto_sideless", sideless, "etoto_shared", shared, "etoto_solo", solo,
      "etoto_fouls_rows", foul_rows, "etoto_fouls_shared", foul_shared)
print("ou25_n", len(ou_devs), "max_pct", round(max(ou_devs), 1) if ou_devs else None)
print("penalty_awarded_etoto", len(pen), pen)
print("unknown_selections", unknown)
