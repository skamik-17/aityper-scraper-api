# Automated side/line/selection checks over the SIDE_ROW lines that side-probe.mts prints.
# Usage: python3 -I side-check.py <side-probe.out>
# Checks, per row:
#   side     a HOME_/AWAY_ code or a HOME:/AWAY: param must carry a "- <team>" label suffix that is
#            contained in that side's name and not in the other side's name
#   ou       "Powyżej x" -> OVER and "Poniżej x" -> UNDER, and x equals the param line
#   1x2      team / Remis / Nikt legs of MATCH_WINNER, OFFSIDES_1X2, FOUL_RACE, TACKLES_1X2,
#            MOST_SHOTS_ON_TARGET and FIRST_OFFSIDE map to HOME / AWAY / DRAW / NONE; exp "?" means
#            the leg's label is not a substring of exactly one team name (e.g. "Man Utd") and needs a
#            look by hand
#   penalty  "<team> strzeli ..." legs of the PENALTY_GOAL family map to TEAM_HOME / TEAM_AWAY (same
#            "?" rule), "Którakolwiek/Którykolwiek ..." to ANY and "Żaden ..." to NONE
#   repeat   no side code (HOME, AWAY, TEAM_HOME, TEAM_AWAY) occurs on more than one leg of a market;
#            a derby whose team names share a word must show distinct sides or stay OTHER
#   rawodds  the normalizer's own output ("own") keeps each raw leg's name and price in raw order,
#            so the stored index join puts every code on the price of the leg it was resolved from;
#            rows from an older probe without "raw"/"own" are skipped
#   odds     every price is a number above 1
# Prints "rows=N checks=N bad=N", then one "  BAD (...)" line per failed check.
import json, re, sys, unicodedata
rows = [json.loads(l[9:]) for l in open(sys.argv[1], encoding="utf-8") if l.startswith("SIDE_ROW ")]
def fold(s): return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace("\u00a0", " ").strip()
def team_side(s, home, away, h, a):
    # h/a: the codes for a leg naming only the home / only the away team
    return h if s and s in fold(home) and s not in fold(away) else a if s and s in fold(away) and s not in fold(home) else "?"
ONE_X_TWO = ("MATCH_WINNER", "OFFSIDES_1X2", "FOUL_RACE", "TACKLES_1X2", "MOST_SHOTS_ON_TARGET", "FIRST_OFFSIDE")
PENALTY = ("PENALTY_GOAL", "HALF_TIME_PENALTY_GOAL", "SECOND_HALF_PENALTY_GOAL")
SIDE_CODES = ("HOME", "AWAY", "TEAM_HOME", "TEAM_AWAY")
bad, checked = [], 0
for r in rows:
    home, away = r["match"].split(" vs ")
    t, name, param = r["type"], r["name"], r["param"]
    m = re.search(r"-\s*([^()]+?)\s*(\(|$)", name.replace("\u00a0", " "))
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
    sides = [code for _, code, _ in r["sels"] if code in SIDE_CODES]
    checked += 1
    if len(set(sides)) != len(sides):
        bad.append(("repeat", r["match"], name, t, [code for _, code, _ in r["sels"]]))
    if "raw" in r and "own" in r:
        checked += 1
        own = [(label, odds) for label, _, odds in r["own"]]
        raw = [tuple(x) for x in r["raw"]]
        if len(own) == len(raw) and own != raw:
            bad.append(("rawodds", r["match"], name, t, own, raw))
        elif len(own) != len(raw) and any(leg not in raw for leg in own if leg[0] in {n for n, _ in raw}):
            bad.append(("rawodds", r["match"], name, t, own, raw))
    line = re.sub(r"^(HOME|AWAY):", "", param)
    for sname, code, odds in r["sels"]:
        sm = re.match(r"^(Powyżej|Poniżej) (\d+(?:,\d+)?)$", sname.strip())
        if sm:
            checked += 1
            exp = "OVER" if sm[1] == "Powyżej" else "UNDER"
            if code != exp or sm[2].replace(",", ".") != line:
                bad.append(("ou", r["match"], name, sname, code, param))
        elif t in ONE_X_TWO:
            checked += 1
            s = fold(sname)
            exp = "DRAW" if s.startswith("remis") else "NONE" if s.startswith("nikt") or s.startswith("brak") else team_side(s, home, away, "HOME", "AWAY")
            if code != exp:
                bad.append(("1x2", r["match"], name, sname, code, exp))
        elif t in PENALTY:
            checked += 1
            s = fold(sname)
            pm = re.match(r"^(.+?) strzeli", s)
            exp = "ANY" if s.startswith(("ktorakolwiek", "ktorykolwiek")) else "NONE" if s.startswith(("zaden", "zadna", "brak")) else team_side(pm[1].strip() if pm else "", home, away, "TEAM_HOME", "TEAM_AWAY")
            if code != exp:
                bad.append(("penalty", r["match"], name, sname, code, exp))
        if not isinstance(odds, (int, float)) or odds <= 1:
            bad.append(("odds", r["match"], name, sname, odds))
print(f"rows={len(rows)} checks={checked} bad={len(bad)}")
for b in bad: print("  BAD", b)
