"""Betfan 1X2 and O/U 2.5 deviation from the peer median (betfan excluded from the median).

Usage: python3 -I odds-sanity.py   (reads http://localhost:3001, read-only GETs)
Baseline 2026-11-06 17:05Z: matches 20 1x2_n 60 1x2_max 3.6 1x2_mean 1.5 ou25_n 40 ou25_max 3.4
"""
import json,urllib.request,urllib.parse,statistics as st
B='http://localhost:3001/api'
ms=json.load(urllib.request.urlopen(B+'/odds?league=premier-league'))['data']['matches']
def dev(r,keys):
  out=[]
  for k in keys:
    v=[x[k] for b,x in r.items() if b!='betfan' and k in x]
    if k in r['betfan'] and v: out.append(abs(r['betfan'][k]-st.median(v))/st.median(v)*100)
  return out
d1=[];d2=[]
for m in ms:
  mw=m['markets'].get('MATCH_WINNER',{}).get('bookmakerOdds',{})
  r={bm:{s['normalizedName']:s['odds'] for s in v['selections']} for bm,v in mw.items()}
  if 'betfan' in r: d1+=dev(r,('HOME','DRAW','AWAY'))
  u=B+'/matches/%s/%s/normalized-markets?league=premier-league&category=GOLE'%(urllib.parse.quote(m['homeTeam']),urllib.parse.quote(m['awayTeam']))
  for c in json.load(urllib.request.urlopen(u))['data']['categories']:
    for mk in c['markets']:
      for p in mk['parameters']:
        if mk['type']=='TOTAL_GOALS' and p['value']=='2.5':
          r={b['bookmaker']:{s['type']:s['odds'] for s in b['selections']} for b in p['bookmakers']}
          if 'betfan' in r: d2+=dev(r,('OVER','UNDER'))
print('matches',len(ms),'1x2_n',len(d1),'1x2_max %.1f'%max(d1),'1x2_mean %.1f'%st.mean(d1),'ou25_n',len(d2),'ou25_max %.1f'%max(d2))
