# Usage: python3 -I ladder_coverage.py <direct-swarm game.json> <normalized-markets.json>
# For every stats-family "N+" ladder type the raw Swarm game carries, checks that the betcris
# rows in /normalized-markets cover it: team ladders need every rung as a param (exact),
# player ladders need >= 95% of the players that have at least one catalog-declared tier.
# Types the raw game lacks are reported as "absent" and skipped. Exit code 1 on any FAIL.
import json, re, sys

TEAM = {  # Swarm type -> (catalog code, param prefix)
    "FoulsTotal": ("FOULS_TOTAL", ""), "FoulsTeam1Total": ("HOME_TEAM_TOTAL_FOULS", ""),
    "FoulsTeam2Total": ("AWAY_TEAM_TOTAL_FOULS", ""), "OffsidesTotal": ("OFFSIDES_TOTAL", ""),
    "OffsidesTeam1Total": ("HOME_TEAM_TOTAL_OFFSIDES", ""), "OffsidesTeam2Total": ("AWAY_TEAM_TOTAL_OFFSIDES", ""),
    "ShotsTeam1Total": ("TEAM_TOTAL_SHOTS", "HOME:"), "ShotsonTargetTotal": ("TOTAL_SHOTS_ON_TARGET", ""),
    "ShotsonTargetTeam1Total": ("TEAM_TOTAL_SHOTS_ON_TARGET", "HOME:"),
    "ShotsonTargetTeam2Total": ("TEAM_TOTAL_SHOTS_ON_TARGET", "AWAY:"),
    "ShotsonTarget1stHalfTotal": ("HALF_TIME_TOTAL_SHOTS_ON_TARGET", ""), "ThrowInsTotal": ("THROW_INS_TOTAL", ""),
    "ThrowInsTeam1Total": ("HOME_TEAM_TOTAL_THROW_INS", ""), "ThrowInsTeam2Total": ("AWAY_TEAM_TOTAL_THROW_INS", ""),
}
PLAYER = {  # Swarm type -> (catalog code, catalog N+ tiers)
    "PlayerShots": ("PLAYER_SHOTS", range(1, 10)), "PlayerShotsonTarget": ("PLAYER_SHOTS_ON_TARGET", range(1, 8)),
    "PlayerFouls": ("PLAYER_FOULS", range(1, 5)), "PlayerFoulsWon": ("PLAYER_FOULS_WON", range(1, 5)),
    "PlayerOffsides": ("PLAYER_OFFSIDES", range(1, 4)), "PlayerSaves": ("PLAYER_SAVES", range(1, 8)),
    "PlayerAssists": ("PLAYER_ASSISTS", range(1, 3)), "PlayerTackles": ("PLAYER_TACKLES", range(1, 9)),
    "PlayerShotsonTargetOutsidetheBox": ("PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX", range(1, 4)),
    "PlayerHeadedShotsonTarget": ("PLAYER_HEADER_SHOTS_ON_TARGET", range(1, 4)),
}
TIER = re.compile(r"^(?:(.*\S)\s+)?(\d+)\+$")

raw = json.load(open(sys.argv[1]))
game = [g for s in raw["data"]["data"]["sport"].values() for r in s["region"].values()
        for c in r["competition"].values() for g in c["game"].values()][0]
nm = json.load(open(sys.argv[2]))["data"]
params = {}  # code -> {param value: betcris selections}
for cat in nm["categories"]:
    for m in cat["markets"]:
        for p in m["parameters"]:
            for b in p["bookmakers"]:
                if b["bookmaker"] == "betcris":
                    params.setdefault(m["marketKey"], {})[p["value"]] = b["selections"]

fails = 0
by_type = {m["type"]: m for m in game["market"].values()}
for t in list(TEAM) + list(PLAYER) + ["PlayerShotsAgainstWoodwork"]:
    m = by_type.get(t)
    if not m:
        print(f"absent {t}")
        continue
    tiers = [(TIER.match(" ".join(e["name"].split())), e) for e in m["event"].values()]
    if t in TEAM:
        code, prefix = TEAM[t]
        want = {f"{prefix}{int(x.group(2)) - 0.5:.1f}" for x, _ in tiers if x}
        got = {v for v in params.get(code, {}) if v.startswith(prefix) and v[len(prefix):].replace(".", "", 1).isdigit()}
        ok = want <= got
        print(f"{'PASS' if ok else 'FAIL'} {t} -> {code}: rungs {len(want)}, betcris params {len(want & got)}; missing {sorted(want - got)}")
    elif t in PLAYER:
        code, allowed = PLAYER[t]
        want = {x.group(1) for x, _ in tiers if x and x.group(1) and int(x.group(2)) in allowed}
        got = len(params.get(code, {}))
        ok = got >= 0.95 * len(want)
        print(f"{'PASS' if ok else 'FAIL'} {t} -> {code}: players with a catalog tier {len(want)}, betcris params {got}")
    else:
        want = {x.group(1) for x, _ in tiers if x and x.group(1) and x.group(2) == "1"}
        got = len(params.get("PLAYER_HIT_WOODWORK", {}).get("", []))
        ok = got >= 0.95 * len(want)
        print(f"{'PASS' if ok else 'FAIL'} {t} -> PLAYER_HIT_WOODWORK: players {len(want)}, betcris selections {got}")
    fails += 0 if ok else 1
print(f"LADDER_COVERAGE fails={fails}")
sys.exit(1 if fails else 0)
