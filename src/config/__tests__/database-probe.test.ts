/**
 * The DB preflight that gates every scrape run (root cause (b)): probeDatabase,
 * waitForDatabase and testConnection, which now delegates to the probe.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeResponse, type RecordedQuery } from "../../__tests__/helpers/fake-supabase.js";

const db = vi.hoisted(() => ({ client: null as any, createError: null as Error | null }));
// getSupabase() caches the client it creates, so the stand-in forwards to whichever fake the test installed.
vi.mock("@supabase/supabase-js", async () => ({
  createClient: () => {
    if (db.createError) throw db.createError;
    return { from: (table: string) => db.client.from(table) };
  },
}));

import { probeDatabase, testConnection, waitForDatabase } from "../database.js";

const shapes = JSON.parse(
  readFileSync(
    new URL("../../services/__tests__/fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url),
    "utf8",
  ),
);
const ECONNREFUSED = "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)";

let fake: ReturnType<typeof createFakeSupabase>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

function useFake(respond: (q: RecordedQuery) => FakeResponse) {
  fake = createFakeSupabase(respond);
  db.client = fake.client;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.createError = null;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  db.client = null;
});

describe("probeDatabase", () => {
  it("is ok when PostgREST answers a market_types read", async () => {
    useFake(() => ({ data: [{ id: 1 }] }));
    expect(await probeDatabase()).toEqual({ ok: true });
    expect(fake.queries).toEqual([{ table: "market_types", calls: [["select", "id"], ["limit", 1]] }]);
  });

  it("reports the formatted socket cause when the database is unreachable", async () => {
    useFake(() => ({ error: shapes.econnrefused }));
    expect(await probeDatabase()).toEqual({ ok: false, error: ECONNREFUSED });
  });

  it("is not ok while PostgREST is still loading its schema cache (PGRST002)", async () => {
    useFake(() => ({ error: shapes.schemaCacheNotReady }));
    expect(await probeDatabase()).toEqual({
      ok: false,
      error: "Could not query the database for the schema cache. Retrying. [PGRST002]",
    });
  });

  it("keeps testConnection's rule that PGRST116 (no rows) counts as reachable", async () => {
    useFake(() => ({ error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } }));
    expect(await probeDatabase()).toEqual({ ok: true });
  });

  it("never throws when the client itself throws", async () => {
    useFake(() => {
      throw new TypeError("fetch failed");
    });
    expect(await probeDatabase()).toEqual({ ok: false, error: "fetch failed" });
  });

  it("never throws when the client cannot be created (bad SUPABASE_URL)", async () => {
    // A fresh module copy: getSupabase() has not cached a client yet.
    vi.resetModules();
    db.createError = new Error("supabaseUrl is required.");
    const fresh = await import("../database.js");
    expect(await fresh.probeDatabase()).toEqual({ ok: false, error: "supabaseUrl is required." });
  });
});

describe("waitForDatabase", () => {
  it("polls until the database answers", async () => {
    let calls = 0;
    useFake(() => (++calls < 3 ? { error: shapes.econnrefused } : {}));
    expect(await waitForDatabase(5_000, 5)).toEqual({ ok: true });
    expect(fake.queries).toHaveLength(3);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain(ECONNREFUSED);
  });

  it("gives up after the timeout and returns the last error", async () => {
    useFake(() => ({ error: shapes.econnrefused }));
    const started = Date.now();
    expect(await waitForDatabase(40, 10)).toEqual({ ok: false, error: ECONNREFUSED });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(fake.queries.length).toBeGreaterThanOrEqual(2);
  });

  it("does not wait at all when the database is up", async () => {
    useFake(() => ({}));
    expect(await waitForDatabase(120_000)).toEqual({ ok: true });
    expect(fake.queries).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("testConnection", () => {
  it("keeps its boolean and its log prefix", async () => {
    useFake(() => ({ error: shapes.econnrefused }));
    expect(await testConnection()).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith("Database connection test failed:", ECONNREFUSED);

    useFake(() => ({}));
    expect(await testConnection()).toBe(true);
  });
});
