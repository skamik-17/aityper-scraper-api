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
import type {
  FullOfferScraperResult,
  FullMatchOffer,
  ScrapedMarket,
} from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { ScraperCache, CACHE_TTLS } from "../../../services/cache-manager.js";

import {
  fetchLeagueMatches,
  fetchMatchDetails,
  fetchMarketGroupResults,
  extractMatchIdFromUrl,
  buildEventUrl,
  createBetclicTransportStats,
  addBetclicTransportStats,
  formatBetclicTransportStats,
  type BetclicTransportStats,
} from "./navigation.js";
import {
  parseListingResponse,
  parseAllMarketsFromProto,
  parseAllMarketsFromMultipleResponses,
  parseTeamNames,
  isValidMatch,
  extract1X2FromMarkets,
  extractDoubleChanceFromMarkets,
  extractBTTSFromMarkets,
  extractOverUnderFromMarkets,
  parseMatchHeader,
} from "./parser.js";
import type { BetclicListingMatch } from "./types.js";
import { assessMatchGroups } from "./match-groups.js";
import { toIsoStartTime } from "../../shared/start-time.js";
import type { TransportStats, TransportStatsSource } from "../../shared/scraper-contract.js";
import { mapLimit } from "../../shared/concurrency.js";
import { resolveBetclicMatchConcurrency } from "./constants.js";

/** Same value as plan 02's MAX_SKIPPED_DETAIL_RATIO: more skipped matches than this fails the run. */
const MAX_SKIPPED_MATCH_RATIO = 0.5;

/** Per-run context handed to fetchMatchOffer. */
interface MatchFetchContext {
  league: string;
  /** The match's own transport counters. */
  stats: BetclicTransportStats;
}

/** What happened to one listed match: written, or skipped with the reason (no write, no prune). */
type BetclicMatchOutcome =
  | { kind: "written"; offer: FullMatchOffer }
  | { kind: "skipped"; reason: string };

const eventsCache = new ScraperCache<BetclicListingMatch>({
  name: "betclic-events",
  ttl: CACHE_TTLS.EVENTS,
  maxSize: 500,
});

export class BetclicPlaywrightScraper extends PlaywrightScraper implements TransportStatsSource {
  bookmaker: PolishBookmaker = "betclic";
  readonly transport = "http" as const;
  config: ScraperConfig;
  /** Transport counters of every scrapeFullOffer since construction (README §3: cumulative). */
  private readonly totals = createBetclicTransportStats();

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.betclic,
      ...config,
      enabled: true,
    };
  }

  /** A copy of the cumulative counters; callers diff two readings around a unit of work. */
  transportStats(): TransportStats {
    const { requests, retries, failures, bytes, byStatus } = this.totals;
    return { http: { requests, retries, failures, bytes, byStatus: { ...byStatus } } };
  }

  private updateCache(matches: BetclicListingMatch[]): void {
    eventsCache.setMany(
      matches
        .filter((m) => m.matchId !== null)
        .map((m) => ({ key: m.matchId!, value: m }))
    );
  }

  private getCachedEvent(matchId: string): BetclicListingMatch | undefined {
    return eventsCache.get(matchId);
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();

    if (!isLeagueSupported(league, this.bookmaker)) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      const responseData = await fetchLeagueMatches(league);
      if (!responseData) {
        return this.createNotFoundResult(
          `No ${league} matches found on Betclic`,
          Date.now() - startTime
        );
      }

      const parsedMatches = parseListingResponse(responseData, league);

      if (parsedMatches.length === 0) {
        return this.createNotFoundResult(
          `Could not parse any ${league} match data from Betclic`,
          Date.now() - startTime
        );
      }

      this.updateCache(parsedMatches);

      const matches: RawScrapedOdds[] = parsedMatches
        .filter(isValidMatch)
        .map((match) => ({
          bookmaker: this.bookmaker,
          eventName: match.matchName,
          homeTeam: getCanonicalTeamName(match.homeTeam, league),
          awayTeam: getCanonicalTeamName(match.awayTeam, league),
          homeOdds: match.homeOdds,
          drawOdds: match.drawOdds,
          awayOdds: match.awayOdds,
          hasNoTaxPromo: false,
          scrapedAt: new Date(),
          eventUrl: match.matchId
            ? buildEventUrl(match.matchId, league, match.homeTeam, match.awayTeam)
            : undefined,
        }));

      console.log(`[Betclic] Successfully scraped ${matches.length} ${league} matches via gRPC API`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: matches,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[Betclic] API scraping error:", error);
      return this.createErrorResult(error, Date.now() - startTime);
    }
  }

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "premier-league";

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
        `Match not found on Betclic: ${match.homeTeam} vs ${match.awayTeam}`,
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

    try {
      const matchId = extractMatchIdFromUrl(eventUrl);
      if (!matchId) {
        return this.createMatchDetailNotFoundResult(
          "Could not extract match ID from URL",
          Date.now() - startTime
        );
      }

      const responseData = await fetchMatchDetails(matchId);
      if (!responseData) {
        return this.createMatchDetailNotFoundResult(
          "No match data received",
          Date.now() - startTime
        );
      }

      const markets = parseAllMarketsFromProto(responseData);
      if (markets.length === 0) {
        return this.createMatchDetailNotFoundResult(
          "Could not parse match data",
          Date.now() - startTime
        );
      }

      const cachedEvent = this.getCachedEvent(matchId);
      const homeTeam = cachedEvent?.homeTeam || "";
      const awayTeam = cachedEvent?.awayTeam || "";
      const eventName = cachedEvent?.matchName || `${homeTeam} - ${awayTeam}`;

      const market1X2 = extract1X2FromMarkets(markets, homeTeam, awayTeam);
      const marketDoubleChance = extractDoubleChanceFromMarkets(markets);
      const marketBTTS = extractBTTSFromMarkets(markets);
      const marketOverUnder = extractOverUnderFromMarkets(markets);

      const matchOdds: RawScrapedMatchOdds = {
        bookmaker: this.bookmaker,
        eventName,
        homeTeam,
        awayTeam,
        eventUrl,
        hasNoTaxPromo: false,
        scrapedAt: new Date(),
        market1X2: market1X2 || { home: 0, draw: 0, away: 0 },
        marketDoubleChance: marketDoubleChance || undefined,
        marketBTTS: marketBTTS || undefined,
        marketOverUnder: marketOverUnder || undefined,
      };

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: matchOdds,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[Betclic] Error scraping match details:", error);
      return this.createMatchDetailErrorResult(error, Date.now() - startTime);
    }
  }

  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    const startTime = Date.now();

    if (!isLeagueSupported(league, this.bookmaker)) {
      return this.createFullOfferErrorResult(
        league,
        new Error(`Unknown league: ${league}`),
        Date.now() - startTime
      );
    }

    const runStats = createBetclicTransportStats();
    try {
      const listingData = await fetchLeagueMatches(league, { stats: runStats });
      if (!listingData) {
        return {
          success: false,
          bookmaker: this.bookmaker,
          league,
          matches: [],
          error: "No events found from API",
          duration: Date.now() - startTime,
        };
      }

      const listingMatches = parseListingResponse(listingData, league);
      console.log(`[Betclic/FullOffer] Found ${listingMatches.length} events in listing`);

      this.updateCache(listingMatches);

      // A few matches at a time; every log line is one console call, so concurrent
      // matches interleave whole lines only. Results come back in listing order.
      const withIds = listingMatches.filter((m) => m.matchId);
      const settled = await mapLimit(withIds, resolveBetclicMatchConcurrency(), async (listingMatch) => {
        const matchStats = createBetclicTransportStats();
        const outcome = await this.fetchMatchOffer(listingMatch, { league, stats: matchStats });
        console.log(
          `[Betclic/Transport] ${listingMatch.homeTeam} vs ${listingMatch.awayTeam}: ${formatBetclicTransportStats(matchStats)}`
        );
        addBetclicTransportStats(runStats, matchStats);
        if (outcome.kind === "skipped") {
          console.warn(
            `[Betclic/FullOffer] Skipping ${listingMatch.homeTeam} vs ${listingMatch.awayTeam} (ID: ${listingMatch.matchId}): ${outcome.reason}`
          );
        }
        await this.delay(50);
        return outcome;
      });

      const matches: FullMatchOffer[] = [];
      const skipped: string[] = [];
      for (const result of settled) {
        if (result.status === "rejected") {
          skipped.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        } else if (result.value.kind === "written") {
          matches.push(result.value.offer);
        } else {
          skipped.push(result.value.reason);
        }
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(
        `[Betclic/Transport] ${league}: ${matches.length}/${listingMatches.length} matches in ${Date.now() - startTime} ms, ${formatBetclicTransportStats(runStats)}`
      );
      console.log(
        `[Betclic/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
      );

      const attempted = matches.length + skipped.length;
      const error =
        skipped.length > 0 ? `${skipped.length} of ${attempted} details failed | ${skipped[0]}` : undefined;
      if (error) console.warn(`[betclic] ${error}`);

      const failed =
        attempted > 0 && (matches.length === 0 || skipped.length / attempted > MAX_SKIPPED_MATCH_RATIO);

      return {
        success: !failed,
        bookmaker: this.bookmaker,
        league,
        matches: failed ? [] : matches,
        ...(error ? { error } : {}),
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return this.createFullOfferErrorResult(league, error, Date.now() - startTime);
    } finally {
      addBetclicTransportStats(this.totals, runStats);
    }
  }

  /**
   * Fetch and parse one listed match. Never throws: a match whose groups are
   * incomplete, that parses to no markets, or whose fetch throws is skipped
   * with the reason, so nothing is written or pruned for it.
   */
  private async fetchMatchOffer(
    listingMatch: BetclicListingMatch,
    ctx: MatchFetchContext
  ): Promise<BetclicMatchOutcome> {
    const { homeTeam, awayTeam } = listingMatch;
    const matchId = listingMatch.matchId!;
    try {
      console.log(
        `[Betclic/FullOffer] Fetching markets for ${homeTeam} vs ${awayTeam} (ID: ${matchId})`
      );

      const results = await fetchMarketGroupResults(matchId, { stats: ctx.stats });
      // Every group carries the same header; TOP's says which categories the match declares.
      const top = results.find((r) => r.group === "TOP")?.response;
      const assessment = assessMatchGroups(results, top ? parseMatchHeader(top).categories : []);
      if (!assessment.ok) return { kind: "skipped", reason: assessment.reason };

      console.log(
        `[Betclic/FullOffer] ${homeTeam} vs ${awayTeam}: received ${assessment.responses.length} response(s) from 7 market groups, ${assessment.duplicates.length} duplicate(s) not parsed`
      );

      const markets = parseAllMarketsFromMultipleResponses(assessment.responses);
      if (markets.length === 0) return { kind: "skipped", reason: "0 markets parsed" };

      const offer: FullMatchOffer = {
        matchId,
        startTime: toIsoStartTime(listingMatch.startTime),
        bookmaker: this.bookmaker,
        homeTeam: getCanonicalTeamName(homeTeam, ctx.league),
        awayTeam: getCanonicalTeamName(awayTeam, ctx.league),
        eventUrl: buildEventUrl(matchId, ctx.league, homeTeam, awayTeam),
        markets,
        scrapedAt: new Date(),
      };

      console.log(
        `[Betclic/FullOffer] ${homeTeam} vs ${awayTeam}: ${markets.length} markets total`
      );
      return { kind: "written", offer };
    } catch (error) {
      return { kind: "skipped", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async extractEventUrls(_page: Page): Promise<EventUrlEntry[]> {
    return [];
  }
}

export const betclicScraper = new BetclicPlaywrightScraper();
