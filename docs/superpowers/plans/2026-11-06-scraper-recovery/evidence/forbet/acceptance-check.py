"""Forbet live acceptance check (read-only: local API GETs + a log file).

Usage:
  sed 's/\\x1b\\[[0-9;]*m//g' <backend.log> > /tmp/backend.clean.log
  python3 -I acceptance-check.py /tmp/backend.clean.log [TURBO_CODE]

TURBO_CODE is the code TurboPrzewaga (-31170) was routed to: default
MATCH_RESULT_OR_WIN_BY_2 (plan option a); pass WIN_OR_WIN_BY_2 for option b.

Only the LAST "[ScraperService] Starting scrape for premier-league" block of
the log is evaluated, so older runs in the same file do not count. Thresholds
are relative to N = matches in /api/odds?league=premier-league that carry a
forbet MATCH_WINNER at check time. Exit code 0 = all criteria pass.
"""
import json, re, statistics, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

API = "http://localhost:3001"
get = lambda p: json.load(urllib.request.urlopen(API + p))
log = open(sys.argv[1], encoding="utf-8").read()
TURBO = sys.argv[2] if len(sys.argv) > 2 else "MATCH_RESULT_OR_WIN_BY_2"
run = log[log.rfind("[ScraperService] Starting scrape for premier-league"):]
now = datetime.now(timezone.utc)
ms = [m for m in get("/api/odds?league=premier-league")["data"]["matches"]
      if "forbet" in m["markets"].get("MATCH_WINNER", {}).get("bookmakerOdds", {})]
N = len(ms)

# Raw market count per match, joined to /api/odds by team-name containment
counts = re.findall(r"^\[forBET/FullOffer\] (.+?) vs (.+?): (\d+) markets$", run, re.M)
same = lambda a, b: a.lower() in b.lower() or b.lower() in a.lower()
low = []
for m in ms:
    c = [int(n) for h, a, n in counts if same(h, m["homeTeam"]) and same(a, m["awayTeam"])]
    need = 400 if datetime.fromisoformat(m["startTime"]) - now <= timedelta(days=3) else 140
    if not c or c[0] < need:
        low.append((m["matchId"], c, need))

coll = len(re.findall(r"marketKey collision.*for forbet ", run))

def dev(p, sel):
    bms = {b["bookmaker"]: {s["type"]: s["odds"] for s in b["selections"]} for b in p["bookmakers"]}
    f = bms.get("forbet", {}).get(sel)
    peers = [o[sel] for k, o in bms.items() if k != "forbet" and sel in o]
    return abs(f - statistics.median(peers)) / statistics.median(peers) if f and peers else None

bad = mr = unk = 0
d1x2, dou = [], []
for m in ms:
    u = "/api/matches/%s/%s/normalized-markets?league=premier-league" % (
        urllib.parse.quote(m["homeTeam"]), urllib.parse.quote(m["awayTeam"]))
    for c in get(u)["data"]["categories"]:
        for mk in c["markets"]:
            for p in mk["parameters"]:
                f = next((b for b in p["bookmakers"] if b["bookmaker"] == "forbet"), None)
                if not f:
                    continue
                unk += sum(s["type"] == "UNKNOWN" for s in f["selections"])
                if mk["type"] == TURBO and "TurboPrzewaga" in f["rawMarketName"]:
                    mr += 1
                if mk["type"] == "EUROPEAN_HANDICAP" and p["value"] in ("2", "+2"):
                    d = dev(p, "HOME")
                    if "TurboPrzewaga" in f["rawMarketName"] or (d is not None and d > 0.15):
                        bad += 1
                        print("BAD_EH2", m["matchId"], f["rawMarketName"], d)
                if mk["type"] == "MATCH_WINNER":
                    d1x2 += [x for x in (dev(p, s) for s in ("HOME", "DRAW", "AWAY")) if x is not None]
                if mk["type"] == "TOTAL_GOALS" and p["value"] == "2.5":
                    dou += [x for x in (dev(p, s) for s in ("OVER", "UNDER")) if x is not None]

for x in low:
    print("LOW_RAW", *x)
checks = {
    "low_raw == 0": len(low) == 0,
    "collisions == 0": coll == 0,
    "bad_eh2_rows == 0": bad == 0,
    "matches_with_forbet_turbo >= N-1": mr >= N - 1,
    "unknown_sel == 0": unk == 0,
    "max_dev_1x2 <= 0.10": bool(d1x2) and max(d1x2) <= 0.10,
    "max_dev_ou25 <= 0.10": bool(dou) and max(dou) <= 0.10,
}
print("N", N, "low_raw", len(low), "collisions", coll, "bad_eh2_rows", bad, "matches_with_forbet_turbo (%s)" % TURBO, mr,
      "unknown_sel", unk, "max_dev_1x2 %.3f (n=%d)" % (max(d1x2 or [0]), len(d1x2)),
      "max_dev_ou25 %.3f (n=%d)" % (max(dou or [0]), len(dou)))
for k, v in checks.items():
    print(("PASS " if v else "FAIL ") + k)
sys.exit(0 if all(checks.values()) else 1)
