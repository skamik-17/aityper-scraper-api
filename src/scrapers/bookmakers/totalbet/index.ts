/**
 * Totalbet scraper (UUID "dealer" API)
 *
 * Plain HTTP, no browser: one league list request, then one event-detail request
 * per listed event, at most TOTALBET_DETAIL_CONCURRENCY at once, all under one
 * scrape budget (TOTALBET_BUDGET_MS unless the caller passes one). The class still extends
 * PlaywrightScraper only for the shared scraper interface (aggregator, audit tools);
 * it never opens a browser.
 *
 * League category UUIDs come from src/config/leagues.ts. Every failure is reported
 * in the result's error string. A match whose detail failed is skipped, never written
 * with its list 1X2: a 1X2-only write would replace the match's full offer. More than
 * MAX_SKIPPED_DETAIL_RATIO failed details fail the run, with nothing written.
 */

import type { Page } from "playwright";
import type { PolishBookmaker } from "../../../config/index.js";
import { getBookmakerLeagueId } from "../../../config/leagues.js";
import type { FullMatchOffer, FullOfferScraperResult, Market1X2Odds, ScrapedMarket } from "../../../types/full-offer.js";
import type {
  EventUrlEntry,
  MatchDetailResult,
  MatchIdentifier,
  RawScrapedOdds,
  ScraperConfig,
  ScraperResult,
} from "../../../types/scraper.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { findMatchingEvent, getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { BudgetExceededError, createScrapeBudget, type ScrapeBudget } from "../../shared/budget.js";
import { mapLimit } from "../../shared/concurrency.js";
import { MAX_SKIPPED_DETAIL_RATIO } from "../../shared/detail-fetch.js";
import { createHttpClient, type HttpClient } from "../../shared/http/http-client.js";
import type { TransportStats } from "../../shared/scraper-contract.js";

import {
  buildEventUrl,
  createHttpFetchJson,
  extractEventUuidFromUrl,
  fetchEventDetail,
  fetchLeagueEvents,
  type EventDetailResult,
  type FetchJson,
} from "./api-client.js";
import type { TotalbetDetailEvent } from "./api-types.js";
import {
  PHASE1_CHECK_MIN_MARKETS,
  PHASE1_MARKET_KEYS,
  TOTALBET_BUDGET_MS,
  TOTALBET_DETAIL_CONCURRENCY,
  TOTALBET_REQUEST_TIMEOUT_MS,
} from "./constants.js";
import { listEventToMatchWinnerMarket, parseEventDetail, parseParticipants } from "./grid-parser.js";

/** Injectable transport (tests pass a fake FetchJson or a replay HttpClient). */
export interface TotalbetDeps {
  /** Raw transport; wins over `http`. Its requests are not counted in transportStats(). */
  fetchJson?: FetchJson;
  /** HTTP client behind the default FetchJson; defaults to a fresh shared-HttpClient instance. */
  http?: HttpClient;
  /** Event-detail requests in flight at once; defaults to TOTALBET_DETAIL_CONCURRENCY. */
  detailConcurrency?: number;
}

type Teams = { homeTeam: string; awayTeam: string };

const LOG = "[Totalbet/FullOffer]";
const MATCH_WINNER_NAME = "Wynik meczu";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Name kept for compatibility with existing imports; this scraper never opens a browser. */
export class TotalbetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "totalbet";
  readonly transport = "http" as const;
  config: ScraperConfig;
  private readonly http: HttpClient;
  private readonly fetchJson: FetchJson;
  private readonly detailConcurrency: number;

  constructor(config?: Partial<ScraperConfig>, deps: TotalbetDeps = {}) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.totalbet,
      ...config,
      enabled: true,
    };
    this.http = deps.http ?? createHttpClient({ perHostConcurrency: TOTALBET_DETAIL_CONCURRENCY });
    this.fetchJson = deps.fetchJson ?? createHttpFetchJson(this.http, { timeoutMs: TOTALBET_REQUEST_TIMEOUT_MS });
    this.detailConcurrency = deps.detailConcurrency ?? TOTALBET_DETAIL_CONCURRENCY;
  }

  /** Counters of this instance's HttpClient, cumulative since construction (copies). */
  transportStats(): TransportStats {
    const stats = this.http.stats;
    return { http: { ...stats, byStatus: { ...stats.byStatus } } };
  }

  /** League list only: one RawScrapedOdds per event with an oriented, fully active list 1X2. */
  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    const categoryUuid = leagueCategoryUuid(league);
    if (!categoryUuid) {
      return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);
    }

    try {
      const list = await fetchLeagueEvents(categoryUuid, this.fetchJson);
      if (list.error) {
        return { status: "error", bookmaker: this.bookmaker, error: list.error, duration: Date.now() - startTime, timestamp: new Date() };
      }

      const matches: RawScrapedOdds[] = [];
      for (const event of list.events) {
        const teams = parseParticipants(event);
        const market = listEventToMatchWinnerMarket(event);
        if (!teams || !market) continue;

        const odds = orientedMatchWinnerOdds(market, teams);
        if (!odds) {
          console.warn(`[Totalbet] skipped ${teams.homeTeam} vs ${teams.awayTeam}: 1X2 outcome names do not match the participants`);
          continue;
        }

        matches.push({
          bookmaker: this.bookmaker,
          eventName: `${teams.homeTeam} - ${teams.awayTeam}`,
          homeTeam: getCanonicalTeamName(teams.homeTeam, league),
          awayTeam: getCanonicalTeamName(teams.awayTeam, league),
          homeOdds: odds.home,
          drawOdds: odds.draw,
          awayOdds: odds.away,
          hasNoTaxPromo: false,
          scrapedAt: new Date(),
          eventUrl: buildEventUrl(event.uuid),
        });
      }

      console.log(`[Totalbet] Found ${matches.length} matches with valid odds for ${league}`);
      return { status: "success", bookmaker: this.bookmaker, data: matches, duration: Date.now() - startTime, timestamp: new Date() };
    } catch (error) {
      return this.createErrorResult(error, Date.now() - startTime);
    }
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
        `Match not found on Totalbet: ${match.homeTeam} vs ${match.awayTeam}`,
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

  /** One event detail, reduced to its 1X2 ("Wynik meczu" in grid order home, draw, away). */
  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    const eventUuid = extractEventUuidFromUrl(eventUrl);
    if (!eventUuid) {
      return this.createMatchDetailNotFoundResult("Invalid Totalbet event URL", Date.now() - startTime);
    }

    try {
      const detail = await fetchEventDetail(eventUuid, this.fetchJson);
      if (!detail.event) {
        const message = detail.error ?? `No detail for Totalbet event ${eventUuid}`;
        // An event that is no longer an active prematch event is a state change, not a fetch failure.
        return detail.notPrematch
          ? this.createMatchDetailNotFoundResult(message, Date.now() - startTime)
          : this.createMatchDetailErrorResult(new Error(message), Date.now() - startTime);
      }

      const teams = parseParticipants(detail.event);
      // Exactly one id-less, line-less "Wynik meczu": two such markets are ambiguous, so no 1X2 is read.
      const candidates = parseEventDetail(detail.event).filter(
        (m) => m.name === MATCH_WINNER_NAME && m.bookmakerMarketId === undefined && m.paramValue === undefined
      );
      const odds = teams && candidates.length === 1 ? orientedMatchWinnerOdds(candidates[0], teams) : null;
      if (!teams || !odds) {
        return this.createMatchDetailNotFoundResult(
          `No oriented 1X2 market in Totalbet event ${eventUuid}`,
          Date.now() - startTime
        );
      }

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: {
          bookmaker: this.bookmaker,
          eventName: `${teams.homeTeam} - ${teams.awayTeam}`,
          homeTeam: teams.homeTeam,
          awayTeam: teams.awayTeam,
          eventUrl,
          hasNoTaxPromo: false,
          scrapedAt: new Date(),
          market1X2: odds,
        },
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      return this.createMatchDetailErrorResult(error, Date.now() - startTime);
    }
  }

  async scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult> {
    const startTime = Date.now();
    const categoryUuid = leagueCategoryUuid(league);
    if (!categoryUuid) {
      return this.createFullOfferErrorResult(league, new Error(`Unknown league: ${league}`), Date.now() - startTime);
    }

    try {
      return await this.scrapeLeagueOffer(league, categoryUuid, startTime, budget ?? createScrapeBudget(TOTALBET_BUDGET_MS));
    } catch (error) {
      return this.createFullOfferErrorResult(league, error, Date.now() - startTime);
    }
  }

  async extractEventUrls(_page: Page): Promise<EventUrlEntry[]> {
    return [];
  }

  private async scrapeLeagueOffer(
    league: string,
    categoryUuid: string,
    startTime: number,
    budget: ScrapeBudget
  ): Promise<FullOfferScraperResult> {
    // The aggregator logs only success=false for a failed run, so the reason is logged here.
    const failure = (error: string): FullOfferScraperResult => {
      console.warn(`${LOG} ${league} failed: ${error}`);
      return { success: false, bookmaker: this.bookmaker, league, matches: [], error, duration: Date.now() - startTime };
    };

    const list = await fetchLeagueEvents(categoryUuid, this.fetchJson, budget.signal);
    if (list.error) return failure(budgetFailure(budget) ?? list.error);
    if (list.events.length === 0) {
      // README §3 empty-listing rule: success with no matches (observability: `empty`)
      const reason = list.empty ?? `No prematch events for ${league}`;
      console.warn(`${LOG} ${reason}`);
      return { success: true, bookmaker: this.bookmaker, league, matches: [], error: reason, duration: Date.now() - startTime };
    }
    console.log(`${LOG} Found ${list.events.length} prematch events for ${league}`);

    // Details run concurrently; the results are read below in list order, so the
    // output is the same as a sequential run over the same responses.
    const settled = await mapLimit(list.events, this.detailConcurrency, (listEvent) => {
      budget.checkpoint();
      return fetchEventDetail(listEvent.uuid, this.fetchJson, budget.signal);
    });
    // A budget abort fails the whole scrape: no partial offer and no list-1X2
    // fallbacks, so a hard deadline never produces 1X2-only rows.
    const aborted = budgetAbort(settled, budget);
    if (aborted) return failure(aborted);

    const matches: FullMatchOffer[] = [];
    const driftErrors: string[] = [];
    // Events whose detail request failed; each is skipped (no list-1X2 fallback). Events
    // that are no longer active prematch events, or whose detail has no active market,
    // are "no offer": skipped too, but not counted.
    let detailsFailed = 0;
    let firstDetailError: string | undefined;
    // Events skipped because their detail is no longer an active prematch event.
    let skippedNotPrematch = 0;
    let firstNotPrematchError: string | undefined;

    for (const [index, listEvent] of list.events.entries()) {
      // Match identity always comes from the list event, so it never depends on detail success.
      const teams = parseParticipants(listEvent);
      if (!teams) {
        console.warn(`${LOG} skipped event ${listEvent.uuid}: no named home and away participants`);
        continue;
      }
      const homeTeam = getCanonicalTeamName(teams.homeTeam, league);
      const awayTeam = getCanonicalTeamName(teams.awayTeam, league);

      const detail = settledDetail(settled[index]);

      if (detail.notPrematch) {
        // Kicked off (or was suspended) after the list call: no prematch price may be
        // stored for it, so there is no list-1X2 fallback either.
        skippedNotPrematch++;
        firstNotPrematchError ??= detail.error;
        console.log(`${LOG} skipped ${homeTeam} vs ${awayTeam}: detail is ${detail.notPrematch.type}/${detail.notPrematch.status}`);
        continue;
      }

      if (!detail.event) {
        detailsFailed++;
        firstDetailError ??= detail.error;
        console.warn(`${LOG} ${homeTeam} vs ${awayTeam}: detail fetch failed, match skipped: ${detail.error}`);
        continue;
      }

      const markets: ScrapedMarket[] = parseEventDetail(detail.event);
      const missing = missingPhase1Keys(detail.event);
      if (missing.length > 0) {
        const text = `phase-1 keys missing for ${homeTeam} vs ${awayTeam}: ${missing.join(",")}`;
        console.warn(`${LOG} ${text}`);
        driftErrors.push(text);
      }

      if (markets.length === 0) {
        console.warn(`${LOG} skipped ${homeTeam} vs ${awayTeam}: no active market`);
        continue;
      }

      matches.push({
        matchId: listEvent.uuid,
        bookmaker: this.bookmaker,
        homeTeam,
        awayTeam,
        eventUrl: buildEventUrl(listEvent.uuid),
        markets,
        startTime: listEvent.start_at,
        scrapedAt: new Date(),
      });
      // M for acceptance A2 (N >= 0.95*M): the count of the detail the markets were parsed from.
      console.log(`${LOG} ${homeTeam} vs ${awayTeam}: ${markets.length} markets (market_count ${detail.event.market_count})`);
    }

    const errorParts: string[] = [];
    // m: matches written plus failed details; "no offer" events count in neither.
    const attempted = matches.length + detailsFailed;
    // Too many skipped matches fail the run below, with nothing written.
    const tooManySkipped = attempted > 0 && detailsFailed / attempted > MAX_SKIPPED_DETAIL_RATIO;
    if (detailsFailed > 0) {
      const text = `${detailsFailed} of ${attempted} details failed | ${firstDetailError}`;
      console.warn(`${LOG} ${text}`);
      errorParts.push(text);
    }
    // Kick-off skips are routine on a healthy run, so they are reported only when the run
    // fails: then they can be the reason (e.g. every detail went live at a shared kick-off).
    if (skippedNotPrematch > 0 && (matches.length === 0 || tooManySkipped)) {
      errorParts.push(`Skipped ${skippedNotPrematch} not-prematch events (first: ${firstNotPrematchError})`);
    }
    errorParts.push(...driftErrors);

    if (matches.length === 0) {
      // The fixed text comes first; the detail and drift parts keep the HTTP reason (plan risk 8).
      return failure([`No parsable Totalbet events for ${league}`, ...errorParts].join(" | "));
    }
    if (tooManySkipped) {
      // Too many skipped matches: fail without writing, so the previous rows stay.
      return failure(errorParts.join(" | "));
    }

    const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
    console.log(`${LOG} Completed: ${matches.length} matches, ${totalMarkets} total markets`);

    return {
      success: true,
      bookmaker: this.bookmaker,
      league,
      matches,
      error: errorParts.length > 0 ? errorParts.join(" | ") : undefined,
      duration: Date.now() - startTime,
    };
  }
}

/** The budget's own message when it has aborted, else null. */
function budgetFailure(budget: ScrapeBudget): string | null {
  try {
    budget.checkpoint();
    return null;
  } catch (err) {
    if (err instanceof BudgetExceededError) return err.message;
    throw err;
  }
}

/**
 * The budget message when the detail phase was cut short by the budget: a detail
 * refused at its checkpoint, or one aborted in flight ("fetch aborted …") after
 * the budget signal fired. Null otherwise, even if the budget expired after every
 * detail had already answered.
 */
function budgetAbort(settled: PromiseSettledResult<EventDetailResult>[], budget: ScrapeBudget): string | null {
  const cut = settled.some((r) =>
    r.status === "rejected"
      ? r.reason instanceof BudgetExceededError
      : budget.signal.aborted && r.value.error?.startsWith("fetch aborted ") === true
  );
  return cut ? budgetFailure(budget) : null;
}

/** The detail result of a settled fetch; fetchEventDetail never rejects, so a rejection is a bug and rethrown. */
function settledDetail(result: PromiseSettledResult<EventDetailResult>): EventDetailResult {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

/** The league's Totalbet category (tournament) UUID from src/config/leagues.ts, or null. */
function leagueCategoryUuid(league: string): string | null {
  const id = getBookmakerLeagueId(league, "totalbet");
  return typeof id === "string" && UUID_PATTERN.test(id) ? id : null;
}

/**
 * Home, draw and away prices of a 3-way "Wynik meczu" market, in grid (or list sort)
 * order. Null unless the first and last outcome names are the home and away
 * participants: a reordered grid would otherwise publish one team's price as the other's.
 */
function orientedMatchWinnerOdds(market: ScrapedMarket, teams: Teams): Market1X2Odds | null {
  if (market.selections.length !== 3) return null;
  const [home, draw, away] = market.selections;
  if (home.name !== teams.homeTeam || away.name !== teams.awayTeam) return null;
  return { home: home.odds, draw: draw.odds, away: away.odds };
}

/**
 * Phase-1 keys absent from a large event's raw component_lists (slug-drift check).
 * Keys are read before any status filtering, so suspended markets raise no alarm:
 * every component slug, plus the market_id of each markets_in_columns header label,
 * read with the same rules as the grid parser.
 */
function missingPhase1Keys(event: TotalbetDetailEvent): string[] {
  if (!(event.market_count >= PHASE1_CHECK_MIN_MARKETS)) return [];

  const present = new Set<string>();
  for (const component of event.component_lists as unknown[]) {
    if (!isRecord(component)) continue;
    if (typeof component.slug === "string" && component.slug !== "") present.add(`slug:${component.slug}`);
    if (component.type !== "markets_in_columns" || !Array.isArray(component.grid)) continue;

    const header: unknown = component.grid[0];
    if (!Array.isArray(header)) continue;
    for (const head of header) {
      if (isRecord(head) && head.type === "label" && typeof head.text === "string" && head.market_id) {
        present.add(`mid:${head.market_id}`);
      }
    }
  }
  return PHASE1_MARKET_KEYS.filter((key) => !present.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const totalbetScraper = new TotalbetPlaywrightScraper();
