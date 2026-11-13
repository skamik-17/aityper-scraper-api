# Acceptance check for superbet per-player stat lines (plan superbet.md, Task 5).
# usage: python3 -I player_stat_lines_check.py [--codes A,B,...] <normalized-markets.json> [<more.json> ...]
# Input: GET /api/matches/<Home>/<Away>/normalized-markets?league=premier-league, e.g. the files that
# fetch_near_term.py writes. /api/odds without full=true carries MATCH_WINNER only, so it cannot be used.
# Per file and code, over data.categories[].markets[] with type == CODE:
#   - superbet quotes at least MIN_PLAYERS parameters (one parameter per player; about 36-41 on a
#     near-term Premier League match);
#   - each of those parameters holds exactly one superbet entry (two players never share a row);
#   - that entry holds only "N+" selection types, each type once, odds > 1, odds non-decreasing as N
#     grows (a higher threshold can never pay less), and no selection flagged suspect.
# It checks structure only. Prices change on every run, so none is compared.
import json, re, sys

CODES = ["PLAYER_FOULS", "PLAYER_FOULS_WON", "PLAYER_SHOTS_ON_TARGET", "PLAYER_TACKLES",
         "PLAYER_SHOTS_OUTSIDE_BOX", "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX", "PLAYER_ASSISTS"]
MIN_PLAYERS = 25
THRESHOLD = re.compile(r"[1-9]\d*\+")

args = sys.argv[1:]
if args[:1] == ["--codes"]:
    CODES, args = args[1].split(","), args[2:]
if not args:
    sys.exit("usage: player_stat_lines_check.py [--codes A,B] <normalized-markets.json> ...")

fail = 0
for path in args:
    name = path.split("/")[-1]
    data = json.load(open(path))["data"]
    markets = [m for c in data["categories"] for m in c["markets"]]
    for code in CODES:
        params = [p for m in markets if m["type"] == code for p in (m.get("parameters") or [])]
        rows = [(p["value"], [b for b in p["bookmakers"] if b["bookmaker"] == "superbet"]) for p in params]
        rows = [(v, sb) for v, sb in rows if sb]
        problems = []
        for value, sb in rows:
            if len(sb) != 1:
                problems.append(f"{value!r}: {len(sb)} superbet entries")
                continue
            sels = sb[0]["selections"]
            types = [s["type"] for s in sels]
            bad = [t for t in types if not THRESHOLD.fullmatch(t)]
            if bad:
                problems.append(f"{value!r}: non-threshold types {bad}")
                continue
            if len(set(types)) != len(types):
                problems.append(f"{value!r}: duplicate types {types}")
                continue
            ladder = sorted((int(s["type"][:-1]), s["odds"]) for s in sels)
            if any(o <= 1 for _, o in ladder):
                problems.append(f"{value!r}: odds <= 1 in {ladder}")
            if any(b[1] < a[1] for a, b in zip(ladder, ladder[1:])):
                problems.append(f"{value!r}: odds fall as N grows {ladder}")
            if any(s.get("suspect") for s in sels):
                problems.append(f"{value!r}: suspect selection {[s for s in sels if s.get('suspect')]}")
        if not rows:
            print(f"{name} {code}: superbet ABSENT")
            fail += 1
            continue
        ok = not problems and len(rows) >= MIN_PLAYERS
        fail += not ok
        few = "" if len(rows) >= MIN_PLAYERS else f" (fewer than {MIN_PLAYERS})"
        print(f"{name} {code}: superbet players={len(rows)}{few} {'OK' if ok else 'FAIL'}")
        for p in problems[:5]:
            print(f"    {p}")
        if len(problems) > 5:
            print(f"    ... {len(problems) - 5} more")
print("RESULT", "PASS" if fail == 0 else f"FAIL ({fail})", f"files={len(args)}")
sys.exit(1 if fail else 0)
