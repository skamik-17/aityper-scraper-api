import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../../__tests__/helpers/run-fixtures.js";

const m = vi.hoisted(() => ({ cleanupOldOdds: vi.fn() }));
vi.mock("../../repositories/odds-repository.js", async () => ({ cleanupOldOdds: m.cleanupOldOdds }));

import { RETENTION_HOURS, runRetentionCleanup } from "../retention-service.js";

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  m.cleanupOldOdds.mockReset();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

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
});
