import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapedMarket } from "../../types/full-offer.js";
import { createFakeSupabase, type FakeResponse, type RecordedQuery } from "../../__tests__/helpers/fake-supabase.js";

const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));

import { generateMatchId, saveBatchFullOfferMarkets, saveFullOfferMarkets } from "../full-offer-repository.js";

const shapes = JSON.parse(
  readFileSync(new URL("../../services/__tests__/fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url), "utf8"),
);

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

const LEEDS = generateMatchId("Leeds United", "Tottenham Hotspur", "premier-league");
const ARSENAL = generateMatchId("Arsenal", "Hull City", "premier-league");
const PRUNE_OK = { deleted: 3, pruned_matches: 2, prune_skipped: [] };

const two = () => [
  { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", markets: [matchWinner(2.1, 3.4, 3.3), totalGoals("2.5")] },
  { homeTeam: "Arsenal", awayTeam: "Hull City", markets: [matchWinner(1.3, 5.5, 9.0)] },
];

let fake: ReturnType<typeof createFakeSupabase>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

function useFake(respond: (q: RecordedQuery) => FakeResponse) {
  fake = createFakeSupabase(respond);
  db.client = fake.client;
}
const rpcCalls = () => fake.queries.filter((q) => q.table === "rpc:prune_stale_odds");
const rpcArgs = () => rpcCalls()[0].calls[0][1] as Record<string, any>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  useFake((q) => (q.table === "rpc:prune_stale_odds" ? { data: PRUNE_OK } : {}));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  db.client = null;
});

describe("batched stale-row prune", () => {
  it("prunes once per bookmaker save with every written match and its row count, guard off by default", async () => {
    await saveBatchFullOfferMarkets(two(), "forbet", "premier-league");
    expect(rpcCalls()).toHaveLength(1);
    expect(rpcArgs()).toMatchObject({ p_bookmaker: "forbet", p_new_counts: { [LEEDS]: 2, [ARSENAL]: 1 }, p_guard: false });
    expect(typeof rpcArgs().p_scraped_at).toBe("string");
    expect(fake.queries.filter((q) => q.table === "odds" && q.calls.some(([m]) => m === "delete"))).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith("[FullOfferRepo] Pruned 3 stale row(s) across 2 match(es) for forbet");
  });

  it("ODDS_PRUNE_GUARD=true passes p_guard: true", async () => {
    vi.stubEnv("ODDS_PRUNE_GUARD", "true");
    await saveBatchFullOfferMarkets(two(), "forbet", "premier-league");
    expect(rpcArgs().p_guard).toBe(true);
  });

  it("a match with 0 canonical records is sent with 0, not dropped (Review Focus 1)", async () => {
    const matches = two();
    matches[1].markets = [{ ...matchWinner(1.3, 5.5, 9.0), normalizedType: "NOT_IN_CATALOG" } as ScrapedMarket];
    await saveBatchFullOfferMarkets(matches, "forbet", "premier-league");
    expect(rpcArgs().p_new_counts[ARSENAL]).toBe(0);
    expect(rpcArgs().p_new_counts[LEEDS]).toBe(2);
  });

  it("does not prune when a batch failed", async () => {
    useFake((q) => (q.table === "odds" ? { error: shapes.econnrefused } : { data: PRUNE_OK }));
    await saveBatchFullOfferMarkets(two(), "forbet", "premier-league");
    expect(rpcCalls()).toHaveLength(0);
  });

  it("returns degenerate writes as pruneSkipped and warns", async () => {
    useFake((q) =>
      q.table === "rpc:prune_stale_odds"
        ? { data: { deleted: 0, pruned_matches: 1, prune_skipped: [{ match_id: ARSENAL, new_rows: 1, previous_rows: 312 }] } }
        : {},
    );
    const r = await saveBatchFullOfferMarkets(two(), "forbet", "premier-league");
    expect(r.pruneSkipped).toEqual([{ match_id: ARSENAL, new_rows: 1, previous_rows: 312 }]);
    expect(warnSpy).toHaveBeenCalledWith(`[FullOfferRepo] Prune skipped for forbet/${ARSENAL}: degenerate write (1 of 312 rows)`);
  });

  it("no skip leaves pruneSkipped absent", async () => {
    const r = await saveBatchFullOfferMarkets(two(), "forbet", "premier-league");
    expect("pruneSkipped" in r).toBe(false);
  });

  it("a missing function is logged with the migration name and never throws", async () => {
    useFake((q) =>
      q.table === "rpc:prune_stale_odds"
        ? {
            error: {
              code: "PGRST202",
              message: "Could not find the function public.prune_stale_odds(p_bookmaker, p_guard, p_new_counts, p_scraped_at) in the schema cache",
              details: null,
              hint: null,
            },
          }
        : {},
    );
    await expect(saveBatchFullOfferMarkets(two(), "forbet", "premier-league")).resolves.toMatchObject({ inserted: 3 });
    const logged = errorSpy.mock.calls.flat().join("\n");
    expect(logged).toContain("[FullOfferRepo] Stale-row prune failed for forbet: Could not find the function");
    expect(logged).toContain("(apply supabase/migrations/12_odds_quick_wins.sql)");
  });

  it("the single-match save prunes through the same function with a one-entry map", async () => {
    await saveFullOfferMarkets("Arsenal", "Hull City", "forbet", [matchWinner(1.3, 5.5, 9.0)], "premier-league");
    expect(rpcCalls()).toHaveLength(1);
    expect(rpcArgs().p_new_counts).toEqual({ [ARSENAL]: 1 });
  });
});
