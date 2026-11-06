"""Betfan team-stat side check against the local API (read-only GETs).

Usage: python3 -I team-stat-check.py [base_url]   (default http://localhost:3001)
Prints one SIDELESS line per betfan row on a team-stat code whose param lacks
HOME:/AWAY:, one FOULS line per match where betfan quotes any team fouls, then a
summary line. Baseline 2026-11-06 (pre-fix):
  betfan_sideless 7 betfan_shared 0 betfan_solo 0 betfan_team_total_fouls 1 betfan_home_fouls_matches 0 betfan_away_fouls_matches 0
"""
import json, sys, urllib.parse, urllib.request

base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3001"
get = lambda path: json.load(urllib.request.urlopen(base + path))
matches = get("/api/odds?league=premier-league")["data"]["matches"]
sideless = shared = solo = team_total_fouls = home_fouls = away_fouls = 0
for m in matches:
    path = "/api/matches/%s/%s/normalized-markets?league=premier-league&category=STATYSTYKI" % (
        urllib.parse.quote(m["homeTeam"]), urllib.parse.quote(m["awayTeam"]))
    seen = set()
    for c in get(path)["data"]["categories"]:
        for mk in c["markets"]:
            for p in mk["parameters"]:
                bms = [b["bookmaker"] for b in p["bookmakers"]]
                if "betfan" not in bms:
                    continue
                if mk["type"] in ("HOME_TEAM_TOTAL_FOULS", "AWAY_TEAM_TOTAL_FOULS", "TEAM_TOTAL_FOULS"):
                    seen.add(mk["type"])
                if mk["type"] == "TEAM_TOTAL_FOULS":
                    team_total_fouls += 1
                if mk["type"] not in ("TEAM_TOTAL_SHOTS", "TEAM_TOTAL_SHOTS_ON_TARGET", "TEAM_TOTAL_FOULS"):
                    continue
                if ":" not in p["value"]:
                    sideless += 1
                    print("SIDELESS", m["matchId"], mk["type"], p["value"])
                elif len(bms) > 1:
                    shared += 1
                else:
                    solo += 1
    if seen:
        print("FOULS", m["matchId"], sorted(seen))
    home_fouls += "HOME_TEAM_TOTAL_FOULS" in seen
    away_fouls += "AWAY_TEAM_TOTAL_FOULS" in seen
print("betfan_sideless", sideless, "betfan_shared", shared, "betfan_solo", solo,
      "betfan_team_total_fouls", team_total_fouls,
      "betfan_home_fouls_matches", home_fouls, "betfan_away_fouls_matches", away_fouls)
