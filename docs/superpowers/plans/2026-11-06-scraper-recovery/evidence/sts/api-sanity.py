"""API odds sanity for one bookmaker on one match (read-only GET).
Usage: python3 -I api-sanity.py "<Home>" "<Away>" [bookmaker=sts] [league=premier-league] [base=http://localhost:3001]
Prints one SANITY_RESULT JSON line; exit 0 when every check passes."""
import json, statistics, sys, urllib.parse, urllib.request
home, away = sys.argv[1], sys.argv[2]
bm = sys.argv[3] if len(sys.argv) > 3 else "sts"
league = sys.argv[4] if len(sys.argv) > 4 else "premier-league"
base = sys.argv[5] if len(sys.argv) > 5 else "http://localhost:3001"
q = urllib.parse.quote
url = f"{base}/api/matches/{q(home)}/{q(away)}/normalized-markets?league={q(league)}"
data = json.load(urllib.request.urlopen(url, timeout=60))["data"]
markets = {m["type"]: m for c in data["categories"] for m in c["markets"] if m["marketKey"] == m["type"]}

def quotes(code):
    """{(param, selectionType): {bookmaker: odds}} with dropdown ('base'/'') rows exploded per selection."""
    out = {}
    for p in markets.get(code, {}).get("parameters", []):
        for b in p["bookmakers"]:
            for s in b["selections"]:
                param = s["type"] if p["value"] in ("", "base") and code.startswith("GOALSCORER") else p["value"]
                sel = "PLAYER" if code.startswith("GOALSCORER") else s["type"]
                out.setdefault((param, sel), {})[b["bookmaker"]] = s["odds"]
    return out

def dev(pool):
    peers = [o for k, o in pool.items() if k != bm]
    return abs(pool[bm] / statistics.median(peers) - 1) if peers and bm in pool else None

checks = {}
mw = [(k, dev(v)) for k, v in quotes("MATCH_WINNER").items()]
checks["match_winner_max_dev"] = max((d for _, d in mw if d is not None), default=None)
checks["match_winner_ok"] = checks["match_winner_max_dev"] is not None and checks["match_winner_max_dev"] <= 0.10
gs = [(k[0], v[bm], dev(v)) for k, v in quotes("GOALSCORER_ANYTIME").items() if bm in v and len(v) > 1]
top3 = sorted(gs, key=lambda x: x[1])[:3]
checks["goalscorer_top3"] = [(n, o, round(d, 3)) for n, o, d in top3]
checks["goalscorer_ok"] = len(top3) == 3 and all(d <= 0.35 for _, _, d in top3)
cards_lines = {k[0] for k, v in quotes("CARDS_TOTAL").items() if bm in v}
checks["cards_total_lines"] = sorted(cards_lines)
checks["cards_total_ok"] = len(cards_lines) >= 4
ct = [(k, v) for k, v in quotes("CORNERS_TEAM").items() if bm in v]
checks["corners_team_shape_ok"] = bool(ct) and all(k[0].split(":")[0] in ("HOME", "AWAY") and k[1] in ("OVER", "UNDER") for k, _ in ct)
ok = all(v for k, v in checks.items() if k.endswith("_ok"))
print("SANITY_RESULT " + json.dumps({"match": f"{home} vs {away}", "bookmaker": bm, "pass": ok, **checks}))
sys.exit(0 if ok else 1)
