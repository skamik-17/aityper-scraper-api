import json,sys,re,collections
d=json.load(open(sys.argv[1]))['data']; bm=sys.argv[2]
tot=0; solo=0; init=0; ex=[]
for c in d['categories']:
  for m in c['markets']:
    if m['viewType'] not in ('PLAYER_STAT_LINES','PLAYER_DROPDOWN','PLAYER_LIST','PLAYER_GRID') and not m['type'].startswith('PLAYER') and 'GOALSCORER' not in m['type']: continue
    for p in m['parameters']:
      bms=[b['bookmaker'] for b in p['bookmakers'] if b['selections']]
      if bm not in bms: continue
      tot+=1
      if len(set(bms))==1: solo+=1; ex.append((m['type'],p['value']))
      if re.match(r'^[A-ZŁŚŻ]\.\s', p['value'] or ''): init+=1
print(bm,'player params with this bm:',tot,'only-this-bm:',solo,'abbreviated-initial params:',init)
print('  sample solo:', collections.Counter(v for _,v in ex).most_common(12))
