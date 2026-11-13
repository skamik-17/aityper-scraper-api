
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import type {
  ScraperConfig,
} from "../../../types/scraper.js";
import type {
  FullOfferScraperResult,
  FullMatchOffer,
} from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";

import {
  fetchLeagueMatches,
  fetchMarketGroupResults,
  buildEventUrl,
  createBetclicTransportStats,
  addBetclicTransportStats,
  formatBetclicTransportStats,
  type BetclicTransportStats,
} from "./navigation.js";
import {
  parseListingResponse,
  parseAllMarketsFromMultipleResponses,
  parseMatchHeader,
} from "./parser.js";
import type { BetclicListingMatch } from "./types.js";
import { assessMatchGroups } from "./match-groups.js";
import { toIsoStartTime } from "../../shared/start-time.js";
import type { TransportStats, TransportStatsSource } from "../../shared/scraper-contract.js";
import type { EventRef, IncrementalScraper } from "../../shared/incremental/incremental-scraper.js";
import { listingFingerprintOrNull } from "../../shared/incremental/listing-fingerprint.js";
import { setMaxListeners } from "node:events";
import { mapLimit } from "../../shared/concurrency.js";
import { BudgetExceededError, createScrapeBudget, type ScrapeBudget } from "../../shared/budget.js";
import { MAX_SKIPPED_DETAIL_RATIO } from "../../shared/detail-fetch.js";
import { BETCLIC_MAX_DURATION_MS, resolveBetclicMatchConcurrency } from "./constants.js";

/** Listeners on the run signal: 21 concurrent group streams plus the listing and mapLimit. */
const RUN_SIGNAL_MAX_LISTENERS = 64;

/** Per-run context handed to fetchMatchOffer. */
interface MatchFetchContext {
  league: string;
  /** The match's own transport counters. */
  stats: BetclicTransportStats;
  /** The run budget; its signal aborts the match's streams. */
  budget: ScrapeBudget;
}

/**
 * What happened to one listed match: written; skipped with the reason (no write, no
 * prune); or stopped by the run budget (not counted as a failure).
 */
type BetclicMatchOutcome =
  | { kind: "written"; offer: FullMatchOffer }
  | { kind: "skipped"; reason: string }
  | { kind: "budget" };

export class BetclicPlaywrightScraper
  extends PlaywrightScraper
  implements TransportStatsSource, IncrementalScraper<BetclicListingMatch>
{
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

  /** Plan 10: matches fetched at once on incremental passes, as on the full pass. */
  get detailConcurrency(): number {
    return resolveBetclicMatchConcurrency();
  }

  /** A copy of the cumulative counters; callers diff two readings around a unit of work. */
  transportStats(): TransportStats {
    const { requests, retries, failures, bytes, byStatus } = this.totals;
    return { http: { requests, retries, failures, bytes, byStatus: { ...byStatus } } };
  }

  async scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult> {
    const startTime = Date.now();

    if (!isLeagueSupported(league, this.bookmaker)) {
      return this.createFullOfferErrorResult(
        league,
        new Error(`Unknown league: ${league}`),
        Date.now() - startTime
      );
    }

    const budgetExhausted = (): FullOfferScraperResult => ({
      success: false,
      bookmaker: this.bookmaker,
      league,
      matches: [],
      error: "budget exhausted before the listing",
      duration: Date.now() - startTime,
    });
    // A caller's budget can only shorten the run's own 90 s
    const ms = budget ? Math.min(BETCLIC_MAX_DURATION_MS, budget.remainingMs()) : BETCLIC_MAX_DURATION_MS;
    if (ms <= 0) return budgetExhausted();
    const run = createScrapeBudget(ms, budget?.signal);
    setMaxListeners(RUN_SIGNAL_MAX_LISTENERS, run.signal);

    const runStats = createBetclicTransportStats();
    try {
      const listingData = await fetchLeagueMatches(league, { stats: runStats, signal: run.signal });
      if (!listingData) {
        if (run.signal.aborted) return budgetExhausted();
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

      // A few matches at a time; every log line is one console call, so concurrent
      // matches interleave whole lines only. Results come back in listing order.
      const withIds = listingMatches.filter((m) => m.matchId);
      // Matches not started when the budget aborts reject with its reason (mapLimit)
      const settled = await mapLimit(withIds, resolveBetclicMatchConcurrency(), async (listingMatch) => {
        run.checkpoint();
        const matchStats = createBetclicTransportStats();
        const outcome = await this.fetchMatchOffer(listingMatch, { league, stats: matchStats, budget: run });
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
      }, run.signal);

      const matches: FullMatchOffer[] = [];
      const skipped: string[] = [];
      let budgetStopped = 0;
      for (const result of settled) {
        if (result.status === "rejected") {
          if (run.signal.aborted) budgetStopped++;
          else skipped.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        } else if (result.value.kind === "written") {
          matches.push(result.value.offer);
        } else if (result.value.kind === "budget") {
          budgetStopped++;
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

      // m = written + skipped; budget-stopped matches are not failures and stay out of m
      const attempted = matches.length + skipped.length;
      const parts: string[] = [];
      if (skipped.length > 0) parts.push(`${skipped.length} of ${attempted} details failed | ${skipped[0]}`);
      if (budgetStopped > 0) {
        const text = `${budgetStopped} of ${withIds.length} matches not completed`;
        console.warn(`[Betclic/FullOffer] Budget exhausted after ${Date.now() - startTime} ms: ${text}`);
        parts.push(`budget exhausted: ${text}`);
      }
      const error = parts.length > 0 ? parts.join("; ") : undefined;
      if (error) console.warn(`[betclic] ${error}`);

      const failed =
        (matches.length === 0 && attempted + budgetStopped > 0) ||
        (attempted > 0 && skipped.length / attempted > MAX_SKIPPED_DETAIL_RATIO);

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

      const results = await fetchMarketGroupResults(matchId, { stats: ctx.stats, signal: ctx.budget.signal });
      // Every group carries the same header; TOP's says which categories the match declares.
      const top = results.find((r) => r.group === "TOP")?.response;
      const assessment = assessMatchGroups(results, top ? parseMatchHeader(top).categories : []);
      // A match whose required groups all completed is kept even if the budget aborted meanwhile
      if (!assessment.ok) return ctx.budget.signal.aborted ? { kind: "budget" } : { kind: "skipped", reason: assessment.reason };

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
      if (ctx.budget.signal.aborted) return { kind: "budget" };
      return { kind: "skipped", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Plan 10: the listing as event refs, with plan 06's listing request and log line. The
   * fingerprint is the listed 1X2 plus the match's market count (proto field 7).
   */
  async listEvents(league: string, budget: ScrapeBudget): Promise<EventRef<BetclicListingMatch>[]> {
    if (!isLeagueSupported(league, this.bookmaker)) throw new Error(`Unknown league: ${league}`);
    setMaxListeners(RUN_SIGNAL_MAX_LISTENERS, budget.signal);
    const runStats = createBetclicTransportStats();
    try {
      const listingData = await fetchLeagueMatches(league, { stats: runStats, signal: budget.signal });
      if (!listingData) {
        throw new Error(budget.signal.aborted ? "budget exhausted before the listing" : "No events found from API");
      }
      const listingMatches = parseListingResponse(listingData, league);
      console.log(`[Betclic/FullOffer] Found ${listingMatches.length} events in listing`);
      return listingMatches
        .filter((m) => m.matchId)
        .map((m) => ({
          eventId: m.matchId!,
          homeTeam: getCanonicalTeamName(m.homeTeam, league),
          awayTeam: getCanonicalTeamName(m.awayTeam, league),
          kickoff: toIsoStartTime(m.startTime) ?? null,
          fingerprint: listingFingerprintOrNull(
            [["1", m.homeOdds], ["X", m.drawOdds], ["2", m.awayOdds], ["marketCount", m.marketCount ?? -1]],
            `[Betclic/FullOffer] ${m.matchId}`
          ),
          eventUrl: buildEventUrl(m.matchId!, league, m.homeTeam, m.awayTeam),
          listing: m,
        }));
    } finally {
      addBetclicTransportStats(this.totals, runStats);
    }
  }

  /**
   * Plan 10: one listed match through plan 06's fetchMatchOffer. "0 markets parsed" is
   * an answer without markets (null); any other skip throws its reason; a budget stop
   * throws BudgetExceededError.
   */
  async fetchEvent(league: string, ref: EventRef<BetclicListingMatch>, budget: ScrapeBudget): Promise<FullMatchOffer | null> {
    setMaxListeners(RUN_SIGNAL_MAX_LISTENERS, budget.signal);
    const matchStats = createBetclicTransportStats();
    try {
      const outcome = await this.fetchMatchOffer(ref.listing, { league, stats: matchStats, budget });
      if (outcome.kind === "written") return outcome.offer;
      if (outcome.kind === "budget") throw new BudgetExceededError(`budget exhausted before ${ref.homeTeam} vs ${ref.awayTeam} completed`);
      if (outcome.reason === "0 markets parsed") return null;
      throw new Error(outcome.reason);
    } finally {
      addBetclicTransportStats(this.totals, matchStats);
    }
  }
}

export const betclicScraper = new BetclicPlaywrightScraper();
