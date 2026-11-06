import json,sys,statistics
for f in sys.argv[1:]:
  d=json.load(open(f))['data']
  for c in d['categories']:
    for m in c['markets']:
      if m['type']!='TOTAL_GOALS': continue
      for p in m['parameters']:
        if p['value'] not in ('2.5','1.5','3.5'): continue
        od={b['bookmaker']:{s['type']:s['odds'] for s in b['selections']} for b in p['bookmakers']}
        for t in ['superbet','lvbet','fuksiarz']:
          if t not in od: print(f.split('/')[-1],p['value'],t,'MISSING'); continue
          oth=[v for k,v in od.items() if k!=t]
          devs={k:(od[t].get(k,0)-statistics.median([o[k] for o in oth if k in o]))/statistics.median([o[k] for o in oth if k in o])*100 for k in ('OVER','UNDER') if k in od[t]}
          print(f.split('/')[-1], p['value'], t, od[t], {k:f'{v:+.1f}%' for k,v in devs.items()}, 'sels:',list(od[t].keys()))
