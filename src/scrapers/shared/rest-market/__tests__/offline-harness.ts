/**
 * Test-only helpers for the /rest/market brands: fixture routes. The offline browser
 * driver lives in src/__tests__/helpers/replay-page.ts and is re-exported here.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { ReplayRoutes } from "../../../../__tests__/helpers/replay-page.js";

// Moved to the shared helper (plan 04 Task 0); re-exported so these tests stay unchanged.
export { driveBrowserScraperOffline, withoutScrapedAt, type ReplayRoutes } from "../../../../__tests__/helpers/replay-page.js";

export type RestMarketBrandDir = "etoto" | "forbet" | "fuksiarz" | "betfan";

const FIXTURES = new URL("./fixtures/", import.meta.url);

/** `fixtures/<dir>/list.json` at urls.list, and every `detail-<id>.json` at urls.detail(id). */
export function loadFixtureRoutes(dir: RestMarketBrandDir, urls: { list: string; detail: (id: string) => string }): ReplayRoutes {
  const base = new URL(`${dir}/`, FIXTURES);
  const routes: ReplayRoutes = { [urls.list]: { body: readFileSync(new URL("list.json", base), "utf8") } };
  for (const file of readdirSync(base)) {
    const id = /^detail-(.+)\.json$/.exec(file)?.[1];
    if (id !== undefined) routes[urls.detail(id)] = { body: readFileSync(new URL(file, base), "utf8") };
  }
  return routes;
}

