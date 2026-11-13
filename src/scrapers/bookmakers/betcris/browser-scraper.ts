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
import { findMatchingEvent } from "../../../utils/team-matcher.js";
import { budgetAbortReason, type ScrapeBudget } from "../../shared/budget.js";
import { currentScrapeJob } from "../../shared/job-context.js";

import {
  COMPETITION_IDS,
  LEAGUE_URLS,
  WS_CONFIG,
} from "./constants.js";
import {
  captureSwarm,
  formatCaptureFailure,
  formatCaptureSuccess,
  isSiteLevelCaptureFailure,
  extractGameIdFromUrl,
  buildEventUrl,
} from "./navigation.js";
import {
  parseSwarmDataForLeague,
  parseSwarmDataForMatchDetails,
  parseSwarmDataForFullOffer,
} from "./parser.js";
import { buildBetcrisMatchOffer, detailSkipReason } from "./swarm-offer.js";

const BUDGET_CUT = Symbol("betcris-budget-cut");

/**
 * Resolves BUDGET_CUT once `signal` aborts, so the per-match loop can stop at
 * once instead of waiting for an in-flight capture on a closed context.
 */
function watchBudgetCut(signal: AbortSignal | undefined): {
  cut: Promise<typeof BUDGET_CUT> | null;
  release: () => void;
} {
  if (!signal) return { cut: null, release: () => {} };
  let release = () => {};
  const cut = new Promise<typeof BUDGET_CUT>((resolve) => {
    if (signal.aborted) return resolve(BUDGET_CUT);
    const onAbort = () => resolve(BUDGET_CUT);
    signal.addEventListener("abort", onAbort, { once: true });
    release = () => signal.removeEventListener("abort", onAbort);
  });
  return { cut, release };
}

export class BetcrisBrowserScraper extends PlaywrightScraper {
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

  async scrapeLeague(league: string): Promise<ScraperResult> {
    return this.executeLeagueScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();
        const competitionId = COMPETITION_IDS[leagueSlug];
        const url = LEAGUE_URLS[leagueSlug];
        if (!url) {
          return this.createErrorResult(
            new Error(`No Betcris listing URL for league: ${leagueSlug}`),
            Date.now() - startTime
          );
        }

        const outcome = await captureSwarm(page, url, { competitionId });
        if (!outcome.data) {
          const reason = formatCaptureFailure(outcome);
          console.warn(`[Betcris] ${reason}`);
          return this.createNotFoundResult(reason, Date.now() - startTime);
        }
        console.log(`[Betcris] ${formatCaptureSuccess(outcome)}`);

        const matches = parseSwarmDataForLeague(outcome.data, leagueSlug, competitionId);

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

    return this.executeWithBrowser(
      async (page) => {
        const outcome = await captureSwarm(page, eventUrl, {
          singleEventMode: true,
          targetGameNumber: gameId,
        });
        if (!outcome.data) {
          const reason = formatCaptureFailure(outcome);
          console.warn(`[Betcris] ${reason}`);
          return this.createMatchDetailNotFoundResult(reason, Date.now() - startTime);
        }

        const matchData = parseSwarmDataForMatchDetails(outcome.data, eventUrl, gameId);
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

        return this.createMatchDetailNotFoundResult(
          `Game ${gameId} details not found`,
          Date.now() - startTime
        );
      },
      (error, duration) => this.createMatchDetailErrorResult(error, duration)
    );
  }

  async scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult> {
    const cutSignal = (budget ?? currentScrapeJob()?.budget)?.signal;
    return this.executeFullOfferScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();
        const competitionId = COMPETITION_IDS[leagueSlug];
        const url = LEAGUE_URLS[leagueSlug];
        if (!url) {
          return this.createFullOfferErrorResult(
            leagueSlug,
            new Error(`No Betcris listing URL for league: ${leagueSlug}`),
            Date.now() - startTime
          );
        }

        const listing = await captureSwarm(page, url, { competitionId });
        if (!listing.data) {
          const reason = formatCaptureFailure(listing);
          console.warn(`[Betcris] ${reason}`);
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: reason,
            duration: Date.now() - startTime,
          };
        }
        console.log(`[Betcris] ${formatCaptureSuccess(listing)}`);

        const gamesInfo = parseSwarmDataForFullOffer(listing.data, leagueSlug, competitionId);
        console.log(`[Betcris/FullOffer] Found ${gamesInfo.length} games for ${leagueSlug}`);

        const matches: FullMatchOffer[] = [];
        // Consecutive site-level capture failures (page or socket delivered no
        // sport data). Game-level misses neither count nor reset; a success resets.
        let consecutiveFailures = 0;
        let aborted = false;
        // A budget cut (job deadline or run abort) stops the loop at once and keeps
        // the games captured so far; the in-flight capture is abandoned.
        let budgetCut: string | null = null;
        const watcher = watchBudgetCut(cutSignal);

        for (const { game, teams, regionAlias, competitionId: compId } of gamesInfo) {
          if (cutSignal?.aborted) {
            budgetCut = budgetAbortReason(cutSignal).message;
            break;
          }
          try {
            const eventUrl = buildEventUrl(regionAlias, compId, game.id);

            const pending = captureSwarm(page, eventUrl, {
              singleEventMode: true,
              targetGameNumber: game.id,
            });
            const capture = watcher.cut ? await Promise.race([pending, watcher.cut]) : await pending;
            if (capture === BUDGET_CUT) {
              budgetCut = budgetAbortReason(cutSignal!).message;
              break;
            }
            const matchWsData = capture.data;

            if (!matchWsData) {
              console.warn(
                `[Betcris/FullOffer] Skipped game ${game.id} (${teams.homeTeam} vs ${teams.awayTeam}): ${formatCaptureFailure(capture)}`
              );
              if (isSiteLevelCaptureFailure(capture.failure)) {
                consecutiveFailures++;
                if (consecutiveFailures >= WS_CONFIG.MAX_CONSECUTIVE_MATCH_FAILURES) {
                  console.warn(
                    `[Betcris/FullOffer] Aborting per-match loop: ${consecutiveFailures} consecutive capture failures`
                  );
                  aborted = true;
                  break;
                }
              }
            } else {
              consecutiveFailures = 0;
              const entry = { game, teams, regionAlias, competitionId: compId };
              // A missing or thin copy is skipped, never written as its listing 1X2
              const skip = detailSkipReason(entry, matchWsData);
              if (skip) {
                console.warn(
                  `[Betcris/FullOffer] Skipped game ${game.id} (${teams.homeTeam} vs ${teams.awayTeam}): ${skip}`
                );
              }
              const offer = skip ? null : buildBetcrisMatchOffer(entry, matchWsData, leagueSlug, new Date());
              if (offer) {
                matches.push(offer);
                console.log(
                  `[Betcris/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${offer.markets.length} markets`
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
        // Every iteration catches its own errors, so the loop always gets here
        watcher.release();

        const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
        console.log(
          `[Betcris/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
        );

        if (budgetCut !== null) {
          console.warn(`[Betcris/FullOffer] Stopping per-match loop: ${budgetCut}`);
          // Keep the games captured before the cut (status partial); none is a failure.
          return {
            success: matches.length > 0,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches,
            error: budgetCut,
            duration: Date.now() - startTime,
          };
        }

        if (aborted) {
          // Keep what was captured before the site went away; nothing captured is a failure.
          return {
            success: matches.length > 0,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches,
            error: `aborted after ${WS_CONFIG.MAX_CONSECUTIVE_MATCH_FAILURES} consecutive per-match capture failures`,
            duration: Date.now() - startTime,
          };
        }

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

