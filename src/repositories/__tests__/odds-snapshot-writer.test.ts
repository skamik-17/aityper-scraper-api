import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketSelection } from "../../types/full-offer.js";
import { createFakeSupabase, type FakeResponse, type RecordedQuery } from "../../__tests__/helpers/fake-supabase.js";
import type { OddsInsert } from "../full-offer-repository.js";

const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));

import { toSnapshotRows, writeOddsSnapshots } from "../odds-snapshot-writer.js";

const RUN_ID = "440d2fc6-658b-46fe-b288-05261faa0caf";
const HEADER = {
  match_id: "premier-league:arsenal:hull city",
  league_slug: "premier-league",
  home_team: "Arsenal",
  away_team: "Hull City",
  event_url: null,
  start_time: null,
};
const SEL: MarketSelection[] = [{ name: "1", normalizedName: "HOME", odds: 1.3 } as MarketSelection];

function rec(over: Partial<OddsInsert> = {}): OddsInsert {
  return {
    match_id: HEADER.match_id,
    league_slug: "premier-league",
    home_team: "Arsenal",
    away_team: "Hull City",
    bookmaker: "fortuna",
    market_type_id: 48,
    market_key: "MATCH_WINNER",
    selections: SEL,
    scraped_at: "2026-11-07T10:00:00.000Z",
    ...over,
  };
}

const OK = { received: 40, inserted: 0, updated: 1, unchanged: 39, removed: 2, prune_skipped: false, previous_rows: 40 };

let fake: ReturnType<typeof createFakeSupabase>;
function useFake(respond: (q: RecordedQuery) => FakeResponse) {
  fake = createFakeSupabase(respond);
  db.client = fake.client;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  useFake(() => ({ data: OK }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  db.client = null;
});

describe("odds snapshot writer", () => {
  it("rows carry no per-row match header and use null for absent fields", () =>
    expect(toSnapshotRows([rec({ market_key: "MATCH_WINNER", market_type_id: 48, raw_market_name: "1X2" })])).toEqual([
      { market_key: "MATCH_WINNER", market_type_id: 48, param_value: null, custom_name: null, raw_market_name: "1X2", selections: SEL },
    ]));

  it("one rpc per match, in order, with the run id", async () => {
    const leeds = { ...HEADER, match_id: "premier-league:leeds united:tottenham hotspur", home_team: "Leeds United", away_team: "Tottenham Hotspur" };
    await writeOddsSnapshots(RUN_ID, "fortuna", [{ header: HEADER, records: [rec()] }, { header: leeds, records: [] }]);
    expect(fake.queries.map((q) => q.table)).toEqual(["rpc:save_odds_snapshot", "rpc:save_odds_snapshot"]);
    expect(fake.queries[0].calls[0][1]).toMatchObject({ p_run_id: RUN_ID, p_bookmaker: "fortuna", p_match: HEADER, p_guard: false });
    expect(fake.queries[1].calls[0][1]).toMatchObject({ p_match: leeds, p_rows: [] });
  });

  it("ODDS_PRUNE_GUARD=true passes p_guard: true", async () => {
    vi.stubEnv("ODDS_PRUNE_GUARD", "true");
    await writeOddsSnapshots(RUN_ID, "fortuna", [{ header: HEADER, records: [rec()] }]);
    expect(fake.queries[0].calls[0][1]).toMatchObject({ p_guard: true });
  });

  it("sums the counts of successful calls", async () => {
    const s = await writeOddsSnapshots(RUN_ID, "fortuna", [
      { header: HEADER, records: [rec()] },
      { header: { ...HEADER, match_id: "premier-league:b:c" }, records: [rec()] },
    ]);
    expect(s).toMatchObject({ calls: 2, failedCalls: 0, failedRows: 0, firstError: null, received: 80, inserted: 0, updated: 2, unchanged: 78, removed: 4, pruneSkipped: [] });
    expect(s.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("a failed call is counted, formatted, and the next match is still written (Review Focus 3)", async () => {
    useFake(() =>
      fake.queries.length === 1
        ? {
            error: {
              code: "23505",
              message: 'duplicate key value violates unique constraint "_incoming_pkey"',
              details: "Key (market_key)=(MATCH_WINNER) already exists.",
              hint: null,
            },
          }
        : { data: OK },
    );
    const s = await writeOddsSnapshots(RUN_ID, "fortuna", [
      { header: HEADER, records: [rec()] },
      { header: { ...HEADER, match_id: "premier-league:b:c" }, records: [rec(), rec({ market_key: "K2" })] },
    ]);
    expect(s).toMatchObject({
      calls: 2,
      failedCalls: 1,
      failedRows: 1,
      received: 40,
      firstError: 'duplicate key value violates unique constraint "_incoming_pkey" [23505]: Key (market_key)=(MATCH_WINNER) already exists.',
    });
  });

  it("collects degenerate snapshots", async () => {
    useFake(() => ({ data: { ...OK, received: 2, prune_skipped: true, previous_rows: 38 } }));
    const s = await writeOddsSnapshots(RUN_ID, "fortuna", [{ header: HEADER, records: [rec(), rec({ market_key: "K2" })] }]);
    expect(s.pruneSkipped).toEqual([{ match_id: HEADER.match_id, new_rows: 2, previous_rows: 38 }]);
  });

  it("never throws when the client rejects", async () => {
    useFake(() => {
      throw new Error("fetch failed");
    });
    const s = await writeOddsSnapshots(RUN_ID, "fortuna", [{ header: HEADER, records: [rec()] }]);
    expect(s).toMatchObject({ calls: 1, failedCalls: 1, failedRows: 1, firstError: "fetch failed" });
  });
});
