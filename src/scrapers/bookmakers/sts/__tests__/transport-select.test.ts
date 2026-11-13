import { describe, it, expect, vi, afterEach } from "vitest";
import { createStsScraper, StsBrowserScraper, StsWsScraper, STSScraper, STSPlaywrightScraper } from "../index.js";

afterEach(() => vi.restoreAllMocks());

describe("sts transport selection (README §3 single pick, in the brand module)", () => {
  it("defaults to the WebSocket transport", () => {
    const s = createStsScraper({});
    expect(s).toBeInstanceOf(StsWsScraper);
    expect(s.bookmaker).toBe("sts");
    expect((s as StsWsScraper).transport).toBe("websocket");
  });

  it("SCRAPER_TRANSPORT_STS=browser selects the browser class", () => {
    const s = createStsScraper({ SCRAPER_TRANSPORT_STS: "browser" });
    expect(s).toBeInstanceOf(StsBrowserScraper);
    expect(s.bookmaker).toBe("sts");
    expect("transport" in s).toBe(false);
  });

  it("any other value keeps the WebSocket transport", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createStsScraper({ SCRAPER_TRANSPORT_STS: "ws" })).toBeInstanceOf(StsWsScraper);
    expect(warn).toHaveBeenCalledWith('[transport] Ignoring SCRAPER_TRANSPORT_STS="ws": only "browser" is recognised');
  });

  it("legacy names still point at the browser class", () => {
    expect(STSScraper).toBe(StsBrowserScraper);              // scripts/test-scrapers.sh
    expect(STSPlaywrightScraper).toBe(StsBrowserScraper);
  });

  it("bookmakers/index re-exports the picked instance", async () => {
    expect((await import("../../index.js")).stsScraper).toBe((await import("../index.js")).stsScraper);
  });
});
