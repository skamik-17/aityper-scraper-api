/**
 * Browserless PZBuk full-offer scraper: one Node WebSocket session to the
 * site's `sportsbook-api/ws`, one listing subscription and one offer
 * subscription for every listed event (`ws-direct.ts`), in about one second.
 *
 * An event is written only when every declared market group delivered its
 * `marketsCount` markets; incomplete events are skipped (no write, no prune).
 * The result follows the `HttpScraper` template: more than
 * MAX_SKIPPED_DETAIL_RATIO skipped fails the scrape with the first cause.
 * A dropped, refused or timed-out session is retried once.
 */
import type { PolishBookmaker } from "../../../config/index.js";
import { getBookmakerLeagueId, isLeagueSupported } from "../../../config/leagues.js";
import type { FullMatchOffer, FullOfferScraperResult } from "../../../types/full-offer.js";
import { BudgetExceededError, createScrapeBudget, type ScrapeBudget } from "../../shared/budget.js";
import { MAX_SKIPPED_DETAIL_RATIO } from "../../shared/detail-fetch.js";
import {
  DEFAULT_MAX_DURATION_MS,
  type FullOfferScraper,
  type TransportStats,
  type TransportStatsSource,
} from "../../shared/scraper-contract.js";
import { openWsSession, type WsSession, type WsSessionOptions } from "../../shared/ws/ws-session.js";
import { mapEventOffer } from "./full-offer-mapper.js";
import { describeCoverage, isCoverageComplete } from "./offer-coverage.js";
import { isValidEvent, parseTeamNames } from "./parser.js";
import {
  PZBUK_WS_HEADERS,
  PZBUK_WS_URL,
  coverageFor,
  describeDirectState,
  initialDirectState,
  isDirectSessionDone,
  offerFor,
  reduceDirectFrame,
  type DirectSessionState,
} from "./ws-direct.js";
import { addFrameCounters, emptyFrameCounters, errorMessage, type PzbukFrameCounters } from "./ws-protocol.js";

export const PZBUK_CONNECT_TIMEOUT_MS = 10_000;
export const PZBUK_COLLECT_TIMEOUT_MS = 15_000;

export interface PzbukWsDeps {
  /** Default: openWsSession. */
  openSession?: (opts: WsSessionOptions) => Promise<WsSession>;
  /** Delay before the one retry. Default: 0–499 ms full jitter. */
  retryDelayMs?: () => number;
}

const RETRYABLE = [/^ws (failed|closed|timeout) /, /^ws handshake HTTP (429|5\d\d) /];

const isRetryable = (error: unknown) =>
  !(error instanceof BudgetExceededError) && RETRYABLE.some((re) => re.test(errorMessage(error)));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class PzbukWsScraper implements FullOfferScraper, TransportStatsSource {
  readonly bookmaker: PolishBookmaker = "pzbuk";
  /** Read by plan 07's job classification (DeclaresTransport). */
  readonly transport = "websocket" as const;

  private readonly openSession: (opts: WsSessionOptions) => Promise<WsSession>;
  private readonly retryDelayMs: () => number;
  /** Cumulative since construction (README §3: monotonic; consumers diff). */
  private readonly ws = { framesReceived: 0, bytesReceived: 0 };
  private readonly counters: PzbukFrameCounters = emptyFrameCounters();

  constructor(deps: PzbukWsDeps = {}) {
    this.openSession = deps.openSession ?? openWsSession;
    this.retryDelayMs = deps.retryDelayMs ?? (() => Math.floor(Math.random() * 500));
  }

  async scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult> {
    const start = Date.now();
    const base = { bookmaker: this.bookmaker, league };

    if (!isLeagueSupported(league, this.bookmaker)) {
      return { ...base, success: false, matches: [], error: `Unknown league: ${league}`, duration: Date.now() - start };
    }

    let state: DirectSessionState;
    try {
      const b = budget ?? createScrapeBudget(DEFAULT_MAX_DURATION_MS.websocket);
      b.checkpoint();
      state = await this.collectWithRetry(Number(getBookmakerLeagueId(league, this.bookmaker)), b);
    } catch (e) {
      const error = errorMessage(e);
      console.error(`[${this.bookmaker}] Full offer scraper error: ${error}`);
      return { ...base, success: false, matches: [], error, duration: Date.now() - start };
    }

    const { matches, skipped } = this.mapListing(state, league);
    const n = skipped.length;
    if (n === 0) return { ...base, success: true, matches, duration: Date.now() - start };

    const error = `${n} of ${matches.length + n} details failed | ${skipped[0]}`;
    if (n / (matches.length + n) > MAX_SKIPPED_DETAIL_RATIO) {
      return { ...base, success: false, matches: [], error, duration: Date.now() - start };
    }
    return { ...base, success: true, matches, error, duration: Date.now() - start };
  }

  /** `{ ws: { framesReceived, bytesReceived } }`, cumulative over every session; a copy. */
  transportStats(): TransportStats {
    return { ws: { ...this.ws } };
  }

  /** Invalid/chunked frames and the largest frame, cumulative over every session; a copy. */
  frameCounters(): PzbukFrameCounters {
    return { ...this.counters };
  }

  async cleanup(): Promise<void> {}

  private async collectWithRetry(leagueId: number, budget: ScrapeBudget): Promise<DirectSessionState> {
    try {
      return await this.attempt(leagueId, budget);
    } catch (error) {
      if (!isRetryable(error) || budget.remainingMs() < PZBUK_COLLECT_TIMEOUT_MS) throw error;
      console.warn(`[PZBuk/WS] retrying once after: ${errorMessage(error)}`);
      await sleep(this.retryDelayMs());
      budget.checkpoint();
      return await this.attempt(leagueId, budget);
    }
  }

  /** One session: SETUP → listing → offer, until every target event is covered or the collect times out. */
  private async attempt(leagueId: number, budget: ScrapeBudget): Promise<DirectSessionState> {
    const started = Date.now();
    const session = await this.openSession({
      url: PZBUK_WS_URL,
      headers: { ...PZBUK_WS_HEADERS },
      budget,
      connectTimeoutMs: PZBUK_CONNECT_TIMEOUT_MS,
    });
    const ms = Math.min(PZBUK_COLLECT_TIMEOUT_MS, budget.remainingMs());
    // Held here: reduceDirectFrame mutates it, so it is readable even when collect rejects.
    const state = initialDirectState();
    let timedOut = false;
    try {
      ({ timedOut } = await session.collect(
        state,
        (s, frame) => reduceDirectFrame(s, frame, leagueId, (data) => session.send(data)),
        isDirectSessionDone,
        ms
      ));
    } finally {
      await session.close();
      this.ws.framesReceived += session.stats.framesReceived;
      this.ws.bytesReceived += session.stats.bytesReceived;
      addFrameCounters(this.counters, state.diagnostics);
      console.log(
        `[PZBuk/WS] ${session.stats.framesReceived} frames, ${session.stats.bytesReceived} bytes in ${Date.now() - started}ms${timedOut ? " (timed out)" : ""}`
      );
    }

    if (timedOut && state.listing === null) {
      throw new Error(`ws timeout ${ms}ms ${PZBUK_WS_URL} | no listing (${describeDirectState(state)})`);
    }
    if (timedOut && state.targetIds.length > 0 && state.offerMessages === 0) {
      throw new Error(
        `ws timeout ${ms}ms ${PZBUK_WS_URL} | no offer for ${state.targetIds.length} event(s) (${describeDirectState(state)})`
      );
    }
    return state;
  }

  /** Maps every valid listed event, or names why it was skipped. */
  private mapListing(state: DirectSessionState, league: string): { matches: FullMatchOffer[]; skipped: string[] } {
    const listing = state.listing!;
    console.log(`[PZBuk/FullOffer] Found ${listing.events.length} events in listing`);
    if (listing.events.length === 0) console.log("[PZBuk/FullOffer] listing is empty");

    const matches: FullMatchOffer[] = [];
    const skipped: string[] = [];
    const targets = new Set(state.targetIds.map(String));

    for (const event of listing.events) {
      if (!isValidEvent(event)) continue;
      const teams = parseTeamNames(event);
      const label = `${teams.homeTeam} vs ${teams.awayTeam}`;
      const key = String(event.id);
      const coverage = coverageFor(state, event.id);

      let kind: string;
      if (!targets.has(key)) {
        kind = "no market groups declared";
      } else if (!isCoverageComplete(coverage)) {
        const present = state.offerEvents.has(key) || coverage.uniqueMarkets > 0;
        kind = `${present ? "incomplete" : "not in offer"} (${describeCoverage(coverage)})`;
      } else {
        const match = mapEventOffer(event, offerFor(state, event.id), league, new Date());
        if (match !== null) {
          matches.push(match);
          console.log(`[PZBuk/FullOffer] ${label}: ${match.markets.length} markets (${describeCoverage(coverage)})`);
          continue;
        }
        kind = "0 parsed markets";
      }

      const reason = `${event.id} ${label}: ${kind}`;
      console.warn(`[PZBuk/FullOffer] skipped ${reason}`);
      skipped.push(reason);
    }

    const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
    console.log(`[PZBuk/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`);
    return { matches, skipped };
  }
}
