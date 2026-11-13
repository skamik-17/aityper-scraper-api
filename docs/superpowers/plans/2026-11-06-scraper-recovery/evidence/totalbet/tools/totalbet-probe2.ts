// Run from the repo root: heavy [--live] npx tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/tools/<file>. Reads/writes .scratch/totalbet-probe2/.
/**
 * Read-only totalbet probe #2: the discovery printout (runScraperDiscovery, with
 * the raw bookmakerMarketId now printed) over a scraper whose FetchJson records
 * every response, so the list and detail payloads can become test fixtures.
 * Same traffic as scripts/totalbet-market-discovery.ts. Writes only to .scratch.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { TotalbetPlaywrightScraper } from "../../../../../../../src/scrapers/bookmakers/totalbet/index.js";
import { createHttpFetchJson, type FetchJson } from "../../../../../../../src/scrapers/bookmakers/totalbet/api-client.js";
import { TOTALBET_DETAIL_CONCURRENCY, TOTALBET_REQUEST_TIMEOUT_MS } from "../../../../../../../src/scrapers/bookmakers/totalbet/constants.js";
import { createHttpClient } from "../../../../../../../src/scrapers/shared/http/http-client.js";
import { totalbetNormalizer } from "../../../../../../../src/services/normalization/bookmakers/totalbet-normalizer.js";
import { runScraperDiscovery } from "../../../../../../../src/services/audit/scraper-audit-core.js";

const OUT = new URL(`file://${process.cwd()}/.scratch/totalbet-probe2/`);
mkdirSync(OUT, { recursive: true });
const EVENT_URL = "https://totalbet.pl/event-details/b9241ab0-80fd-46fa-8249-c9397d40a205";

const http = createHttpClient({ perHostConcurrency: TOTALBET_DETAIL_CONCURRENCY });
const real = createHttpFetchJson(http, { timeoutMs: TOTALBET_REQUEST_TIMEOUT_MS });
const recorded: Array<{ url: string; status: number; contentType: string; at: string }> = [];
let n = 0;
const recording: FetchJson = async (url, init) => {
  const res = await real(url, init);
  const file = url.includes("/events?") ? `list-${++n}.json` : `detail-${url.split("/").pop()}.json`;
  writeFileSync(new URL(file, OUT), JSON.stringify(res.body));
  recorded.push({ url, status: res.status, contentType: res.contentType, at: new Date().toISOString() });
  return res;
};

const scraper = new TotalbetPlaywrightScraper(undefined, { http, fetchJson: recording });
await runScraperDiscovery({ scraper, normalizer: totalbetNormalizer, eventUrl: EVENT_URL, league: "premier-league", showAll: true });
writeFileSync(new URL("index.json", OUT), JSON.stringify(recorded, null, 1));
console.log(`[probe2] recorded ${recorded.length} responses`);
