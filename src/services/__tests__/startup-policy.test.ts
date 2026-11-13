import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getLastSuccessfulScrapeTime: vi.fn(), getOddsFreshnessByBookmaker: vi.fn(), getRecentRunRows: vi.fn() }));
vi.mock("../../repositories/scraper-run-repository.js", async () => ({
  getLastSuccessfulScrapeTime: h.getLastSuccessfulScrapeTime,
  getRecentRunRows: h.getRecentRunRows,
}));
vi.mock("../../repositories/odds-repository.js", async () => ({ getOddsFreshnessByBookmaker: h.getOddsFreshnessByBookmaker }));

import { decideStartupScrape, getLastOkRunAt, getStalestOkRunAt } from "../startup-policy.js";
import { CONFIG } from "../../config/index.js";
import { isLeagueSupported } from "../../config/leagues.js";

const NOW = new Date("2026-11-07T10:00:00.000Z");
const H = 3_600_000;

// scraper_runs rows, newest first: every supported bookmaker reported at `at`, except `older`
function rowsFor(league: string, at: string, older: Record<string, string | null> = {}) {
  return CONFIG.BOOKMAKERS.filter((bm) => isLeagueSupported(league, bm) && older[bm] !== null)
    .map((bm) => ({ bookmaker: bm, league_slug: league, status: "success", started_at: older[bm] ?? at, finished_at: older[bm] ?? at }))
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
}

beforeEach(() => {
  h.getLastSuccessfulScrapeTime.mockReset();
  h.getOddsFreshnessByBookmaker.mockReset();
  h.getRecentRunRows.mockReset();
  h.getRecentRunRows.mockImplementation(async (league: string) => rowsFor(league, "2026-11-07T09:02:49.798+00:00"));
});

describe("decideStartupScrape", () => {
  it("auto: fresh -> resume the cadence; stale -> scrape in 5 s; due within 5 s -> clamped", () => {
    expect(decideStartupScrape("auto", new Date("2026-11-07T09:40:00.000Z"), NOW, H))
      .toEqual({ firstTrigger: "interval", firstDelayMs: 2_400_000, reason: "auto: last OK run 20 min ago < 60 min" });
    expect(decideStartupScrape("auto", new Date("2026-11-07T08:45:00.000Z"), NOW, H))
      .toEqual({ firstTrigger: "startup", firstDelayMs: 5_000, reason: "auto: last OK run 75 min ago >= 60 min" });
    expect(decideStartupScrape("auto", new Date("2026-11-07T09:00:01.000Z"), NOW, H)).toMatchObject({ firstTrigger: "interval", firstDelayMs: 5_000 });
  });

  it("auto: unknown freshness scrapes (Review Focus 4); always / never", () => {
    expect(decideStartupScrape("auto", null, NOW, H)).toEqual({ firstTrigger: "startup", firstDelayMs: 5_000, reason: "auto: no OK run on record" });
    expect(decideStartupScrape("always", NOW, NOW, H)).toEqual({ firstTrigger: "startup", firstDelayMs: 5_000, reason: "STARTUP_SCRAPE=always" });
    expect(decideStartupScrape("never", null, NOW, H)).toEqual({ firstTrigger: "interval", firstDelayMs: H, reason: "STARTUP_SCRAPE=never" });
  });
});

describe("freshness lookups", () => {
  it("getLastOkRunAt prefers scraper_runs, falls back to the newest odds row, maps errors to null (Review Focus 4)", async () => {
    h.getLastSuccessfulScrapeTime.mockResolvedValueOnce(new Date("2026-11-07T09:02:49.798Z"));
    expect(await getLastOkRunAt("premier-league")).toEqual(new Date("2026-11-07T09:02:49.798Z"));
    expect(h.getOddsFreshnessByBookmaker).not.toHaveBeenCalled();
    h.getLastSuccessfulScrapeTime.mockResolvedValueOnce(null);
    h.getOddsFreshnessByBookmaker.mockResolvedValueOnce(new Map([["sts", new Date("2026-11-07T09:02:49.048Z")], ["fortuna", new Date("2026-11-07T09:00:45.385Z")]]));
    expect(await getLastOkRunAt("premier-league")).toEqual(new Date("2026-11-07T09:02:49.048Z"));
    h.getLastSuccessfulScrapeTime.mockResolvedValueOnce(null);
    h.getOddsFreshnessByBookmaker.mockRejectedValueOnce(new Error("TypeError: fetch failed"));
    expect(await getLastOkRunAt("premier-league")).toBeNull();
  });

  it("a run interrupted before the browser bookmakers finished leaves the league as old as their last outcome", async () => {
    h.getLastSuccessfulScrapeTime.mockResolvedValue(new Date("2026-11-07T09:58:00.000Z"));
    h.getRecentRunRows.mockResolvedValue(rowsFor("premier-league", "2026-11-07T09:58:00.000+00:00", {
      betcris: "2026-11-07T08:55:00.000+00:00",
      pzbuk: "2026-11-07T08:57:00.000+00:00",
    }));
    expect(await getLastOkRunAt("premier-league")).toEqual(new Date("2026-11-07T08:55:00.000Z"));
    expect(h.getRecentRunRows).toHaveBeenCalledWith("premier-league", expect.any(Number));
  });

  it("a one-bookmaker admin run does not make the league fresh; a failing bookmaker's outcome still counts", async () => {
    h.getLastSuccessfulScrapeTime.mockResolvedValue(new Date("2026-11-07T09:59:00.000Z"));
    const rows = rowsFor("premier-league", "2026-11-07T08:50:00.000+00:00", { forbet: "2026-11-07T09:59:00.000+00:00" });
    rows.find((r) => r.bookmaker === "totalbet")!.status = "scrape_failed";
    h.getRecentRunRows.mockResolvedValue(rows);
    expect(await getLastOkRunAt("premier-league")).toEqual(new Date("2026-11-07T08:50:00.000Z"));
  });

  it("a supported bookmaker without any outcome on record makes freshness unknown (null)", async () => {
    h.getLastSuccessfulScrapeTime.mockResolvedValue(new Date("2026-11-07T09:58:00.000Z"));
    h.getRecentRunRows.mockResolvedValue(rowsFor("premier-league", "2026-11-07T09:58:00.000+00:00", { pzbuk: null }));
    expect(await getLastOkRunAt("premier-league")).toBeNull();
  });

  it("getStalestOkRunAt: the oldest league wins; any unknown league -> null", async () => {
    h.getLastSuccessfulScrapeTime.mockImplementation(async (league: string) =>
      league === "premier-league" ? new Date("2026-11-07T09:40:00.000Z") : new Date("2026-11-07T08:45:00.000Z"));
    h.getRecentRunRows.mockImplementation(async (league: string) =>
      rowsFor(league, league === "premier-league" ? "2026-11-07T09:40:00.000+00:00" : "2026-11-07T08:45:00.000+00:00"));
    expect(await getStalestOkRunAt(["premier-league", "laliga"])).toEqual(new Date("2026-11-07T08:45:00.000Z"));
    h.getLastSuccessfulScrapeTime.mockImplementation(async (league: string) => (league === "premier-league" ? new Date("2026-11-07T09:40:00.000Z") : null));
    h.getOddsFreshnessByBookmaker.mockResolvedValue(new Map());
    expect(await getStalestOkRunAt(["premier-league", "laliga"])).toBeNull();
  });
});
