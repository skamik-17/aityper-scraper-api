/**
 * Totalbet scraper (UUID "dealer" API)
 *
 * Plain HTTP, no browser: one league list request, then one event-detail request
 * per listed event, in sequence and DETAIL_DELAY_MS apart. The class still extends
 * PlaywrightScraper only for the shared scraper interface (aggregator, audit tools);
 * it never opens a browser.
 *
 * League category UUIDs come from src/config/leagues.ts. Every failure is reported
 * in the result's error string; a run whose details all fail is a failed run even
 * when list-1X2 fallbacks exist, because a 1X2-only offer is an outage.
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

import {
  buildEventUrl,
  extractEventUuidFromUrl,
  fetchEventDetail,
  fetchLeagueEvents,
  nodeFetchJson,
  type FetchJson,
} from "./api-client.js";
import type { TotalbetDetailEvent } from "./api-types.js";
import { DETAIL_DELAY_MS, PHASE1_CHECK_MIN_MARKETS, PHASE1_MARKET_KEYS } from "./constants.js";
import { listEventToMatchWinnerMarket, parseEventDetail, parseParticipants } from "./grid-parser.js";

/** Injectable transport and pacing (tests pass a fake FetchJson and no delay). */
export interface TotalbetDeps {
  /** HTTP transport; defaults to Node's global fetch (nodeFetchJson). */
  fetchJson?: FetchJson;
  /** Pause after each event-detail request; defaults to DETAIL_DELAY_MS. */
  detailDelayMs?: number;
}

type Teams = { homeTeam: string; awayTeam: string };

const LOG = "[Totalbet/FullOffer]";
const MATCH_WINNER_NAME = "Wynik meczu";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Name kept for compatibility with existing imports; this scraper never opens a browser. */
export class TotalbetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "totalbet";
  config: ScraperConfig;
  private readonly fetchJson: FetchJson;
  private readonly detailDelayMs: number;

  constructor(config?: Partial<ScraperConfig>, deps: TotalbetDeps = {}) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.totalbet,
      ...config,
      enabled: true,
    };
    this.fetchJson = deps.fetchJson ?? nodeFetchJson;
    this.detailDelayMs = deps.detailDelayMs ?? DETAIL_DELAY_MS;
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

  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    const startTime = Date.now();
    const categoryUuid = leagueCategoryUuid(league);
    if (!categoryUuid) {
      return this.createFullOfferErrorResult(league, new Error(`Unknown league: ${league}`), Date.now() - startTime);
    }

    try {
      return await this.scrapeLeagueOffer(league, categoryUuid, startTime);
    } catch (error) {
      return this.createFullOfferErrorResult(league, error, Date.now() - startTime);
    }
  }

  async extractEventUrls(_page: Page): Promise<EventUrlEntry[]> {
    return [];
  }

  private async scrapeLeagueOffer(league: string, categoryUuid: string, startTime: number): Promise<FullOfferScraperResult> {
    // The aggregator logs only success=false for a failed run, so the reason is logged here.
    const failure = (error: string): FullOfferScraperResult => {
      console.warn(`${LOG} ${league} failed: ${error}`);
      return { success: false, bookmaker: this.bookmaker, league, matches: [], error, duration: Date.now() - startTime };
    };

    const list = await fetchLeagueEvents(categoryUuid, this.fetchJson);
    if (list.error) return failure(list.error);
    console.log(`${LOG} Found ${list.events.length} prematch events for ${league}`);

    const matches: FullMatchOffer[] = [];
    const driftErrors: string[] = [];
    // n: events whose detail answered or failed. Events skipped because they are no
    // longer active prematch events (or have no participants) are not counted, so
    // success (k < n) still means at least one detail answered: a run in which every
    // reachable detail failed is an outage, even with list-1X2 fallbacks.
    let detailsCounted = 0;
    // k: events whose detail failed and that fell back to the list 1X2.
    let detailsFailed = 0;
    let firstDetailError: string | undefined;
    // Events skipped because their detail is no longer an active prematch event.
    let skippedNotPrematch = 0;
    let firstNotPrematchError: string | undefined;

    for (const listEvent of list.events) {
      // Match identity always comes from the list event, so it never depends on detail success.
      const teams = parseParticipants(listEvent);
      if (!teams) {
        console.warn(`${LOG} skipped event ${listEvent.uuid}: no named home and away participants`);
        continue;
      }
      const homeTeam = getCanonicalTeamName(teams.homeTeam, league);
      const awayTeam = getCanonicalTeamName(teams.awayTeam, league);

      const detail = await fetchEventDetail(listEvent.uuid, this.fetchJson);
      await this.delay(this.detailDelayMs);

      if (detail.notPrematch) {
        // Kicked off (or was suspended) after the list call: no prematch price may be
        // stored for it, so there is no list-1X2 fallback either.
        skippedNotPrematch++;
        firstNotPrematchError ??= detail.error;
        console.log(`${LOG} skipped ${homeTeam} vs ${awayTeam}: detail is ${detail.notPrematch.type}/${detail.notPrematch.status}`);
        continue;
      }
      detailsCounted++;

      let markets: ScrapedMarket[];
      if (detail.event) {
        markets = parseEventDetail(detail.event);
        const missing = missingPhase1Keys(detail.event);
        if (missing.length > 0) {
          const text = `phase-1 keys missing for ${homeTeam} vs ${awayTeam}: ${missing.join(",")}`;
          console.warn(`${LOG} ${text}`);
          driftErrors.push(text);
        }
      } else {
        detailsFailed++;
        firstDetailError ??= detail.error;
        console.warn(`${LOG} ${homeTeam} vs ${awayTeam}: detail fetch failed, list 1X2 only: ${detail.error}`);
        const fallback = listEventToMatchWinnerMarket(listEvent);
        markets = fallback ? [fallback] : [];
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
      // M for acceptance A2 (N >= 0.95*M): the count of the payload the markets were parsed
      // from, i.e. the detail when it answered (as the drift check uses), else the list event.
      console.log(`${LOG} ${homeTeam} vs ${awayTeam}: ${markets.length} markets (market_count ${(detail.event ?? listEvent).market_count})`);
    }

    const success = detailsFailed < detailsCounted;
    const errorParts: string[] = [];
    if (detailsFailed > 0) {
      const text = `Detail fetch failed for ${detailsFailed}/${detailsCounted} events (first: ${firstDetailError})`;
      console.warn(`${LOG} ${text}`);
      errorParts.push(text);
    }
    // Kick-off skips are routine on a healthy run, so they are reported only when the run
    // fails: then they can be the reason (e.g. every detail went live at a shared kick-off).
    if (skippedNotPrematch > 0 && (matches.length === 0 || !success)) {
      errorParts.push(`Skipped ${skippedNotPrematch} not-prematch events (first: ${firstNotPrematchError})`);
    }
    errorParts.push(...driftErrors);

    if (matches.length === 0) {
      // The fixed text comes first; the detail and drift parts keep the HTTP reason (plan risk 8).
      return failure([`No parsable Totalbet events for ${league}`, ...errorParts].join(" | "));
    }

    const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
    console.log(`${LOG} Completed: ${matches.length} matches, ${totalMarkets} total markets`);

    return {
      success,
      bookmaker: this.bookmaker,
      league,
      matches,
      error: errorParts.length > 0 ? errorParts.join(" | ") : undefined,
      duration: Date.now() - startTime,
    };
  }
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
