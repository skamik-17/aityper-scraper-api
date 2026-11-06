import json,sys,collections,re
for f in sys.argv[1:]:
    rows=json.load(open(f))
    codes=collections.Counter(r['market_code'] for r in rows)
    sels=sum(len(r['selections']) for r in rows)
    unk=sum(1 for r in rows for s in r['selections'] if s.get('normalizedName')=='UNKNOWN')
    oth=[r for r in rows if r['market_code']=='OTHER']
    oth_sel=sum(len(r['selections']) for r in oth)
    scr=collections.Counter(r['scraped_at'][:16] for r in rows)
    undef=sum(1 for r in rows for s in r['selections'] if s.get('externalId') in ('undefined',None))
    # raw-name leaks: selection 'name' equal to normalizedName missing or normalizedName looks like raw text (contains spaces & lowercase)
    leak=sum(1 for r in rows for s in r['selections'] if s.get('normalizedName') and re.search(r'[a-ząćęłńóśźż]{3,}\s', s['normalizedName']) )
    print(f.split('/')[-1], json.dumps({'rows':len(rows),'codes':len([c for c in codes if c!='OTHER']),'sel':sels,'UNKNOWN':unk,'UNK%':round(100*unk/max(sels,1),1),'OTHERrows':len(oth),'OTHERsel%':round(100*oth_sel/max(sels,1),1),'scrapedAt':dict(scr),'extIdMissing':undef,'normNameLooksRaw':leak}))
