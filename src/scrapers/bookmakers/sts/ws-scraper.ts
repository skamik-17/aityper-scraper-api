/**
 * Browserless STS full-offer scraper: one direct WebSocket session per league
 * call reads the i_pl listing and every fixture snapshot, then maps them with
 * the same mapStsFixtureToOffer the browser path uses.
 *
 * Flow: subscribe i_pl (+ {"t":4}) and wait for its snapshot; derive the
 * fixtures with the strict league filter; ask all fixture snapshots in one
 * subscription; re-send once with n:0 only for the ids still missing; skip
 * what is missing after that (no offer, so no write and no prune), and fail
 * the whole run when the misses trip the breaker.
 */
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import type { FullMatchOffer, FullOfferScraperResult } from "../../../types/full-offer.js";
import { createScrapeBudget, type ScrapeBudget } from "../../shared/budget.js";
import {
  DEFAULT_MAX_DURATION_MS,
  type FullOfferScraper,
  type TransportStats,
  type TransportStatsSource,
} from "../../shared/scraper-contract.js";
import { openWsSession, type WsSession, type WsSessionOptions } from "../../shared/ws/ws-session.js";
import { mapStsFixtureToOffer, stsLog } from "./offer-mapping.js";
import { parseFixtures, parseWebSocketJson } from "./parser.js";
import {
  STS_FALLBACK_HINT,
  STS_IPL_TIMEOUT_MS,
  STS_SNAPSHOT_TIMEOUT_MS,
  STS_SYNC_MESSAGE,
  STS_WS_CONNECT_TIMEOUT_MS,
  STS_WS_HEADERS,
  STS_WS_URL,
  buildStsSubscription,
  classifyStsWsFailure,
  emptyStsCapture,
  fixtureTopic,
  hasIplSnapshot,
  missingSnapshots,
  reduceStsFrame,
  shouldTripStsBreaker,
} from "./ws-protocol.js";

export interface StsWsScraperDeps {
  /** Default: openWsSession */
  openSession?: (opts: WsSessionOptions) => Promise<WsSession>;
}

export class StsWsScraper implements FullOfferScraper, TransportStatsSource {
  readonly bookmaker: PolishBookmaker = "sts";
  readonly transport = "websocket" as const;

  private readonly openSession: (opts: WsSessionOptions) => Promise<WsSession>;
  /** Cumulative and monotonic since construction (README §3); every session adds to it */
  private readonly totalStats = { framesReceived: 0, bytesReceived: 0 };

  constructor(deps: StsWsScraperDeps = {}) {
    this.openSession = deps.openSession ?? openWsSession;
  }

  transportStats(): TransportStats {
    return { ws: { ...this.totalStats } };
  }

  async cleanup(): Promise<void> {
    // Every session is closed by the scrape that opened it
  }

  async scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult> {
    const start = Date.now();
    const fail = (error: string): FullOfferScraperResult => {
      console.error(`[${this.bookmaker}] Full offer scraper error: ${error}`);
      const kind = classifyStsWsFailure(error);
      if (kind !== "transient") console.error(`[STS/WS] ${kind} - ${STS_FALLBACK_HINT}`);
      return { success: false, bookmaker: this.bookmaker, league, matches: [], error, duration: Date.now() - start };
    };

    if (!isLeagueSupported(league, this.bookmaker)) return fail(`Unknown league: ${league}`);
    const runBudget = budget ?? createScrapeBudget(DEFAULT_MAX_DURATION_MS.websocket);

    let session: WsSession | undefined;
    try {
      runBudget.checkpoint();
      session = await this.openSession({
        url: STS_WS_URL,
        headers: { ...STS_WS_HEADERS },
        budget: runBudget,
        connectTimeoutMs: STS_WS_CONNECT_TIMEOUT_MS,
      });
      const ws = session;
      const state = emptyStsCapture();
      const cap = (ms: number) => Math.min(ms, runBudget.remainingMs());
      // Collect first, then send (the session buffers frames either way). The
      // no-op catch keeps a collect whose send threw from becoming an
      // unhandled rejection; awaiting it still throws.
      const collectWhile = (done: (s: typeof state) => boolean, wait: number, ...messages: string[]) => {
        const pending = ws.collect(state, reduceStsFrame, done, wait);
        pending.catch(() => {});
        for (const message of messages) ws.send(message);
        return pending;
      };

      let wait = cap(STS_IPL_TIMEOUT_MS);
      const listing = await collectWhile(
        hasIplSnapshot,
        wait,
        buildStsSubscription([{ topic: "i_pl", snapshot: true }]),
        STS_SYNC_MESSAGE,
      );
      if (listing.timedOut) return fail(`no i_pl snapshot | ws timeout ${wait}ms ${STS_WS_URL}`);

      // The run's only parse of the ~3 MB i_pl
      const ipl = parseWebSocketJson(state.initialData);
      if (!ipl) return fail("Failed to parse WebSocket data");
      // Logs the strict-id miss warning itself
      const fixtures = parseFixtures(ipl, league);
      if (fixtures.length === 0) return fail("No fixtures found for league");
      console.log(stsLog.found(fixtures.length, league));

      const ids = fixtures.map((f) => f.id);
      let missing = ids;
      let resent = 0;
      // The first request plus exactly one re-send for the ids still missing
      for (let round = 0; round < 2 && missing.length > 0; round++) {
        runBudget.checkpoint();
        const ask = new Set(missing);
        wait = cap(STS_SNAPSHOT_TIMEOUT_MS);
        await collectWhile(
          (s) => missingSnapshots(s, ids).length === 0,
          wait,
          buildStsSubscription([
            { topic: "i_pl", snapshot: false },
            ...ids.map((id) => ({ topic: fixtureTopic(id), snapshot: ask.has(id) })),
          ]),
        );
        if (round === 1) resent = ask.size;
        missing = missingSnapshots(state, ids);
      }

      for (const f of fixtures) if (missing.includes(f.id)) console.warn(stsLog.noSnapshot(f));
      const missCause = `${missing.length} of ${ids.length} details failed | ws timeout ${wait}ms ${STS_WS_URL}`;
      if (shouldTripStsBreaker(missing.length, ids.length)) return fail(missCause);

      const matches: FullMatchOffer[] = [];
      for (const fixture of fixtures) {
        const snapshot = state.fixtureData.get(fixture.id);
        if (!snapshot) continue;
        const result = mapStsFixtureToOffer(fixture, snapshot, ipl, league);
        if (result.kind === "skip") {
          if (result.warning !== null) console.warn(result.warning);
          continue;
        }
        matches.push(result.offer);
        console.log(stsLog.matchMarkets(fixture, result.offer.markets.length));
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(stsLog.completed(matches.length, totalMarkets));
      console.log(
        `[STS/WS] Done in ${Date.now() - start}ms: ${ws.stats.framesReceived} frames, ` +
          `${ws.stats.bytesReceived} bytes, ${resent} re-sent`,
      );

      return {
        success: true,
        bookmaker: this.bookmaker,
        league,
        matches,
        ...(missing.length > 0 ? { error: missCause } : {}),
        duration: Date.now() - start,
      };
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    } finally {
      if (session) {
        this.totalStats.framesReceived += session.stats.framesReceived;
        this.totalStats.bytesReceived += session.stats.bytesReceived;
        await session.close();
      }
    }
  }
}
