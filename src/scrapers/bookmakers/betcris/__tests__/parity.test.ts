import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import type { FullOfferScraperResult } from "../../../../types/full-offer.js";
import { BetcrisBrowserScraper } from "../browser-scraper.js";
import { BetcrisSwarmScraper } from "../swarm-scraper.js";
import { createFakeSwarm, recordedAnswer, type FakeSwarmRequest } from "./helpers/fake-swarm-session.js";
import { browserOfferPage, loadFixtureText, RECORDED_GAME_IDS } from "./helpers/swarm-fixtures.js";
import { settle, type FakeSwarmPage } from "./helpers/fake-swarm-page.js";

const replayHttp = () => createReplayHttpClient({ "https://www.betcris.pl/": { body: loadFixtureText("swarm/partner-configs.html"), contentType: "text/html" } });
const strip = (r: FullOfferScraperResult) => r.matches.map(({ scrapedAt: _s, ...m }) => m);

/** Every browser session of the browser class gets the fake page */
function useFakeBrowser(fake: FakeSwarmPage): void {
  vi.spyOn(BetcrisBrowserScraper.prototype as any, "initBrowser").mockResolvedValue({
    page: fake.page,
    browser: {},
    context: {},
    cleanup: async () => {},
  });
}

describe("betcris parity (README §6 gate 1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("betcris parity: browser and Swarm paths write deep-equal offers from the same recorded payloads", async () => {
    useFakeBrowser(browserOfferPage());
    const browser = await settle(new BetcrisBrowserScraper().scrapeFullOffer("premier-league"));
    const swarm = await settle(new BetcrisSwarmScraper({ http: replayHttp(), openSession: createFakeSwarm(recordedAnswer()).open }).scrapeFullOffer("premier-league"));
    expect(browser.success && swarm.success).toBe(true);
    expect(strip(swarm)).toHaveLength(20);
    expect(strip(swarm)).toEqual(strip(browser));
  });

  it("betcris parity: holds when Swarm replies arrive in reverse order", async () => {
    const delayMs = (q: FakeSwarmRequest) => (q.params?.where?.game?.id ? 300 - 10 * RECORDED_GAME_IDS.indexOf(q.params.where.game.id) : 5);
    useFakeBrowser(browserOfferPage());
    const browser = await settle(new BetcrisBrowserScraper().scrapeFullOffer("premier-league"));
    const swarm = await settle(new BetcrisSwarmScraper({ http: replayHttp(), openSession: createFakeSwarm(recordedAnswer({ delayMs })).open }).scrapeFullOffer("premier-league"));
    expect(strip(swarm)).toEqual(strip(browser));
  });
});
