import type { Page } from "playwright";
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import type {
  ScraperConfig,
  ScraperResult,
  RawScrapedOdds,
  MatchIdentifier,
  MatchDetailResult,
  EventUrlEntry,
} from "../../../types/scraper.js";
import type { FullOfferScraperResult, FullMatchOffer } from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { ScraperCache, CACHE_TTLS } from "../../../services/cache-manager.js";

import {
  COMPETITION_IDS,
} from "./constants.js";
import {
  navigateToLeaguePage,
  navigateToMatchPage,
  captureSwarmData,
  extractGameIdFromUrl,
  buildEventUrl,
} from "./navigation.js";
import {
  parseSwarmDataForLeague,
  parseSwarmDataForMatchDetails,
  parseSwarmDataForFullOffer,
  parseAllMarkets,
} from "./parser.js";
import type { SwarmGame, ParsedTeams } from "./types.js";

interface CachedBetcrisGame {
  game: SwarmGame;
  teams: ParsedTeams;
  regionAlias: string;
  competitionId: number;
  eventUrl: string;
}

const eventsCache = new ScraperCache<CachedBetcrisGame>({
  name: "betcris-events",
  ttl: CACHE_TTLS.EVENTS,
  maxSize: 500,
});

export class BetcrisPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "betcris";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.betcris,
      ...config,
      enabled: true,
    };
  }

  private updateCache(entries: CachedBetcrisGame[]): void {
    eventsCache.setMany(entries.map((e) => ({ key: String(e.game.id), value: e })));
  }

  private getCachedEvent(gameId: string): CachedBetcrisGame | undefined {
    return eventsCache.get(gameId);
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    return this.executeLeagueScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();
        const competitionId = COMPETITION_IDS[leagueSlug];

        const wsDataPromise = captureSwarmData(page, { competitionId });

        const navSuccess = await navigateToLeaguePage(page, leagueSlug);
        if (!navSuccess) {
          return this.createErrorResult(
            new Error("Failed to navigate to league page"),
            Date.now() - startTime
          );
        }

        const wsData = await Promise.race([
          wsDataPromise,
          this.delay(15000).then(() => null),
        ]);

        if (!wsData) {
          console.log("[Betcris] No WebSocket data captured");
          return this.createNotFoundResult(
            "No WebSocket data captured",
            Date.now() - startTime
          );
        }

        const matches = parseSwarmDataForLeague(wsData, leagueSlug, competitionId);

        if (matches.length === 0) {
          console.log("[Betcris] No matches parsed from WebSocket");
          return this.createNotFoundResult(
            "No matches in WebSocket data",
            Date.now() - startTime
          );
        }

        console.log(`[Betcris] Scraped ${matches.length} matches for ${leagueSlug} via WebSocket`);

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
        `Match not found: ${match.homeTeam} vs ${match.awayTeam}`,
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
    const gameId = extractGameIdFromUrl(eventUrl);

    if (!gameId) {
      return this.createMatchDetailNotFoundResult("Invalid URL format", Date.now() - startTime);
    }

    const cachedEvent = this.getCachedEvent(String(gameId));
    if (cachedEvent) {
      const mockSwarmData = {
        sport: {
          "1": {
            id: 1,
            name: "Soccer",
            alias: "Soccer",
            region: {
              "1": {
                id: 1,
                name: "Region",
                alias: cachedEvent.regionAlias,
                competition: {
                  "1": {
                    id: cachedEvent.competitionId,
                    name: "Competition",
                    game: { [gameId]: cachedEvent.game },
                  },
                },
              },
            },
          },
        },
      };
      const matchData = parseSwarmDataForMatchDetails(mockSwarmData, eventUrl, gameId);
      if (matchData) {
        return {
          status: "success",
          bookmaker: this.bookmaker,
          data: matchData,
          duration: Date.now() - startTime,
          timestamp: new Date(),
        };
      }
    }

    return this.executeWithBrowser(
      async (page) => {
        const wsDataPromise = captureSwarmData(page, {
          singleEventMode: true,
          targetGameNumber: gameId,
        });

        const navSuccess = await navigateToMatchPage(page, eventUrl);
        if (!navSuccess) {
          return this.createMatchDetailErrorResult(
            new Error("Failed to navigate to match page"),
            Date.now() - startTime
          );
        }

        const wsData = await Promise.race([
          wsDataPromise,
          this.delay(15000).then(() => null),
        ]);

        if (wsData) {
          const matchData = parseSwarmDataForMatchDetails(wsData, eventUrl, gameId);
          if (matchData) {
            return {
              status: "success",
              bookmaker: this.bookmaker,
              data: matchData,
              duration: Date.now() - startTime,
              timestamp: new Date(),
            };
          }
          console.log(
            `[Betcris] WebSocket data received but game ${gameId} not found or has insufficient markets`
          );
        } else {
          console.log(`[Betcris] No WebSocket data received for game ${gameId}`);
        }

        return this.createMatchDetailNotFoundResult(
          `Game ${gameId} details not found`,
          Date.now() - startTime
        );
      },
      (error, duration) => this.createMatchDetailErrorResult(error, duration)
    );
  }

  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    return this.executeFullOfferScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();
        const competitionId = COMPETITION_IDS[leagueSlug];

        const wsDataPromise = captureSwarmData(page, { competitionId });

        const navSuccess = await navigateToLeaguePage(page, leagueSlug);
        if (!navSuccess) {
          return this.createFullOfferErrorResult(
            leagueSlug,
            new Error("Failed to navigate to league page"),
            Date.now() - startTime
          );
        }

        const wsData = await Promise.race([
          wsDataPromise,
          this.delay(15000).then(() => null),
        ]);

        if (!wsData) {
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: "No WebSocket data captured",
            duration: Date.now() - startTime,
          };
        }

        const gamesInfo = parseSwarmDataForFullOffer(wsData, leagueSlug, competitionId);
        console.log(`[Betcris/FullOffer] Found ${gamesInfo.length} games for ${leagueSlug}`);

        const matches: FullMatchOffer[] = [];

        for (const { game, teams, regionAlias, competitionId: compId } of gamesInfo) {
          try {
            const eventUrl = buildEventUrl(regionAlias, compId, game.id);

            const matchWsPromise = captureSwarmData(page, {
              singleEventMode: true,
              targetGameNumber: game.id,
            });

            await navigateToMatchPage(page, eventUrl);

            const matchWsData = await Promise.race([
              matchWsPromise,
              this.delay(10000).then(() => null),
            ]);

            if (matchWsData) {
              let fullGame = game;
              for (const sport of Object.values(matchWsData.sport || {})) {
                for (const region of Object.values(sport.region || {})) {
                  for (const competition of Object.values(region.competition || {})) {
                    for (const g of Object.values(competition.game || {})) {
                      if (g.id === game.id && Object.keys(g.market || {}).length > Object.keys(fullGame.market || {}).length) {
                        fullGame = g;
                      }
                    }
                  }
                }
              }

              this.updateCache([{
                game: fullGame,
                teams,
                regionAlias,
                competitionId: compId,
                eventUrl,
              }]);

              const allMarkets = parseAllMarkets(fullGame, teams);

              if (allMarkets.length > 0) {
                matches.push({
                  matchId: String(game.id),
                  bookmaker: this.bookmaker,
                  homeTeam: getCanonicalTeamName(teams.homeTeam, leagueSlug),
                  awayTeam: getCanonicalTeamName(teams.awayTeam, leagueSlug),
                  eventUrl,
                  markets: allMarkets,
                  startTime: fullGame.start_ts ? new Date(fullGame.start_ts * 1000).toISOString() : undefined,
                  scrapedAt: new Date(),
                });

                console.log(
                  `[Betcris/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${allMarkets.length} markets`
                );
              }
            }

            await this.delay(100);
          } catch (error) {
            console.warn(
              `[Betcris/FullOffer] Failed to fetch details for game ${game.id}:`,
              error
            );
          }
        }

        const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
        console.log(
          `[Betcris/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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

  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    const SELECTORS = {
      matchCard: "[data-testid='game']",
      teamName: ".comp__team-name",
    };

    return page.evaluate((selectors) => {
      const entries: EventUrlEntry[] = [];
      document.querySelectorAll(selectors.matchCard).forEach((card) => {
        const teamElements = card.querySelectorAll(selectors.teamName);
        if (teamElements.length < 2) return;
        const home = teamElements[0]?.textContent?.trim() || "";
        const away = teamElements[1]?.textContent?.trim() || "";
        const link =
          (card.querySelector("a[href*='/zaklady-bukmacherskie/']") as HTMLAnchorElement) ||
          (card.closest("a") as HTMLAnchorElement);
        if (link?.href) {
          entries.push({ matchKey: `${home} vs ${away}`, eventUrl: link.href });
        }
      });
      return entries;
    }, SELECTORS);
  }
}

export const betcrisScraper = new BetcrisPlaywrightScraper();
