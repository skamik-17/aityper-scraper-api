import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapedMarket } from "../../types/full-offer.js";
import { createFakeSupabase, type FakeResponse, type RecordedQuery } from "../../__tests__/helpers/fake-supabase.js";

const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));

import { saveBatchFullOfferMarkets } from "../full-offer-repository.js";

const RUN_ID = "440d2fc6-658b-46fe-b288-05261faa0caf";

function matchWinner(home: number, draw: number, away: number): ScrapedMarket {
  return {
    name: "1X2",
    normalizedType: "MATCH_WINNER",
    marketKey: "MATCH_WINNER",
    selections: [
      { name: "1", normalizedName: "HOME", odds: home },
      { name: "X", normalizedName: "DRAW", odds: draw },
      { name: "2", normalizedName: "AWAY", odds: away },
    ],
  } as ScrapedMarket;
}

function totalGoals(line: string): ScrapedMarket {
  return {
    name: `Liczba goli ${line}`,
    normalizedType: "TOTAL_GOALS",
    marketKey: `TOTAL_GOALS:${line}`,
    paramValue: line,
    selections: [
      { name: "Powyżej", normalizedName: "OVER", odds: 1.9 },
      { name: "Poniżej", normalizedName: "UNDER", odds: 1.9 },
    ],
  } as ScrapedMarket;
}

// Two matches, 3 canonical records
const two = () => [
  { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", markets: [matchWinner(2.1, 3.4, 3.3), totalGoals("2.5")], eventUrl: "https://fortuna.test/1" },
  { homeTeam: "Arsenal", awayTeam: "Hull City", markets: [matchWinner(1.3, 5.5, 9.0)], startTime: "2030-01-01T15:00:00Z" },
];

const SNAP = (received: number) => ({ received, inserted: received, updated: 0, unchanged: 0, removed: 0, prune_skipped: false, previous_rows: null });

let fake: ReturnType<typeof createFakeSupabase>;
let errorSpy: ReturnType<typeof vi.spyOn>;
function useFake(respond: (q: RecordedQuery) => FakeResponse) {
  fake = createFakeSupabase(respond);
  db.client = fake.client;
}
const tables = () => fake.queries.map((q) => q.table);
const snapshotArgs = () => fake.queries.filter((q) => q.table === "rpc:save_odds_snapshot").map((q) => q.calls[0][1] as Record<string, any>);

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  useFake((q) => {
    if (q.table === "rpc:save_odds_snapshot") {
      const rows = ((q.calls[0][1] as { p_rows: unknown[] }).p_rows ?? []).length;
      return { data: SNAP(rows) };
    }
    if (q.table === "rpc:prune_stale_odds") return { data: { deleted: 0, pruned_matches: 2, prune_skipped: [] } };
    return {};
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  db.client = null;
});

describe("saveBatchFullOfferMarkets: write models", () => {
  it("legacy: no snapshot RPC", async () => {
    const r = await saveBatchFullOfferMarkets(two(), "fortuna", "premier-league", { runId: RUN_ID });
    expect(tables()).not.toContain("rpc:save_odds_snapshot");
    expect(r).toMatchObject({ inserted: 3, errors: 0, snapshot: null, secondaryFailures: 0 });
  });

  it("dual: legacy is primary and the snapshot leg gets every written match with its header", async () => {
    vi.stubEnv("ODDS_WRITE_MODEL", "dual");
    const r = await saveBatchFullOfferMarkets(two(), "fortuna", "premier-league", { runId: RUN_ID });
    expect(tables()).toEqual(["odds", "rpc:prune_stale_odds", "rpc:save_odds_snapshot", "rpc:save_odds_snapshot"]);
    const [leeds, arsenal] = snapshotArgs();
    expect(leeds).toMatchObject({ p_run_id: RUN_ID, p_bookmaker: "fortuna", p_match: { league_slug: "premier-league", event_url: "https://fortuna.test/1", start_time: null } });
    expect(leeds.p_rows).toHaveLength(2);
    expect(arsenal).toMatchObject({ p_match: { event_url: null, start_time: "2030-01-01T15:00:00Z" } });
    expect(r).toMatchObject({ inserted: 3, errors: 0, totalBatches: 1, secondaryFailures: 0, snapshot: { calls: 2, received: 3 } });
  });

  it("dual: a snapshot failure is logged, not an error", async () => {
    vi.stubEnv("ODDS_WRITE_MODEL", "dual");
    useFake((q) => (q.table === "rpc:save_odds_snapshot" ? { error: { message: "boom", code: "XX000" } } : {}));
    const r = await saveBatchFullOfferMarkets(two(), "fortuna", "premier-league", { runId: RUN_ID });
    expect(r).toMatchObject({ inserted: 3, errors: 0, failedBatches: 0, secondaryFailures: 2 });
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("[FullOfferRepo] snapshot write (secondary) failed for fortuna: boom [XX000]");
  });

  it("switched: snapshot counts are primary and the legacy leg still runs", async () => {
    vi.stubEnv("ODDS_WRITE_MODEL", "switched");
    const r = await saveBatchFullOfferMarkets(two(), "fortuna", "premier-league", { runId: RUN_ID });
    expect(r).toMatchObject({ inserted: 3, errors: 0, totalBatches: 2, failedBatches: 0, firstError: null, secondaryFailures: 0 });
    expect(tables()).toContain("odds");
    expect(tables()).toContain("rpc:prune_stale_odds");
    expect(tables().indexOf("rpc:save_odds_snapshot")).toBeLessThan(tables().indexOf("odds"));
  });

  it("switched: a legacy failure is secondary and never touches errors", async () => {
    vi.stubEnv("ODDS_WRITE_MODEL", "switched");
    useFake((q) => {
      if (q.table === "rpc:save_odds_snapshot") return { data: SNAP(((q.calls[0][1] as { p_rows: unknown[] }).p_rows).length) };
      if (q.table === "odds") return { error: { message: "fetch failed" } };
      return {};
    });
    const r = await saveBatchFullOfferMarkets(two(), "fortuna", "premier-league", { runId: RUN_ID });
    expect(r).toMatchObject({ inserted: 3, errors: 0, failedBatches: 0, secondaryFailures: 1 });
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("[FullOfferRepo] legacy write (secondary) failed for fortuna: fetch failed");
  });

  it("snapshot: no legacy upsert and no prune RPC", async () => {
    vi.stubEnv("ODDS_WRITE_MODEL", "snapshot");
    const r = await saveBatchFullOfferMarkets(two(), "fortuna", "premier-league", { runId: RUN_ID });
    expect(tables()).toEqual(["rpc:save_odds_snapshot", "rpc:save_odds_snapshot"]);
    expect(r).toMatchObject({ inserted: 3, errors: 0, totalBatches: 2 });
  });

  it("snapshot: a failed call counts its rows as errors and its cause as firstError", async () => {
    vi.stubEnv("ODDS_WRITE_MODEL", "snapshot");
    useFake((q) =>
      fake.queries.indexOf(q) === 0 ? { error: { message: "boom", code: "XX000" } } : { data: SNAP(((q.calls[0][1] as { p_rows: unknown[] }).p_rows).length) },
    );
    const r = await saveBatchFullOfferMarkets(two(), "fortuna", "premier-league", { runId: RUN_ID });
    expect(r).toMatchObject({ inserted: 1, errors: 2, totalBatches: 2, failedBatches: 1, firstError: "boom [XX000]" });
  });
});
