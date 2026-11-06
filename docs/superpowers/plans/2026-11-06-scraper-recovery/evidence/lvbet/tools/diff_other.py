import json,sys,re
# usage: diff_other.py aug.json now.json "AugHome|AugAway" "NowHome|NowAway" [extra alias regex pairs]
a=json.load(open(sys.argv[1])); n=json.load(open(sys.argv[2]))
ah,aa=sys.argv[3].split('|'); nh,na=sys.argv[4].split('|')
def ph(s,h,aw):
    for t,p in sorted([(h,'{HOME}'),(aw,'{AWAY}')],key=lambda x:-len(x[0])):
        s=s.replace(t,p)
        short=t.split()[0]
        if len(short)>3: s=re.sub(r'\b'+re.escape(short)+r'\b',p,s)
    return s
an={}
for k,v in a['otherNames']: an[ph(k,ah,aa)]=an.get(ph(k,ah,aa),0)+v
nn={}
for k,v in n['otherNames']: nn[ph(k,nh,na)]=nn.get(ph(k,nh,na),0)+v
new=sorted([k for k in nn if k not in an], key=lambda k:-nn[k])
print('OTHER-bucket raw names now, absent from Aug OTHER: %d (of %d now, %d aug)'%(len(new),len(nn),len(an)))
for k in new: print('  %3d  %s'%(nn[k],k))
print('codes lost:', sorted(set(a['codes'])-set(n['codes'])))
print('codes gained:', sorted(set(n['codes'])-set(a['codes'])))
