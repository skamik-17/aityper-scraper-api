import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import { getTransportOverride } from "../../../config/transport.js";
import type { ScraperConfig } from "../../../types/scraper.js";
import type { FullOfferScraperResult, FullMatchOffer } from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import type { FullOfferScraper } from "../../shared/scraper-contract.js";

import {
  navigateAndCaptureLeagueData,
  navigateAndCaptureMatchData,
  captureMatchWithRetry,
} from "./navigation.js";
import { parseWebSocketJson, parseFixtures } from "./parser.js";
import type { STSFixture } from "./types.js";
import { MAX_CONSECUTIVE_MATCH_FAILURES } from "./constants.js";
import { mapStsFixtureToOffer, stsLog } from "./offer-mapping.js";
import { StsWsScraper } from "./ws-scraper.js";

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
