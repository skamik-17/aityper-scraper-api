import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type RecordedQuery } from "../../__tests__/helpers/fake-supabase.js";

let rows: unknown[] = [];
let dbError: unknown = null;
let rpcData: unknown = null;
let rpcError: unknown = null;

const respond = (q: RecordedQuery) => {
  if (q.table === "odds_snapshot") return dbError ? { error: dbError } : { data: rows };
  if (q.table === "rpc:record_incremental_pass") return rpcError ? { error: rpcError } : { data: rpcData };
  throw new Error(`unexpected query ${q.table}`);
};
let fake = createFakeSupabase(respond);

vi.mock("../../config/database.js", async () => ({ getSupabase: () => fake.client }));

const { getIncrementalState, recordIncrementalPass } = await import("../incremental-state-repository.js");

beforeEach(() => {
  rows = [];
  dbError = null;
  rpcData = null;
  rpcError = null;
  fake = createFakeSupabase(respond);
});

describe("incremental state repository", () => {
  it("reads state for one league and bookmaker", async () => {
    rows = [
      { match_id: "premier-league:leeds:tottenham", status: "ok", last_detail_at: "2026-11-07T11:50:00+00:00", listing_fingerprint: "41f59ecfdb96fa22" },
      { match_id: "premier-league:arsenal:hull city", status: "degenerate", last_detail_at: null, listing_fingerprint: null },
    ];
    const m = await getIncrementalState("premier-league", "forbet");
    expect(fake.queries[0]).toEqual({
      table: "odds_snapshot",
      calls: [
        ["select", "match_id,status,last_detail_at,listing_fingerprint"],
        ["eq", "league_slug", "premier-league"],
        ["eq", "bookmaker", "forbet"],
      ],
    });
    expect(m.get("premier-league:leeds:tottenham")).toEqual({
      lastDetailAt: Date.parse("2026-11-07T11:50:00Z"),
      fingerprint: "41f59ecfdb96fa22",
      status: "ok",
    });
    expect(m.get("premier-league:arsenal:hull city")).toEqual({ lastDetailAt: null, fingerprint: null, status: "degenerate" });
  });

  it("throws with the DB cause", async () => {
    dbError = { code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." };
    await expect(getIncrementalState("premier-league", "forbet")).rejects.toThrow(
      "odds_snapshot state read failed: Could not query the database for the schema cache. Retrying. [PGRST002]",
    );
  });

  it("calls the RPC with match ids, fingerprints and caps", async () => {
    rpcData = { stamped: 2, confirmed: 15, not_confirmed: 1, confirmed_rows: 4210 };
    expect(
      await recordIncrementalPass(
        "440d2fc6-658b-46fe-b288-05261faa0caf",
        "forbet",
        [{ matchKey: "premier-league:leeds:tottenham", fingerprint: "aaaa" }],
        [{ matchKey: "premier-league:arsenal:hull city", fingerprint: null }],
      ),
    ).toEqual({ stamped: 2, confirmed: 15, notConfirmed: 1, confirmedRows: 4210 });
    expect(fake.queries.find((q) => q.table === "rpc:record_incremental_pass")!.calls[0][1]).toEqual({
      p_run_id: "440d2fc6-658b-46fe-b288-05261faa0caf",
      p_bookmaker: "forbet",
      p_fetched: [{ match_id: "premier-league:leeds:tottenham", fingerprint: "aaaa" }],
      p_confirmed: [{ match_id: "premier-league:arsenal:hull city", fingerprint: null }],
      p_cap_near: "2 hours",
      p_cap_far: "6 hours",
    });
  });

  it("throws when the RPC fails", async () => {
    rpcError = { code: "PGRST202", message: "Could not find the function public.record_incremental_pass" };
    await expect(recordIncrementalPass("440d2fc6-658b-46fe-b288-05261faa0caf", "forbet", [], [])).rejects.toThrow(
      "record_incremental_pass failed: Could not find the function public.record_incremental_pass [PGRST202]",
    );
  });
});
