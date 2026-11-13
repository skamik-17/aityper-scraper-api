/**
 * Betcris full offer over one direct WebSocket session to its BetConstruct
 * Swarm backend: request_session, one competition listing, then one request
 * per game (GAME_CONCURRENCY in flight). A failed, slow or thin game is
 * skipped, never downgraded to its listing copy. A session that drops while
 * the games stream is reopened once, for the games that failed only. Every reply goes through the same
 * pure mapping as the browser path (swarm-offer.ts).
 */
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import type { FullMatchOffer, FullOfferScraperResult } from "../../../types/full-offer.js";
import { BudgetExceededError, createScrapeBudget, type ScrapeBudget } from "../../shared/budget.js";
import { fetchDetailsSkippingFailures, MAX_SKIPPED_DETAIL_RATIO, type DetailFetchOutcome } from "../../shared/detail-fetch.js";
import { createHttpClient, type HttpClient } from "../../shared/http/http-client.js";
import {
  DEFAULT_MAX_DURATION_MS,
  type FullOfferScraper,
  type TransportStats,
  type TransportStatsSource,
} from "../../shared/scraper-contract.js";
import { openWsSession, type WsSession } from "../../shared/ws/ws-session.js";
import { COMPETITION_IDS, SWARM_TRANSPORT } from "./constants.js";
import { parseSwarmDataForFullOffer } from "./parser.js";
import { openSwarmClient, swarmGameParams, swarmListingParams, type SwarmClient } from "./swarm-client.js";
import { createSwarmPartnerConfigCache, type ResolvedSwarmConfig, type SwarmPartnerConfigCache } from "./swarm-config.js";
import { buildBetcrisMatchOffer, detailSkipReason, type BetcrisListingEntry } from "./swarm-offer.js";

export interface BetcrisSwarmDeps {
  http?: HttpClient;
  openSession?: typeof openWsSession;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A dropped or timed-out socket; never a budget or run abort */
function isReopenable(error: Error | null): error is Error {
  return error !== null && !(error instanceof BudgetExceededError) && /^ws (failed|closed|timeout) /.test(error.message);
}

type GameOutcome = DetailFetchOutcome<BetcrisListingEntry, FullMatchOffer | null>;

export class BetcrisSwarmScraper implements FullOfferScraper, TransportStatsSource {
  readonly bookmaker: PolishBookmaker = "betcris";
  /** README §3 / plan 07 DeclaresTransport. */
  readonly transport = "websocket" as const;

  private readonly http: HttpClient;
  private readonly openSession: typeof openWsSession;
  /** One per instance, so the betcrisScraper singleton caches per process */
  private readonly configCache: SwarmPartnerConfigCache;
  /** Cumulative counters of every session this instance has closed */
  private readonly wsTotals = { framesReceived: 0, bytesReceived: 0 };

  constructor(deps: BetcrisSwarmDeps = {}) {
    this.http = deps.http ?? createHttpClient();
    this.openSession = deps.openSession ?? openWsSession;
    this.configCache = createSwarmPartnerConfigCache(this.http);
  }

  async scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult> {
    const start = Date.now();
    const base = { bookmaker: this.bookmaker, league };

    if (!isLeagueSupported(league, this.bookmaker)) {
      return { ...base, success: false, matches: [], error: `Unknown league: ${league}`, duration: Date.now() - start };
    }

    const b = budget ?? createScrapeBudget(DEFAULT_MAX_DURATION_MS.websocket);
    // Every session opened by this call, so its counters reach the totals even when the open fails later
    const sessions: WsSession[] = [];
    const trackedOpen: typeof openWsSession = async (opts) => {
      const session = await this.openSession(opts);
      sessions.push(session);
      return session;
    };
    let client: SwarmClient | null = null;

    try {
      let config: ResolvedSwarmConfig;
      let entries: BetcrisListingEntry[];
      let connectMs: number;
      let listingMs: number;
      try {
        const competitionId = COMPETITION_IDS[league];
        if (competitionId === undefined) throw new Error(`No Betcris competition id for league: ${league}`);

        ({ client, config } = await this.connect(b, trackedOpen));
        connectMs = Date.now() - start;

        const listingStarted = Date.now();
        const listing = await client.request("get", swarmListingParams(competitionId), SWARM_TRANSPORT.LISTING_TIMEOUT_MS);
        listingMs = Date.now() - listingStarted;
        entries = parseSwarmDataForFullOffer(listing.data?.data ?? {}, league, competitionId);
      } catch (e) {
        const error = errorText(e);
        console.error(`[${this.bookmaker}] Full offer scraper error: ${error}`);
        return { ...base, success: false, matches: [], error, duration: Date.now() - start };
      }
      console.log(`[Betcris/FullOffer] Found ${entries.length} games for ${league}`);

      let outcome = await this.fetchGames(client, entries, league, b);
      const dropped = client.dropped;
      if (outcome.skipped.length > 0 && isReopenable(dropped) && b.remainingMs() >= SWARM_TRANSPORT.REOPEN_MIN_BUDGET_MS) {
        console.warn(`[Betcris/Swarm] session dropped (${dropped.message}); reopening once for ${outcome.skipped.length} failed games`);
        void client.close();
        client = null;
        try {
          ({ client } = await this.connect(b, trackedOpen));
          const failed = new Set(outcome.skipped.map((s) => s.id));
          const again = await this.fetchGames(client, entries.filter((e) => failed.has(String(e.game.id))), league, b);
          const order = new Map(entries.map((e, i) => [e, i]));
          outcome = {
            fetched: [...outcome.fetched, ...again.fetched].sort((x, y) => order.get(x.event)! - order.get(y.event)!),
            skipped: again.skipped,
          };
        } catch (e) {
          // The reopen itself failed: the first session's skipped games stand
          console.warn(`[Betcris/Swarm] reopen failed: ${errorText(e)}`);
        }
      }

      const matches: FullMatchOffer[] = [];
      for (const { event, detail } of outcome.fetched) {
        if (!detail) continue; // a game without markets is dropped, as in the browser path
        matches.push(detail);
        console.log(`[Betcris/FullOffer] ${event.teams.homeTeam} vs ${event.teams.awayTeam}: ${detail.markets.length} markets`);
      }
      const byId = new Map(entries.map((e) => [String(e.game.id), e]));
      for (const { id, error } of outcome.skipped) {
        const e = byId.get(id);
        console.warn(`[Betcris/FullOffer] Skipped game ${id} (${e?.teams.homeTeam} vs ${e?.teams.awayTeam}): ${error}`);
      }
      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(`[Betcris/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`);

      const n = outcome.skipped.length;
      const m = outcome.fetched.length + n;
      let error: string | undefined;
      if (n > 0) {
        error = `${n} of ${m} details failed | ${outcome.skipped[0].error}`;
        console.warn(`[${this.bookmaker}] ${error}`);
        if (n / m > MAX_SKIPPED_DETAIL_RATIO) {
          return { ...base, success: false, matches: [], error, duration: Date.now() - start };
        }
      }

      const ws = this.sumSessions(sessions);
      console.log(
        `[Betcris] capture ok: transport=swarm, games=${entries.length}, fetched=${outcome.fetched.length}, skipped=${n}, connectMs=${connectMs}, listingMs=${listingMs}, totalMs=${Date.now() - start}, frames=${ws.framesReceived}, bytes=${ws.bytesReceived}, config=${config.source}`
      );
      return { ...base, success: true, matches, ...(error ? { error } : {}), duration: Date.now() - start };
    } finally {
      const ws = this.sumSessions(sessions);
      this.wsTotals.framesReceived += ws.framesReceived;
      this.wsTotals.bytesReceived += ws.bytesReceived;
      // Not awaited: a server that ignores our close frame (live: 1006) must not
      // add the session's terminate delay to the result.
      void client?.close();
    }
  }

  /** One request per game (GAME_CONCURRENCY in flight), each mapped as soon as it arrives */
  private fetchGames(
    swarm: SwarmClient,
    entries: readonly BetcrisListingEntry[],
    league: string,
    budget: ScrapeBudget
  ): Promise<GameOutcome> {
    return fetchDetailsSkippingFailures(
      entries,
      (e) => String(e.game.id),
      async (e) => {
        const reply = await swarm.request("get", swarmGameParams(e.game.id), SWARM_TRANSPORT.GAME_TIMEOUT_MS);
        const data = reply.data?.data ?? {};
        // A missing or thin copy (`market: {}`, the 1X2 only) is a failed game, never its listing copy
        const skip = detailSkipReason(e, data);
        if (skip) throw new Error(`swarm ${skip}`);
        // Mapped here, so no raw payload outlives its game
        return buildBetcrisMatchOffer(e, data, league, new Date());
      },
      { concurrency: SWARM_TRANSPORT.GAME_CONCURRENCY, budget }
    );
  }

  /** Up to OPEN_ATTEMPTS: config (cached), socket and Swarm session; a failed open re-reads the config */
  private async connect(
    budget: ScrapeBudget,
    open: typeof openWsSession
  ): Promise<{ client: SwarmClient; config: ResolvedSwarmConfig }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= SWARM_TRANSPORT.OPEN_ATTEMPTS; attempt++) {
      budget.checkpoint();
      const config = await this.configCache.get(budget.signal);
      try {
        return { client: await openSwarmClient(config, budget, open), config };
      } catch (e) {
        lastError = e;
        // A budget or run abort is final; anything else may be a retired host
        if (budget.signal.aborted) throw e;
        this.configCache.invalidate();
        if (attempt < SWARM_TRANSPORT.OPEN_ATTEMPTS) {
          await new Promise<void>((resolve) => setTimeout(resolve, SWARM_TRANSPORT.OPEN_RETRY_DELAY_MS));
          budget.checkpoint();
        }
      }
    }
    throw lastError;
  }

  private sumSessions(sessions: readonly WsSession[]): { framesReceived: number; bytesReceived: number } {
    return sessions.reduce(
      (acc, s) => ({ framesReceived: acc.framesReceived + s.stats.framesReceived, bytesReceived: acc.bytesReceived + s.stats.bytesReceived }),
      { framesReceived: 0, bytesReceived: 0 }
    );
  }

  /** Cumulative since construction (README §3: monotonic; consumers diff two readings) */
  transportStats(): TransportStats {
    return {
      http: { ...this.http.stats, byStatus: { ...this.http.stats.byStatus } },
      ws: { ...this.wsTotals },
    };
  }

  /** Nothing to release: each scrapeFullOffer closes its own socket */
  async cleanup(): Promise<void> {}
}
