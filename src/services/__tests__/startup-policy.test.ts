import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getLastSuccessfulScrapeTime: vi.fn(), getOddsFreshnessByBookmaker: vi.fn() }));
vi.mock("../../repositories/scraper-run-repository.js", async () => ({ getLastSuccessfulScrapeTime: h.getLastSuccessfulScrapeTime }));
vi.mock("../../repositories/odds-repository.js", async () => ({ getOddsFreshnessByBookmaker: h.getOddsFreshnessByBookmaker }));

import { decideStartupScrape, getLastOkRunAt, getStalestOkRunAt } from "../startup-policy.js";

const NOW = new Date("2026-11-07T10:00:00.000Z");
const H = 3_600_000;

beforeEach(() => {
  h.getLastSuccessfulScrapeTime.mockReset();
  h.getOddsFreshnessByBookmaker.mockReset();
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

  it("getStalestOkRunAt: the oldest league wins; any unknown league -> null", async () => {
    h.getLastSuccessfulScrapeTime.mockImplementation(async (league: string) =>
      league === "premier-league" ? new Date("2026-11-07T09:40:00.000Z") : new Date("2026-11-07T08:45:00.000Z"));
    expect(await getStalestOkRunAt(["premier-league", "laliga"])).toEqual(new Date("2026-11-07T08:45:00.000Z"));
    h.getLastSuccessfulScrapeTime.mockImplementation(async (league: string) => (league === "premier-league" ? new Date("2026-11-07T09:40:00.000Z") : null));
    h.getOddsFreshnessByBookmaker.mockResolvedValue(new Map());
    expect(await getStalestOkRunAt(["premier-league", "laliga"])).toBeNull();
  });
});
