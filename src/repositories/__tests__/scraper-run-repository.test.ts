import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookmakerRunOutcome } from "../../services/run-outcome.js";
import { RUN_ID } from "../../__tests__/helpers/run-fixtures.js";
import { createFakeSupabase, type FakeResponse, type RecordedQuery } from "../../__tests__/helpers/fake-supabase.js";

const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));

import {
  deleteScraperRunsOlderThan,
  getAverageScrapeDurations,
  getLastSuccessfulScrapeTime,
  getRecentRunRows,
  getRunsSummary,
  insertBookmakerRunOutcomes,
  toScraperRunInsert,
} from "../scraper-run-repository.js";

const shapes = JSON.parse(
  readFileSync(
    new URL("../../services/__tests__/fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url),
    "utf8",
  ),
);

// The DB-down repro run (evidence/observability/repro-db-down-forbet.txt).
const forbet: BookmakerRunOutcome = {
  runId: "50a12b0c-89a9-43fe-8173-fc718d1b3bdd",
  bookmaker: "forbet",
  league: "premier-league",
  status: "persist_failed",
  matchesFound: 20,
  marketsFound: 5995,
  marketsSaved: 0,
  error: "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)",
  startedAt: new Date("2026-11-06T16:27:40.830Z"),
  finishedAt: new Date("2026-11-06T16:27:48.826Z"),
  durationMs: 7969,
};

const betclic: BookmakerRunOutcome = {
  ...forbet,
  bookmaker: "betclic",
  status: "success",
  marketsFound: 3150,
  marketsSaved: 3150,
  error: null,
};

let fake: ReturnType<typeof createFakeSupabase>;
let errorSpy: ReturnType<typeof vi.spyOn>;

function useFake(respond: (q: RecordedQuery) => FakeResponse) {
  fake = createFakeSupabase(respond);
  db.client = fake.client;
}

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  db.client = null;
});

describe("toScraperRunInsert", () => {
  it("maps an outcome to a scraper_runs row", () =>
    expect(toScraperRunInsert(forbet)).toEqual({
      run_id: "50a12b0c-89a9-43fe-8173-fc718d1b3bdd",
      bookmaker: "forbet",
      league_slug: "premier-league",
      status: "persist_failed",
      matches_found: 20,
      markets_found: 5995,
      markets_saved: 0,
      error_message: forbet.error,
      started_at: "2026-11-06T16:27:40.830Z",
      finished_at: "2026-11-06T16:27:48.826Z",
      duration_ms: 7969,
    }));

  it("truncates error_message to 2000 chars", () =>
    expect(toScraperRunInsert({ ...forbet, error: "x".repeat(5000) }).error_message).toHaveLength(2000));

  it("never cuts error_message between the two halves of a surrogate pair", () => {
    // "😢" is 2 UTF-16 units; at units 1999-2000 a plain slice would keep a lone high surrogate.
    const message = toScraperRunInsert({ ...forbet, error: `${"x".repeat(1999)}😢 page title` }).error_message!;
    expect(message).toBe("x".repeat(1999));
  });
});

describe("insertBookmakerRunOutcomes", () => {
  it("inserts all outcomes in one call", async () => {
    useFake(() => ({}));
    await insertBookmakerRunOutcomes([forbet, betclic]);
    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0]).toMatchObject({ table: "scraper_runs" });
    expect(fake.queries[0].calls).toContainEqual(["insert", [toScraperRunInsert(forbet), toScraperRunInsert(betclic)]]);
  });

  it("does not call the DB for a run without outcomes", async () => {
    useFake(() => ({}));
    await insertBookmakerRunOutcomes([]);
    expect(fake.queries).toHaveLength(0);
  });

  it("throws a formatted error", async () => {
    useFake(() => ({ error: shapes.schemaCacheNotReady }));
    await expect(insertBookmakerRunOutcomes([forbet])).rejects.toThrow(
      "scraper_runs insert failed: Could not query the database for the schema cache. Retrying. [PGRST002]",
    );
  });

  it("names the migration when a column is missing (Review Focus 2)", async () => {
    useFake(() => ({
      error: {
        code: "PGRST204",
        message: "Could not find the 'run_id' column of 'scraper_runs' in the schema cache",
        details: null,
        hint: null,
      },
    }));
    await expect(insertBookmakerRunOutcomes([forbet])).rejects.toThrow(
      "scraper_runs insert failed: Could not find the 'run_id' column of 'scraper_runs' in the schema cache [PGRST204] (apply supabase/migrations/11_scraper_runs_observability.sql)",
    );
  });

  it("formats a client that throws instead of returning { error }", async () => {
    useFake(() => {
      throw new TypeError("fetch failed");
    });
    await expect(insertBookmakerRunOutcomes([forbet])).rejects.toThrow("scraper_runs insert failed: fetch failed");
  });
});

describe("getRecentRunRows", () => {
  it("reads the newest rows of one league", async () => {
    const rows = [{ id: 1, bookmaker: "betters", league_slug: "premier-league", status: "scrape_failed" }];
    useFake(() => ({ data: rows }));
    expect(await getRecentRunRows("premier-league", 700)).toEqual(rows);
    expect(fake.queries[0]).toEqual({
      table: "scraper_runs",
      calls: [
        ["select", "*"],
        ["eq", "league_slug", "premier-league"],
        ["order", "started_at", { ascending: false }],
        ["limit", 700],
      ],
    });
  });

  it("throws a formatted error so callers can fall back", async () => {
    useFake(() => ({ error: shapes.econnrefused }));
    await expect(getRecentRunRows("premier-league", 700)).rejects.toThrow(
      "scraper_runs read failed: TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)",
    );
  });
});

describe("getLastSuccessfulScrapeTime", () => {
  it("last successful scrape is per league, counts partial, and parses +00:00 (Review Focus 3)", async () => {
    useFake(() => ({ data: [{ finished_at: "2026-11-06T16:02:49.798+00:00" }] }));
    expect((await getLastSuccessfulScrapeTime("premier-league"))!.toISOString()).toBe("2026-11-06T16:02:49.798Z");
    expect(fake.queries[0].calls).toContainEqual(["in", "status", ["success", "partial"]]);
    expect(fake.queries[0].calls).toContainEqual(["eq", "league_slug", "premier-league"]);
  });

  it("is global when no league is given", async () => {
    useFake(() => ({ data: [{ finished_at: "2026-11-06T16:02:49.798+00:00" }] }));
    expect((await getLastSuccessfulScrapeTime())!.toISOString()).toBe("2026-11-06T16:02:49.798Z");
    expect(fake.queries[0].calls.some(([method]) => method === "eq")).toBe(false);
  });

  it("returns null on a DB error or without OK runs", async () => {
    useFake(() => ({ error: shapes.econnrefused }));
    expect(await getLastSuccessfulScrapeTime("premier-league")).toBeNull();
    useFake(() => ({ data: [] }));
    expect(await getLastSuccessfulScrapeTime("premier-league")).toBeNull();
  });
});

describe("getRunsSummary", () => {
  it("getRunsSummary groups real +00:00 rows without throwing (today: RangeError -> /api/admin/runs 500)", async () => {
    // Order as the DB returns it (started_at desc). Different minutes: the old minute bucket split them into 2 runs.
    useFake(() => ({
      data: [
        {
          id: 2, run_id: RUN_ID, league_slug: "premier-league", bookmaker: "betters", status: "scrape_failed",
          matches_found: 0, markets_saved: 0, error_message: "No events found from API",
          started_at: "2026-11-06T16:01:30.1+00:00", finished_at: "2026-11-06T16:01:38.2+00:00", duration_ms: 8100,
        },
        {
          id: 1, run_id: RUN_ID, league_slug: "premier-league", bookmaker: "sts", status: "success",
          matches_found: 20, markets_saved: 5130, error_message: null,
          started_at: "2026-11-06T16:00:00.35+00:00", finished_at: "2026-11-06T16:02:49.048+00:00", duration_ms: 168698,
        },
      ],
    }));
    const { runs, total } = await getRunsSummary(20, 0);
    expect(total).toBe(1);
    expect(runs[0].batchId).toBe("440d2fc6-658b-46fe-b288-05261faa0caf");
    expect(runs[0].startedAt.toISOString()).toBe("2026-11-06T16:00:00.350Z");
    expect(runs[0].finishedAt!.toISOString()).toBe("2026-11-06T16:02:49.048Z");
    expect(runs[0].results).toHaveLength(2);
  });

  it("answers before migration 11 is applied instead of failing /api/admin/runs (select names no new column)", async () => {
    // A schema without run_id: PostgREST rejects a select that names the column
    // (42703), and `select *` returns rows that have no run_id key at all.
    useFake((q) => {
      const columns = String(q.calls.find(([method]) => method === "select")?.[1] ?? "");
      if (columns.includes("run_id")) {
        return { error: { code: "42703", details: null, hint: null, message: "column scraper_runs.run_id does not exist" } };
      }
      return {
        data: [
          {
            id: 1, league_slug: "premier-league", bookmaker: "sts", status: "success",
            matches_found: 20, markets_saved: 5130, error_message: null,
            started_at: "2026-11-06T16:00:00.35+00:00", finished_at: "2026-11-06T16:02:49.048+00:00", duration_ms: 168698,
          },
        ],
      };
    });
    const { runs, total } = await getRunsSummary(20, 0);
    expect(total).toBe(1);
    expect(runs[0].batchId).toBe("2026-11-06T16:00:00.000Z-premier-league");
    expect(runs[0].results).toEqual([
      { bookmaker: "sts", status: "success", matchesFound: 20, marketsSaved: 5130, durationMs: 168698, error: undefined },
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("falls back to the minute bucket for rows written before migration 11 (no run_id)", async () => {
    useFake(() => ({
      data: [
        {
          id: 2, run_id: null, league_slug: "premier-league", bookmaker: "fortuna", status: "success",
          matches_found: 20, markets_saved: 12897, error_message: null,
          started_at: "2026-11-06T16:00:40+00:00", finished_at: "2026-11-06T16:00:45.385+00:00", duration_ms: 5000,
        },
        {
          id: 1, run_id: null, league_slug: "premier-league", bookmaker: "sts", status: "success",
          matches_found: 20, markets_saved: 5130, error_message: null,
          started_at: "2026-11-06T16:00:00.35+00:00", finished_at: "2026-11-06T16:02:49.048+00:00", duration_ms: 168698,
        },
      ],
    }));
    const { runs, total } = await getRunsSummary(20, 0);
    expect(total).toBe(1);
    expect(runs[0].batchId).toBe("2026-11-06T16:00:00.000Z-premier-league");
    expect(runs[0].startedAt.toISOString()).toBe("2026-11-06T16:00:00.350Z");
    expect(runs[0].finishedAt!.toISOString()).toBe("2026-11-06T16:02:49.048Z");
  });
});

describe("getAverageScrapeDurations", () => {
  it("averages OK runs (success and partial) per bookmaker", async () => {
    useFake(() => ({
      data: [
        { bookmaker: "sts", duration_ms: 100 },
        { bookmaker: "sts", duration_ms: 201 },
        { bookmaker: "fortuna", duration_ms: 50 },
      ],
    }));
    const averages = await getAverageScrapeDurations();
    expect(Object.fromEntries(averages)).toEqual({ sts: 151, fortuna: 50 });
    expect(fake.queries[0].calls).toContainEqual(["in", "status", ["success", "partial"]]);
  });
});

describe("deleteScraperRunsOlderThan (owner decision B11: keep 30 days)", () => {
  it("deletes rows started before the cutoff and returns the count", async () => {
    useFake(() => ({ count: 4 }));
    const deleted = await deleteScraperRunsOlderThan(30, new Date("2026-11-06T16:16:18.614Z"));
    expect(deleted).toBe(4);
    expect(fake.queries[0]).toEqual({
      table: "scraper_runs",
      calls: [
        ["delete", { count: "exact" }],
        ["lt", "started_at", "2026-10-07T16:16:18.614Z"],
      ],
    });
  });

  it("throws a formatted error", async () => {
    useFake(() => ({ error: shapes.econnrefused }));
    await expect(deleteScraperRunsOlderThan(30, new Date("2026-11-06T16:16:18.614Z"))).rejects.toThrow(
      "scraper_runs prune failed: TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)",
    );
  });
});
