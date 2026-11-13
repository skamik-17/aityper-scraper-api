import { afterEach, describe, expect, it, vi } from "vitest";

// The pick is made once at module load (README §3): a change needs a restart, so each
// case re-imports the module with fresh env.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("per-brand transport selection", () => {
  it.each([
    ["etoto", "SCRAPER_TRANSPORT_ETOTO", "etotoScraper", "EtotoHttpScraper", "EtotoBrowserScraper"],
    ["forbet", "SCRAPER_TRANSPORT_FORBET", "forbetScraper", "ForbetHttpScraper", "ForbetBrowserScraper"],
    ["fuksiarz", "SCRAPER_TRANSPORT_FUKSIARZ", "fuksiarzScraper", "FuksiarzHttpScraper", "FuksiarzBrowserScraper"],
    ["betfan", "SCRAPER_TRANSPORT_BETFAN", "betfanScraper", "BetfanHttpScraper", "BetfanBrowserScraper"],
    ["fortuna", "SCRAPER_TRANSPORT_FORTUNA", "fortunaScraper", "FortunaHttpScraper", "FortunaBrowserScraper"],
    ["superbet", "SCRAPER_TRANSPORT_SUPERBET", "superbetScraper", "SuperbetHttpScraper", "SuperbetBrowserScraper"],
    ["lvbet", "SCRAPER_TRANSPORT_LVBET", "lvbetScraper", "LVBetHttpScraper", "LVBetBrowserScraper"],
  ])(
    "%s: HTTP by default, browser class when %s=browser",
    async (_bm, env, inst, httpCls, browserCls) => {
      vi.stubEnv(env, "");
      vi.resetModules();
      let m: any = await import("../index.js");
      expect(m[inst]).toBeInstanceOf(m[httpCls]);
      vi.stubEnv(env, "browser");
      vi.resetModules();
      m = await import("../index.js");
      expect(m[inst]).toBeInstanceOf(m[browserCls]);
    },
  );

  it.each([["fortuna", "fortunaScraper"], ["superbet", "superbetScraper"], ["lvbet", "lvbetScraper"]])("the audit registry audits the selected %s instance", async (bm, inst) => {
    const m: any = await import("../index.js");
    const reg = await import("../../../services/audit/bookmaker-registry.js");
    expect(reg.getBookmakerAuditTargets(bm)!.scraper).toBe(m[inst]);
  });

  it("superbet no longer opts out of resource blocking", async () => {
    const { DEFAULT_SCRAPER_CONFIGS } = await import("../../../types/scraper.js");
    expect(DEFAULT_SCRAPER_CONFIGS.superbet.disableResourceBlocking).toBeUndefined();
  });
});
