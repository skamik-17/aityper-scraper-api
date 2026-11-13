import { createPzbukScraper, hasFrameCounters, PzbukBrowserScraper, PzbukWsScraper } from "../index.js";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("pzbuk transport selection", () => {
  it("defaults to the WebSocket scraper", () => {
    const s = createPzbukScraper({});
    expect(s).toBeInstanceOf(PzbukWsScraper); expect((s as PzbukWsScraper).transport).toBe("websocket");
  });
  it("returns the browser scraper for SCRAPER_TRANSPORT_PZBUK=browser", () =>
    expect(createPzbukScraper({ SCRAPER_TRANSPORT_PZBUK: "browser" })).toBeInstanceOf(PzbukBrowserScraper));
  it("ignores any other override value", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createPzbukScraper({ SCRAPER_TRANSPORT_PZBUK: "chromium" })).toBeInstanceOf(PzbukWsScraper);
  });
  it("keeps the legacy 1X2 methods only on the browser class", () =>
    expect(["scrapeLeague" in PzbukBrowserScraper.prototype, "scrapeLeague" in PzbukWsScraper.prototype]).toEqual([true, false]));
  it("the smoke reads frame counters from either class (cumulative, both start at zero)", () => {
    for (const s of [createPzbukScraper({}), createPzbukScraper({ SCRAPER_TRANSPORT_PZBUK: "browser" })]) {
      expect(hasFrameCounters(s)).toBe(true);
      expect((s as any).frameCounters()).toEqual({ invalidFrames: 0, chunkedFrames: 0, maxFrameBytes: 0 });
      expect("lastTransportStats" in s).toBe(false);
    }
  });
  it("bookmakers/index exports the picked instance", async () => {
    vi.stubEnv("SCRAPER_TRANSPORT_PZBUK", ""); vi.resetModules();
    const all = await import("../../index.js");
    expect(all.pzbukScraper).toBeInstanceOf(all.PzbukWsScraper);
  });
});
