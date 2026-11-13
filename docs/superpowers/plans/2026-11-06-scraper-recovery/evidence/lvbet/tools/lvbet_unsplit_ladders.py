# LVBet L1 companion check: no mapped "Zawodnicy - statystyki" ladder reaches the output unsplit.
# usage: python3 -I lvbet_unsplit_ladders.py <file>...
# Accepts either shape, detected per file:
#   - a prep-audit archive (scripts/lvbet-prep-audit.ts --out): a row is unsplit when raw.name is a mapped ladder
#     and raw.paramValue is empty;
#   - a full-offer dump (GET /api/odds/match/full-offer?home=<H>&away=<A>&league=<slug>): an LVBet entry is unsplit
#     when one " / "-part of its rawMarketName is a mapped ladder and either its key is OTHER (the parser left the
#     ladder whole and the normalizer's paramValue guard dropped it) or a selection still reads "<Player> <N>+".
#     One LVBet save stamps one scrapedAt on every row of the match. Rows of an older scrape are served until
#     pruneStaleOddsRows deletes them, and the pre-deploy rows hold every ladder unsplit, so only the newest
#     scrapedAt decides: unsplit rows there are a FAIL; older buckets alone make the dump STALE (take it again
#     after a run that logged "[FullOfferRepo] Pruned N stale row(s) for lvbet/<matchId>").
# The market-count floor of L1 cannot tell "LVBet listed fewer players" from "a ladder stayed unsplit"; this can.
# Prints one line per file: "<file> PASS|FAIL|STALE split=<rows> unsplit=<n> [<names>]".
# Exit 1 when any file FAILs, 2 when none FAILs but one is STALE, else 0.
# A file with split=0 and unsplit=0 has no published ladders (L1/L3 "pending: no ladders" for that match).
import json, re, sys

# The raw LVBet names of PLAYER_STAT_LADDER_NAMES (src/scrapers/bookmakers/lvbet/parser.ts), diacritics kept.
LADDERS = {"Strzały", "Strzały celne", "Popełnione faule", "Faule na zawodniku", "Odbiory (tackle)", "Asysty",
           "Spalone zawodnika", "Obrony bramkarza", "Strzały celne głową", "Strzały celne spoza pola karnego"}
TIER = re.compile(r"^(.+\S)\s+(\d+)\+$")
BM = "lvbet"


def check(path):
    data = json.load(open(path))
    split, unsplit, stale = 0, [], ""
    if isinstance(data.get("markets"), list):
        for row in data["markets"]:
            raw = row["raw"]
            if raw["name"] not in LADDERS:
                continue
            if raw.get("paramValue"):
                split += 1
            else:
                unsplit.append(raw["name"])
    else:
        entries = [(k, m["bookmakerOdds"][BM]) for k, m in data["data"]["markets"].items() if BM in m["bookmakerOdds"]]
        buckets = sorted({e["scrapedAt"] for _, e in entries})
        newest = buckets[-1] if buckets else None
        old_unsplit = 0
        for key, entry in entries:
            names = [n for n in (entry.get("rawMarketName") or "").split(" / ") if n in LADDERS]
            if not names:
                continue
            if key.startswith("OTHER") or any(TIER.match(s["name"]) for s in entry["selections"]):
                if entry["scrapedAt"] == newest:
                    unsplit.extend(names)
                else:
                    old_unsplit += len(names)
            elif entry["scrapedAt"] == newest:
                split += 1
        if len(buckets) > 1:
            stale = f" scrapedAt-buckets={len(buckets)} unsplit-in-older={old_unsplit}"
    verdict = "FAIL" if unsplit else ("STALE" if stale else "PASS")
    tail = f" {sorted(set(unsplit))}" if unsplit else ""
    print(f"{path.split('/')[-1]} {verdict} split={split} unsplit={len(unsplit)}{tail}{stale}")
    return verdict


verdicts = [check(p) for p in sys.argv[1:]]
sys.exit(1 if "FAIL" in verdicts else 2 if "STALE" in verdicts else 0)
