"""Per-run STS checks on an ANSI-stripped service log, from a given line onward (read-only).
Usage: python3 -I sts-run-check.py <cleaned-log> <start-line>
<start-line> = `wc -l < <cleaned-log>` recorded just before the live checkout switched to the fix.
Prints one RUN_CHECK JSON line; exit 0 when every completed STS run after <start-line> passes."""
import json, re, sys
log, start = sys.argv[1], int(sys.argv[2])
runs, cur = [], None
for no, line in enumerate(open(log, encoding="utf-8", errors="replace"), 1):
    if no <= start:
        continue
    line = line.rstrip("\n")
    if m := re.match(r"^\[STS/FullOffer\] Found (\d+) fixtures for premier-league$", line):
        cur = {"line": no, "found": int(m[1]), "counts": {}, "noSnapshot": 0, "nonPlSkips": 0, "completed": None}
        runs.append(cur)
    elif cur is None:
        continue
    elif m := re.match(r"^\[STS/FullOffer\] Completed: (\d+) matches", line):
        cur["completed"] = int(m[1])
    elif re.match(r"^\[STS/FullOffer\] No fixture snapshot for .* skipping", line):
        cur["noSnapshot"] += 1
    elif re.match(r"^\[STS/FullOffer\] Skipping .*(whitelist|Youth team match)", line):
        cur["nonPlSkips"] += 1
    elif m := re.match(r"^\[STS/FullOffer\] (.+): (\d+) markets$", line):
        cur["counts"][m[1]] = int(m[2])
done = [r for r in runs if r["completed"] is not None]
problems = []
for i, r in enumerate(done):
    tiny = [k for k, v in r["counts"].items() if v < 100]
    if tiny: problems.append({"run": r["line"], "under100": tiny})
    if r["noSnapshot"] > 1: problems.append({"run": r["line"], "noSnapshot": r["noSnapshot"]})
    if r["nonPlSkips"]: problems.append({"run": r["line"], "nonPlSkips": r["nonPlSkips"]})
    if r["found"] > 20: problems.append({"run": r["line"], "found": r["found"]})
    if r["completed"] != r["found"] - r["noSnapshot"]: problems.append({"run": r["line"], "completed": r["completed"], "expected": r["found"] - r["noSnapshot"]})
    if i:
        prev = done[i - 1]["counts"]
        drops = [k for k, v in r["counts"].items() if prev.get(k, 0) >= 400 and v < 400]
        if drops: problems.append({"run": r["line"], "fullOfferDrops": drops})
summary = [{"line": r["line"], "found": r["found"], "completed": r["completed"], "noSnapshot": r["noSnapshot"], "fullOffer": sum(v >= 400 for v in r["counts"].values()), "min": min(r["counts"].values(), default=None)} for r in done]
print("RUN_CHECK " + json.dumps({"completedRuns": len(done), "pass": len(done) >= 3 and not problems, "runs": summary, "problems": problems}))
sys.exit(0 if len(done) >= 3 and not problems else 1)
