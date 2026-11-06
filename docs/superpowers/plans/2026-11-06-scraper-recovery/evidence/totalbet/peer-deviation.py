#!/usr/bin/env python3
"""Acceptance helper: compare one bookmaker's normalized markets against peer medians.

Input is the JSON body of
  GET /api/matches/<Home>/<Away>/normalized-markets?league=<slug>
Usage:
  python3 -I peer-deviation.py <normalized-markets.json> <bookmaker> [--max-odds 5.0] [--min-peers 3] [--threshold 12]
      [--codes MATCH_WINNER,DOUBLE_CHANCE,...]   (restrict to these market codes; default: all)
Prints a single summary line starting with "PEER-CHECK" plus every selection over the threshold.
Exit code 0 when no compared selection exceeds the threshold, 1 otherwise, 2 when the bookmaker is absent.
"""
import json
import statistics
import sys


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        return 2
    path, target = args[0], args[1]
    opts = {"--max-odds": 5.0, "--min-peers": 3, "--threshold": 12.0, "--codes": ""}
    for i, a in enumerate(args):
        if a in opts:
            opts[a] = type(opts[a])(args[i + 1])
    data = json.load(open(path))["data"]

    ours, peers = {}, {}
    for cat in data["categories"]:
        for m in cat["markets"]:
            for p in m["parameters"]:
                key = m["type"] + (f":{p['value']}" if p["value"] not in ("", None, "base") else "")
                for b in p["bookmakers"]:
                    for s in b["selections"]:
                        if b["bookmaker"] == target:
                            ours.setdefault(key, {})[s["type"]] = s["odds"]
                        else:
                            peers.setdefault(key, {}).setdefault(s["type"], []).append(s["odds"])
    if not ours:
        print(f"PEER-CHECK bookmaker={target} absent from response")
        return 2

    compared, over = 0, []
    worst = (0.0, "", "", 0.0, 0.0)
    codes = {c for c in opts["--codes"].split(",") if c}
    if codes:
        ours = {k: v for k, v in ours.items() if k.split(":")[0] in codes}
    for key, sels in ours.items():
        for sel, odds in sels.items():
            vals = peers.get(key, {}).get(sel, [])
            if odds > opts["--max-odds"] or len(vals) < opts["--min-peers"]:
                continue
            med = statistics.median(vals)
            dev = abs(odds - med) / med * 100
            compared += 1
            if dev > worst[0]:
                worst = (round(dev, 1), key, sel, odds, med)
            if dev > opts["--threshold"]:
                over.append((round(dev, 1), key, sel, odds, med))
    unknown = sum(1 for v in ours.values() for sel in v if sel == "UNKNOWN")
    total_sels = sum(len(v) for v in ours.values())
    print(
        f"PEER-CHECK bookmaker={target} marketKeys={len(ours)} selections={total_sels} "
        f"unknown={unknown} compared={compared} maxDevPct={worst[0]} worst={worst[1:]} over={len(over)}"
    )
    for row in sorted(over, reverse=True):
        print("  OVER", row)
    return 1 if over else 0


if __name__ == "__main__":
    sys.exit(main())
