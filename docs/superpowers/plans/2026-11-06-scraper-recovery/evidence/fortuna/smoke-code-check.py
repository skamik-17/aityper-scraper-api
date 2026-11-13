#!/usr/bin/env python3
"""Acceptance-code check for one Fortuna smoke run (fortuna.md criteria 1 and 2).

Usage, from the repo root (stdlib only; run it with -I):
  python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/fortuna/smoke-code-check.py \
      <capture.json> <smoke.txt>

  <capture.json>  the raw matches the run normalized: the --dump file of a live run
                  (criterion 2), or the capture a --from run re-normalized (criterion 1)
  <smoke.txt>     a file holding that run's SMOKE_RESULT line

The counts written in fortuna.md ("20 each", ">= 9", ">= 8") were measured on the
2026-11-06 offer. The prematch list changes as matches kick off and new rounds open,
so every threshold here comes from the capture itself:
  M        matches in the capture
  F        perMatch entries with raw > 500 (full-offer matches)
  P(code)  matches that carry at least one raw market which the planned id map
           (fortuna.md Tasks 1-5 plus the preflight rulings) turns into <code>

Gates:
  exact   requiredCodeMatchCounts[code] == P(code), for each of the 25 acceptance codes
  floor   the 10 all-match codes == M; the 13 full-offer codes >= F - 1;
          FIRST_CORNER >= P(FIRST_CORNER) - 1; SECOND_HALF_CORNERS_RACE == 0
          (a negative floor is clamped to 0)
  share   otherMarketShare <= 0.305 (unscaled, as in criterion 1)
  warn    warnPatternCount == 0
  run     success, matches == M, and perMatch lines up with the capture (names, raw)

Verdict (printed as SMOKE_CHECK, also the exit code):
  PASS         exit 0: every gate holds
  FAIL         exit 1: an exact, share, warn or run gate failed. Stop and inspect.
  OFFER_SHIFT  exit 2: every count equals its presence, but the offer itself misses a
               floor or carries none of a code's ids. The code matches the offer; the run
               is not evidence for the codes listed under "shift". Record them.

P(code) follows the normalizer's id map plus the Task 1 corners guard, the half-scope
reroute and the preflight WINNING_MARGIN ruling, not its name routers. A count above or below
P(code) therefore means either a normalizer bug or an offer shape this script does not
model (for example a 1X2 label naming the wrong team, which the normalizer flips).
Either way: inspect it with a --from run on the same capture.
"""
import json
import re
import sys

MAX_OTHER_SHARE = 0.305
FULL_OFFER_MIN_RAW = 500  # short-offer matches carry ~110 raw markets, full ones ~1200

ALL_MATCH = [
    "HALF_TIME_RESULT", "HALF_TIME_BTTS", "HOME_WIN_TO_NIL", "AWAY_WIN_TO_NIL",
    "WINNING_MARGIN", "HOME_WIN_BOTH_HALVES", "HOME_SCORE_BOTH_HALVES",
    "AWAY_SCORE_BOTH_HALVES", "HOME_WIN_AT_LEAST_ONE_HALF", "AWAY_WIN_AT_LEAST_ONE_HALF",
]
FULL_OFFER = [
    "HALF_TIME_CORNERS_RACE", "PENALTY_AWARDED", "RED_CARD_AND_PENALTY", "OWN_GOAL",
    "HEADER_GOAL", "ASSISTS_TOTAL", "HOME_EXACT_GOALS", "AWAY_EXACT_GOALS",
    "RED_CARD_TEAM", "HALF_TIME_RED_CARD_TEAM", "HALF_TIME_RED_CARD",
    "SECOND_HALF_EXACT_GOALS", "ODD_EVEN_GOALS",
]
FIRST_CORNER = "FIRST_CORNER"
SECOND_HALF_RACE = "SECOND_HALF_CORNERS_RACE"
CODES = ALL_MATCH + FULL_OFFER + [FIRST_CORNER, SECOND_HALF_RACE]

# Plain id -> code entries the plan adds (Task 3 fortuna.md:524, Task 4 :582, Task 5 :643)
# plus the existing ones for the same codes (fortuna-normalizer.ts id map, constants.ts).
ID_TO_CODE = {
    "00-9a": "PENALTY_AWARDED", "00-bt": "RED_CARD_AND_PENALTY", "00-bv": "OWN_GOAL",
    "00-k7": "HEADER_GOAL", "00-k6": "ASSISTS_TOTAL",
    "00-2n": "HALF_TIME_BTTS", "00-1d": "HALF_TIME_BTTS",
    "00-1h": "HOME_WIN_TO_NIL", "00-1i": "AWAY_WIN_TO_NIL",
    "00-1o": "HOME_WIN_BOTH_HALVES", "00-1p": "AWAY_WIN_BOTH_HALVES",
    "00-2b": "HOME_SCORE_BOTH_HALVES", "00-2c": "AWAY_SCORE_BOTH_HALVES",
    "00-1r": "HOME_WIN_AT_LEAST_ONE_HALF", "00-1s": "AWAY_WIN_AT_LEAST_ONE_HALF",
    "00-07": "RED_CARD_TEAM", "00-08": "RED_CARD_TEAM",
    "00-0c": "HALF_TIME_RED_CARD_TEAM", "00-0d": "HALF_TIME_RED_CARD_TEAM",
    "00-0a": "HALF_TIME_RED_CARD", "00-0f": "FIRST_CORNER", "00-19": "ODD_EVEN_GOALS",
    "00-09": "WINNING_MARGIN",
    "00-16": "HOME_EXACT_GOALS", "00-17": "AWAY_EXACT_GOALS", "00-3e": "SECOND_HALF_EXACT_GOALS",
}
# Ids whose code the Task 1 corners guard can turn into a corners race, with the
# scope an unscoped corners name keeps (fortuna-normalizer.ts FORTUNA_CORNERS_RACE_BY_CODE).
RACE_GUARD_ID_SCOPE = {
    "00-00": "FT", "00-60": "FT", "00-2x": "FT",  # MATCH_WINNER
    "00-02": "H1", "00-2d": "H1",                 # HALF_TIME_RESULT
    "00-2w": "H2",                                 # SECOND_HALF_RESULT
    "00-0e": "FT", "00-0p": "FT",                  # CORNERS_RACE
}
HALF_TIME_RESULT_IDS = {"00-02", "00-2d"}
MATCH_WINNER_IDS = {"00-00", "00-60", "00-2x"}

CORNERS_RE = re.compile(r"rzut(?:[oó]w)?\s+ro[żz]nych", re.I)
SCOPE_RE = re.compile(r"^\s*(?:(mecz)|([12])\s*\.?\s*po[lł]owa)\s*:\s*", re.I)
HANDICAP_RE = re.compile(r"handicap|\d+\s*:\s*\d+", re.I)
FIRST_GOAL_RE = re.compile(r"^1\s*\.\s*gol\b", re.I)
MARGIN_LEG_RE = re.compile(r"^(.+?)\s*/\s*o\s+(\d+)\s+gol", re.I)


def plain_id(market):
    bid = str(market.get("bookmakerMarketId") or "")
    return bid[len("ufo:mtyp:"):] if bid.startswith("ufo:mtyp:") else None


def market_code(market):
    """The acceptance code the planned normalizer gives this raw market, or None."""
    mid = plain_id(market)
    name = str(market.get("name") or "").strip()
    scope_match = SCOPE_RE.match(name)
    scope = None
    if scope_match:
        scope = "FT" if scope_match.group(1) else ("H1" if scope_match.group(2) == "1" else "H2")
    unscoped = name[scope_match.end():] if scope_match else name
    if mid in RACE_GUARD_ID_SCOPE and CORNERS_RE.search(name):
        # Task 1: a corners name under a 1X2-family or race id is a corners race; a
        # handicap-style one is dropped; an explicit prefix sets the scope, otherwise
        # the race keeps the scope of its id's code.
        if HANDICAP_RE.search(unscoped):
            return None
        return {"H1": "HALF_TIME_CORNERS_RACE", "H2": SECOND_HALF_RACE}.get(scope or RACE_GUARD_ID_SCOPE[mid])
    if mid in HALF_TIME_RESULT_IDS or mid in MATCH_WINNER_IDS:
        # "1.połowa: 1. gol" is a first-goal market, never a 1X2
        if scope in ("H1", "H2") and FIRST_GOAL_RE.match(unscoped):
            return None
        if mid in HALF_TIME_RESULT_IDS:
            return "HALF_TIME_RESULT"
        # the half reroute: a "1.połowa:" 1X2 name under a MATCH_WINNER id
        return "HALF_TIME_RESULT" if scope == "H1" and not HANDICAP_RE.search(unscoped) else None
    code = ID_TO_CODE.get(mid)
    if code == "WINNING_MARGIN":
        # Preflight ruling T4: a book that lists "o 4 gole" or more is dropped,
        # because "o 3 gole" would no longer mean "3 or more".
        for sel in market.get("selections") or []:
            leg = MARGIN_LEG_RE.match(str(sel.get("name") or "").strip())
            if leg and int(leg.group(2)) >= 4:
                return None
    return code


def load_smoke(path):
    with open(path, encoding="utf-8") as fh:
        lines = [ln for ln in fh if ln.startswith("SMOKE_RESULT ")]
    if len(lines) != 1:
        sys.exit(f"{path}: expected exactly one SMOKE_RESULT line, found {len(lines)}")
    return json.loads(lines[0].split(" ", 1)[1])


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as fh:
        capture = json.load(fh)
    smoke = load_smoke(sys.argv[2])
    matches = capture.get("matches") or []
    per_match = smoke.get("perMatch") or []
    problems = []

    # run gate: the smoke result must describe exactly this capture
    if not smoke.get("success"):
        problems.append("run: success is false")
    if smoke.get("matches") != len(matches) or len(per_match) != len(matches):
        problems.append(f"run: smoke matches {smoke.get('matches')} / perMatch {len(per_match)} != capture {len(matches)}")
    else:
        for m, row in zip(matches, per_match):
            label = f"{m.get('homeTeam')} vs {m.get('awayTeam')}"
            if row.get("match") != label or row.get("raw") != len(m.get("markets") or []):
                problems.append(f"run: perMatch {row.get('match')!r} raw {row.get('raw')} != capture {label!r} raw {len(m.get('markets') or [])}")
                break
    counts = smoke.get("requiredCodeMatchCounts") or {}
    if sorted(counts) != sorted(CODES):
        problems.append(f"run: requiredCodeMatchCounts codes differ from the acceptance CODES list: {sorted(set(counts) ^ set(CODES))}")

    # warn and share gates
    if smoke.get("warnPatternCount") != 0:
        problems.append(f"warn: warnPatternCount {smoke.get('warnPatternCount')} (want 0)")
    share = smoke.get("otherMarketShare")
    if share is None or share > MAX_OTHER_SHARE:
        problems.append(f"share: otherMarketShare {share} > {MAX_OTHER_SHARE}")

    # presence per code, from the capture
    presence = {c: 0 for c in CODES}
    for m in matches:
        carried = {market_code(x) for x in m.get("markets") or []}
        for c in CODES:
            if c in carried:
                presence[c] += 1
    total = len(matches)
    full = sum(1 for row in per_match if (row.get("raw") or 0) > FULL_OFFER_MIN_RAW)
    full_floor = max(full - 1, 0)
    first_corner_floor = max(presence[FIRST_CORNER] - 1, 0)

    rows = {}
    shift = []
    for c in CODES:
        if c in ALL_MATCH:
            group, floor = "all-match", f"=={total}"
            floor_ok = counts.get(c) == total
        elif c in FULL_OFFER:
            group, floor = "full-offer", f">={full_floor}"
            floor_ok = (counts.get(c) or 0) >= full_floor
        elif c == FIRST_CORNER:
            group, floor = "first-corner", f">={first_corner_floor}"
            floor_ok = (counts.get(c) or 0) >= first_corner_floor
        else:
            group, floor = "not-offered", "==0"
            floor_ok = counts.get(c) == 0
        exact = counts.get(c) == presence[c]
        rows[c] = {"group": group, "count": counts.get(c), "presence": presence[c], "floor": floor,
                   "exact": exact, "floorOk": floor_ok}
        if not exact:
            problems.append(f"exact: {c} count {counts.get(c)} != presence {presence[c]}")
        elif not floor_ok:
            shift.append(f"{c}: floor {floor} not met, offer presence {presence[c]}")
        elif presence[c] == 0 and c != SECOND_HALF_RACE:
            shift.append(f"{c}: not exercised, no match carries its ids")

    verdict = "FAIL" if problems else ("OFFER_SHIFT" if shift else "PASS")
    print(f"capture {sys.argv[1]} capturedAt {capture.get('capturedAt')} source {smoke.get('source')}")
    print(f"M={total} F={full} P(FIRST_CORNER)={presence[FIRST_CORNER]} otherMarketShare={share} warnPatternCount={smoke.get('warnPatternCount')}")
    for c in CODES:
        r = rows[c]
        print(f"  {c:<28} {r['group']:<12} count={r['count']!s:<3} presence={r['presence']:<3} floor{r['floor']:<5} "
              f"exact={'ok' if r['exact'] else 'NO'} floor={'ok' if r['floorOk'] else 'NO'}")
    for p in problems:
        print("PROBLEM " + p)
    for s in shift:
        print("SHIFT " + s)
    print("SMOKE_CHECK " + json.dumps({
        "verdict": verdict, "matches": total, "fullOffer": full, "firstCornerPresence": presence[FIRST_CORNER],
        "otherMarketShare": share, "warnPatternCount": smoke.get("warnPatternCount"),
        "thresholds": {"allMatch": f"=={total}", "fullOffer": f">={full_floor}",
                       "FIRST_CORNER": f">={first_corner_floor}", "SECOND_HALF_CORNERS_RACE": "==0",
                       "otherMarketShare": f"<={MAX_OTHER_SHARE}"},
        "presence": presence, "counts": counts, "problems": problems, "shift": shift,
    }, ensure_ascii=False))
    sys.exit({"PASS": 0, "FAIL": 1, "OFFER_SHIFT": 2}[verdict])


if __name__ == "__main__":
    main()
