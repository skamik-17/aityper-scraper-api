import json,sys,statistics
f=sys.argv[1]; codes=sys.argv[2].split(',')
d=json.load(open(f))['data']
found={}
for c in d['categories']:
  for m in c['markets']:
    if m['type'] in codes:
      bms=set(); vals=[]
      for p in m['parameters']:
        for b in p['bookmakers']:
          bms.add(b['bookmaker'])
      rec=found.setdefault(m['type'], set()); rec|=bms
for code in codes:
  bms=found.get(code,set())
  print(f"{code}\tpeers={len(bms-{'fortuna'})}\tfortuna={'fortuna' in bms}\t{','.join(sorted(bms-{'fortuna'}))}")
