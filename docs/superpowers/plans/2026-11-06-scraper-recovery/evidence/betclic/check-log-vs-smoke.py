# Compare every Betclic run in an ANSI-cleaned backend log against an unloaded smoke result.
# Usage: python3 -I check-log-vs-smoke.py <cleaned.log> <smoke.txt> [tolerance_pct=2]
#   cleaned.log: sed 's/\x1b\[[0-9;]*m//g' backend.log > cleaned.log
#   smoke.txt:   file containing the "SMOKE_RESULT {...}" line of smoke-full-offer.mts
# A run starts at "[Betclic/FullOffer] Found N events in listing". Log names are Betclic short names
# ("Leeds vs Tottenham"); smoke names are canonical ("Leeds United vs Tottenham Hotspur"); a log match
# is paired with the smoke match whose home and away names contain the log's home and away names.
# Per run it also counts the retry warnings "[Betclic/Navigation] Attempt n/3 failed: <message>"
# (navigation.ts fetchGrpcStream), each by the start of its message:
#   incompleteRetries  "Incomplete gRPC-web frame"      stream ended mid-frame
#   deadline           "gRPC-web frame deadline"        all of them, the 1 ms ones included
#   deadline1ms        "gRPC-web frame deadline (1 ms)" subset: headers came after the whole budget
#   trailer            "gRPC-web trailer frame instead of data"
#   compressed         "gRPC-web compressed frame not supported"
#   emptyFrame         "gRPC-web empty data frame"
#   grpcError          "gRPC error N"                   trailers-only response
#   requestTimeout     "Request timeout"                socket idle before the headers
#   otherRetries       anything else, e.g. "gRPC request failed: HTTP 503" or a socket error
# Retry counts are informational: PASS needs every match within tolerance and failedGroups=0.
# Caveats: (1) the listing call's own retries are logged before its run's "Found" line, so they count
# toward the previous run (and are not counted before the first run); (2) a run whose listing fails
# prints no "Found" line and is missing from the output instead of printing FAIL, so check that the
# expected number of run lines appears.
import json, re, sys

log_path, smoke_path = sys.argv[1], sys.argv[2]
tol = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
smoke = next(json.loads(l[len("SMOKE_RESULT "):]) for l in open(smoke_path, encoding="utf-8") if l.startswith("SMOKE_RESULT "))
ref = [(p["match"].split(" vs ")[0], p["match"].split(" vs ")[1], p["raw"]) for p in smoke["perMatch"]]

# (counter, start of the retry message); the first match wins, unmatched messages go to otherRetries
RETRY_KINDS = [
    ("incomplete", "Incomplete gRPC-web frame"),
    ("deadline", "gRPC-web frame deadline"),
    ("trailer", "gRPC-web trailer frame instead of data"),
    ("compressed", "gRPC-web compressed frame not supported"),
    ("emptyFrame", "gRPC-web empty data frame"),
    ("grpcError", "gRPC error "),
    ("requestTimeout", "Request timeout"),
]
COUNTERS = [k for k, _ in RETRY_KINDS] + ["deadline1ms", "otherRetries"]

runs = []
for n, line in enumerate(open(log_path, encoding="utf-8", errors="replace"), 1):
    line = line.rstrip("\n")
    if re.match(r"^\[Betclic/FullOffer\] Found \d+ events in listing", line):
        runs.append({"line": n, "totals": [], "failedGroups": 0, **{k: 0 for k in COUNTERS}})
    elif not runs:
        continue
    elif m := re.match(r"^\[Betclic/FullOffer\] (.+?) vs (.+?): (\d+) markets total$", line):
        runs[-1]["totals"].append((m[1], m[2], int(m[3])))
    elif line.startswith("[Betclic/Navigation] Failed to fetch group"):
        runs[-1]["failedGroups"] += 1
    elif m := re.match(r"^\[Betclic/Navigation\] Attempt \d+/\d+ failed: (.*)$", line):
        kind = next((k for k, start in RETRY_KINDS if m[1].startswith(start)), "otherRetries")
        runs[-1][kind] += 1
        if m[1].startswith("gRPC-web frame deadline (1 ms)"):
            runs[-1]["deadline1ms"] += 1

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
          f"failedGroups={r['failedGroups']} incompleteRetries={r['incomplete']} deadline={r['deadline']} "
          f"deadline1ms={r['deadline1ms']} trailer={r['trailer']} compressed={r['compressed']} "
          f"emptyFrame={r['emptyFrame']} grpcError={r['grpcError']} requestTimeout={r['requestTimeout']} "
          f"otherRetries={r['otherRetries']} -> {'PASS' if ok else 'FAIL'}")
    for b in bad:
        print("   ", b)
