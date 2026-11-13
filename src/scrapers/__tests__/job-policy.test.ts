import { describe, expect, it, vi } from "vitest";
import { CONFIG } from "../../config/index.js";
import { getScraper } from "../aggregator.js";
import { PlaywrightScraper } from "../base/playwright-base.js";
import { maxDurationMsFor, resolveJobTransport } from "../job-policy.js";
import type { FullOfferScraper } from "../shared/scraper-contract.js";

const pw = (bm: string, extra = {}) => Object.assign(Object.create(PlaywrightScraper.prototype), { bookmaker: bm, ...extra }) as FullOfferScraper;
const plain = (bm: string, extra = {}) => ({ bookmaker: bm, scrapeFullOffer: vi.fn(), cleanup: vi.fn(), ...extra }) as unknown as FullOfferScraper;

describe("job policy", () => {
  it("classifies by declaration first, then by Playwright inheritance", () => {
    expect([
      resolveJobTransport(pw("sts")),
      resolveJobTransport(pw("betclic", { transport: "http" })),
      resolveJobTransport(plain("forbet")),
      resolveJobTransport(plain("sts", { transport: "websocket" })),
      resolveJobTransport(plain("forbet", { transport: "bogus" })),
    ]).toEqual(["browser", "http", "http", "websocket", "http"]);
  });

  it("budgets", () =>
    expect([
      maxDurationMsFor("pzbuk", "browser"), maxDurationMsFor("betcris", "browser"), maxDurationMsFor("sts", "browser"),
      maxDurationMsFor("fortuna", "browser"), maxDurationMsFor("pzbuk", "websocket"), maxDurationMsFor("forbet", "http"),
    ]).toEqual([600_000, 720_000, 360_000, 240_000, 120_000, 120_000]));

  it("pins the transport of every getScraper(bm) default instance (cross-plan #8)", () => {
    // Plans 02-04 moved these to plain HTTP; plan 05 updates the set when it changes a pick.
    const WEBSOCKET = new Set(["pzbuk"]); // plan 05c
    const BROWSERLESS = new Set(["betclic", "betters", "lebull", "totalbet", "etoto", "forbet", "fuksiarz", "betfan", "fortuna", "superbet", "lvbet"]);
    // Plan 05: direct WebSocket clients
    const WEBSOCKET = new Set(["betcris"]);
    expect(Object.fromEntries(CONFIG.BOOKMAKERS.map((bm) => [bm, resolveJobTransport(getScraper(bm)!)])))
      .toEqual(Object.fromEntries(CONFIG.BOOKMAKERS.map((bm) => [bm, WEBSOCKET.has(bm) ? "websocket" : BROWSERLESS.has(bm) ? "http" : "browser"])));
  });
});
