#!/usr/bin/env python3
"""Fortuna live API checks for the 2026-11-06 recovery plan (read-only, local API only).

Usage (from anywhere):
  python3 -I api-checks.py [--base http://localhost:3001] [--league premier-league] [--from-dir DIR]
                           [--mononym Murillo]

--from-dir DIR reads saved normalized-markets files named nm_<Home>_<Away>.json (URL-quoted
names, '%' replaced by '_') instead of calling the API for them; /api/odds is always fetched
live unless DIR/odds.json exists.

Prints, per match where Fortuna has the full offer (>= 300 Fortuna (market, param) entries):
  - ht:    Fortuna HALF_TIME_RESULT rawMarketName, legs, max |dev| vs the peer median (%)
  - htc:   whether Fortuna is in HALF_TIME_CORNERS_RACE (and its max |dev|)
  - leak:  Fortuna PLAYER_*/GOALSCORER_* params containing a team token (>= 4 letters) of
           either team, e.g. "Youri United Tielemans"
  - labelLeak: Fortuna player params containing a whole Fortuna team label ("Atl. Madryt",
           "Real M.", "A Coruňa"); labels are read from Fortuna's own raw market names, so
           this does not depend on canonical team names
  - shared: tokens in leading or inner position (not last) shared by >= 3 distinct Fortuna
           player params of the match; 'team' when the token is a segment of a Fortuna label
           (a leak, e.g. "Madryt" in "Ademola Madryt Lookman"), 'name' otherwise (a shared
           given name such as "Lucas", listed for review). PLAYER_RED_CARD params and leading
           initials ("J." of the combo form "J. Schuster") are not counted.
  - base:  Fortuna PLAYER_*/GOALSCORER_* rows whose parameter is 'base', and baseCodes, the
           codes of every Fortuna row whose parameter is 'base'
  - codes: presence of the codes mapped by the plan
  - new:   Fortuna legs priced < 5.0 on the plan's new codes vs the peer median of the same
           (code, param) row; the worst one and how many exceed 10%
  - pool:  Fortuna PLAYER_SHOTS params that share a row with >= 1 other bookmaker, and the
           bookmakers on the --mononym row (default 'Murillo'), or ABSENT
  - mononym: the selection types per bookmaker on GOALSCORER_FIRST for --mononym, and the
           Fortuna single-token player params of the match (candidates for --mononym)
and a summary line with totals plus the 1X2 deviation stats over all 20 matches. The
summary's verdict is NOT RUN when no match has the full offer (every count is then 0
without anything having been checked), and PARTIAL when the --mononym row is absent.
"""
import json
import os
import re
import statistics
import sys
import unicodedata
import urllib.parse
import urllib.request

args = sys.argv[1:]


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


BASE = opt("--base", "http://localhost:3001")
LEAGUE = opt("--league", "premier-league")
FROM_DIR = opt("--from-dir")
MONONYM = opt("--mononym", "Murillo")
PARTICLES = {"de", "del", "della", "di", "da", "das", "dos", "du", "la", "le", "van", "von", "den",
             "der", "ten", "ter", "el", "al"}
PLAN_CODES = [
    "HALF_TIME_CORNERS_RACE", "PENALTY_AWARDED", "RED_CARD_AND_PENALTY", "OWN_GOAL", "HEADER_GOAL",
    "ASSISTS_TOTAL", "HALF_TIME_BTTS", "HOME_WIN_TO_NIL", "WINNING_MARGIN", "HOME_WIN_BOTH_HALVES",
    "HOME_SCORE_BOTH_HALVES", "HOME_WIN_AT_LEAST_ONE_HALF", "HOME_EXACT_GOALS", "RED_CARD_TEAM",
    "HALF_TIME_RED_CARD", "SECOND_HALF_EXACT_GOALS", "ODD_EVEN_GOALS",
]


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def nm_file(home, away):
    q = lambda s: urllib.parse.quote(s).replace("%", "_")
    return os.path.join(FROM_DIR, f"nm_{q(home)}_{q(away)}.json") if FROM_DIR else None


def load_nm(home, away):
    f = nm_file(home, away)
    if f and os.path.exists(f):
        return json.load(open(f))["data"]
    url = f"{BASE}/api/matches/{urllib.parse.quote(home)}/{urllib.parse.quote(away)}/normalized-markets?league={LEAGUE}"
    return get(url)["data"]


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if not unicodedata.combining(c))


def segments(label):
    # "Atl. Madryt" -> ["atl.", "madryt"], "Man.City" -> ["man.", "city"], "A Coruňa" -> ["a", "coruna"]
    return [seg for tok in fold(label).split() for seg in re.findall(r"[^.]+\.?", tok)]


def fortuna_labels(fort):
    """Fortuna's own team labels, read from its raw names: "Mecz: <label> - liczba ..." on typed
    team rows (player rows use the same shape with a player) and the "<label>\xa0<player>\xa0strzeli
    pierwszego/ostatniego gola w meczu" prefix on GOALSCORER_FIRST/LAST rows."""
    labels = set()
    for r in fort:
        for raw in r[3].split(" / "):
            m = re.match(r"^(?:Mecz|1\.połowa|2\.połowa):\xa0([^,\xa0]+?)\xa0(?:-\s|liczba\s)", raw)
            if m and not re.match(r"(PLAYER_|GOALSCORER_|OTHER)", r[0]):
                labels.add(m.group(1).strip())
            m = re.match(r"^([^\xa0]+)\xa0[^\xa0]+\xa0strzeli (?:pierwszego|ostatniego) gola w meczu", raw)
            if m and r[0] in ("GOALSCORER_FIRST", "GOALSCORER_LAST"):
                labels.add(m.group(1).strip())
    return labels


def max_dev(legs, peers):
    devs = []
    for code, odds in legs.items():
        vals = [p[code] for p in peers if code in p]
        if vals:
            med = statistics.median(vals)
            devs.append(abs(odds - med) / med * 100)
    return round(max(devs), 1) if devs else None


odds_path = os.path.join(FROM_DIR, "odds.json") if FROM_DIR else None
odds = json.load(open(odds_path)) if odds_path and os.path.exists(odds_path) else get(f"{BASE}/api/odds?league={LEAGUE}")
matches = odds["data"]["matches"]

# 1X2 deviation of Fortuna vs the median of the other bookmakers (all matches).
dev1x2, worst = [], (0, None)
for m in matches:
    bo = m["markets"].get("MATCH_WINNER", {}).get("bookmakerOdds", {})
    per = {b: {s["normalizedName"]: s["odds"] for s in v["selections"]} for b, v in bo.items()}
    if "fortuna" not in per:
        continue
    for code in ("HOME", "DRAW", "AWAY"):
        others = [per[b][code] for b in per if b != "fortuna" and code in per[b]]
        if not others or code not in per["fortuna"]:
            continue
        med = statistics.median(others)
        d = abs(per["fortuna"][code] - med) / med * 100
        dev1x2.append(d)
        if d > worst[0]:
            worst = (round(d, 1), f"{m['homeTeam']} vs {m['awayTeam']} {code} {per['fortuna'][code]} vs {med}")

NEW_CODES = set(PLAN_CODES) | {"AWAY_WIN_TO_NIL", "AWAY_WIN_BOTH_HALVES", "AWAY_SCORE_BOTH_HALVES",
                                "AWAY_WIN_AT_LEAST_ONE_HALF", "AWAY_EXACT_GOALS", "HALF_TIME_RED_CARD_TEAM",
                                "FIRST_CORNER", "SECOND_HALF_CORNERS_RACE"}
tot = {"full": 0, "htBad": 0, "htcMissing": 0, "leak": 0, "labelLeak": 0, "sharedTeamToken": 0,
       "sharedNameToken": 0, "base": 0, "noLabels": 0}
base_codes = set()
mononym_row = None
new_legs = []  # (dev%, match, code:param, leg, odds, median)
for m in matches:
    home, away = m["homeTeam"], m["awayTeam"]
    d = load_nm(home, away)
    rows = []  # (type, param, bookmaker, rawMarketName, {code: odds})
    for c in d["categories"]:
        for mk in c["markets"]:
            for p in mk["parameters"]:
                for b in p["bookmakers"]:
                    rows.append((mk["type"], p["value"], b["bookmaker"], b.get("rawMarketName") or "",
                                 {s["type"]: s["odds"] for s in b["selections"]}))
    fort = [r for r in rows if r[2] == "fortuna"]
    if len(fort) < 300:
        continue
    tot["full"] += 1

    def legs(code, bm):
        return [r[4] for r in rows if r[0] == code and r[2] == bm]

    ht = [r for r in fort if r[0] == "HALF_TIME_RESULT"]
    ht_peers = [r[4] for r in rows if r[0] == "HALF_TIME_RESULT" and r[2] != "fortuna"]
    ht_dev = max_dev(ht[0][4], ht_peers) if ht else None
    ht_ok = bool(ht) and ht[0][3].replace("\xa0", " ").strip() == "1.połowa" and ht_dev is not None and ht_dev <= 10
    tot["htBad"] += 0 if ht_ok else 1
    htc = [r for r in fort if r[0] == "HALF_TIME_CORNERS_RACE"]
    htc_dev = max_dev(htc[0][4], [r[4] for r in rows if r[0] == "HALF_TIME_CORNERS_RACE" and r[2] != "fortuna"]) if htc else None
    tot["htcMissing"] += 0 if htc else 1
    tokens = {t for t in re.split(r"[\s.]+", f"{home} {away}") if len(t) >= 4}
    leaks = [r for r in fort if re.match(r"(PLAYER_|GOALSCORER_)", r[0]) and r[1] != "base"
             and any(re.search(rf"\b{re.escape(t)}\b", str(r[1])) for t in tokens)]
    base = [r for r in fort if re.match(r"(PLAYER_|GOALSCORER_)", r[0]) and r[1] == "base"]
    codes_base = sorted({r[0] for r in fort if r[1] == "base"})
    base_codes.update(codes_base)
    tot["leak"] += len(leaks)
    tot["base"] += len(base)
    labels = fortuna_labels(fort)
    tot["noLabels"] += 0 if labels else 1
    label_segs = {s for lb in labels for s in segments(lb)}
    label_seqs = [" ".join(segments(lb)) for lb in labels]
    # PLAYER_RED_CARD params are the grouper's split of sentence selections ("X wyrzucony z boiska")
    player_params = sorted({str(r[1]) for r in fort if re.match(r"(PLAYER_|GOALSCORER_)", r[0])
                            and r[0] != "PLAYER_RED_CARD" and r[1] != "base"})
    label_leaks = [p for p in player_params if any(f" {q} " in f" {' '.join(fold(p).split())} " for q in label_seqs)]
    token_params = {}
    for p in player_params:
        for i, w in enumerate(fold(p).split()[:-1]):
            if w in PARTICLES and w not in label_segs:
                continue
            # The API serves goalscorer params in the combo form "I. Surname", so a leading
            # initial is a given name here; the offline replay (replay-player-keys.mts)
            # still counts initials such as the "M." of "Real M.".
            if i == 0 and re.fullmatch(r"\w\.", w):
                continue
            token_params.setdefault(w, set()).add(p)
    shared = {w: ps for w, ps in token_params.items() if len(ps) >= 3}
    shared_team = sorted(w for w in shared if w in label_segs)
    shared_name = sorted(w for w in shared if w not in label_segs)
    tot["labelLeak"] += len(label_leaks)
    tot["sharedTeamToken"] += len(shared_team)
    tot["sharedNameToken"] += len(shared_name)
    singles = [p for p in player_params if len(p.split()) == 1]
    present = [c for c in PLAN_CODES if any(r[0] == c for r in fort)]
    for r in fort:
        if r[0] not in NEW_CODES:
            continue
        peer_rows = [x[4] for x in rows if x[0] == r[0] and x[1] == r[1] and x[2] != "fortuna"]
        for leg, odds in r[4].items():
            vals = [p[leg] for p in peer_rows if leg in p]
            if odds < 5 and vals:
                med = statistics.median(vals)
                new_legs.append((round(abs(odds - med) / med * 100, 1), f"{home} vs {away}", f"{r[0]}:{r[1]}", leg, odds, med))
    shots = {}
    for r in rows:
        if r[0] == "PLAYER_SHOTS" and r[1] != "base":
            shots.setdefault(r[1], set()).add(r[2])
    f_shots = [p for p, bms in shots.items() if "fortuna" in bms]
    pooled = [p for p in f_shots if len(shots[p]) > 1]
    print(f"== {home} vs {away}: fortunaEntries={len(fort)}")
    print(f"   ht: raw={ht[0][3]!r} legs={ht[0][4]} maxDev={ht_dev}% ok={ht_ok}" if ht else "   ht: MISSING")
    print(f"   htc: fortuna={'yes' if htc else 'no'} maxDev={htc_dev}")
    print(f"   leak={len(leaks)} {[r[1] for r in leaks][:4]}  base={len(base)} {sorted({r[3].split(chr(160))[0] for r in base})[:3]}")
    print(f"   baseCodes={codes_base}")
    print(f"   labels={sorted(labels)} labelLeak={len(label_leaks)} {label_leaks[:4]}")
    print(f"   shared: team={[(w, sorted(shared[w])[:4]) for w in shared_team]} name={[(w, len(shared[w])) for w in shared_name]}")
    print(f"   codes={len(present)}/{len(PLAN_CODES)} missing={[c for c in PLAN_CODES if c not in present]}")
    print(f"   pool: PLAYER_SHOTS fortuna params shared with peers {len(pooled)}/{len(f_shots)}"
          + (f"; {MONONYM!r} row: {sorted(shots[MONONYM])}" if MONONYM in shots else f"; {MONONYM!r} row: ABSENT"))
    gs1 = {r[2]: sorted(r[4]) for r in rows if r[0] == "GOALSCORER_FIRST" and r[1] == MONONYM}
    print(f"   mononym: GOALSCORER_FIRST {MONONYM!r}: {gs1 or 'ABSENT'}; fortuna mononyms: {singles}")
    if MONONYM in shots and mononym_row is None:
        mononym_row = {"name": MONONYM, "match": f"{home} vs {away}", "playerShots": sorted(shots[MONONYM]),
                       "fortunaOnRow": "fortuna" in shots[MONONYM], "goalscorerFirst": gs1}

if tot["full"] == 0:
    verdict = "NOT RUN: no full-offer match (>= 300 Fortuna entries); criteria 3-4 are not checked"
elif mononym_row is None:
    verdict = (f"PARTIAL: criterion 4 NOT RUN, no PLAYER_SHOTS row for {MONONYM!r}; "
               "pick a name from the 'fortuna mononyms' lists and rerun with --mononym")
elif tot["noLabels"]:
    verdict = f"PARTIAL: {tot['noLabels']} full-offer match(es) without Fortuna labels, labelLeak/shared not checked there"
else:
    verdict = "CHECKED"
print("SUMMARY " + json.dumps({
    **tot,
    "baseCodes": sorted(base_codes),
    "mononym": mononym_row,
    "verdict": verdict,
    "newLegsUnder5": {"n": len(new_legs), "over10Pct": sum(1 for x in new_legs if x[0] > 10),
                      "worst": max(new_legs) if new_legs else None},
    "oneXTwo": {"n": len(dev1x2), "meanDevPct": round(statistics.mean(dev1x2), 1) if dev1x2 else None,
                "maxDevPct": worst[0], "worst": worst[1]},
}, ensure_ascii=False))
