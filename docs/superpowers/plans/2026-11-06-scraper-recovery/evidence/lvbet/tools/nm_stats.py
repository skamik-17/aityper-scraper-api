import json,sys,collections
# usage: nm_stats.py <nm.json or august-prep.json> <bookmaker> [--list]
path,bm=sys.argv[1],sys.argv[2]
d=json.load(open(path))
if 'data' in d:
    markets=[m for c in d['data']['categories'] for m in c['markets']]
else:
    markets=[x['market'] for x in d['markets']]
codes=collections.Counter(); sels=0; unk=0; other_sel=0; other_mk=0; entries=0
raw_names=collections.Counter(); code_raw=collections.defaultdict(set); params=collections.Counter()
for m in markets:
    t=m['type']
    for p in m['parameters']:
        for b in p['bookmakers']:
            if b['bookmaker']!=bm: continue
            entries+=1
            codes[t]+=1
            params[t]+=1
            raw_names[b.get('rawMarketName')]+=1
            code_raw[t].add(b.get('rawMarketName'))
            for s in b['selections']:
                sels+=1
                if s['type']=='UNKNOWN': unk+=1
                if t=='OTHER': other_sel+=1
            if t=='OTHER': other_mk+=1
res={'codes':len([c for c in codes if c!='OTHER']),'entries(code x param)':entries,'selections':sels,'unknownSel':unk,'unknownPct':round(100*unk/max(sels,1),2),'otherEntries':other_mk,'otherSel':other_sel,'otherSelPct':round(100*other_sel/max(sels,1),2)}
print(json.dumps(res))
if '--list' in sys.argv:
    for c,n in sorted(codes.items()): print(c,n,sorted(code_raw[c])[:3])
if '--codes' in sys.argv:
    print(' '.join(sorted(c for c in codes if c!='OTHER')))
