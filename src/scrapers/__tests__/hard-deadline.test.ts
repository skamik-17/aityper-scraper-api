import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBudget, okResult } from "../../__tests__/helpers/run-fixtures.js";
import { scrapeWithHardDeadline } from "../hard-deadline.js";
import { currentScrapeJob } from "../shared/job-context.js";
import type { FullOfferScraper } from "../shared/scraper-contract.js";

const JOB = { runId: "6f1c2b9e-0d4a-4c43-9a57-2a1f3c0e9b11", bookmaker: "forbet", league: "premier-league", transport: "http", maxDurationMs: 120_000 } as const;
let s: FullOfferScraper & { scrapeFullOffer: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-07T10:00:00.000Z") });
  s = { bookmaker: "forbet", scrapeFullOffer: vi.fn(), cleanup: vi.fn(async () => {}) } as never;
});
afterEach(() => vi.useRealTimers());

describe("scrapeWithHardDeadline", () => {
  it("passes a budget ending at start + maxDurationMs and exposes the job context", async () => {
    let seen: unknown;
    s.scrapeFullOffer.mockImplementationOnce(async (league: string, budget: { deadline: number }) => {
      seen = { league, deadline: budget.deadline, job: currentScrapeJob() };
      return okResult("forbet");
    });
    await scrapeWithHardDeadline(s, JOB);
    expect(seen).toMatchObject({ league: "premier-league", deadline: Date.parse("2026-11-07T10:02:00.000Z"), job: { bookmaker: "forbet", runId: JOB.runId } });
  });

  it("a scraper that never resolves becomes 'hard timeout after 120s' at deadline + 5 s, not earlier (Review Focus 1)", async () => {
    s.scrapeFullOffer.mockReturnValueOnce(new Promise(() => {}));
    let done = false;
    const p = scrapeWithHardDeadline(s, JOB).finally(() => (done = true));
    await vi.advanceTimersByTimeAsync(124_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ success: false, bookmaker: "forbet", league: "premier-league", matches: [], error: "hard timeout after 120s", duration: 125_000 });
  });

  it("betcris on the browser gets 600 s", async () => {
    s.scrapeFullOffer.mockReturnValueOnce(new Promise(() => {}));
    let done = false;
    const p = scrapeWithHardDeadline(s, { ...JOB, bookmaker: "betcris", transport: "browser", maxDurationMs: 600_000 }).finally(() => (done = true));
    await vi.advanceTimersByTimeAsync(604_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await p).error).toBe("hard timeout after 600s");
  });

  it("a failure arriving after the deadline is labelled as the hard timeout", async () => {
    s.scrapeFullOffer.mockReturnValueOnce(new Promise((res) => setTimeout(() => res({ success: false, bookmaker: "forbet",
      league: "premier-league", matches: [], error: "page.goto: Target page, context or browser has been closed" }), 121_000)));
    const p = scrapeWithHardDeadline(s, JOB);
    await vi.advanceTimersByTimeAsync(121_000);
    expect((await p).error).toBe("hard timeout after 120s | page.goto: Target page, context or browser has been closed");
  });

  it("rethrows; uses the run signal as the budget's parent", async () => {
    s.scrapeFullOffer.mockRejectedValueOnce(new Error("boom"));
    await expect(scrapeWithHardDeadline(s, JOB)).rejects.toThrow("boom");
    s.scrapeFullOffer.mockResolvedValueOnce(okResult("forbet"));
    const createBudget = vi.fn((ms: number) => fakeBudget(Date.now() + ms));
    const run = new AbortController();
    await scrapeWithHardDeadline(s, JOB, run.signal, { createBudget: createBudget as never });
    expect(createBudget).toHaveBeenCalledWith(120_000, run.signal);
  });
});
