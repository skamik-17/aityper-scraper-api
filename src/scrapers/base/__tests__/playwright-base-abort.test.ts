import { describe, expect, it, vi } from "vitest";
import { fakeBudget } from "../../../__tests__/helpers/run-fixtures.js";
import { DEFAULT_SCRAPER_CONFIGS, type MatchDetailResult, type ScraperConfig, type ScraperResult } from "../../../types/scraper.js";
import { runInScrapeJob } from "../../shared/job-context.js";
import { PlaywrightScraper, type BrowserSession } from "../playwright-base.js";

const CLOSED = "Target page, context or browser has been closed";
const JOB = { runId: "6f1c2b9e-0d4a-4c43-9a57-2a1f3c0e9b11", bookmaker: "fortuna", league: "premier-league", transport: "browser" } as const;

class AbortTestScraper extends PlaywrightScraper {
  bookmaker = "fortuna" as const;
  config: ScraperConfig = DEFAULT_SCRAPER_CONFIGS.fortuna;
  rejectPending: ((e: Error) => void) | null = null;
  readonly context = {
    close: vi.fn(async () => {
      this.rejectPending?.(new Error(CLOSED));
    }),
  };
  readonly cleanup = vi.fn(async () => {});

  protected async initBrowser(): Promise<BrowserSession> {
    return { page: {}, browser: {}, context: this.context, cleanup: this.cleanup } as unknown as BrowserSession;
  }
  run<T>(op: () => Promise<T>): Promise<T | { error: string }> {
    return this.executeWithBrowser(op, (e) => ({ error: (e as Error).message }));
  }
  scrapeLeague(): Promise<ScraperResult> {
    throw new Error("unused");
  }
  scrapeMatch(): Promise<ScraperResult> {
    throw new Error("unused");
  }
  scrapeMatchDetails(): Promise<MatchDetailResult> {
    throw new Error("unused");
  }
  async extractEventUrls(): Promise<never[]> {
    return [];
  }
}

describe("executeWithBrowser and the job budget", () => {
  it("closes the context when the job budget aborts mid-scrape", async () => {
    const s = new AbortTestScraper();
    const b = fakeBudget(Date.now() + 240_000);
    const p = runInScrapeJob({ ...JOB, budget: b }, () => s.run(() => new Promise<never>((_, rej) => (s.rejectPending = rej))));
    await Promise.resolve();
    await Promise.resolve();
    b.controller.abort(new Error("deadline"));
    expect(await p).toEqual({ error: CLOSED });
    expect(s.context.close).toHaveBeenCalledTimes(1);
    expect(s.cleanup).toHaveBeenCalledTimes(1);
  });

  it("an already-aborted budget closes right after acquisition", async () => {
    const s = new AbortTestScraper();
    const b = fakeBudget(Date.now() + 240_000);
    b.controller.abort(new Error("deadline"));
    await runInScrapeJob({ ...JOB, budget: b }, () => s.run(async () => "done"));
    expect(s.context.close).toHaveBeenCalledTimes(1);
  });

  it("a finished scrape detaches the listener", async () => {
    const s = new AbortTestScraper();
    const b = fakeBudget(Date.now() + 240_000);
    expect(await runInScrapeJob({ ...JOB, budget: b }, () => s.run(async () => "done"))).toBe("done");
    b.controller.abort(new Error("late"));
    expect(s.context.close).not.toHaveBeenCalled();
  });

  it("outside a scrape job nothing is attached", async () => {
    const s = new AbortTestScraper();
    expect(await s.run(async () => "done")).toBe("done");
    expect(s.context.close).not.toHaveBeenCalled();
    expect(s.cleanup).toHaveBeenCalledTimes(1);
  });
});
