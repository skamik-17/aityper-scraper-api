import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../../__tests__/helpers/run-fixtures.js";

const m = vi.hoisted(() => ({ cleanupOldOdds: vi.fn(), cleanupOdds: vi.fn(), deleteScraperRunsOlderThan: vi.fn() }));
vi.mock("../../repositories/odds-repository.js", async () => ({ cleanupOldOdds: m.cleanupOldOdds, cleanupOdds: m.cleanupOdds }));
vi.mock("../../repositories/scraper-run-repository.js", async () => ({ deleteScraperRunsOlderThan: m.deleteScraperRunsOlderThan }));

import { RETENTION_HOURS, runRetentionCleanup } from "../retention-service.js";

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  m.cleanupOldOdds.mockReset();
  m.cleanupOdds.mockReset();
  m.deleteScraperRunsOlderThan.mockReset();
  m.cleanupOldOdds.mockResolvedValue({ deleted: 0 });
  m.cleanupOdds.mockResolvedValue({ current: 0, matches: 0, snapshots: 0, history: 0 });
  m.deleteScraperRunsOlderThan.mockResolvedValue(0);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runRetentionCleanup", () => {
  it("wraps cleanupOldOdds(24) and logs the count", async () => {
    m.cleanupOldOdds.mockResolvedValueOnce({ deleted: 108_000 });
    expect(await runRetentionCleanup()).toMatchObject({ deleted: 108_000, error: null });
    expect(m.cleanupOldOdds).toHaveBeenCalledWith(24);
    expect(RETENTION_HOURS).toBe(24);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[Retention\] deleted 108000 odds rows older than 24h in \d+ms$/));
  });

  it("never throws", async () => {
    m.cleanupOldOdds.mockRejectedValueOnce(new Error("TypeError: fetch failed"));
    expect(await runRetentionCleanup()).toMatchObject({ deleted: 0, error: "TypeError: fetch failed" });
    expect(errorSpy).toHaveBeenCalledWith("[Retention] cleanup failed: TypeError: fetch failed");
  });

  it("is single-flight (03:00 cron overlapping a post-run call)", async () => {
    const d = deferred<{ deleted: number }>();
    m.cleanupOldOdds.mockReturnValueOnce(d.promise);
    const [a, b] = [runRetentionCleanup(), runRetentionCleanup()];
    d.resolve({ deleted: 7 });
    expect(await a).toBe(await b);
    expect(m.cleanupOldOdds).toHaveBeenCalledTimes(1);
    // The next call after it settled runs again
    m.cleanupOldOdds.mockResolvedValueOnce({ deleted: 0 });
    await runRetentionCleanup();
    expect(m.cleanupOldOdds).toHaveBeenCalledTimes(2);
  });

  it.each([["legacy", 1, 0], ["dual", 1, 0], ["switched", 1, 1], ["snapshot", 0, 1]] as const)(
    "%s runs legacy %i, model %i, scraper_runs always",
    async (model, legacy, snapshot) => {
      vi.stubEnv("ODDS_WRITE_MODEL", model);
      await runRetentionCleanup();
      expect(m.cleanupOldOdds).toHaveBeenCalledTimes(legacy);
      expect(m.cleanupOdds).toHaveBeenCalledTimes(snapshot);
      expect(m.deleteScraperRunsOlderThan).toHaveBeenCalledWith(30);
    },
  );

  it("snapshot model logs odds rows and the breakdown in the shared [Retention] format", async () => {
    m.cleanupOdds.mockResolvedValueOnce({ current: 412, matches: 33, snapshots: 2, history: 0 });
    m.deleteScraperRunsOlderThan.mockResolvedValueOnce(3);
    vi.stubEnv("ODDS_WRITE_MODEL", "snapshot");
    expect(await runRetentionCleanup()).toMatchObject({ deleted: 412, error: null });
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(
      /^\[Retention\] deleted 412 odds rows \(snapshot model\) in \d+ms \(matches=33, snapshots=2, scraper_runs=3\)$/m,
    );
  });

  it("switched sums legacy and model odds rows; each step failing is isolated", async () => {
    vi.stubEnv("ODDS_WRITE_MODEL", "switched");
    m.cleanupOldOdds.mockResolvedValueOnce({ deleted: 100 });
    m.cleanupOdds.mockRejectedValueOnce(new Error("cleanup_odds failed: boom"));
    m.deleteScraperRunsOlderThan.mockResolvedValueOnce(1);
    const r = await runRetentionCleanup();
    expect(r).toMatchObject({ deleted: 100, error: "cleanup_odds failed: boom" });
    expect(m.deleteScraperRunsOlderThan).toHaveBeenCalledWith(30);
    expect(errorSpy).toHaveBeenCalledWith("[Retention] cleanup failed: cleanup_odds failed: boom");
  });
});
