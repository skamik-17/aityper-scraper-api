# LVBet Task 3 live acceptance checks over normalized-markets dumps (GET /api/matches/<H>/<A>/normalized-markets).
# Covers what lvbet_ac.py does not: RESULT_OR_TOTAL in every match, HALF_TIME_TOTAL_GOALS line 2, and
# TWO_PLAYERS_COMBINED_GOALS pair codes pooling with betclic's.
# usage: python3 -I lvbet_t3_ac.py [--ht2-ref <cleaned pre-deploy log>] nm-*.json
#   rot    RESULT_OR_TOTAL: LVBet present at >= 1 line; every LVBet leg is one of HOME_/DRAW_/AWAY_ x OVER/UNDER
#   ht     HALF_TIME_TOTAL_GOALS "1" and "2": where LVBet is present, its legs are exactly OVER/UNDER (no 3-way leak)
#   ht2    with --ht2-ref: LVBet present at HALF_TIME_TOTAL_GOALS "2" in every dump whose match has a
#          "for lvbet HALF_TIME_TOTAL_GOALS:2.0 (<matchId>)" collision line in the reference log, i.e. the matches
#          that offer that line (7/20 on 2026-11-06). The reference must be a log of the pre-deploy code on the same
#          fixtures: after Task 3 that collision line is gone. Dumps are matched by the file name nm-<slug>.json,
#          slug = matchId without the league, ":" -> "_", " " -> "-" (the plan's fetch loop).
#   pairs  TWO_PLAYERS_COMBINED_GOALS 1.5 / 2.5 / 3.5, where both LVBet and betclic quote the line:
#          no LVBet-only code is a name variant of a betclic-only code (same other members, one member whose
#          surname is a prefix of the other's, e.g. "G. Mag & V. Gyokeres" vs "G. Magalhaes & V. Gyokeres"),
#          and >= 90 % of LVBet codes are string-equal to a betclic code (Ars-Hul 2026-11-06: 100/99/100 %).
# Prints one line per file, then a summary line. Exit 0 = PASS, 1 = any FAIL, 2 = no FAIL but the pair check
# ran in no dump (PENDING: rerun on a matchweek where both bookmakers quote the pairs).
import json, os, re, sys, unicodedata

BM, PEER = "lvbet", "betclic"
ROT_LEGS = {f"{s}_{t}" for s in ("HOME", "DRAW", "AWAY") for t in ("OVER", "UNDER")}
PAIR_LINES = ("1.5", "2.5", "3.5")


def fold(s):
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().lower()


def is_variant(x, y):
    """Two "I. Surname" members that are spellings of one player (feed truncation, diacritics)."""
    if x == y:
        return False
    fx, fy = fold(x), fold(y)
    if fx == fy:
        return True
    mx, my = re.fullmatch(r"(\w)\.\s*(.+)", fx), re.fullmatch(r"(\w)\.\s*(.+)", fy)
    if not (mx and my) or mx.group(1) != my.group(1):
        return False
    sx, sy = mx.group(2), my.group(2)
    return min(len(sx), len(sy)) >= 3 and (sx.startswith(sy) or sy.startswith(sx))


def suspects(lv_only, bc_only):
    out = []
    for a in lv_only:
        ma = a.split(" & ")
        for b in bc_only:
            mb = b.split(" & ")
            if len(ma) != len(mb):
                continue
            ra, rb = [m for m in ma if m not in mb], [m for m in mb if m not in ma]
            if len(ra) == 1 and len(rb) == 1 and is_variant(ra[0], rb[0]):
                out.append(f"{a}~{b}")
    return out


def slug(match_id):
    return match_id.split(":", 1)[1].replace(":", "_").replace(" ", "-")


def ht2_ref(path):
    pat = re.compile(r"for lvbet HALF_TIME_TOTAL_GOALS:2\.0 \(([^)]+)\)")
    return {slug(m.group(1)) for line in open(path, encoding="utf-8") for m in [pat.search(line)] if m}


def check(path, ref):
    markets = {m["type"]: m for c in json.load(open(path))["data"]["categories"] for m in c["markets"]}
    params = lambda code: {p["value"]: p["bookmakers"] for p in markets.get(code, {"parameters": []})["parameters"]}
    pick = lambda bms, bm: next((b for b in bms if b["bookmaker"] == bm), None)
    fails, notes, pairs_ran = [], [], False

    rot = {line: pick(bms, BM) for line, bms in params("RESULT_OR_TOTAL").items()}
    rot = {line: b for line, b in rot.items() if b}
    if not rot:
        fails.append("rot:missing")
    for line, b in sorted(rot.items()):
        legs = [s["type"] for s in b["selections"]]
        bad = sorted({l for l in legs if l not in ROT_LEGS}) + (["dup"] if len(set(legs)) != len(legs) else [])
        if bad:
            fails.append(f"rot{line}:legs={bad}")
    notes.append("rot=" + ",".join(f"{line}x{len(b['selections'])}" for line, b in sorted(rot.items(), key=lambda kv: float(kv[0]))))

    ht = params("HALF_TIME_TOTAL_GOALS")
    for line in ("1", "2"):
        b = pick(ht.get(line, []), BM)
        if b and sorted(s["type"] for s in b["selections"]) != ["OVER", "UNDER"]:
            fails.append(f"ht{line}:legs={sorted(s['type'] for s in b['selections'])}")
        notes.append(f"ht{line}={'present' if b else 'absent'}")
    name = os.path.basename(path)
    if ref is not None and re.sub(r"^nm-|\.json$", "", name) in ref and not pick(ht.get("2", []), BM):
        fails.append("ht2:missing")

    tp = params("TWO_PLAYERS_COMBINED_GOALS")
    for line in PAIR_LINES:
        lv, bc = pick(tp.get(line, []), BM), pick(tp.get(line, []), PEER)
        if not lv or not bc:
            notes.append(f"pairs{line}:n/a({'no ' + BM if not lv else 'no ' + PEER})")
            continue
        pairs_ran = True
        L, B = {s["type"] for s in lv["selections"]}, {s["type"] for s in bc["selections"]}
        sus = suspects(sorted(L - B), sorted(B - L))
        share = 100 * len(L & B) / len(L)
        notes.append(f"pairs{line}:{len(L & B)}/{len(L)}={share:.0f}% lvbet_only={sorted(L - B)}")
        if sus:
            fails.append(f"pairs{line}:variants={sus}")
        if share < 90:
            fails.append(f"pairs{line}:shared={share:.0f}%")

    print(name, "PASS" if not fails else "FAIL " + " ".join(fails), "|", " ".join(notes))
    return not fails, pairs_ran


args, ref = sys.argv[1:], None
if "--ht2-ref" in args:
    i = args.index("--ht2-ref")
    ref = ht2_ref(args[i + 1])
    del args[i:i + 2]
    print(f"ht2 reference: {len(ref)} matches {sorted(ref)}")
results = [check(p, ref) for p in args]
ok, ran = all(r[0] for r in results), sum(1 for r in results if r[1])
print(f"SUMMARY files={len(results)} fail={sum(1 for r in results if not r[0])} pairs_checked={ran}"
      + ("" if ref is not None else " ht2=unchecked(no --ht2-ref)"))
sys.exit(1 if not ok else (2 if ran == 0 else 0))
