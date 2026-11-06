// Live probe (7 requests): fetch the 7 Betclic market groups of one match IN PARALLEL (as fetchAllMarketGroups does),
// report per group when the first gRPC-web frame is complete and whether the server ends the stream within holdMs.
// Usage (repo root): node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/stream-probe.mts <matchId> [holdMs=5000]
import https from "node:https";
const REPO = new URL("../../../../../../", import.meta.url).pathname;
const { ENDPOINTS, GRPC_HEADERS, MARKET_GROUP_FILTERS } = await import(`${REPO}src/scrapers/bookmakers/betclic/constants.ts`);
const { buildMatchDetailsRequestWithFilter } = await import(`${REPO}src/scrapers/bookmakers/betclic/navigation.ts`);
const [matchId, holdArg] = process.argv.slice(2);
const holdMs = Number(holdArg ?? 5000);
const frameOf = (b: Buffer) => { const f = Buffer.alloc(5 + b.length); f.writeUInt32BE(b.length, 1); b.copy(f, 5); return f; };
function probe(group: string, cat: string | null): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const u = new URL(ENDPOINTS.match); const t0 = Date.now();
    let data = "", chunks = 0, headersAt = -1, completeAt = -1, endedAt = -1, need = -1, flag = -1;
    const req = https.request({ hostname: u.hostname, port: 443, path: u.pathname, method: "POST", headers: GRPC_HEADERS, timeout: 30000 }, (res) => {
      headersAt = Date.now() - t0;
      res.on("data", (c: Buffer) => {
        data += c.toString(); chunks++;
        if (need < 0 && data.length >= 8) { const h = Buffer.from(data.slice(0, 8), "base64"); flag = h[0]; need = Math.ceil((5 + h.readUInt32BE(1)) / 3) * 4; }
        if (completeAt < 0 && need > 0 && data.replace(/[\r\n]/g, "").length >= need) completeAt = Date.now() - t0;
      });
      res.on("end", () => { endedAt = Date.now() - t0; });
    });
    req.on("error", (e) => resolve({ group, error: e.message }));
    req.write(frameOf(buildMatchDetailsRequestWithFilter(matchId, cat)).toString("base64")); req.end();
    setTimeout(() => {
      req.destroy();
      resolve({ group, headersAt, completeAt, endedAt, flag, frameBytes: need > 0 ? Buffer.from(data.slice(0, need), "base64").readUInt32BE(1) : null, b64Chars: data.length, chunks });
    }, holdMs);
  });
}
const rows = await Promise.all(Object.entries(MARKET_GROUP_FILTERS).map(([g, c]) => probe(g, c as string | null)));
for (const r of rows) console.log(JSON.stringify(r));
process.exit(0);
