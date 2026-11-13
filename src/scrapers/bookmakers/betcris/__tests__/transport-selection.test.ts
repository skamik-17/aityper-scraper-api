import { describe, it, expect, vi, afterEach } from "vitest";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../../types/scraper.js";

describe("betcris transport selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("betcrisScraper defaults to the Swarm transport", async () => {
    vi.stubEnv("SCRAPER_TRANSPORT_BETCRIS", ""); vi.resetModules();
    const m = await import("../index.js");
    expect(m.betcrisScraper).toBeInstanceOf(m.BetcrisSwarmScraper);
    expect((m.betcrisScraper as any).transport).toBe("websocket");
  });

  it("SCRAPER_TRANSPORT_BETCRIS=browser selects BetcrisBrowserScraper", async () => {
    vi.stubEnv("SCRAPER_TRANSPORT_BETCRIS", "browser"); vi.resetModules();
    const m = await import("../index.js");
    expect(m.betcrisScraper).toBeInstanceOf(m.BetcrisBrowserScraper);
  });

  it("bookmakers/index re-exports the selected instance, both classes and the legacy alias", async () => {
    const all: any = await import("../../index.js"); const b: any = await import("../index.js");
    expect(all.betcrisScraper).toBe(b.betcrisScraper);
    expect(b.BetcrisSwarmScraper).toBeDefined(); // undefined === undefined would pass the next line
    expect(all.BetcrisSwarmScraper).toBe(b.BetcrisSwarmScraper);
    expect(all.BetcrisPlaywrightScraper).toBe(b.BetcrisBrowserScraper);
  });

  it("the job budget follows the picked instance: websocket 120 s by default, the 720 s browser budget for the fallback", async () => {
    const { resolveJobTransport, maxDurationMsFor } = await import("../../../job-policy.js");
    vi.stubEnv("SCRAPER_TRANSPORT_BETCRIS", ""); vi.resetModules();
    const swarm = (await import("../index.js")).betcrisScraper;
    expect(resolveJobTransport(swarm)).toBe("websocket");
    expect(maxDurationMsFor("betcris", resolveJobTransport(swarm))).toBe(120_000);
    vi.stubEnv("SCRAPER_TRANSPORT_BETCRIS", "browser"); vi.resetModules();
    const { resolveJobTransport: resolveFresh } = await import("../../../job-policy.js");
    const browser = (await import("../index.js")).betcrisScraper;
    expect(resolveFresh(browser)).toBe("browser");
    expect(maxDurationMsFor("betcris", resolveFresh(browser))).toBe(720_000);
  });

  it("the browser fallback never blocks resources (CSS blocked = 0 matches)", () => {
    // plan 08 Task 3 rewrites this guard to resolveBrowserPolicy("betcris", …) with no stylesheet pattern (cross-plan #5)
    expect(DEFAULT_SCRAPER_CONFIGS.betcris.disableResourceBlocking).toBe(true);
  });
});
