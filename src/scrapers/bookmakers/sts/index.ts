import type { Page } from "playwright";
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import type {
  ScraperConfig,
  ScraperResult,
  RawScrapedOdds,
  MatchIdentifier,
  MatchDetailResult,
  RawScrapedMatchOdds,
  EventUrlEntry,
} from "../../../types/scraper.js";
import type { FullOfferScraperResult, FullMatchOffer } from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName, matchToCanonical } from "../../../utils/team-matcher.js";
import { ScraperCache, CACHE_TTLS } from "../../../services/cache-manager.js";

import {
  navigateAndCaptureLeagueData,
  navigateAndCaptureMatchData,
  extractFixtureIdFromUrl,
} from "./navigation.js";
import {
  parseLeagueData,
  parseWebSocketJson,
  parseFixtures,
  extractOdds,
  parseAllMarkets,
  oddsToMarketOverUnder,
} from "./parser.js";
import type { STSFixture } from "./types.js";

const eventsCache = new ScraperCache<STSFixture>({
  name: "sts-events",
  ttl: CACHE_TTLS.EVENTS,
  maxSize: 500,
});

export class STSPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "sts";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.sts,
      ...config,
      enabled: true,
    };
  }

  private updateCache(fixtures: STSFixture[]): void {
    eventsCache.setMany(fixtures.map((f) => ({ key: f.id, value: f })));
  }

  private getCachedFixture(fixtureId: string): STSFixture | undefined {
    return eventsCache.get(fixtureId);
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    return this.executeLeagueScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();

        const captureResult = await navigateAndCaptureLeagueData(page, leagueSlug);
        if (!captureResult) {
          return this.createNotFoundResult(
            "No WebSocket data received",
            Date.now() - startTime
          );
        }

        const parsedData = parseLeagueData(captureResult, leagueSlug);
        if (parsedData.length === 0) {
          return this.createNotFoundResult(
            `No matches found for ${leagueSlug}`,
            Date.now() - startTime
          );
        }

        const fixtures = parsedData.map((d) => d.fixture);
        this.updateCache(fixtures);

        const matches: RawScrapedOdds[] = parsedData.map(({ fixture, odds }) => ({
          bookmaker: this.bookmaker,
          eventName: `${fixture.home} - ${fixture.away}`,
          homeTeam: getCanonicalTeamName(fixture.home, leagueSlug),
          awayTeam: getCanonicalTeamName(fixture.away, leagueSlug),
          homeOdds: odds.odds1!,
          drawOdds: odds.oddsX!,
          awayOdds: odds.odds2!,
          hasNoTaxPromo: false,
          scrapedAt: new Date(),
          eventUrl: fixture.eventUrl,
        }));

        console.log(`[STS] Found ${matches.length} matches with valid odds`);

        return {
          status: "success",
          bookmaker: this.bookmaker,
          data: matches,
          duration: Date.now() - startTime,
          timestamp: new Date(),
        };
      }
    );
  }

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "ekstraklasa";

    const allMatches = await this.scrapeLeague(league);
    if (allMatches.status !== "success" || !allMatches.data) {
      return allMatches;
    }

    const matchResult = findMatchingEvent(
      { homeTeam: match.homeTeam, awayTeam: match.awayTeam },
      allMatches.data,
      league
    );

    if (!matchResult) {
      return this.createNotFoundResult(
        `Match not found on STS: ${match.homeTeam} vs ${match.awayTeam}`,
        Date.now() - startTime
      );
    }

    return {
      status: "success",
      bookmaker: this.bookmaker,
      data: [matchResult.event],
      duration: Date.now() - startTime,
      timestamp: new Date(),
    };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    const fixtureId = extractFixtureIdFromUrl(eventUrl);

    if (!fixtureId) {
      return this.createMatchDetailNotFoundResult("Invalid STS event URL", Date.now() - startTime);
    }

    return this.executeWithBrowser(
      async (page) => {
        const captureResult = await navigateAndCaptureMatchData(page, eventUrl);
        if (!captureResult) {
          return this.createMatchDetailNotFoundResult(
            "No WebSocket data received",
            Date.now() - startTime
          );
        }

        const initialJson = parseWebSocketJson(captureResult.initialData);
        const fixtureJson = captureResult.fixtureData.get(fixtureId) || null;

        const matchData = this.findAndParseMatchData(
          fixtureJson,
          initialJson,
          fixtureId,
          eventUrl
        );

        if (!matchData) {
          return this.createMatchDetailNotFoundResult(
            "Could not parse match data",
            Date.now() - startTime
          );
        }

        return {
          status: "success",
          bookmaker: this.bookmaker,
          data: matchData,
          duration: Date.now() - startTime,
          timestamp: new Date(),
        };
      },
      (error, duration) => this.createMatchDetailErrorResult(error, duration)
    );
  }

  private findAndParseMatchData(
    fixtureJson: import("./types.js").STSWebSocketData | null,
    initialJson: import("./types.js").STSWebSocketData | null,
    targetFixtureId: string,
    eventUrl: string
  ): RawScrapedMatchOdds | null {
    const dataSource = initialJson || fixtureJson;
    if (!dataSource) return null;

    const footballData = dataSource.B?.S?.["1"];
    if (!footballData?.C) return null;

    for (const [, cat] of Object.entries(footballData.C)) {
      if (!cat.T) continue;

      for (const [, tourn] of Object.entries(cat.T)) {
        if (!tourn.FX) continue;

        for (const [fixId, fix] of Object.entries(tourn.FX)) {
          if (fixId !== targetFixtureId) continue;
          if (!fix.H?.n || !fix.A?.n) continue;

          const fixture = {
            id: fixId,
            home: fix.H.n,
            away: fix.A.n,
            startTime: fix.t || "",
            stsId: fix.sid || 0,
            tournament: tourn.n || "",
            country: cat.n || "",
            eventUrl,
          };

          const odds = extractOdds(fixture, fixtureJson, initialJson);

          return {
            bookmaker: this.bookmaker,
            eventName: `${fixture.home} - ${fixture.away}`,
            homeTeam: fixture.home,
            awayTeam: fixture.away,
            eventUrl,
            hasNoTaxPromo: false,
            scrapedAt: new Date(),
            market1X2: {
              home: odds.odds1 || 0,
              draw: odds.oddsX || 0,
              away: odds.odds2 || 0,
            },
            marketDoubleChance: odds.odds1X
              ? {
                  homeOrDraw: odds.odds1X,
                  drawOrAway: odds.oddsX2 || 0,
                  homeOrAway: odds.odds12 || 0,
                }
              : undefined,
            marketOverUnder: oddsToMarketOverUnder(odds),
            marketBTTS: odds.bttsYes
              ? {
                  yes: odds.bttsYes,
                  no: odds.bttsNo || 0,
                }
              : undefined,
          };
        }
      }
    }

    return null;
  }

  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    return this.executeFullOfferScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();

        const captureResult = await navigateAndCaptureLeagueData(page, leagueSlug);
        if (!captureResult) {
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: "No WebSocket data received",
            duration: Date.now() - startTime,
          };
        }

        const initialJson = parseWebSocketJson(captureResult.initialData);
        if (!initialJson) {
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: "Failed to parse WebSocket data",
            duration: Date.now() - startTime,
          };
        }

        const fixtures = parseFixtures(initialJson, leagueSlug);
        if (fixtures.length === 0) {
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: "No fixtures found for league",
            duration: Date.now() - startTime,
          };
        }

        console.log(`[STS/FullOffer] Found ${fixtures.length} fixtures for ${leagueSlug}`);
        this.updateCache(fixtures);

        const matches: FullMatchOffer[] = [];

        for (const fixture of fixtures) {
          try {
            const matchCaptureResult = await navigateAndCaptureMatchData(
              page,
              fixture.eventUrl
            );

            if (!matchCaptureResult) {
              console.warn(
                `[STS/FullOffer] No data for ${fixture.home} vs ${fixture.away}`
              );
              continue;
            }

            const fixtureJson = matchCaptureResult.fixtureData.get(fixture.id) || null;
            const matchInitialJson = parseWebSocketJson(matchCaptureResult.initialData);
            const markets = parseAllMarkets(fixture, fixtureJson, matchInitialJson);

            if (markets.length > 0) {
              const homeTeamLower = fixture.home.toLowerCase();
              const awayTeamLower = fixture.away.toLowerCase();
              if (
                homeTeamLower.includes("u21") ||
                homeTeamLower.includes("u23") ||
                awayTeamLower.includes("u21") ||
                awayTeamLower.includes("u23") ||
                homeTeamLower.includes("under 21") ||
                homeTeamLower.includes("under 23") ||
                awayTeamLower.includes("under 21") ||
                awayTeamLower.includes("under 23")
              ) {
                console.warn(
                  `[STS/FullOffer] Skipping ${fixture.home} vs ${fixture.away}: Youth team match`
                );
                continue;
              }

              const homeMatch = matchToCanonical(fixture.home, leagueSlug);
              const awayMatch = matchToCanonical(fixture.away, leagueSlug);

              if (!homeMatch || !awayMatch) {
                console.warn(
                  `[STS/FullOffer] Skipping ${fixture.home} vs ${fixture.away}: Teams not in ${leagueSlug} whitelist`
                );
                continue;
              }

              const homeCanonical = homeMatch.name;
              const awayCanonical = awayMatch.name;

              matches.push({
                matchId: fixture.id,
                bookmaker: this.bookmaker,
                homeTeam: homeCanonical,
                awayTeam: awayCanonical,
                eventUrl: fixture.eventUrl,
                markets,
                startTime: fixture.startTime,
                scrapedAt: new Date(),
              });

              console.log(
                `[STS/FullOffer] ${fixture.home} vs ${fixture.away}: ${markets.length} markets`
              );
            }

            await this.delay(200);
          } catch (error) {
            console.warn(
              `[STS/FullOffer] Failed to fetch details for ${fixture.home} vs ${fixture.away}:`,
              error
            );
          }
        }

        const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
        console.log(
          `[STS/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
        );

        return {
          success: true,
          bookmaker: this.bookmaker,
          league: leagueSlug,
          matches,
          duration: Date.now() - startTime,
        };
      }
    );
  }

  async extractEventUrls(_page: Page): Promise<EventUrlEntry[]> {
    return [];
  }
}

export const stsScraper = new STSPlaywrightScraper();

export { STSPlaywrightScraper as STSScraper };
