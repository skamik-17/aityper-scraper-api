# Usage: python3 -I phantom_strict.py <betcris-rows.json from health.py> <direct-swarm -game.json>  (player rows vs same raw market)
import json, sys, re, unicodedata, collections
rows = json.load(open(sys.argv[1])); raw = json.load(open(sys.argv[2]))
def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii','ignore').decode().lower()
    return re.sub(r'[^a-z0-9.+ ]', ' ', s).split()
g = [g for s in raw['data']['data']['sport'].values() for r in s['region'].values() for c in r['competition'].values() for g in c['game'].values()][0]
by_name = collections.defaultdict(list)
for mk in g['market'].values():
    by_name[' '.join(norm(mk['name']))].append(mk)
def is_player(p): return bool(p) and not re.search(r'\d', p) and len(p.split()) >= 2 and ':' not in p
stats = collections.Counter(); bad = []
for code, param, rawname, sel, odds, bm, typ in rows:
    if not is_player(param): continue
    mks = by_name.get(' '.join(norm(rawname)), [])
    if not mks: stats['raw market name not found now'] += 1; continue
    toks = [t for t in norm(param) if len(t) > 2 and not t.endswith('+')]
    evs = [e for mk in mks for e in mk.get('event',{}).values() if all(t in norm(e['name']) for t in toks[-1:])]
    if not evs: stats['PLAYER ABSENT in same raw market'] += 1; bad.append((code,param,rawname,sel,odds)); continue
    if any(abs(e['price']-odds) <= 0.05*e['price'] for e in evs): stats['confirmed same market (+-5%)'] += 1
    else: stats['player present, odds differ >5%'] += 1; bad.append((code,param,rawname,sel,odds,[e['price'] for e in evs][:6]))
print(dict(stats))
for b in bad[:20]: print('  ', b)
