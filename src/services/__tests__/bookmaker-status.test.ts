import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG, type PolishBookmaker } from "../../config/index.js";

const repo = vi.hoisted(() => ({
  getRecentRunRows: vi.fn(),
  getLastSuccessfulScrapeTime: vi.fn(),
  getOddsFreshnessByBookmaker: vi.fn(),
}));
vi.mock("../../repositories/scraper-run-repository.js", async () => ({
  getRecentRunRows: repo.getRecentRunRows,
  getLastSuccessfulScrapeTime: repo.getLastSuccessfulScrapeTime,
}));
vi.mock("../../repositories/odds-repository.js", async () => ({
  getOddsFreshnessByBookmaker: repo.getOddsFreshnessByBookmaker,
}));

import {
  deriveBookmakerStatus,
  getBookmakerStatusSnapshot,
  mergeRunRows,
  staleAfterMs,
  STATUS_WINDOW_RUNS,
  summarizeBookmakerRuns,
  worstBookmakerStatus,
  type RunRowLike,
} from "../bookmaker-status.js";

// Real values from evidence/observability/db-probe-2026-11-06.txt and the backend log.
const NOW = new Date("2026-11-06T16:16:18.614Z");
const STALE = staleAfterMs(60);
const row = (bookmaker: string, status: string, started_at: string, extra: Partial<RunRowLike> = {}): RunRowLike => ({
  run_id: null,
  bookmaker,
  status,
  started_at,
  finished_at: null,
  error_message: null,
  matches_found: 0,
  markets_saved: 0,
  ...extra,
});

describe("summarizeBookmakerRuns / deriveBookmakerStatus", () => {
  it("betcris: failed after an earlier success is error, not available", () => {
    const s = summarizeBookmakerRuns(
      [
        row("betcris", "scrape_failed", "2026-11-06T16:00:00.35+00:00", { error_message: "No WebSocket data captured" }),
        row("betcris", "success", "2026-11-06T15:44:03+00:00", {
          finished_at: "2026-11-06T15:46:48.552+00:00",
          matches_found: 20,
          markets_saved: 9753,
        }),
      ],
      ["betcris"],
    ).get("betcris")!;
    expect(s).toMatchObject({
      lastStatus: "scrape_failed",
      consecutiveFailures: 1,
      failingSince: "2026-11-06T16:00:00.350Z",
      lastSuccessAt: "2026-11-06T15:46:48.552Z",
      lastError: "No WebSocket data captured",
    });
    expect(deriveBookmakerStatus(s, new Date("2026-11-06T15:46:48.552Z"), NOW, STALE)).toBe("error");
  });

  it("no run history: fresh odds are available (fortuna, today reported stale)", () =>
    expect(deriveBookmakerStatus(undefined, new Date("2026-11-06T16:00:45.385Z"), NOW, STALE)).toBe("available"));

  it("no run history: August odds or none are stale (lebull, betters)", () => {
    expect(deriveBookmakerStatus(undefined, new Date("2026-08-22T08:00:07.846Z"), NOW, STALE)).toBe("stale");
    expect(deriveBookmakerStatus(undefined, null, NOW, STALE)).toBe("stale");
  });

  it("with run history, the newer of the last OK run and the newest odds decides freshness", () => {
    const oldOk = summarizeBookmakerRuns(
      [row("fortuna", "success", "2026-11-06T13:00:00+00:00", { finished_at: "2026-11-06T13:02:00+00:00" })],
      ["fortuna"],
    ).get("fortuna")!;
    const freshOk = summarizeBookmakerRuns(
      [row("sts", "success", "2026-11-06T16:00:00.35+00:00", { finished_at: "2026-11-06T16:02:49.048+00:00" })],
      ["sts"],
    ).get("sts")!;
    // OK run older than staleAfter, odds written in run 2: the odds keep it available.
    expect(deriveBookmakerStatus(oldOk, new Date("2026-11-06T16:00:45.385Z"), NOW, STALE)).toBe("available");
    // Recent OK run, only August odds left: the run keeps it available.
    expect(deriveBookmakerStatus(freshOk, new Date("2026-08-22T08:00:07.846Z"), NOW, STALE)).toBe("available");
    // Both older than staleAfter.
    expect(deriveBookmakerStatus(oldOk, new Date("2026-08-22T08:00:07.846Z"), NOW, STALE)).toBe("stale");
  });

  it("offset-less timestamps are UTC (defensive, Review Focus 3)", () =>
    expect(summarizeBookmakerRuns([row("sts", "success", "2026-11-06T16:00:00.35")], ["sts"]).get("sts")!.lastSuccessAt).toBe(
      "2026-11-06T16:00:00.350Z",
    ));

  it("mergeRunRows: in-memory rows win, DB duplicates of the same run are dropped (Review Focus 2)", () => {
    const mem = [
      row("betters", "scrape_failed", "2026-11-06T16:00:00.350Z", {
        run_id: "440d2fc6-658b-46fe-b288-05261faa0caf",
        error_message: "mem",
      }),
    ];
    const db = [
      row("betters", "scrape_failed", "2026-11-06T16:00:00.35+00:00", {
        run_id: "440d2fc6-658b-46fe-b288-05261faa0caf",
        error_message: "db",
      }),
      row("betters", "scrape_failed", "2026-11-06T15:00:00+00:00", { run_id: "7067e5f0-35c2-4bae-a045-5501547505a7" }),
    ];
    const merged = mergeRunRows(mem, db);
    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.run_id === "440d2fc6-658b-46fe-b288-05261faa0caf")!.error_message).toBe("mem");
    expect(summarizeBookmakerRuns(merged, ["betters"]).get("betters")!.consecutiveFailures).toBe(2);
  });

  it("mergeRunRows: rows without run_id match on the same instant across timestamp shapes", () => {
    const mem = [row("sts", "success", "2026-11-06T16:00:00.350Z")];
    const db = [row("sts", "success", "2026-11-06T16:00:00.35+00:00"), row("fortuna", "success", "2026-11-06T16:00:00.35+00:00")];
    expect(mergeRunRows(mem, db).map((r) => r.bookmaker)).toEqual(["sts", "fortuna"]);
  });

  it("recovery after 3 failures", () =>
    expect(
      summarizeBookmakerRuns(
        ["success", "scrape_failed", "scrape_failed", "scrape_failed"].map((st, i) => row("pzbuk", st, `2026-11-06T1${6 - i}:00:00Z`)),
        ["pzbuk"],
      ).get("pzbuk"),
    ).toMatchObject({ consecutiveFailures: 0, recoveredAfterFailures: 3 }));

  it("sorts rows newest first whatever the input order, and reads the newest row's fields", () => {
    const s = summarizeBookmakerRuns(
      [
        row("etoto", "empty", "2026-11-06T14:00:00+00:00", { error_message: "Scraper reported success with 0 matches" }),
        row("etoto", "persist_failed", "2026-11-06T16:00:00.35+00:00", {
          error_message: "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)",
          matches_found: 20,
        }),
        row("etoto", "partial", "2026-11-06T13:00:00+00:00", { finished_at: "2026-11-06T13:01:00+00:00", markets_saved: 6000 }),
        row("etoto", "scrape_failed", "2026-11-06T15:00:00+00:00"),
      ],
      ["etoto", "betters"],
    );
    expect(s.get("etoto")).toEqual({
      bookmaker: "etoto",
      lastStatus: "persist_failed",
      lastRunAt: "2026-11-06T16:00:00.350Z",
      lastSuccessAt: "2026-11-06T13:01:00.000Z",
      consecutiveFailures: 3,
      failingSince: "2026-11-06T14:00:00.000Z",
      lastError: "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)",
      lastMatchesFound: 20,
      lastMarketsSaved: 0,
      recoveredAfterFailures: 0,
    });
    // No rows: no summary, so deriveBookmakerStatus falls back to odds freshness.
    expect(s.has("betters")).toBe(false);
  });

  it("staleAfterMs covers one missed run", () => {
    expect(staleAfterMs(60)).toBe(7_200_000);
    expect(staleAfterMs(5)).toBe(3_600_000);
  });

  it("worst status wins", () => {
    expect(worstBookmakerStatus("available", "error")).toBe("error");
    expect(worstBookmakerStatus("error", "stale")).toBe("error");
    expect(worstBookmakerStatus(undefined, "stale")).toBe("stale");
    expect(worstBookmakerStatus("stale", "available")).toBe("stale");
  });
});

describe("getBookmakerStatusSnapshot", () => {
  const freshness = new Map<PolishBookmaker, Date>([
    ["fortuna", new Date("2026-11-06T16:00:45.385Z")],
    ["betcris", new Date("2026-11-06T15:46:48.552Z")],
    ["lebull", new Date("2026-08-22T08:00:07.846Z")],
  ]);
  const runRows = [
    row("betcris", "scrape_failed", "2026-11-06T16:00:00.35+00:00", { error_message: "No WebSocket data captured" }),
    row("sts", "success", "2026-11-06T16:00:00.35+00:00", { finished_at: "2026-11-06T16:02:49.048+00:00", markets_saved: 5130 }),
    row("betcris", "success", "2026-11-06T15:44:03+00:00", { finished_at: "2026-11-06T15:46:48.552+00:00" }),
  ];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    repo.getRecentRunRows.mockResolvedValue(runRows);
    repo.getOddsFreshnessByBookmaker.mockResolvedValue(freshness);
    repo.getLastSuccessfulScrapeTime.mockResolvedValue(new Date("2026-11-06T16:02:49.798Z"));
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("combines run history and odds freshness for every bookmaker", async () => {
    const snap = await getBookmakerStatusSnapshot("premier-league", NOW);
    expect(repo.getRecentRunRows).toHaveBeenCalledWith("premier-league", STATUS_WINDOW_RUNS * CONFIG.BOOKMAKERS.length);
    expect(repo.getOddsFreshnessByBookmaker).toHaveBeenCalledWith("premier-league", CONFIG.BOOKMAKERS);
    expect(repo.getLastSuccessfulScrapeTime).toHaveBeenCalledWith("premier-league");
    expect(snap.source).toBe("scraper_runs");
    expect(Object.keys(snap.status)).toEqual([...CONFIG.BOOKMAKERS]);
    expect(snap.status).toMatchObject({ betcris: "error", sts: "available", fortuna: "available", lebull: "stale", betters: "stale" });
    expect(snap.health.betcris).toEqual({
      status: "error",
      lastSuccessAt: "2026-11-06T15:46:48.552Z",
      failingSince: "2026-11-06T16:00:00.350Z",
      consecutiveFailures: 1,
    });
    expect(snap.health.betters).toEqual({ status: "stale", lastSuccessAt: null, failingSince: null, consecutiveFailures: 0 });
    expect(snap.lastSuccessfulRunAt).toBe("2026-11-06T16:02:49.798Z");
    expect(snap.lastOddsAt.get("fortuna")!.toISOString()).toBe("2026-11-06T16:00:45.385Z");
    expect(snap.summaries.get("sts")).toMatchObject({ lastStatus: "success", lastMarketsSaved: 5130 });
  });

  it("falls back to odds freshness only when scraper_runs cannot be read", async () => {
    repo.getRecentRunRows.mockRejectedValue(new Error("scraper_runs read failed: TypeError: fetch failed"));
    const snap = await getBookmakerStatusSnapshot("premier-league", NOW);
    expect(snap.source).toBe("odds_only");
    expect(snap.summaries.size).toBe(0);
    // Without run history betcris has only its 15:46 odds, which are fresh enough.
    expect(snap.status).toMatchObject({ betcris: "available", fortuna: "available", sts: "stale", lebull: "stale" });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("reports every bookmaker stale when the freshness query fails, as before", async () => {
    repo.getOddsFreshnessByBookmaker.mockRejectedValue(new Error("odds freshness query failed"));
    const snap = await getBookmakerStatusSnapshot("premier-league", NOW);
    expect(Object.values(snap.status).every((s) => s === "stale")).toBe(true);
    expect(Object.values(snap.health).every((h) => h.status === "stale")).toBe(true);
    expect(snap.lastOddsAt.size).toBe(0);
  });

  it("never throws, even when every read fails", async () => {
    repo.getRecentRunRows.mockRejectedValue(new Error("down"));
    repo.getOddsFreshnessByBookmaker.mockRejectedValue(new Error("down"));
    repo.getLastSuccessfulScrapeTime.mockRejectedValue(new Error("down"));
    const snap = await getBookmakerStatusSnapshot("premier-league", NOW);
    expect(snap).toMatchObject({ source: "odds_only", lastSuccessfulRunAt: null });
    expect(Object.keys(snap.health)).toHaveLength(CONFIG.BOOKMAKERS.length);
    expect(Object.values(snap.status).every((s) => s === "stale")).toBe(true);
  });

  it("never throws on rows or a last-success time it cannot parse", async () => {
    repo.getRecentRunRows.mockResolvedValue([row("sts", "success", "not-a-timestamp")]);
    repo.getLastSuccessfulScrapeTime.mockResolvedValue(new Date(NaN));
    const snap = await getBookmakerStatusSnapshot("premier-league", NOW);
    expect(snap).toMatchObject({ source: "odds_only", lastSuccessfulRunAt: null });
    expect(snap.summaries.size).toBe(0);
    // Odds freshness still applies.
    expect(snap.status).toMatchObject({ fortuna: "available", betcris: "available", sts: "stale", lebull: "stale" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("scraper_runs rows unusable for premier-league"));
  });
});
