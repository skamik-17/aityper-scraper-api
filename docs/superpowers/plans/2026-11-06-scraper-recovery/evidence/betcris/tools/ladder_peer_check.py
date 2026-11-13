"""A4 ladder peer check: betcris team-ladder OVER prices against the peer median.

Usage: python3 -I ladder_peer_check.py nm.json
  nm.json = GET /api/matches/<Home>/<Away>/normalized-markets?league=premier-league

Every betcris OVER price on a line that at least 2 peers also quote is compared
with the peer median on that line (deviation in %):
- side-less totals (FOULS_TOTAL, OFFSIDES_TOTAL, ...): the same line;
- side-scoped team ladders (HOME_/AWAY_TEAM_TOTAL_FOULS, _OFFSIDES, _THROW_INS,
  and TEAM_TOTAL_SHOTS[_ON_TARGET] "HOME:<line>" / "AWAY:<line>"): the same
  side, and also the opposite side at the same line.
One line is printed per label (code, plus the side for the scoped codes).

SWAP_SUSPECT lists the side-scoped labels that fit the peers' opposite side
better than their own side (by more than 5 points of median deviation): a
possible Team1/Team2 swap.
LADDER_PEER_CHECK FAIL lists the labels whose median deviation is beyond +-15%,
with one line beyond +-25%, or that are a SWAP_SUSPECT. Exit code 1 on FAIL.
A FAIL caused only by a SWAP_SUSPECT label may be cleared by hand when the same
side's other family fits its own side (TEAM_TOTAL_SHOTS against
TEAM_TOTAL_SHOTS_ON_TARGET; FOULS against OFFSIDES or THROW_INS); record both
lines' numbers.
"""
import json
import statistics
import sys

SIDELESS = ["FOULS_TOTAL", "TOTAL_SHOTS_ON_TARGET", "THROW_INS_TOTAL", "OFFSIDES_TOTAL",
            "HALF_TIME_TOTAL_SHOTS_ON_TARGET"]
# Side in the code: the opposite side is the paired code at the same line.
PAIRS = {"HOME_TEAM_TOTAL_FOULS": "AWAY_TEAM_TOTAL_FOULS",
         "HOME_TEAM_TOTAL_OFFSIDES": "AWAY_TEAM_TOTAL_OFFSIDES",
         "HOME_TEAM_TOTAL_THROW_INS": "AWAY_TEAM_TOTAL_THROW_INS"}
PAIRS.update({v: k for k, v in list(PAIRS.items())})
# Side in the param: "HOME:<line>" / "AWAY:<line>".
SCOPED = ["TEAM_TOTAL_SHOTS", "TEAM_TOTAL_SHOTS_ON_TARGET"]
OTHER_SIDE = {"HOME": "AWAY", "AWAY": "HOME"}

MEDIAN_LIMIT = 15.0  # % per label
LINE_LIMIT = 25.0  # % per line
SWAP_MARGIN = 5.0  # points of |median deviation|


def over_prices(nm):
    """(marketKey, param) -> {bookmaker: OVER odds}"""
    over = {}
    for cat in nm["data"]["categories"]:
        for m in cat["markets"]:
            for p in m["parameters"]:
                for b in p["bookmakers"]:
                    o = [s["odds"] for s in b["selections"] if s["type"] == "OVER"]
                    if o:
                        over.setdefault((m["marketKey"], p["value"]), {})[b["bookmaker"]] = o[0]
    return over


def opposite(key, param):
    if key in PAIRS:
        return PAIRS[key], param
    if key in SCOPED:
        side, _, line = param.partition(":")
        return key, OTHER_SIDE.get(side, side) + ":" + line
    return None


def label_of(key, param):
    if key in SCOPED:
        return key + " " + param.partition(":")[0]
    return key


def peers(books):
    return [v for b, v in books.items() if b != "betcris"]


def check(nm):
    over = over_prices(nm)
    groups = {}  # label -> (own-side devs, opposite-side devs)
    for (key, param), books in over.items():
        if key not in SIDELESS + list(PAIRS) + SCOPED or "betcris" not in books or len(peers(books)) < 2:
            continue
        own, opp = groups.setdefault(label_of(key, param), ([], []))
        own.append(100 * (books["betcris"] / statistics.median(peers(books)) - 1))
        flip = opposite(key, param)
        if flip and len(peers(over.get(flip, {}))) >= 2:
            opp.append(100 * (books["betcris"] / statistics.median(peers(over[flip])) - 1))

    lines, bad, suspects = [], [], []
    for label, (own, opp) in sorted(groups.items()):
        med, worst = statistics.median(own), max(own, key=abs)
        text = f"{label} lines {len(own)} median dev {med:.1f}% worst {worst:.1f}%"
        if opp:
            omed = statistics.median(opp)
            text += f" | vs opposite side: lines {len(opp)} median dev {omed:.1f}%"
            if abs(omed) + SWAP_MARGIN < abs(med):
                suspects.append(label)
        lines.append(text)
        if abs(med) > MEDIAN_LIMIT or abs(worst) > LINE_LIMIT:
            bad.append(label)
    return lines, bad, suspects


def main():
    lines, bad, suspects = check(json.load(open(sys.argv[1])))
    for text in lines:
        print(text)
    failed = sorted(set(bad) | set(suspects))
    print("SWAP_SUSPECT", suspects)
    print("LADDER_PEER_CHECK", "FAIL" if failed else "PASS", failed)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
