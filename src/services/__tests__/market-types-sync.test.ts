import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../__tests__/helpers/fake-supabase.js";

const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));

import { MARKET_CATALOG } from "../../data/market-catalog.js";

// ensureMarketTypesSynced() memoizes per process; every test gets a fresh module.
async function loadEnsureMarketTypesSynced() {
  vi.resetModules();
  return (await import("../market-types-sync.js")).ensureMarketTypesSynced;
}

const shapes = JSON.parse(
  readFileSync(new URL("./fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url), "utf8"),
);

let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
  db.client = null;
});

describe("ensureMarketTypesSynced", () => {
  it("retries after a failed sync and memoizes success", async () => {
    const ensureMarketTypesSynced = await loadEnsureMarketTypesSynced();
    // Startup against a DB that is still coming up: the first upsert fails, the next one works.
    let upserts = 0;
    const fake = createFakeSupabase(() => (++upserts === 1 ? { error: shapes.econnrefused } : { error: null }));
    db.client = fake.client;

    expect(await ensureMarketTypesSynced()).toBe(false);
    expect(await ensureMarketTypesSynced()).toBe(true);
    expect(await ensureMarketTypesSynced()).toBe(true);
    expect(fake.queries.filter((q) => q.table === "market_types")).toHaveLength(2);
    expect(fake.queries.every((q) => q.calls[0][0] === "upsert")).toBe(true);
    // The failure keeps its cause in the log.
    expect(errorSpy).toHaveBeenCalledWith("[marketTypesSync] Upsert error:", shapes.econnrefused);
  });

  it("logs the sync that succeeded once, whichever caller ran it (startup or the first scrape run)", async () => {
    // The DB came up after startup: the startup call fails, the first scrape run's call syncs,
    // later runs hit the memo. Only the call that upserted prints the line.
    const ensureMarketTypesSynced = await loadEnsureMarketTypesSynced();
    let upserts = 0;
    db.client = createFakeSupabase(() => (++upserts === 1 ? { error: shapes.econnrefused } : { error: null })).client;

    await ensureMarketTypesSynced();
    expect(logSpy).not.toHaveBeenCalled();
    await ensureMarketTypesSynced();
    await ensureMarketTypesSynced();
    expect(logSpy.mock.calls).toEqual([[`[marketTypesSync] Synced market_types: ${MARKET_CATALOG.length} entries`]]);
  });
});
