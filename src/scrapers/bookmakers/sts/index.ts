import type { Page } from "playwright";
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import { getTransportOverride } from "../../../config/transport.js";
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
import type { FullOfferScraper } from "../../shared/scraper-contract.js";
import { findMatchingEvent, getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { ScraperCache, CACHE_TTLS } from "../../../services/cache-manager.js";

import {
  navigateAndCaptureLeagueData,
  navigateAndCaptureMatchData,
  captureMatchWithRetry,
  extractFixtureIdFromUrl,
} from "./navigation.js";
import {
  parseLeagueData,
  parseWebSocketJson,
  parseFixtures,
  extractOdds,
  oddsToMarketOverUnder,
} from "./parser.js";
import type { STSFixture } from "./types.js";
import { MAX_CONSECUTIVE_MATCH_FAILURES } from "./constants.js";
import { mapStsFixtureToOffer, stsLog } from "./offer-mapping.js";
import { StsWsScraper } from "./ws-scraper.js";

const eventsCache = new ScraperCache<STSFixture>({
  name: "sts-events",
  ttl: CACHE_TTLS.EVENTS,
  maxSize: 500,
});

export class StsBrowserScraper extends PlaywrightScraper {
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

        console.log(stsLog.found(fixtures.length, leagueSlug));
        this.updateCache(fixtures);

        const matches: FullMatchOffer[] = [];
        let misses = 0;
        let consecutiveMisses = 0;
        let firstMissed: STSFixture | undefined;

        for (const fixture of fixtures) {
          try {
            // Without the fixture snapshot only the i_pl markets parse (1
            // market), and writing that would prune the match's previous
            // complete snapshot. Skip the match instead: its rows stay as-is.
            const matchCaptureResult = await captureMatchWithRetry(
              (u) => navigateAndCaptureMatchData(page, u),
              fixture.eventUrl,
              fixture.id
            );

            if (!matchCaptureResult) {
              console.warn(stsLog.noSnapshot(fixture));
              misses++;
              firstMissed ??= fixture;
              if (++consecutiveMisses >= MAX_CONSECUTIVE_MATCH_FAILURES) {
                // A systemic miss (protocol change, block) would otherwise cost
                // ~20 s per fixture for the whole league; stop and keep the
                // previous rows instead of writing anything.
                console.warn(
                  `[STS/FullOffer] Aborting per-fixture loop: ${consecutiveMisses} consecutive fixtures without a snapshot`
                );
                return {
                  success: false,
                  bookmaker: this.bookmaker,
                  league: leagueSlug,
                  matches: [],
                  error: `${misses} of ${fixtures.length} details failed | no fixture snapshot ${firstMissed.eventUrl}`,
                  duration: Date.now() - startTime,
                };
              }
              continue;
            }
            consecutiveMisses = 0;

            const result = mapStsFixtureToOffer(
              fixture,
              matchCaptureResult.fixtureData.get(fixture.id) ?? null,
              parseWebSocketJson(matchCaptureResult.initialData),
              leagueSlug
            );
            if (result.kind === "skip" && result.warning !== null) {
              console.warn(result.warning);
              continue;
            }
            if (result.kind === "offer") {
              matches.push(result.offer);
              console.log(stsLog.matchMarkets(fixture, result.offer.markets.length));
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
        console.log(stsLog.completed(matches.length, totalMarkets));

        return {
          success: true,
          bookmaker: this.bookmaker,
          league: leagueSlug,
          matches,
          ...(misses > 0 && firstMissed
            ? { error: `${misses} of ${fixtures.length} details failed | no fixture snapshot ${firstMissed.eventUrl}` }
            : {}),
          duration: Date.now() - startTime,
        };
      }
    );
  }

  async extractEventUrls(_page: Page): Promise<EventUrlEntry[]> {
    return [];
  }
}

/**
 * The single transport pick for STS (README §3): the direct WebSocket client by
 * default, the browser class when SCRAPER_TRANSPORT_STS=browser. Read once at
 * module load, so a change needs a restart.
 */
export function createStsScraper(env: NodeJS.ProcessEnv = process.env): FullOfferScraper {
  return getTransportOverride("sts", env) === "browser" ? new StsBrowserScraper() : new StsWsScraper();
}

export const stsScraper: FullOfferScraper = createStsScraper();

export { StsWsScraper };
export { StsBrowserScraper as STSPlaywrightScraper, StsBrowserScraper as STSScraper };
