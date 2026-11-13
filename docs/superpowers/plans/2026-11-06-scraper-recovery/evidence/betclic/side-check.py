# Automated side/line/selection checks over the SIDE_ROW lines that side-probe.mts prints.
# Usage: python3 -I side-check.py <side-probe.out>
# Checks, per row:
#   side  a HOME_/AWAY_ code or a HOME:/AWAY: param must carry a "- <team>" label suffix that is
#         contained in that side's name and not in the other side's name
#   ou    "Powyżej x" -> OVER and "Poniżej x" -> UNDER, and x equals the param line
#   1x2   team / Remis / Nikt legs of OFFSIDES_1X2, FOUL_RACE, TACKLES_1X2, MOST_SHOTS_ON_TARGET and
#         FIRST_OFFSIDE map to HOME / AWAY / DRAW / NONE; exp "?" means the leg's label is not a
#         substring of exactly one team name (e.g. "Man Utd") and needs a look by hand
#   odds  every price is a number above 1
# Prints "rows=N checks=N bad=N", then one "  BAD (...)" line per failed check.
import json, re, sys, unicodedata
rows = [json.loads(l[9:]) for l in open(sys.argv[1], encoding="utf-8") if l.startswith("SIDE_ROW ")]
def fold(s): return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace(" ", " ").strip()
bad, checked = [], 0
for r in rows:
    home, away = r["match"].split(" vs ")
    t, name, param = r["type"], r["name"], r["param"]
    m = re.search(r"-\s*([^()]+?)\s*(\(|$)", name.replace(" ", " "))
    team = m[1].strip() if m and not name.startswith(("Wynik", "Strzały Celne")) else None
    side = None
    if t.startswith("HOME_TEAM") or param.startswith("HOME:"): side = "HOME"
    if t.startswith("AWAY_TEAM") or param.startswith("AWAY:"): side = "AWAY"
    if side:
        checked += 1
        tgt = home if side == "HOME" else away
        oth = away if side == "HOME" else home
        if not team or fold(team) not in fold(tgt) or fold(team) in fold(oth):
            bad.append(("side", r["match"], name, t, param))
    line = re.sub(r"^(HOME|AWAY):", "", param)
    for sname, code, odds in r["sels"]:
        sm = re.match(r"^(Powyżej|Poniżej) (\d+(?:,\d+)?)$", sname.strip())
        if sm:
            checked += 1
            exp = "OVER" if sm[1] == "Powyżej" else "UNDER"
            if code != exp or sm[2].replace(",", ".") != line:
                bad.append(("ou", r["match"], name, sname, code, param))
        elif t in ("OFFSIDES_1X2", "FOUL_RACE", "TACKLES_1X2", "MOST_SHOTS_ON_TARGET", "FIRST_OFFSIDE"):
            checked += 1
            s = fold(sname)
            exp = "DRAW" if s.startswith("remis") else "NONE" if s.startswith("nikt") or s.startswith("brak") else "HOME" if s and s in fold(home) and s not in fold(away) else "AWAY" if s and s in fold(away) and s not in fold(home) else "?"
            if code != exp:
                bad.append(("1x2", r["match"], name, sname, code, exp))
        if not isinstance(odds, (int, float)) or odds <= 1:
            bad.append(("odds", r["match"], name, sname, odds))
print(f"rows={len(rows)} checks={checked} bad={len(bad)}")
for b in bad: print("  BAD", b)
