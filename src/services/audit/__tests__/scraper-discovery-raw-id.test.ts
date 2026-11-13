import { afterEach, describe, expect, it, vi } from "vitest";
import { runScraperDiscovery } from "../scraper-audit-core.js";
import type { BookmakerMarketNormalizer } from "../../normalization/types.js";

/**
 * The discovery printout is how a fixer (and the totalbet drift investigation
 * of 2026-11-13) sees what a bookmaker sent. Its RAW JSON used to drop the
 * market's own id and line, so a renamed totalbet slug ("Suma goli" -> OTHER,
 * matched by pattern) could not be read from it: the id the normalizer failed
 * to look up must be printed.
 */
describe("runScraperDiscovery RAW JSON", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints each market's bookmakerMarketId and paramValue", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { lines.push(args.join(" ")); });
    const scraper = {
      bookmaker: "totalbet",
      scrapeFullOffer: async () => ({
        success: true,
        matches: [{
          matchId: "b9241ab0-80fd-46fa-8249-c9397d40a205",
          bookmaker: "totalbet" as const,
          homeTeam: "Manchester City",
          awayTeam: "Fulham",
          eventUrl: "https://totalbet.pl/event-details/b9241ab0-80fd-46fa-8249-c9397d40a205",
          scrapedAt: new Date(0),
          markets: [{ name: "Suma goli", groupName: "Suma goli", bookmakerMarketId: "slug:suma_goli", paramValue: "2.5",
            selections: [{ name: "poniżej 2.5", odds: 2.4 }, { name: "powyżej 2.5", odds: 1.55 }] }],
        }],
      }),
    };
    const normalizer: BookmakerMarketNormalizer = { bookmaker: "totalbet", normalizeMarket: () => null };

    await runScraperDiscovery({ scraper, normalizer, eventUrl: "https://totalbet.pl/event-details/b9241ab0-80fd-46fa-8249-c9397d40a205",
      league: "premier-league", showAll: true });

    const out = lines.join("\n");
    expect(out).toContain('"bookmakerMarketId": "slug:suma_goli"');
    expect(out).toContain('"paramValue": "2.5"');
  });
});
