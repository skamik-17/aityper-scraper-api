# Print betclic's params and selection types for chosen market types from a normalized-markets API payload (stdin).
import json, sys
types = set(sys.argv[1].split(','))
d = json.load(sys.stdin)['data']
for c in d['categories']:
    for mk in c['markets']:
        if mk['type'] not in types: continue
        for p in mk['parameters']:
            for b in p['bookmakers']:
                if b['bookmaker'] == 'betclic':
                    print(mk['type'], repr(p['value']), [s['type'] for s in b['selections']])
