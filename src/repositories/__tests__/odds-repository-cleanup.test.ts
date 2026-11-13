import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeResponse, type RecordedQuery } from "../../__tests__/helpers/fake-supabase.js";

const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));

import { cleanupOdds } from "../odds-repository.js";

const shapes = JSON.parse(
  readFileSync(new URL("../../services/__tests__/fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url), "utf8"),
);

let fake: ReturnType<typeof createFakeSupabase>;
function useFake(respond: (q: RecordedQuery) => FakeResponse) {
  fake = createFakeSupabase(respond);
  db.client = fake.client;
}
afterEach(() => {
  db.client = null;
});

describe("cleanupOdds", () => {
  it("calls cleanup_odds and returns its counts", async () => {
    useFake(() => ({ data: { current: 412, matches: 33, snapshots: 2, history: 0 } }));
    expect(await cleanupOdds()).toEqual({ current: 412, matches: 33, snapshots: 2, history: 0 });
    expect(fake.queries[0].table).toBe("rpc:cleanup_odds");
    // Never p_history_keep, and there is no p_runs_keep
    expect(fake.queries[0].calls[0][1]).toEqual({});
  });

  it("throws a formatted error", async () => {
    useFake(() => ({ error: shapes.schemaCacheNotReady }));
    await expect(cleanupOdds()).rejects.toThrow(
      "cleanup_odds failed: Could not query the database for the schema cache. Retrying. [PGRST002]",
    );
  });
});
