# Betclic deviation vs peer median on TOTAL_GOALS 2.5 and BTTS from saved normalized-markets API payloads.
import json, sys, statistics
T = 'betclic'
for code, param, sels in [('MATCH_WINNER', '', ['HOME', 'DRAW', 'AWAY']), ('TOTAL_GOALS', '2.5', ['OVER', 'UNDER']), ('BTTS', '', ['YES', 'NO'])]:
    devs = []; worst = (0, None)
    for f in sys.argv[1:]:
        d = json.load(open(f))['data']
        for c in d['categories']:
            for mk in c['markets']:
                if mk['type'] != code: continue
                for p in mk['parameters']:
                    if p['value'] != param: continue
                    per = {b['bookmaker']: {s['type']: s['odds'] for s in b['selections']} for b in p['bookmakers']}
                    if T not in per: continue
                    for s in sels:
                        o = [per[b][s] for b in per if b != T and per[b].get(s)]
                        v = per[T].get(s)
                        if not o or not v: continue
                        med = statistics.median(o); dev = abs(v - med) / med * 100
                        devs.append(dev)
                        if dev > worst[0]: worst = (dev, (f.split('/')[-1], s, v, med))
    print(f"{T} {code}{':'+param if param else ''}: n={len(devs)} mean={statistics.mean(devs):.1f}% max={worst[0]:.1f}% {worst[1]}" if devs else f"{code}: none")
