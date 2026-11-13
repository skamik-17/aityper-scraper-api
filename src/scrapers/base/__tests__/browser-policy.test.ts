import { afterEach, describe, expect, it, vi } from "vitest";
import type { PolishBookmaker } from "../../../config/index.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { NEVER_BLOCK_HOSTS, TRACKER_HOSTS } from "../browser-blocklist.js";
import { blockedUrlPatterns, DEFAULT_BROWSER_POLICY, resolveBrowserPolicy } from "../browser-policy.js";

afterEach(() => vi.restoreAllMocks());

describe("resolveBrowserPolicy", () => {
  it("defaults to none/false/240000", () =>
    expect(resolveBrowserPolicy("fortuna", {}, {})).toEqual({ block: "none", stealth: false, maxSessionMs: 240_000 }));

  it("DEFAULT_BROWSER_POLICY is inert", () =>
    expect(DEFAULT_BROWSER_POLICY).toEqual({ block: "none", stealth: false, maxSessionMs: 240_000 }));

  it("sts sessions live 360 s, betcris 720 s and pzbuk 600 s (plan 07 budgets; Review Focus 6)", () =>
    expect(
      (["sts", "betcris", "pzbuk"] as PolishBookmaker[]).map((bm) => resolveBrowserPolicy(bm, DEFAULT_SCRAPER_CONFIGS[bm], {}).maxSessionMs),
    ).toEqual([360_000, 720_000, 600_000]));

  it("config wins over the default; missing fields come from the default", () =>
    expect(resolveBrowserPolicy("fortuna", { policy: { browser: { block: "media", stealth: false } } }, {})).toEqual({
      block: "media",
      stealth: false,
      maxSessionMs: 240_000,
    }));

  it("a configured maxSessionMs wins over the budget default", () =>
    expect(resolveBrowserPolicy("sts", { policy: { browser: { block: "none", stealth: false, maxSessionMs: 90_000 } } }, {}).maxSessionMs).toBe(90_000));

  it("env wins over config", () =>
    expect(
      resolveBrowserPolicy("sts", { policy: { browser: { block: "media", stealth: false } } }, {
        SCRAPER_BROWSER_BLOCK_STS: "media+trackers",
        SCRAPER_BROWSER_STEALTH_STS: "1",
      }),
    ).toMatchObject({ block: "media+trackers", stealth: true }));

  it("env stealth accepts true/false/0 and the bookmaker name is upper-cased", () => {
    expect(resolveBrowserPolicy("lvbet", { policy: { browser: { block: "none", stealth: true } } }, { SCRAPER_BROWSER_STEALTH_LVBET: "0" }).stealth).toBe(false);
    expect(resolveBrowserPolicy("lvbet", {}, { SCRAPER_BROWSER_STEALTH_LVBET: "true" }).stealth).toBe(true);
    expect(resolveBrowserPolicy("lvbet", { policy: { browser: { block: "none", stealth: true } } }, { SCRAPER_BROWSER_STEALTH_LVBET: "false" }).stealth).toBe(false);
  });

  it("ignores an invalid env value with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveBrowserPolicy("sts", {}, { SCRAPER_BROWSER_BLOCK_STS: "stylesheet" }).block).toBe("none");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[browser-policy] ignoring SCRAPER_BROWSER_BLOCK_STS="stylesheet" (expected none|media|media+trackers)');
  });

  it("ignores an invalid stealth value with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveBrowserPolicy("sts", {}, { SCRAPER_BROWSER_STEALTH_STS: "yes" }).stealth).toBe(false);
    expect(warn).toHaveBeenCalledWith('[browser-policy] ignoring SCRAPER_BROWSER_STEALTH_STS="yes" (expected 1|true|0|false)');
  });

  it("no config carries disableResourceBlocking any more", () =>
    expect(Object.values(DEFAULT_SCRAPER_CONFIGS).some((c) => "disableResourceBlocking" in c)).toBe(false));
});

describe("blockedUrlPatterns", () => {
  it("none blocks nothing", () => expect(blockedUrlPatterns("none")).toEqual([]));

  it("media blocks 18 extensions by pathname", () => {
    const p = blockedUrlPatterns("media");
    expect(p).toHaveLength(18);
    expect(p.slice(0, 2)).toEqual(["*://*/*.png", "*://*/*.jpg"]);
    expect(p).toContain("*://*/*.woff2");
  });

  it("media+trackers adds host and subdomain patterns per tracker host", () => {
    const p = blockedUrlPatterns("media+trackers");
    expect(p).toHaveLength(110);
    expect(p).toContain("*://googletagmanager.com/*");
    expect(p).toContain("*://*.googletagmanager.com/*");
  });

  it("never blocks stylesheets, even for betcris and pzbuk at the strongest env level (cross-plan #5)", () => {
    expect(blockedUrlPatterns("media+trackers").filter((x) => /css/i.test(x))).toEqual([]);
    for (const bm of ["betcris", "pzbuk"] as const) {
      const env = { [`SCRAPER_BROWSER_BLOCK_${bm.toUpperCase()}`]: "media+trackers" };
      expect(blockedUrlPatterns(resolveBrowserPolicy(bm, DEFAULT_SCRAPER_CONFIGS[bm], env).block).filter((x) => /css/i.test(x))).toEqual([]);
    }
  });

  it("tracker hosts are unique and disjoint from never-block and bookmaker hosts", () => {
    const own = [...NEVER_BLOCK_HOSTS, ...Object.values(DEFAULT_SCRAPER_CONFIGS).map((c) => new URL(c.baseUrl).hostname)];
    const covers = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
    expect(TRACKER_HOSTS).toHaveLength(46);
    expect(new Set(TRACKER_HOSTS).size).toBe(TRACKER_HOSTS.length);
    expect(TRACKER_HOSTS.flatMap((t) => own.filter((o) => covers(t, o)))).toEqual([]);
  });
});
