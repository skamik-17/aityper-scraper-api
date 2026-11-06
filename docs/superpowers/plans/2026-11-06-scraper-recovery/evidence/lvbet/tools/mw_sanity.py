import json,sys,statistics
d=json.load(open(sys.argv[1]))
ms=d['data']['matches']
targets=['superbet','lvbet','fuksiarz']
worst={t:0 for t in targets}
rows=[]
for m in ms:
  bo=m['markets']['MATCH_WINNER']['bookmakerOdds']
  def sel(b):
    return {s['normalizedName']:s['odds'] for s in bo[b]['selections']}
  for t in targets:
    if t not in bo: rows.append((m['matchId'],t,'MISSING')); continue
    mine=sel(t)
    others=[sel(b) for b in bo if b!=t]
    devs=[]
    for k in ['HOME','DRAW','AWAY']:
      med=statistics.median([o[k] for o in others if k in o])
      devs.append((mine.get(k,0)-med)/med*100)
    mx=max(abs(x) for x in devs)
    worst[t]=max(worst[t],mx)
    rows.append((m['matchId'].split(':',1)[1],t,' '.join(f'{k}={mine.get(k)}' for k in ['HOME','DRAW','AWAY']), ' '.join(f'{x:+.1f}%' for x in devs)))
for r in rows: print(*r, sep=' | ')
print('worst abs deviation vs median of other bookmakers:',{k:round(v,1) for k,v in worst.items()})
