# Usage: python3 -I health.py <normalized-markets.json> <out-betcris-rows.json>  (1X2 vs peer median, UNKNOWN share)
import json, sys, statistics, collections
nm = json.load(open(sys.argv[1]))['data']
rows = []  # (code, param, rawMarketName, selType, odds, bookmaker)
for cat in nm['categories']:
    for m in cat['markets']:
        for p in m['parameters']:
            for b in p['bookmakers']:
                for s in b['selections']:
                    rows.append((m['marketKey'], p['value'], b.get('rawMarketName'), s['type'], s['odds'], b['bookmaker'], m.get('type')))
bc = [r for r in rows if r[5] == 'betcris']
codes = collections.Counter(r[0] for r in bc)
print('betcris rows', len(bc), 'market codes', len(codes))
unk = [r for r in bc if r[3] == 'UNKNOWN' or r[0] in ('UNKNOWN', 'OTHER')]
print('UNKNOWN/OTHER rows', len(unk), f'{100*len(unk)/max(1,len(bc)):.1f}%')
# 1X2 comparison
mw = [r for r in rows if r[0] == 'MATCH_WINNER' and r[1] == '']
by = collections.defaultdict(dict)
for r in mw: by[r[3]][r[5]] = r[4]
for sel, d in by.items():
    others = [v for k, v in d.items() if k != 'betcris']
    med = statistics.median(others)
    print('1X2', sel, 'betcris', d.get('betcris'), 'peer median', med, f'dev {100*(d.get("betcris",0)-med)/med:.1f}%', 'n', len(others))
json.dump([list(r) for r in bc], open(sys.argv[2], 'w'), ensure_ascii=False)
