import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../__tests__/helpers/fake-supabase.js";

const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));

import { ensureMarketTypesSynced } from "../market-types-sync.js";

const shapes = JSON.parse(
  readFileSync(new URL("./fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url), "utf8"),
);

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  db.client = null;
});

describe("ensureMarketTypesSynced", () => {
  it("retries after a failed sync and memoizes success", async () => {
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
});
