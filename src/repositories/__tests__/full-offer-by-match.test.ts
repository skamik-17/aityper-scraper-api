import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeResponse, type RecordedQuery } from "../../__tests__/helpers/fake-supabase.js";

const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));

import { getFullOfferByMatch } from "../full-offer-repository.js";

// Recorded market_comparison rows of one match (plan 09 Task 1).
const ROWS: Array<Record<string, unknown>> = JSON.parse(
  readFileSync(new URL("../../__tests__/fixtures/db/market-comparison-rows.json", import.meta.url), "utf8"),
);
const HOME = String(ROWS[0].home_team);
const AWAY = String(ROWS[0].away_team);
const MATCH_ID = String(ROWS[0].match_id);

let fake: ReturnType<typeof createFakeSupabase>;

// Serves ROWS both as market_comparison pages (old path) and as the RPC's json (new path).
function serve(rows: Array<Record<string, unknown>>): (q: RecordedQuery) => FakeResponse {
  return (q) => {
    if (q.table === "rpc:get_match_market_rows") return { data: rows };
    if (q.table === "market_comparison") {
      const range = q.calls.find(([m]) => m === "range");
      const [from, to] = range ? (range.slice(1) as [number, number]) : [0, rows.length - 1];
      return { data: rows.slice(from, to + 1) };
    }
    return {};
  };
}

beforeEach(() => {
  fake = createFakeSupabase(serve(ROWS));
  db.client = fake.client;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  db.client = null;
});

describe("getFullOfferByMatch", () => {
  it("reads the whole match in one RPC call", async () => {
    await getFullOfferByMatch(HOME, AWAY, "premier-league");
    expect(fake.queries.map((q) => q.table)).toEqual(["rpc:get_match_market_rows"]);
    expect(fake.queries[0].calls[0][1]).toEqual({ p_match_id: MATCH_ID });
  });

  it("returns today's FullOfferComparison for the recorded rows", async () => {
    await expect(JSON.stringify(await getFullOfferByMatch(HOME, AWAY, "premier-league"), null, 1)).toMatchFileSnapshot(
      "./__snapshots__/full-offer-by-match.json",
    );
  });

  it("no rows is null, not an error", async () => {
    fake = createFakeSupabase(serve([]));
    db.client = fake.client;
    expect(await getFullOfferByMatch(HOME, AWAY, "premier-league")).toBeNull();
  });

  it("an RPC error is a RepositoryError, as today", async () => {
    fake = createFakeSupabase(() => ({ error: { code: "PGRST202", message: "Could not find the function" } }));
    db.client = fake.client;
    await expect(getFullOfferByMatch(HOME, AWAY, "premier-league")).rejects.toThrow("Failed to get full offer");
  });
});
