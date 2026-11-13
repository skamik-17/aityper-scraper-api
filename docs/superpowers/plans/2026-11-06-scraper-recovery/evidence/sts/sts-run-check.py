"""Per-run STS checks on an ANSI-stripped service log, from a given line onward (read-only).
Usage: python3 -I sts-run-check.py <cleaned-log> <start-line>
<start-line> = `wc -l < <cleaned-log>` recorded just before the live checkout switched to the fix.
Prints one RUN_CHECK JSON line; exit 0 when every completed STS run after <start-line> passes.
Fails closed on runs that never print a Found line: every STS full-offer outcome line other than
`success` (`[Aggregator/FullOffer] sts <partial|empty|scrape_failed|persist_failed>: N matches,
M markets found, K saved[ - error]`, src/scrapers/aggregator.ts formatOutcomeLine; e.g. an empty
strict listing after an id renumbering reads `sts scrape_failed: 0 matches ... - No fixtures
found for league`), every thrown STS scrape or save (`sts scraper threw:` / `sts save threw:`)
and any strict-id miss warning from the parser is a problem. `sts success:` is healthy, and
`sts cleanup failed:` is not a problem (the run keeps its outcome). Those aggregator lines carry
no league; they are attributed to the Premier League, the only enabled league
(src/config/index.ts ENABLED_LEAGUES), so an STS failure in a manually triggered other league
also fails the check.
Every parser fold-drop warning (`[STS] <H> vs <A>: dropped N of M lines of market <id> that
do not fold into "<dropdown>" ...`, Task 6) after <start-line> is a problem too: a partial
drop leaves the folded code present with fewer players, so no per-run count shows it."""
import json, re, sys
log, start = sys.argv[1], int(sys.argv[2])
runs, cur, problems = [], None, []
for no, line in enumerate(open(log, encoding="utf-8", errors="replace"), 1):
    if no <= start:
        continue
    line = line.rstrip("\n")
    if m := re.match(r"^\[Aggregator/FullOffer\] sts ((?:partial|empty|scrape_failed|persist_failed): .*)$", line):
        problems.append({"line": no, "stsFailed": m[1][:200]})
    elif m := re.match(r"^\[Aggregator/FullOffer\] sts ((?:scraper threw|save threw):.*)$", line):
        problems.append({"line": no, "stsFailed": m[1][:200]})
    elif re.match(r"^\[STS\] Strict id filter for premier-league .*matched 0 fixtures", line):
        problems.append({"line": no, "strictIdMiss": line[:500]})
    elif 'do not fold into' in line:
        problems.append({"line": no, "foldDrop": line[:300]})
    elif m := re.match(r"^\[STS/FullOffer\] Found (\d+) fixtures for premier-league$", line):
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
