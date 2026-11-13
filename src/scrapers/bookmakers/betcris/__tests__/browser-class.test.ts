import { describe, it, expect } from "vitest";

describe("betcris browser class", () => {
  it("bookmakers/index keeps BetcrisPlaywrightScraper as an alias of BetcrisBrowserScraper (test-scrapers.sh, scraper-flow.test.ts)", async () => {
    const all: any = await import("../../index.js"); const b: any = await import("../index.js");
    expect(b.BetcrisBrowserScraper).toBeDefined();
    expect(b.BetcrisPlaywrightScraper).toBe(b.BetcrisBrowserScraper);
    expect(all.BetcrisPlaywrightScraper).toBe(b.BetcrisBrowserScraper);
    expect(all.betcrisScraper).toBe(b.betcrisScraper);
  });
});
