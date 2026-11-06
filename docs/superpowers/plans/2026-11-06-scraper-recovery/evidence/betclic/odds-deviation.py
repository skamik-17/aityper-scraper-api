# Betclic 1X2 deviation vs the peer median, from a GET /api/odds?league=<league> payload.
# Usage: curl -s 'http://localhost:3001/api/odds?league=premier-league' | python3 -I odds-deviation.py
import json, statistics, sys
ms = json.load(sys.stdin)['data']['matches']
devs, worst, n = [], (0, None), 0
for m in ms:
    e = m['markets'].get('MATCH_WINNER')
    if not e: continue
    per = {bm: {s['normalizedName']: s['odds'] for s in v['selections']} for bm, v in e['bookmakerOdds'].items()}
    if 'betclic' not in per: continue
    n += 1
    for s in ('HOME', 'DRAW', 'AWAY'):
        others = [per[b][s] for b in per if b != 'betclic' and per[b].get(s)]
        v = per['betclic'].get(s)
        if not others or not v: continue
        med = statistics.median(others); dev = abs(v - med) / med * 100
        devs.append(dev)
        if dev > worst[0]: worst = (dev, (m['matchId'], s, v, med))
print(f"betclic MATCH_WINNER: matches={n} n={len(devs)} mean={statistics.mean(devs):.1f}% max={worst[0]:.1f}% {worst[1]}")
