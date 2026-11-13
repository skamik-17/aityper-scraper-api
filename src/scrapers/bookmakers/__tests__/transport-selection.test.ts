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
});
