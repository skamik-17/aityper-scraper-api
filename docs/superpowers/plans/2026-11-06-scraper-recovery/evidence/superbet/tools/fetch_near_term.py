# Fetch normalized-markets for every premier-league match kicking off in (now, now+72h).
# usage: python3 -I fetch_near_term.py <outdir>   (API at http://localhost:3001)
import datetime as dt, gzip, json, os, sys, urllib.parse, urllib.request
API = "http://localhost:3001"
def get(path):
    req = urllib.request.Request(API + path, headers={"Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
        return json.loads(gzip.decompress(body) if r.headers.get("Content-Encoding") == "gzip" else body)
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
now = dt.datetime.now(dt.timezone.utc)
for m in get("/api/odds?league=premier-league")["data"]["matches"]:
    start = dt.datetime.fromisoformat(m["startTime"])
    if not (now < start < now + dt.timedelta(hours=72)):
        continue
    h, a = m["homeTeam"], m["awayTeam"]
    q = f"/api/matches/{urllib.parse.quote(h)}/{urllib.parse.quote(a)}/normalized-markets?league=premier-league"
    name = f"{h}__{a}".replace(" ", "_") + ".json"
    json.dump(get(q), open(os.path.join(out, name), "w"))
    print(name)
