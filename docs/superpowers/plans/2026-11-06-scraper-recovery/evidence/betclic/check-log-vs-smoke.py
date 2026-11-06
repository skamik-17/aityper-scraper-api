# Compare every Betclic run in an ANSI-cleaned backend log against an unloaded smoke result.
# Usage: python3 -I check-log-vs-smoke.py <cleaned.log> <smoke.txt> [tolerance_pct=2]
#   cleaned.log: sed 's/\x1b\[[0-9;]*m//g' backend.log > cleaned.log
#   smoke.txt:   file containing the "SMOKE_RESULT {...}" line of smoke-full-offer.mts
# A run starts at "[Betclic/FullOffer] Found N events in listing". Log names are Betclic short names
# ("Leeds vs Tottenham"); smoke names are canonical ("Leeds United vs Tottenham Hotspur"); a log match
# is paired with the smoke match whose home and away names contain the log's home and away names.
import json, re, sys

log_path, smoke_path = sys.argv[1], sys.argv[2]
tol = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
smoke = next(json.loads(l[len("SMOKE_RESULT "):]) for l in open(smoke_path, encoding="utf-8") if l.startswith("SMOKE_RESULT "))
ref = [(p["match"].split(" vs ")[0], p["match"].split(" vs ")[1], p["raw"]) for p in smoke["perMatch"]]

runs = []
for n, line in enumerate(open(log_path, encoding="utf-8", errors="replace"), 1):
    if re.match(r"^\[Betclic/FullOffer\] Found \d+ events in listing", line):
        runs.append({"line": n, "totals": [], "failedGroups": 0, "incomplete": 0})
    elif not runs:
        continue
    elif m := re.match(r"^\[Betclic/FullOffer\] (.+?) vs (.+?): (\d+) markets total$", line.rstrip("\n")):
        runs[-1]["totals"].append((m[1], m[2], int(m[3])))
    elif line.startswith("[Betclic/Navigation] Failed to fetch group"):
        runs[-1]["failedGroups"] += 1
    elif "Incomplete gRPC-web frame" in line and line.startswith("[Betclic/Navigation]"):
        runs[-1]["incomplete"] += 1

for i, r in enumerate(runs, 1):
    bad = []
    for h, a, got in r["totals"]:
        cand = [x for x in ref if h in x[0] and a in x[1]]
        if len(cand) != 1:
            bad.append(f"{h} vs {a}: no unique smoke match")
            continue
        exp = cand[0][2]
        if abs(got - exp) > exp * tol / 100:
            bad.append(f"{h} vs {a}: {got} vs smoke {exp} ({(got - exp) / exp * 100:+.1f}%)")
    ok = not bad and r["failedGroups"] == 0
    print(f"run {i} (log line {r['line']}): matches={len(r['totals'])} outOfTolerance={len(bad)} "
          f"failedGroups={r['failedGroups']} incompleteRetries={r['incomplete']} -> {'PASS' if ok else 'FAIL'}")
    for b in bad:
        print("   ", b)
